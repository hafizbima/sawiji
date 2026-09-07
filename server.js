const express = require('express');
const layouts = require('express-ejs-layouts');
const crypto = require('crypto');
const path = require('path');
const { init, getSchedule, getHoldQueue, getLedger, addTransaction, addSchedule, deleteSchedule,
  addConsumer, getConsumers, getConsumer, addAttendance, getAttendance, grantPackage, getTemplate, setTemplate, PACKAGES } = require('./db');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || 'sawiji';
const SECRET = process.env.SECRET || 'dev-secret-ganti-di-produksi';
// ponytail: SECRET fallback hardcoded untuk dev; env SECRET wajib diset di produksi

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(layouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ponytail: session = HMAC signed cookie statis (tanpa expiry) — sesuai untuk tool internal;
// upgrade path: tambah payload exp + rotasi kunci jika dibutuhkan
function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}
function makeToken() {
  const value = crypto.randomUUID();
  return `${value}.${sign(value)}`;
}
function verifyToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 1) return false;
  const value = token.slice(0, i), sig = token.slice(i + 1);
  const expected = sign(value);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
function setSession(res) {
  res.setHeader('Set-Cookie', `session=${makeToken()}; HttpOnly; SameSite=Lax; Path=/`);
}
function requireAuth(req, res, next) {
  if (verifyToken(getCookie(req, 'session'))) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (verifyToken(getCookie(req, 'session'))) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

app.post('/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    setSession(res);
    return res.redirect('/');
  }
  res.render('login', { layout: false, error: 'Password salah' });
});

app.use(requireAuth);

app.get('/', async (req, res, next) => {
  try {
    const schedule = await getSchedule();
    const today = new Date().toLocaleDateString('sv');
    const todaySchedule = schedule.filter(s => s.date === today);
    const hold = await getHoldQueue();
    res.render('dashboard', { scheduleCount: schedule.length, holdCount: hold.length, todaySchedule: todaySchedule.slice(0, 5) });
  } catch (e) { next(e); }
});

function monthParam(q) {
  const now = new Date().toLocaleDateString('sv').slice(0, 7);
  if (q === 'all') return null;
  return /^\d{4}-\d{2}$/.test(q || '') ? q : now;
}

app.get('/jadwal', async (req, res, next) => {
  try {
    const month = monthParam(req.query.month);
    res.render('jadwal', { schedule: await getSchedule({ month }), month });
  } catch (e) { next(e); }
});

app.post('/jadwal/tambah', async (req, res, next) => {
  try {
    await addSchedule(req.body);
    res.redirect('/jadwal');
  } catch (e) { next(e); }
});

app.post('/jadwal/:id/hapus', async (req, res, next) => {
  try {
    await deleteSchedule(Number(req.params.id));
    res.redirect('/jadwal');
  } catch (e) { next(e); }
});

app.get('/hold', async (req, res, next) => {
  try {
    res.render('hold', { hold: await getHoldQueue() });
  } catch (e) { next(e); }
});

app.post('/hold/:id/confirm', async (req, res, next) => {
  try {
    const { getDB } = require('./db');
    const db = getDB();
    const booking = (await db.execute({ sql: 'SELECT * FROM bookings WHERE id = ?', args: [Number(req.params.id)] })).rows[0];
    if (!booking) return res.redirect('/hold');
    await addTransaction({
      type: 'payment',
      customer_name: booking.customer_name,
      phone: booking.phone,
      schedule_id: booking.schedule_id,
      paid_by: req.body.paid_by || null,
      payment_method: req.body.payment_method || null,
      nominal: req.body.nominal ? Number(req.body.nominal) : null,
      payment_status: 'Lunas',
      admin: req.body.admin || 'admin'
    });
    res.redirect('/hold');
  } catch (e) { next(e); }
});

app.get('/transaksi/baru', async (req, res, next) => {
  try {
    const { getDB } = require('./db');
    const month = monthParam(req.query.month);
    const schedule = await getSchedule({ month });
    const ledger = (await getDB().execute('SELECT id, type, customer_name FROM ledger ORDER BY id DESC LIMIT 50')).rows;
    const consumers = await getConsumers();
    res.render('transaksi-form', { schedule, ledger, consumers, data: {}, month });
  } catch (e) { next(e); }
});

app.post('/transaksi/baru', async (req, res, next) => {
  try {
    await addTransaction({
      type: req.body.type,
      customer_name: req.body.customer_name,
      phone: req.body.phone || null,
      schedule_id: req.body.schedule_id ? Number(req.body.schedule_id) : null,
      session_count: req.body.session_count ? Number(req.body.session_count) : null,
      nominal: req.body.nominal ? Number(req.body.nominal) : null,
      payment_method: req.body.payment_method || null,
      payment_status: req.body.payment_status || null,
      paid_by: req.body.paid_by || null,
      ref_id: req.body.ref_id ? Number(req.body.ref_id) : null,
      from_schedule_id: req.body.from_schedule_id ? Number(req.body.from_schedule_id) : null,
      to_schedule_id: req.body.to_schedule_id ? Number(req.body.to_schedule_id) : null,
      reason: req.body.reason || null,
      admin: req.body.admin || 'admin',
      notes: req.body.notes || null,
      consumer_id: req.body.consumer_id ? Number(req.body.consumer_id) : null,
      package: req.body.package || null
    });
    res.redirect('/riwayat');
  } catch (e) { next(e); }
});

app.get('/riwayat', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const ledger = await getLedger({
      type: req.query.type || null,
      customer: req.query.customer || null,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      page
    });
    res.render('riwayat', { ledger, filters: { ...req.query, page } });
  } catch (e) { next(e); }
});

app.get('/transaksi/:id/template', async (req, res, next) => {
  try {
    const { getDB } = require('./db');
    const entry = (await getDB().execute({ sql: 'SELECT * FROM ledger WHERE id = ?', args: [Number(req.params.id)] })).rows[0];
    if (!entry) return res.status(404).send('Not found');
    let slot = null;
    if (entry.schedule_id) {
      slot = (await getDB().execute({ sql: 'SELECT * FROM schedule WHERE id = ?', args: [entry.schedule_id] })).rows[0] || null;
    }
    const hari = slot ? new Date(slot.date).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const tmpl = await getTemplate();
    const template = tmpl
      .replace('{nama}', entry.customer_name || '')
      .replace('{kelas}', slot ? slot.class_name : '')
      .replace('{hari}', hari)
      .replace('{jam}', slot ? slot.time : '');
    res.render('template', { template, entry, slot });
  } catch (e) { next(e); }
});

app.get('/pengaturan', async (req, res, next) => {
  try {
    res.render('pengaturan', { template: await getTemplate(), saved: req.query.saved || null });
  } catch (e) { next(e); }
});

app.post('/pengaturan', async (req, res, next) => {
  try {
    await setTemplate(req.body.template || '');
    res.redirect('/pengaturan?saved=1');
  } catch (e) { next(e); }
});

app.post('/konsumen/:id/paket', async (req, res, next) => {
  try {
    const cid = Number(req.params.id);
    const { getDB } = require('./db');
    const c = (await getDB().execute({ sql: 'SELECT name FROM consumers WHERE id = ?', args: [cid] })).rows[0];
    if (!c) return res.status(404).send('Konsumen tidak ditemukan');
    await addTransaction({
      type: 'add_package',
      customer_name: c.name,
      consumer_id: cid,
      package: req.body.package,
      nominal: req.body.nominal ? Number(req.body.nominal) : null,
      payment_method: req.body.payment_method || null,
      payment_status: 'Lunas',
      admin: req.body.admin || 'admin'
    });
    res.redirect('/konsumen/' + cid);
  } catch (e) { next(e); }
});

app.get('/export/:what', async (req, res, next) => {
  try {
    const { getDB } = require('./db');
    const map = {
      'ledger.csv': 'SELECT * FROM ledger ORDER BY id',
      'jadwal.csv': 'SELECT * FROM schedule ORDER BY date, session_no'
    };
    const sql = map[req.params.what];
    if (!sql) return res.status(404).send('Tidak dikenal');
    const rows = (await getDB().execute(sql)).rows;
    const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const cols = Object.keys(rows[0] || {});
    const body = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.what}"`);
    res.send('\uFEFF' + body); // BOM agar Excel baca UTF-8 benar
  } catch (e) { next(e); }
});

app.get('/konsumen', async (req, res, next) => {
  try {
    res.render('konsumen', { consumers: await getConsumers(req.query.q || null), error: req.query.err || null });
  } catch (e) { next(e); }
});

app.post('/konsumen', async (req, res, next) => {
  try {
    await addConsumer(req.body);
    res.redirect('/konsumen');
  } catch (e) {
    if (e.message === 'NAMA SUDAH TERDAFTAR' || e.message === 'Nama wajib diisi') return res.redirect('/konsumen?err=' + encodeURIComponent(e.message));
    next(e);
  }
});

app.get('/konsumen/:id', async (req, res, next) => {
  try {
    const data = await getConsumer(Number(req.params.id));
    if (!data) return res.status(404).send('Konsumen tidak ditemukan');
    res.render('konsumen-detail', data);
  } catch (e) { next(e); }
});

app.get('/absensi', async (req, res, next) => {
  try {
    const consumers = await getConsumers();
    const attendance = await getAttendance();
    res.render('absensi', { consumers, attendance, error: req.query.err || null });
  } catch (e) { next(e); }
});

app.post('/absensi', async (req, res, next) => {
  try {
    await addAttendance({
      consumer_id: Number(req.body.consumer_id),
      session_id: Number(req.body.session_id),
      status: req.body.status,
      replacement_id: req.body.replacement_id ? Number(req.body.replacement_id) : null,
      admin: req.body.admin || 'admin'
    });
    res.redirect('/absensi');
  } catch (e) {
    if (/sudah|wajib|tidak ditemukan|tidak dikenal/i.test(e.message)) return res.redirect('/absensi?err=' + encodeURIComponent(e.message));
    next(e);
  }
});

app.get('/membership', async (req, res, next) => {
  try {
    const all = await getConsumers();
    res.render('membership', { members: all.filter(c => c.package !== 'Non-member') });
  } catch (e) { next(e); }
});

app.get('/api/hold-count', async (req, res, next) => {
  try {
    res.json({ count: (await getHoldQueue()).length });
  } catch (e) { next(e); }
});

app.get('/api/jadwal', async (req, res, next) => {
  try {
    const schedule = await getSchedule();
    const filtered = req.query.date ? schedule.filter(s => s.date === req.query.date) : schedule;
    res.json(filtered.map(s => ({ id: s.id, date: s.date, session_no: s.session_no, time: s.time, coach: s.coach, class_name: s.class_name, sisa: s.sisa, status: s.status })));
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Terjadi kesalahan server');
});

init();

if (require.main === module) {
  app.listen(PORT, () => console.log(`Sawiji Pilates: http://localhost:${PORT}`));
}
module.exports = app;