require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});

const fs = require('fs');
const path = require('path');
const database = require('../database');

async function main() {
  const file = process.argv[2] || path.join(__dirname, 'classes.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  await database.initializeDatabase({
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD
  });

  // load mapping
  const subjects = await database.getAllSubjects();
  const teachers = await database.getAllTeachers();

  const subjectMap = Object.fromEntries(
    subjects.map(s => [s.code, s.id])
  );

  const teacherMap = Object.fromEntries(
    teachers.map(t => [t.code, t.id])
  );

  let ok = 0;
  let skip = 0;

  for (const item of list) {
    try {
      const subjectId = subjectMap[item.subjectCode];
      const teacherId = teacherMap[item.teacherCode];

      if (!subjectId || !teacherId) {
        throw new Error('Missing subject or teacher');
      }

      await database.insertTeacherSchedule({
        teacherId,
        subjectId,
        day: item.day,
        period: item.period,
        duration: item.duration,
        room: item.room
      });

      ok++;
      console.log('OK', item.subjectCode, item.teacherCode);
    } catch (err) {
      skip++;
      console.warn('SKIP', item, err.message);
    }
  }

  console.log(`Done. inserted=${ok}, skipped=${skip}`);
  await database.closeDatabase();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});