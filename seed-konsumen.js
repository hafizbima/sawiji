const { init, getDB, addSchedule, addConsumer } = require('./db');
const XLSX = require('xlsx');

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', Mei: '05', Jun: '06', Jul: '07', Agu: '08', Ags: '08', Sep: '09', Okt: '10', Nov: '11', Des: '12' };

function parseDMY(str) { // "01/02/2026" -> 2026-02-01
  const m = String(str || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
function parseBirth(str) { // "29-Jun-1999" -> 1999-06-29
  const m = String(str || '').match(/(\d{1,2})-([A-Za-z]+)-(\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  return mon ? `${m[3]}-${mon}-${m[1].padStart(2, '0')}` : null;
}
function parseTime(str) { // "8.30" / "17.35" -> 08:30 / 17:35
  const m = String(str || '').match(/(\d{1,2})[.:](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

async function seed() {
  const db = await init();
  const wb = XLSX.readFile('Sawiji Pilates - Database Konsumen.xlsx');

  // --- Konsumen ---
  const konsRows = XLSX.utils.sheet_to_json(wb.Sheets['Import Massal Konsumen'], { header: 1, raw: false }).slice(1).filter(r => r[0]);
  let konsOk = 0, konsSkip = 0;
  for (const r of konsRows) {
    try {
      await addConsumer({ name: r[0], phone: r[1], instagram: r[2], birth_date: parseBirth(r[3]), package: r[5], condition: r[6] });
      konsOk++;
    } catch { konsSkip++; }
  }

  // --- Jadwal Feb-Agu (skip jika (tanggal, sesi) sudah ada) ---
  const existing = new Set((await db.execute('SELECT date, session_no FROM schedule')).rows.map(x => `${x.date}|${x.session_no}`));
  const jRows = XLSX.utils.sheet_to_json(wb.Sheets['Import Massal Jadwal'], { header: 1, raw: false }).slice(1).filter(r => r[0]);
  let jOk = 0, jSkip = 0;
  for (const r of jRows) {
    const date = parseDMY(r[2]);
    const sn = parseInt(String(r[3] || '').match(/\d+/)?.[0]);
    if (!date || !sn || existing.has(`${date}|${sn}`)) { jSkip++; continue; }
    await addSchedule({ date, session_no: sn, time: parseTime(r[4]), coach: r[5], class_name: r[6] || 'Basic', quota: parseInt(r[7]) || 8 });
    existing.add(`${date}|${sn}`);
    jOk++;
  }

  const c = await db.execute('SELECT COUNT(*) c FROM consumers');
  const s = await db.execute('SELECT COUNT(*) c FROM schedule');
  console.log(`Konsumen: +${konsOk} (skip ${konsSkip}, total ${c.rows[0].c}) | Jadwal: +${jOk} (skip ${jSkip}, total ${s.rows[0].c})`);
}

seed().catch(e => { console.error(e); process.exit(1); });