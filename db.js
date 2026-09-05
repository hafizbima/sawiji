const { createClient } = require('@libsql/client');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  session_no INTEGER NOT NULL,
  time TEXT,
  coach TEXT,
  class_name TEXT NOT NULL,
  quota INTEGER NOT NULL DEFAULT 6
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  customer_name TEXT,
  phone TEXT,
  schedule_id INTEGER,
  session_count INTEGER,
  nominal INTEGER,
  payment_method TEXT,
  payment_status TEXT,
  paid_by TEXT,
  ref_id INTEGER,
  from_schedule_id INTEGER,
  to_schedule_id INTEGER,
  reason TEXT,
  admin TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL,
  paid_by TEXT,
  created_at TEXT NOT NULL
);
`;

function init(url, authToken) {
  db = createClient({
    url: url || process.env.TURSO_DATABASE_URL || 'file:pilates.db',
    authToken: authToken || process.env.TURSO_AUTH_TOKEN || undefined
  });
  return db.executeMultiple(SCHEMA).then(() => db);
}

function getDB() { return db; }

const STATES = { hold: 'hold', confirmed: 'confirmed', cancelled: 'cancelled', waitlist: 'waitlist' };

async function rebuildFromLedger() {
  const sched = await db.execute('SELECT id, quota FROM schedule');
  const quota = new Map(sched.rows.map(s => [s.id, s.quota]));
  const ledger = await db.execute('SELECT * FROM ledger ORDER BY id');
  const byId = new Map(ledger.rows.map(l => [l.id, l]));

  // state: key `${schedule_id}|${customer_name}` -> booking object
  const state = new Map();

  const activeCount = (sid) => {
    let c = 0;
    for (const b of state.values()) {
      if (b.schedule_id === sid && (b.status === 'hold' || b.status === 'confirmed')) c++;
    }
    return c;
  };

  for (const e of ledger.rows) {
    const key = (sid, name) => `${sid}|${name}`;
    if (e.type === 'booking_new') {
      if (e.schedule_id == null || !e.customer_name) continue;
      const q = quota.get(e.schedule_id) ?? 6;
      const status = activeCount(e.schedule_id) >= q ? 'waitlist' : 'hold';
      state.set(key(e.schedule_id, e.customer_name), {
        schedule_id: e.schedule_id,
        customer_name: e.customer_name,
        phone: e.phone || null,
        status,
        paid_by: e.paid_by || null,
        created_at: e.created_at
      });
    } else if (e.type === 'payment') {
      let sid = e.schedule_id, name = e.customer_name;
      if (e.ref_id && byId.has(e.ref_id)) {
        const ref = byId.get(e.ref_id);
        sid = ref.schedule_id ?? sid;
        name = ref.customer_name || name;
      }
      if (sid == null || !name) continue;
      const b = state.get(key(sid, name));
      if (b && b.status === 'hold') { b.status = 'confirmed'; b.paid_by = e.paid_by || b.paid_by; }
    } else if (e.type === 'cancel') {
      let sid = e.schedule_id, name = e.customer_name;
      if (e.ref_id && byId.has(e.ref_id)) {
        const ref = byId.get(e.ref_id);
        sid = ref.schedule_id ?? sid;
        name = ref.customer_name || name;
      }
      if (sid == null || !name) continue;
      const b = state.get(key(sid, name));
      if (b && b.status !== 'cancelled') b.status = 'cancelled';
    } else if (e.type === 'reschedule') {
      if (e.from_schedule_id == null || e.to_schedule_id == null || !e.customer_name) continue;
      const old = state.get(key(e.from_schedule_id, e.customer_name));
      if (old && old.status !== 'cancelled') old.status = 'cancelled';
      const q = quota.get(e.to_schedule_id) ?? 6;
      const status = activeCount(e.to_schedule_id) >= q ? 'waitlist' : 'hold';
      state.set(key(e.to_schedule_id, e.customer_name), {
        schedule_id: e.to_schedule_id,
        customer_name: e.customer_name,
        phone: e.phone || (old && old.phone) || null,
        status,
        paid_by: (old && old.paid_by) || null,
        created_at: e.created_at
      });
    }
    // session_use, add_package, refund, transfer: log saja, tidak mengubah booking
  }

  const stmts = ['DELETE FROM bookings'];
  for (const b of state.values()) {
    stmts.push({
      sql: 'INSERT INTO bookings (schedule_id, customer_name, phone, status, paid_by, created_at) VALUES (?,?,?,?,?,?)',
      args: [b.schedule_id, b.customer_name, b.phone, b.status, b.paid_by, b.created_at]
    });
  }
  await db.batch(stmts, 'write');
}

async function getSchedule() {
  const [s, b] = await Promise.all([
    db.execute('SELECT * FROM schedule ORDER BY date, session_no'),
    db.execute("SELECT * FROM bookings WHERE status IN ('hold','confirmed','waitlist') ORDER BY id")
  ]);
  const bySlot = new Map();
  for (const r of b.rows) {
    if (!bySlot.has(r.schedule_id)) bySlot.set(r.schedule_id, []);
    bySlot.get(r.schedule_id).push(r);
  }
  return s.rows.map(slot => {
    const list = bySlot.get(slot.id) || [];
    const hold = list.filter(p => p.status === 'hold').length;
    const confirmed = list.filter(p => p.status === 'confirmed').length;
    const waitlist = list.filter(p => p.status === 'waitlist');
    const sisa = slot.quota - hold - confirmed;
    const status = sisa <= 0 ? 'FULL' : sisa <= 2 ? 'Hampir Penuh' : 'Tersedia';
    return { ...slot, hold, confirmed, waitlist: waitlist.length, sisa, status,
      participants: list.filter(p => p.status !== 'waitlist'),
      waitlistEntries: waitlist };
  });
}

async function getHoldQueue() {
  const r = await db.execute(`
    SELECT b.id, b.customer_name, b.phone, b.schedule_id, s.date, s.time, s.class_name, s.coach, s.session_no
    FROM bookings b JOIN schedule s ON b.schedule_id = s.id
    WHERE b.status = 'hold' ORDER BY b.created_at`);
  return r.rows;
}

async function getLedger({ type, customer, startDate, endDate } = {}) {
  let sql = `SELECT l.*, r.id AS r_ref_id, r.type AS r_ref_type, r.customer_name AS r_ref_customer
    FROM ledger l LEFT JOIN ledger r ON l.ref_id = r.id WHERE 1=1`;
  const args = [];
  if (type) { sql += ' AND l.type = ?'; args.push(type); }
  if (customer) { sql += ' AND l.customer_name LIKE ?'; args.push(`%${customer}%`); }
  if (startDate) { sql += ' AND date(l.created_at) >= ?'; args.push(startDate); }
  if (endDate) { sql += ' AND date(l.created_at) <= ?'; args.push(endDate); }
  sql += ' ORDER BY l.id DESC LIMIT 500'; // ponytail: 500 terbaru; filter tanggal untuk lebih lama, pagination kalau terasa
  const entries = (await db.execute({ sql, args })).rows;
  for (const e of entries) {
    e.refTransaction = e.r_ref_id
      ? { id: e.r_ref_id, type: e.r_ref_type, customer_name: e.r_ref_customer }
      : null;
  }
  return entries;
}

async function addTransaction(data, skipRebuild) {
  const now = new Date().toISOString();
  const cols = ['created_at', 'type', 'customer_name', 'phone', 'schedule_id', 'session_count', 'nominal', 'payment_method', 'payment_status', 'paid_by', 'ref_id', 'from_schedule_id', 'to_schedule_id', 'reason', 'admin', 'notes'];
  const vals = [now, data.type, data.customer_name, data.phone, data.schedule_id, data.session_count, data.nominal, data.payment_method, data.payment_status, data.paid_by, data.ref_id, data.from_schedule_id, data.to_schedule_id, data.reason, data.admin, data.notes].map(v => v ?? null);
  const r = await db.execute({
    sql: `INSERT INTO ledger (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    args: vals
  });
  if (!skipRebuild) await rebuildFromLedger();
  return Number(r.lastInsertRowid);
}

async function addSchedule(data) {
  const r = await db.execute({
    sql: 'INSERT INTO schedule (date, session_no, time, coach, class_name, quota) VALUES (?,?,?,?,?,?)',
    args: [data.date, data.session_no, data.time, data.coach, data.class_name, data.quota || 6]
  });
  return Number(r.lastInsertRowid);
}

async function deleteSchedule(id) {
  const r = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM bookings WHERE schedule_id = ? AND status IN ('hold','confirmed')",
    args: [id]
  });
  if (r.rows[0].c > 0) return false;
  await db.execute({ sql: 'DELETE FROM schedule WHERE id = ?', args: [id] });
  return true;
}

module.exports = { init, rebuildFromLedger, getSchedule, getHoldQueue, getLedger, addTransaction, addSchedule, deleteSchedule, getDB, STATES };