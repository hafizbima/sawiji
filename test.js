const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { init, getDB, addSchedule, addTransaction, getSchedule } = require('./db');

describe('Sawiji Pilates DB', () => {
  before(async () => {
    await init('file::memory:');
  });

  async function resetDB() {
    const db = getDB();
    await db.executeMultiple('DELETE FROM bookings; DELETE FROM ledger; DELETE FROM schedule;');
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
});