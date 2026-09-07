const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { init, getDB, addSchedule, addTransaction, getSchedule, addConsumer, getConsumers, getConsumer, addAttendance, getAttendance, getMembership } = require('./db');

describe('Sawiji Pilates DB', () => {
  before(async () => {
    await init('file::memory:');
  });

  async function resetDB() {
    const db = getDB();
    await db.executeMultiple('DELETE FROM bookings; DELETE FROM ledger; DELETE FROM schedule; DELETE FROM attendance; DELETE FROM consumers;');
  }

  it('replay: booking_new creates hold', async () => {
    await resetDB();
    const sid = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 6 });
    await addTransaction({ type: 'booking_new', customer_name: 'Test User', schedule_id: sid, admin: 'test' });
    const sched = await getSchedule();
    assert.equal(sched[0].hold, 1);
    assert.equal(sched[0].confirmed, 0);
    assert.equal(sched[0].sisa, 5);
  });

  it('replay: payment upgrades hold to confirmed', async () => {
    await resetDB();
    const sid = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 6 });
    await addTransaction({ type: 'booking_new', customer_name: 'Test User', schedule_id: sid, admin: 'test' });
    await addTransaction({ type: 'payment', customer_name: 'Test User', schedule_id: sid, nominal: 150000, payment_status: 'Lunas', admin: 'test' });
    const sched = await getSchedule();
    assert.equal(sched[0].hold, 0);
    assert.equal(sched[0].confirmed, 1);
    assert.equal(sched[0].sisa, 5);
  });

  it('replay: cancel removes from count', async () => {
    await resetDB();
    const sid = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 6 });
    await addTransaction({ type: 'booking_new', customer_name: 'Test User', schedule_id: sid, admin: 'test' });
    await addTransaction({ type: 'cancel', customer_name: 'Test User', schedule_id: sid, reason: 'test', admin: 'test' });
    const sched = await getSchedule();
    assert.equal(sched[0].hold, 0);
    assert.equal(sched[0].confirmed, 0);
    assert.equal(sched[0].sisa, 6);
  });

  it('replay: reschedule moves booking', async () => {
    await resetDB();
    const sid1 = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 6 });
    const sid2 = await addSchedule({ date: '2026-09-02', session_no: 1, time: '08:30', coach: 'Tifa', class_name: 'Basic', quota: 6 });
    await addTransaction({ type: 'booking_new', customer_name: 'Test User', schedule_id: sid1, admin: 'test' });
    await addTransaction({ type: 'reschedule', customer_name: 'Test User', from_schedule_id: sid1, to_schedule_id: sid2, reason: 'test', admin: 'test' });
    const sched = await getSchedule();
    const slot1 = sched.find(s => s.id === sid1);
    const slot2 = sched.find(s => s.id === sid2);
    assert.equal(slot1.hold, 0);
    assert.equal(slot2.hold, 1);
  });

  it('replay: over-quota goes to waitlist', async () => {
    await resetDB();
    const sid = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 1 });
    await addTransaction({ type: 'booking_new', customer_name: 'User A', schedule_id: sid, admin: 'test' });
    await addTransaction({ type: 'booking_new', customer_name: 'User B', schedule_id: sid, admin: 'test' });
    const sched = await getSchedule();
    assert.equal(sched[0].hold, 1);
    assert.equal(sched[0].waitlist, 1);
    assert.equal(sched[0].status, 'FULL');
  });

  it('replay: payment via ref_id upgrades booking', async () => {
    await resetDB();
    const sid = await addSchedule({ date: '2026-09-01', session_no: 1, time: '07:30', coach: 'Gitta', class_name: 'Basic', quota: 6 });
    const bid = await addTransaction({ type: 'booking_new', customer_name: 'Ref User', schedule_id: sid, admin: 'test' });
    await addTransaction({ type: 'payment', customer_name: 'Ref User', ref_id: bid, nominal: 150000, payment_status: 'Lunas', admin: 'test' });
    const sched = await getSchedule();
    assert.equal(sched[0].confirmed, 1);
    assert.equal(sched[0].hold, 0);
  });

  it('consumer: duplicate name rejected', async () => {
    await resetDB();
    await addConsumer({ name: 'Budi Santoso', phone: '08123' });
    await assert.rejects(() => addConsumer({ name: '  budi santoso  ' }), /SUDAH TERDAFTAR/);
  });

  it('consumer: code auto-increments K0001, K0002', async () => {
    await resetDB();
    await addConsumer({ name: 'A' });
    await addConsumer({ name: 'B' });
    const list = await getConsumers();
    assert.equal(list[0].code, 'K0001');
    assert.equal(list[1].code, 'K0002');
  });

  it('membership: 10 Kelas = 5 minggu dari kelas pertama', async () => {
    await resetDB();
    const cid = await addConsumer({ name: 'Member', package: '10 Kelas' });
    const s1 = await addSchedule({ date: '2026-09-01', session_no: 1, time: '08:00', class_name: 'Basic', quota: 8 });
    await addAttendance({ consumer_id: cid, session_id: s1, status: 'Hadir' });
    const { membership } = await getConsumer(cid);
    assert.equal(membership.quota, 10);
    assert.equal(membership.used, 1);
    assert.equal(membership.sisa, 9);
    assert.equal(membership.first, '2026-09-01');
    assert.equal(membership.validUntil, '2026-10-06'); // +5 minggu
    assert.equal(membership.state, 'Aktif');
  });

  it('membership: habis kuota -> Kelas Habis', async () => {
    await resetDB();
    const cid = await addConsumer({ name: 'Full', package: '10 Kelas' });
    for (let i = 1; i <= 10; i++) {
      const s = await addSchedule({ date: `2026-09-${String(i).padStart(2, '0')}`, session_no: 1, time: '08:00', class_name: 'Basic', quota: 8 });
      await addAttendance({ consumer_id: cid, session_id: s, status: 'Hadir' });
    }
    const { membership } = await getConsumer(cid);
    assert.equal(membership.sisa, 0);
    assert.equal(membership.state, 'Kelas Habis');
  });

  it('attendance: no double log per session, reschedule needs replacement', async () => {
    await resetDB();
    const cid = await addConsumer({ name: 'X' });
    const s1 = await addSchedule({ date: '2026-09-01', session_no: 1, time: '08:00', class_name: 'Basic', quota: 8 });
    const s2 = await addSchedule({ date: '2026-09-02', session_no: 1, time: '08:00', class_name: 'Basic', quota: 8 });
    await addAttendance({ consumer_id: cid, session_id: s1, status: 'Hadir' });
    await assert.rejects(() => addAttendance({ consumer_id: cid, session_id: s1, status: 'Hadir' }), /sudah punya log/);
    await assert.rejects(() => addAttendance({ consumer_id: cid, session_id: s2, status: 'Reschedule' }), /wajib pilih sesi pengganti/);
    await addAttendance({ consumer_id: cid, session_id: s2, status: 'Reschedule', replacement_id: s1 });
  });

  it('add_package grants quota (stackable)', async () => {
    await resetDB();
    const cid = await addConsumer({ name: 'Paket User' });
    await addTransaction({ type: 'add_package', customer_name: 'Paket User', consumer_id: cid, package: '10 Kelas', nominal: 1200000 });
    let m = await getMembership(cid);
    assert.equal(m.membership.quota, 10);
    await addTransaction({ type: 'add_package', customer_name: 'Paket User', consumer_id: cid, package: '15 Kelas', nominal: 1700000 });
    m = await getMembership(cid);
    assert.equal(m.membership.quota, 25);
    assert.equal(m.membership.sisa, 25);
  });

  it('incremental write == full replay (equivalence)', async () => {
    await resetDB();
    const s1 = await addSchedule({ date: '2026-09-01', session_no: 1, time: '08:00', class_name: 'Basic', quota: 2 });
    const s2 = await addSchedule({ date: '2026-09-02', session_no: 1, time: '08:00', class_name: 'Basic', quota: 2 });
    await addTransaction({ type: 'booking_new', customer_name: 'A', schedule_id: s1 });
    await addTransaction({ type: 'booking_new', customer_name: 'A', schedule_id: s1 }); // duplikat -> tidak dihitung dua
    await addTransaction({ type: 'payment', customer_name: 'A', schedule_id: s1 });
    await addTransaction({ type: 'booking_new', customer_name: 'B', schedule_id: s1 });
    await addTransaction({ type: 'booking_new', customer_name: 'C', schedule_id: s1 }); // waitlist (kuota 2)
    await addTransaction({ type: 'cancel', customer_name: 'B', schedule_id: s1 });
    await addTransaction({ type: 'reschedule', customer_name: 'C', from_schedule_id: s1, to_schedule_id: s2 });
    const snap = async () => (await getDB().execute('SELECT schedule_id, customer_name, status FROM bookings ORDER BY schedule_id, customer_name')).rows.map(r => `${r.schedule_id}|${r.customer_name}|${r.status}`).join(';');
    const before = await snap();
    const { rebuildFromLedger } = require('./db');
    await rebuildFromLedger();
    assert.equal(await snap(), before);
    // dan hasil akhirnya benar secara semantik
    const sched = await getSchedule();
    const slot1 = sched.find(s => s.id === s1), slot2 = sched.find(s => s.id === s2);
    assert.equal(slot1.confirmed, 1); // A
    assert.equal(slot1.hold, 0);
    assert.equal(slot2.hold, 1); // C pindah, status hold ulang
  });
});