const { init, getDB, addSchedule, addTransaction, rebuildFromLedger } = require('./db');
const XLSX = require('xlsx');

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', Mei: '05', Jun: '06', Jul: '07', Agu: '08', Sep: '09', Okt: '10', Nov: '11', Des: '12' };
const SESSION_RE = /Sesi (\d+)/;
const CLASSES = ['Basic', 'Special Class', 'Jumpboard', 'Flou'];

function parseDateID(str) {
  if (!str) return null;
  const m = str.match(/(\d+) (\w+) (\d{4})/);
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[2]] || '01'}-${String(m[1]).padStart(2, '0')}`;
}

function parseParticipants(str) {
  if (!str || !str.trim()) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

async function seed() {
  const db = await init();
  // ponytail: seed menghapus semua data di target DB (lokal maupun Turso) sebelum isi ulang
  await db.executeMultiple('DELETE FROM bookings; DELETE FROM ledger; DELETE FROM schedule; DELETE FROM sqlite_sequence');
  const wb = XLSX.readFile('Sawiji_Pilates_Studio_September_2026.xlsx');

  // --- Schedule ---
  const schedSheet = wb.Sheets['Jadwal Kelas'];
  const schedRows = XLSX.utils.sheet_to_json(schedSheet, { header: 1, raw: false });
  let currentDate = null;
  const scheduleMap = [];

  for (let i = 4; i < schedRows.length; i++) {
    const row = schedRows[i];
    if (!row || !row[0]) continue;
    const dateStr = String(row[1] || '').trim();
    if (dateStr) {
      const parsed = parseDateID(dateStr);
      if (parsed) currentDate = parsed;
    }
    const sesiMatch = String(row[2] || '').trim().match(SESSION_RE);
    if (!sesiMatch) continue;
    const sessionNo = parseInt(sesiMatch[1]);
    if (sessionNo > 10 || !currentDate) continue;
    const time = String(row[3] || '').trim();
    const coach = String(row[4] || '').trim();
    const rawClass = String(row[5] || '').trim();
    const class_name = CLASSES.includes(rawClass) ? rawClass : 'Basic';
    const quota = parseInt(row[6]) || 6;
    const id = Number(await addSchedule({ date: currentDate, session_no: sessionNo, time, coach, class_name, quota }));
    scheduleMap.push({ id, date: currentDate, time, class_name, coach, session_no: sessionNo });
  }

  // --- Booking + payment dari daftar peserta di jadwal ---
  currentDate = null;
  let slotIdx = 0;

  for (let i = 4; i < schedRows.length; i++) {
    const row = schedRows[i];
    if (!row || !row[0]) continue;
    const dateStr = String(row[1] || '').trim();
    if (dateStr) {
      const parsed = parseDateID(dateStr);
      if (parsed) currentDate = parsed;
    }
    const sesiMatch = String(row[2] || '').trim().match(SESSION_RE);
    if (!sesiMatch) continue;
    if (parseInt(sesiMatch[1]) > 10 || !currentDate) continue;
    const participants = parseParticipants(String(row[11] || '').trim());
    const bookingCount = parseInt(row[8]) || 0;
    if (participants.length > 0) {
      const slot = scheduleMap[slotIdx];
      if (slot) {
        const maxP = Math.min(participants.length, bookingCount || participants.length);
        for (let p = 0; p < maxP; p++) {
          const name = participants[p];
          await addTransaction({ type: 'booking_new', customer_name: name, schedule_id: slot.id, admin: 'seed' }, true);
          await addTransaction({ type: 'payment', customer_name: name, schedule_id: slot.id, nominal: 150000, payment_status: 'Lunas', admin: 'seed' }, true);
        }
      }
    }
    slotIdx++;
  }

  // --- Log transaksi asli dari Excel ---
  const logSheet = wb.Sheets['Log Transaksi'];
  const logRows = XLSX.utils.sheet_to_json(logSheet, { header: 1, raw: false });
  const validTypes = ['booking_new', 'payment', 'session_use', 'add_package', 'reschedule', 'cancel', 'refund', 'transfer'];

  for (let i = 4; i < logRows.length; i++) {
    const row = logRows[i];
    if (!row) continue;
    const type = String(row[2] || '').trim().toLowerCase().replace(/ /g, '_');
    const customer = String(row[3] || '').trim();
    if (!type || !customer) continue;
    const phone = String(row[4] || '').trim();
    const dayTime = String(row[5] || '').trim();
    const jam = String(row[6] || '').trim();
    const jmlSesi = parseInt(row[9]) || null;
    const nominal = parseInt(String(row[10] || '').replace(/[^\d]/g, '')) || null;
    const paymentMethod = String(row[11] || '').trim();
    const paymentStatus = String(row[12] || '').trim();
    const paidBy = String(row[13] || '').trim();
    const admin = String(row[18] || '').trim() || 'admin';
    const normalizedType = validTypes.includes(type) ? type : 'payment';

    // ponytail: schedule_id untuk log Excel tidak bisa dipetakan otomatis (teks "SABTU 5 & 12 SEPT"
    // ambigu) — disimpan sebagai notes saja; upgrade path: parser hari+jam jika benar-benar dibutuhkan
    await addTransaction({
      type: normalizedType,
      customer_name: customer,
      phone: phone || null,
      schedule_id: null,
      session_count: jmlSesi,
      nominal: nominal,
      payment_method: paymentMethod || null,
      payment_status: paymentStatus || null,
      paid_by: paidBy || null,
      admin: admin,
      notes: dayTime ? `Kelas: ${dayTime} ${jam}` : null
    }, true);
  }

  await rebuildFromLedger();
  const count = (await db.execute('SELECT COUNT(*) c FROM bookings')).rows[0].c;
  console.log(`Seed selesai. Schedule: ${(await db.execute('SELECT COUNT(*) c FROM schedule')).rows[0].c}, Ledger: ${(await db.execute('SELECT COUNT(*) c FROM ledger')).rows[0].c}, Bookings: ${count}`);
}

seed().catch(e => { console.error(e); process.exit(1); });