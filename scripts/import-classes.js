require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('../database');

async function main() {
  const file = process.argv[2] || path.join(__dirname, 'classes.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  await database.initializeDatabase({
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD
  });

  // Lấy môn + GV từ DB (loadState đã có sẵn)
  const state = await database.loadState();
  const subjectMap = Object.fromEntries(
    (state.subjects || []).map(s => [String(s.code).toUpperCase(), s.id])
  );
  const teacherMap = Object.fromEntries(
    (state.teachers || []).map(t => [String(t.code).toUpperCase(), t.id])
  );

  let ok = 0;
  let skip = 0;

  for (const item of list) {
    const classCode = String(item.classCode || '').trim().toUpperCase();
    const subjectCode = String(item.subjectCode || '').trim().toUpperCase();
    const teacherCode = String(item.teacherCode || '').trim().toUpperCase();
    const sessions = Array.isArray(item.sessions) ? item.sessions : [];

    try {
      if (!classCode) throw new Error('Thiếu classCode');
      if (!sessions.length) throw new Error('Thiếu sessions');

      const subjectId = subjectMap[subjectCode];
      const teacherId = teacherMap[teacherCode];
      if (!subjectId) throw new Error(`Không tìm thấy môn ${subjectCode}`);
      if (!teacherId) throw new Error(`Không tìm thấy GV ${teacherCode}`);

      // Trùng mã lớp
      const existing = await database.listClassSections({ q: classCode });
      if (existing.some(c => c.classCode.toUpperCase() === classCode)) {
        throw new Error('Mã lớp đã tồn tại');
      }

      const normalizedSessions = sessions.map(s => ({
        id: crypto.randomUUID(),
        day: Number(s.day),
        startPeriod: Number(s.startPeriod ?? s.period),
        duration: Number(s.duration),
        room: String(s.room || '').trim(),
        routeNode: String(s.routeNode || '') // ngoài khu II để trống
      }));

      for (const s of normalizedSessions) {
        if (!s.day || !s.startPeriod || !s.duration || !s.room) {
          throw new Error('Session thiếu day/startPeriod/duration/room');
        }
      }

      await database.insertClassSection(
        {
          id: crypto.randomUUID(),
          classCode,
          subjectId,
          teacherId
        },
        normalizedSessions
      );

      ok += 1;
      console.log('OK', classCode, subjectCode, teacherCode, `(${normalizedSessions.length} buổi)`);
    } catch (err) {
      skip += 1;
      console.warn('SKIP', classCode || item, '-', err.message);
    }
  }

  console.log(`Done. inserted=${ok}, skipped=${skip}`);
  await database.closeDatabase();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});