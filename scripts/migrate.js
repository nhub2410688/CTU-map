require('dotenv').config({ quiet:true });

const path = require('path');
const database = require('../database');

const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'CTUMap@2026';

database.initializeDatabase({
    legacyFile: path.join(__dirname, '..', 'data', 'db.json'),
    adminUsername,
    adminPassword
})
    .then(() => {
        console.log('PostgreSQL schema and legacy data are ready.');
    })
    .then(() => database.closeDatabase())
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
