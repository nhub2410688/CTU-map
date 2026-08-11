require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('../database');

async function main() {
  const file = process.argv[2] || path.join(__dirname, 'teachers.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  await database.initializeDatabase({
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD
  });

  let ok = 0;
  let skip = 0;

  for (const item of list) {
    const code = String(item.code || '').trim();
    const name = String(item.name || '').trim();
    if (!code || !name) continue;

    try {
      await database.insertTeacher({
        id: crypto.randomUUID(),
        code,
        name
      });
      ok++;
      console.log('OK', code, name);
    } catch (err) {
      skip++;
      console.warn('SKIP', code, err.message);
    }
  }

  console.log(`Done. inserted=${ok}, skipped=${skip}`);
  await database.closeDatabase();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});