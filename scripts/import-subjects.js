require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});
console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('../database');

async function main() {
  const file = process.argv[2] || path.join(__dirname, 'subjects.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  await database.initializeDatabase({
    // nếu script của bạn cần pool/env sẵn có thì chỉnh cho khớp project
  });

  let ok = 0;
  let skip = 0;

  for (const item of list) {
    const code = String(item.code || '').trim();
    const name = String(item.name || '').trim();
    if (!code || !name) continue;

    try {
      await database.insertSubject({
        id: crypto.randomUUID(),
        code,
        name
      });
      ok += 1;
      console.log('OK', code, name);
    } catch (err) {
      // trùng mã môn thì bỏ qua
      skip += 1;
      console.warn('SKIP', code, err.message);
    }
  }

  console.log(`Done. inserted=${ok}, skipped=${skip}`);
  await database.closeDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});