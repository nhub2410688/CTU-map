const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { newDb } = require('pg-mem');
const database = require('../database');
const { app } = require('../app');
const { legacyHashPassword } = require('../security');

let pool;
let adminToken;
let studentToken;
let subjectId;
let firstTeacherId;
let secondTeacherId;
let thirdTeacherId;
let firstClassId;
let documentId;
let legacyFile;
let sampleDocumentFile;

test.before(async () => {
    const memoryDb = newDb({
        autoCreateForeignKeyIndices: true
    });
    const adapter = memoryDb.adapters.createPg();
    pool = new adapter.Pool();
    legacyFile = path.join(os.tmpdir(), `ctu-map-legacy-${Date.now()}.json`);
    sampleDocumentFile = path.join(
        os.tmpdir(),
        `ctu-map-document-${Date.now()}.txt`
    );

    fs.writeFileSync(legacyFile, JSON.stringify({
        students: {
            B1111111: {
                studentId: 'B1111111',
                salt: 'legacy-test-salt',
                passwordHash: legacyHashPassword(
                    'Legacy123',
                    'legacy-test-salt'
                ),
                schedule: []
            }
        },
        subjects: [],
        teacherSchedules: []
    }));
    fs.writeFileSync(sampleDocumentFile, 'Tai lieu demo CTU Map');

    await database.initializeDatabase({
        pool,
        legacyFile,
        adminUsername: 'admin',
        adminPassword: 'CTUMap@2026'
    });
});

test.after(async () => {
    await database.closeDatabase();
    fs.rmSync(legacyFile, { force:true });
    fs.rmSync(sampleDocumentFile, { force:true });
});

test('path finding returns user-facing directions without internal node names', async () => {
    const response = await request(app)
        .get('/find-path')
        .query({
            start: 'cổng a',
            end: 'D1'
        })
        .expect(200);

    assert.equal(response.body.path[0], 'cổng a');
    assert.equal(response.body.path.at(-1), 'd1');
    assert.ok(response.body.distance > 0);
    assert.ok(response.body.instructions.length > 0);
    assert.equal(
        response.body.instructions.some(item => /\bn\d+\b/i.test(item)),
        false
    );
});

test('tester credentials are configurable and admin can log in', async () => {
    const credentials = await request(app)
        .get('/api/demo-credentials')
        .expect(200);

    assert.deepEqual(credentials.body, {
        username: 'admin',
        password: 'CTUMap@2026'
    });

    const login = await request(app)
        .post('/api/login')
        .send({
            loginId: credentials.body.username,
            password: credentials.body.password
        })
        .expect(200);

    assert.equal(login.body.role, 'admin');
    adminToken = login.body.token;
});

test('student registration stores Argon2id and supports login', async () => {
    await request(app)
        .post('/api/register')
        .send({
            studentId: 'B7654321',
            password: 'Student123'
        })
        .expect(200);

    const stored = await pool.query(
        'SELECT password_hash FROM students WHERE student_id = $1',
        ['B7654321']
    );
    assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);

    const login = await request(app)
        .post('/api/login')
        .send({
            loginId: 'B7654321',
            password: 'Student123'
        })
        .expect(200);

    assert.equal(login.body.role, 'student');
    studentToken = login.body.token;
});

test('legacy db.json password upgrades to Argon2id after login', async () => {
    await request(app)
        .post('/api/login')
        .send({
            loginId: 'B1111111',
            password: 'Legacy123'
        })
        .expect(200);

    const stored = await pool.query(
        `SELECT password_hash, legacy_salt, legacy_password_hash
         FROM students WHERE student_id = $1`,
        ['B1111111']
    );

    assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
    assert.equal(stored.rows[0].legacy_salt, null);
    assert.equal(stored.rows[0].legacy_password_hash, null);
});

test('admin creates a subject, a teacher and a class schedule', async () => {
    const subject = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            code: 'CT101',
            name: 'Lập trình căn bản'
        })
        .expect(200);
    subjectId = subject.body.subject.id;

    const teacher = await request(app)
        .post('/api/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            code: 'GV001',
            name: 'Giảng viên Một'
        })
        .expect(200);
    firstTeacherId = teacher.body.teacher.id;

    const teacherSchedule = await request(app)
        .post('/api/teacher-schedule')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            teacherId: firstTeacherId,
            day: 2,
            period: 1,
            duration: 3,
            subjectId,
            room: '101/A3'
        })
        .expect(200);

    firstClassId = teacherSchedule.body.entry.id;

    assert.equal(teacherSchedule.body.entry.classCode, 'CT10101');
    assert.equal(teacherSchedule.body.entry.subjectCode, 'CT101');

    const counts = await request(app)
        .get('/api/subjects')
        .expect(200);
    assert.equal(counts.body.subjects[0].classCount, 1);
});

test('overlapping teacher and room schedules are rejected', async () => {
    const conflict = await request(app)
        .post('/api/teacher-schedule')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            teacherId: firstTeacherId,
            day: 2,
            period: 3,
            duration: 2,
            subjectId,
            room: '102/A3'
        })
        .expect(409);

    assert.match(conflict.body.error, /đã có lịch/);

    const secondTeacher = await request(app)
        .post('/api/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            code: 'GV002',
            name: 'Giảng viên Hai'
        })
        .expect(200);
    secondTeacherId = secondTeacher.body.teacher.id;

    const roomConflict = await request(app)
        .post('/api/teacher-schedule')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            teacherId: secondTeacherId,
            day: 2,
            period: 2,
            duration: 2,
            subjectId,
            room: '101/A3'
        })
        .expect(409);

    assert.match(roomConflict.body.error, /đã được sử dụng/);
});

test('student can only add non-overlapping teacher schedules', async () => {
    await request(app)
        .post('/api/schedule')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ teacherScheduleId: firstClassId })
        .expect(200);

    const secondClass = await request(app)
        .post('/api/teacher-schedule')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            teacherId: secondTeacherId,
            day: 2,
            period: 3,
            duration: 2,
            subjectId,
            room: '103/A3'
        })
        .expect(200);

    const conflict = await request(app)
        .post('/api/schedule')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ teacherScheduleId: secondClass.body.entry.id })
        .expect(409);

    assert.match(conflict.body.error, /Trùng với/);
});

test('admin filters classes by building, day and session', async () => {
    const teacher = await request(app)
        .post('/api/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            code: 'GV003',
            name: 'Giảng viên Ba'
        })
        .expect(200);
    thirdTeacherId = teacher.body.teacher.id;

    await request(app)
        .post('/api/teacher-schedule')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
            teacherId: thirdTeacherId,
            day: 3,
            period: 6,
            duration: 2,
            subjectId,
            room: '204/D1'
        })
        .expect(200);

    const filtered = await request(app)
        .get('/api/teacher-schedule')
        .query({
            building: 'd1',
            day: 3,
            session: 'afternoon'
        })
        .expect(200);

    assert.equal(filtered.body.schedules.length, 1);
    assert.equal(filtered.body.schedules[0].teacherId, thirdTeacherId);
    assert.equal(filtered.body.schedules[0].building, 'd1');
});

test('student uploads a document and admin approves it for download', async () => {
    const upload = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${studentToken}`)
        .field('title', 'Tài liệu ôn tập')
        .field('description', 'Ghi chú demo')
        .field('subjectId', subjectId)
        .field('teacherId', firstTeacherId)
        .attach('file', sampleDocumentFile)
        .expect(200);

    documentId = upload.body.document.id;
    assert.equal(upload.body.document.status, 'pending');

    const pending = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ status:'pending' })
        .expect(200);
    assert.ok(pending.body.documents.some(item => item.id === documentId));

    await request(app)
        .put(`/api/documents/${documentId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status:'approved' })
        .expect(200);

    const shared = await request(app)
        .get('/api/documents')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({ q:'ôn tập' })
        .expect(200);
    assert.ok(shared.body.documents.some(item => item.id === documentId));

    const opened = await request(app)
        .get(`/api/documents/${documentId}/view`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
    assert.match(opened.text, /Tai lieu demo CTU Map/);

    const download = await request(app)
        .get(`/api/documents/${documentId}/download`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);
    assert.match(download.text, /Tai lieu demo CTU Map/);

    await request(app)
        .delete(`/api/documents/${documentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
});

test('student cannot access admin-only APIs', async () => {
    await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ code: 'NOPE', name: 'Không hợp lệ' })
        .expect(403);
});

test('subject and teacher codes must be unique but names can duplicate', async () => {
    // Trùng mã môn → lỗi
    const dupSubjectCode = await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CT101', name: 'Tên khác' })
        .expect(409);
    assert.match(dupSubjectCode.body.error || '', /mã|code|tồn tại|đã/i);

    // Trùng tên môn → vẫn cho phép
    await request(app)
        .post('/api/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CT999', name: 'Lập trình căn bản' })
        .expect(200);

    // Trùng mã GV → lỗi
    const dupTeacherCode = await request(app)
        .post('/api/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'GV001', name: 'Người khác' })
        .expect(409);
    assert.match(dupTeacherCode.body.error || '', /mã|code|tồn tại|đã/i);

    // Trùng tên GV → vẫn cho phép
    await request(app)
        .post('/api/teachers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'GV999', name: 'Giảng viên Một' })
        .expect(200);
});


test('student schedule list is available after adding a class', async () => {
    const schedule = await request(app)
        .get('/api/schedule')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

    assert.ok(Array.isArray(schedule.body.schedule));
    assert.ok(schedule.body.schedule.length >= 1);

    // Bật dòng dưới khi API /api/schedule đã trả classCode
    // assert.ok(schedule.body.schedule[0].classCode);
});
