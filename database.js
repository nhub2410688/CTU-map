const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
    hashPassword,
    hashToken,
    verifyPassword
} = require('./security');

let pool;

function createPool(){
    if(!process.env.DATABASE_URL){
        throw new Error(
            'DATABASE_URL is required. Configure PostgreSQL before starting CTU Map.'
        );
    }

    return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: false }
            : undefined
    });
}

function getPool(){
    if(!pool){
        pool = createPool();
    }
    return pool;
}

function setPool(nextPool){
    pool = nextPool;
}

async function runSchema(){
    const schemaPath = path.join(__dirname, 'sql', '001_initial.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await getPool().query(schema);
}

async function refreshClassCounts(client=getPool()){
    await client.query('UPDATE subjects SET class_count = 0');
    await client.query('UPDATE teachers SET class_count = 0');

    const subjectCounts = await client.query(
        `SELECT subject_id, COUNT(*)::int AS class_count
         FROM teacher_schedules
         GROUP BY subject_id`
    );
    for(const row of subjectCounts.rows){
        await client.query(
            'UPDATE subjects SET class_count = $2 WHERE id = $1',
            [row.subject_id, row.class_count]
        );
    }

    const teacherCounts = await client.query(
        `SELECT teacher_id, COUNT(*)::int AS class_count
         FROM teacher_schedules
         WHERE teacher_id IS NOT NULL
         GROUP BY teacher_id`
    );
    for(const row of teacherCounts.rows){
        await client.query(
            'UPDATE teachers SET class_count = $2 WHERE id = $1',
            [row.teacher_id, row.class_count]
        );
    }
}

async function findOrCreateTeacher(client, code, name){
    const normalizedCode = String(code || '').trim();
    const normalizedName = String(name || '').trim();

    if(!normalizedCode || !normalizedName){
        return null;
    }

    const current = await client.query(
        `SELECT id FROM teachers
         WHERE LOWER(code) = LOWER($1)
         LIMIT 1`,
        [normalizedCode]
    );

    if(current.rows[0]){
        return current.rows[0].id;
    }

    const id = crypto.randomUUID();
    await client.query(
        `INSERT INTO teachers (id, code, name)
         VALUES ($1, $2, $3)`,
        [id, normalizedCode, normalizedName]
    );
    return id;
}

async function backfillTeachersFromSchedules(){
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');
        const schedules = await client.query(
            `SELECT DISTINCT teacher_code, teacher_name
             FROM teacher_schedules
             WHERE teacher_id IS NULL`
        );

        for(const row of schedules.rows){
            const teacherId = await findOrCreateTeacher(
                client,
                row.teacher_code,
                row.teacher_name
            );

            if(!teacherId){
                continue;
            }

            await client.query(
                `UPDATE teacher_schedules
                 SET teacher_id = $1
                 WHERE teacher_id IS NULL
                    AND LOWER(teacher_code) = LOWER($2)`,
                [teacherId, row.teacher_code]
            );
        }

        await refreshClassCounts(client);
        await client.query('COMMIT');
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function seedAdmin(username, password){
    const current = await getPool().query(
        'SELECT password_hash FROM admins WHERE LOWER(username) = LOWER($1)',
        [username]
    );
    const existing = current.rows[0];

    if(existing && await verifyPassword(existing.password_hash, password)){
        return;
    }

    const passwordHash = await hashPassword(password);
    await getPool().query(
        `INSERT INTO admins (username, password_hash, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            updated_at = NOW()`,
        [username, passwordHash]
    );
}

async function importLegacyData(filePath){
    if(!filePath || !fs.existsSync(filePath)){
        return;
    }

    const legacy = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');

        for(const student of Object.values(legacy.students || {})){
            await client.query(
                `INSERT INTO students (
                    student_id, legacy_salt, legacy_password_hash
                 ) VALUES ($1, $2, $3)
                 ON CONFLICT (student_id) DO NOTHING`,
                [
                    student.studentId,
                    student.salt || null,
                    student.passwordHash || null
                ]
            );
        }

        for(const subject of legacy.subjects || []){
            await client.query(
                `INSERT INTO subjects (id, code, name, class_count)
                 VALUES ($1, $2, $3, 0)
                 ON CONFLICT (id) DO NOTHING`,
                [subject.id, subject.code, subject.name]
            );
        }

        for(const schedule of legacy.teacherSchedules || []){
            if(!schedule.subjectId){
                continue;
            }

            const teacherId = await findOrCreateTeacher(
                client,
                schedule.teacherCode,
                schedule.teacherName
            );

            if(!teacherId){
                continue;
            }

            await client.query(
                `INSERT INTO teacher_schedules (
                    id, teacher_id, teacher_code, teacher_name, day, period,
                    duration, subject_id, room, route_node
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 ON CONFLICT (id) DO NOTHING`,
                [
                    schedule.id,
                    teacherId,
                    schedule.teacherCode,
                    schedule.teacherName,
                    schedule.day,
                    schedule.period,
                    schedule.duration || 1,
                    schedule.subjectId,
                    schedule.room,
                    schedule.routeNode
                ]
            );
        }

        for(const student of Object.values(legacy.students || {})){
            for(const entry of student.schedule || []){
                await client.query(
                    `INSERT INTO student_schedule_entries (
                        id, student_id, teacher_schedule_id,
                        legacy_day, legacy_start_period, legacy_duration,
                        legacy_subject, legacy_room, legacy_teacher,
                        legacy_route_node, legacy_building
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                     ON CONFLICT (id) DO NOTHING`,
                    [
                        entry.id,
                        student.studentId,
                        entry.teacherScheduleId || null,
                        entry.teacherScheduleId ? null : entry.day,
                        entry.teacherScheduleId ? null : entry.startPeriod,
                        entry.teacherScheduleId ? null : entry.duration,
                        entry.teacherScheduleId ? null : entry.subject,
                        entry.teacherScheduleId ? null : entry.room,
                        entry.teacherScheduleId ? null : entry.teacher,
                        entry.teacherScheduleId ? null : entry.routeNode,
                        entry.teacherScheduleId ? null : entry.building
                    ]
                );
            }
        }

        await refreshClassCounts(client);
        await client.query('COMMIT');
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function initializeDatabase(options = {}) {
    if (options.pool) {
        setPool(options.pool);
    }

    await runSchema();
    await importLegacyData(options.legacyFile);
    await backfillTeachersFromSchedules();

    const username = options.adminUsername || process.env.ADMIN_USERNAME;
    const password = options.adminPassword || process.env.ADMIN_PASSWORD;

    await seedAdmin(username, password);
}

async function loadState(){
    const [
        studentsResult,
        entriesResult,
        subjectsResult,
        teachersResult,
        schedulesResult
    ] = await Promise.all([
        getPool().query(
            `SELECT student_id, password_hash, legacy_salt,
                    legacy_password_hash
             FROM students`
        ),
        getPool().query(
            `SELECT id, student_id, teacher_schedule_id,
                    legacy_day, legacy_start_period, legacy_duration,
                    legacy_subject, legacy_room, legacy_teacher,
                    legacy_route_node, legacy_building
             FROM student_schedule_entries`
        ),
        getPool().query(
            'SELECT id, code, name, class_count FROM subjects'
        ),
        getPool().query(
            'SELECT id, code, name, class_count FROM teachers'
        ),
        getPool().query(
            `SELECT id, teacher_id, teacher_code, teacher_name, day, period,
                    duration, subject_id, subject_code, subject, class_code,
                    room, route_node
            FROM teacher_schedules`
        )
    ]);

    const students = {};

    for(const row of studentsResult.rows){
        students[row.student_id] = {
            studentId: row.student_id,
            passwordHash: row.password_hash,
            legacySalt: row.legacy_salt,
            legacyPasswordHash: row.legacy_password_hash,
            schedule: []
        };
    }

    for(const row of entriesResult.rows){
        const student = students[row.student_id];
        if(!student){
            continue;
        }

        if(row.teacher_schedule_id){
            student.schedule.push({
                id: row.id,
                teacherScheduleId: row.teacher_schedule_id
            });
            continue;
        }

        student.schedule.push({
            id: row.id,
            day: Number(row.legacy_day),
            startPeriod: Number(row.legacy_start_period),
            duration: Number(row.legacy_duration),
            subject: row.legacy_subject,
            room: row.legacy_room,
            teacher: row.legacy_teacher || '',
            routeNode: row.legacy_route_node,
            building: row.legacy_building
        });
    }

    return {
        students,
        subjects: subjectsResult.rows.map(row => ({
            id: row.id,
            code: row.code,
            name: row.name,
            classCount: Number(row.class_count || 0)
        })),
        teachers: teachersResult.rows.map(row => ({
            id: row.id,
            code: row.code,
            name: row.name,
            classCount: Number(row.class_count || 0)
        })),
        teacherSchedules: schedulesResult.rows.map(row => ({
            id: row.id,
            teacherId: row.teacher_id,
            teacherCode: row.teacher_code,
            teacherName: row.teacher_name,
            day: Number(row.day),
            period: Number(row.period),
            duration: Number(row.duration),
            subjectId: row.subject_id,
            subjectCode: row.subject_code || '',
            subject: row.subject || '',
            classCode: row.class_code || '',
            room: row.room,
            routeNode: row.route_node
        }))
    };
}

async function createStudent(studentId, passwordHash){
    await getPool().query(
        `INSERT INTO students (student_id, password_hash)
         VALUES ($1, $2)`,
        [studentId, passwordHash]
    );
}

async function updateStudentPassword(studentId, passwordHash){
    await getPool().query(
        `UPDATE students
         SET password_hash = $2,
             legacy_salt = NULL,
             legacy_password_hash = NULL
         WHERE student_id = $1`,
        [studentId, passwordHash]
    );
}

async function findAdmin(username){
    const result = await getPool().query(
        `SELECT username, password_hash
         FROM admins
         WHERE LOWER(username) = LOWER($1)`,
        [username]
    );
    return result.rows[0] || null;
}

async function createSession(token, role, userId, maxAgeHours=8){
    const expiresAt = new Date(
        Date.now() + maxAgeHours * 60 * 60 * 1000
    );

    await getPool().query(
        `INSERT INTO sessions (token_hash, role, user_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [hashToken(token), role, userId, expiresAt]
    );
}

async function getSession(token){
    const result = await getPool().query(
        `SELECT role, user_id
         FROM sessions
         WHERE token_hash = $1 AND expires_at > NOW()`,
        [hashToken(token)]
    );
    return result.rows[0]
        ? {
            role: result.rows[0].role,
            userId: result.rows[0].user_id
        }
        : null;
}

async function deleteSession(token){
    await getPool().query(
        'DELETE FROM sessions WHERE token_hash = $1',
        [hashToken(token)]
    );
}

async function insertStudentSchedule(studentId, entry){
    await getPool().query(
        `INSERT INTO student_schedule_entries (
            id, student_id, teacher_schedule_id
         ) VALUES ($1, $2, $3)`,
        [entry.id, studentId, entry.teacherScheduleId]
    );
}

async function updateStudentSchedule(studentId, entry){
    const result = await getPool().query(
        `UPDATE student_schedule_entries
         SET teacher_schedule_id = $3,
             legacy_day = NULL,
             legacy_start_period = NULL,
             legacy_duration = NULL,
             legacy_subject = NULL,
             legacy_room = NULL,
             legacy_teacher = NULL,
             legacy_route_node = NULL,
             legacy_building = NULL
         WHERE id = $1 AND student_id = $2`,
        [entry.id, studentId, entry.teacherScheduleId]
    );
    return result.rowCount > 0;
}

async function deleteStudentSchedule(studentId, id){
    const result = await getPool().query(
        `DELETE FROM student_schedule_entries
         WHERE id = $1 AND student_id = $2`,
        [id, studentId]
    );
    return result.rowCount > 0;
}

async function insertSubject(subject){
    await getPool().query(
        'INSERT INTO subjects (id, code, name) VALUES ($1, $2, $3)',
        [subject.id, subject.code, subject.name]
    );
}

async function updateSubject(subject){
    const result = await getPool().query(
        `UPDATE subjects SET code = $2, name = $3 WHERE id = $1`,
        [subject.id, subject.code, subject.name]
    );
    return result.rowCount > 0;
}

async function deleteSubject(id){
    const result = await getPool().query(
        'DELETE FROM subjects WHERE id = $1',
        [id]
    );
    return result.rowCount > 0;
}

async function insertTeacher(teacher){
    await getPool().query(
        `INSERT INTO teachers (id, code, name)
         VALUES ($1, $2, $3)`,
        [teacher.id, teacher.code, teacher.name]
    );
}

async function updateTeacher(teacher){
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE teachers
             SET code = $2,
                 name = $3,
                 updated_at = NOW()
             WHERE id = $1`,
            [teacher.id, teacher.code, teacher.name]
        );

        if(result.rowCount > 0){
            await client.query(
                `UPDATE teacher_schedules
                 SET teacher_code = $2,
                     teacher_name = $3
                 WHERE teacher_id = $1`,
                [teacher.id, teacher.code, teacher.name]
            );
        }

        await client.query('COMMIT');
        return result.rowCount > 0;
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function deleteTeacher(id){
    const result = await getPool().query(
        'DELETE FROM teachers WHERE id = $1',
        [id]
    );
    return result.rowCount > 0;
}

async function insertTeacherSchedule(entry){
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO teacher_schedules (
                id, teacher_id, teacher_code, teacher_name, day, period,
                duration, subject_id, subject_code, subject, class_code,
                room, route_node
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
                entry.id,
                entry.teacherId,
                entry.teacherCode,
                entry.teacherName,
                entry.day,
                entry.period,
                entry.duration,
                entry.subjectId,
                entry.subjectCode || null,
                entry.subject || null,
                entry.classCode || null,
                entry.room,
                entry.routeNode
            ]
        );
        await refreshClassCounts(client);
        await client.query('COMMIT');
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function updateTeacherSchedule(entry){
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE teacher_schedules
             SET teacher_id=$2, teacher_code=$3, teacher_name=$4,
                 day=$5, period=$6, duration=$7, subject_id=$8,
                 subject_code=$9, subject=$10, class_code=$11,
                 room=$12, route_node=$13
             WHERE id=$1`,
            [
                entry.id,
                entry.teacherId,
                entry.teacherCode,
                entry.teacherName,
                entry.day,
                entry.period,
                entry.duration,
                entry.subjectId,
                entry.subjectCode || null,
                entry.subject || null,
                entry.classCode || null,
                entry.room,
                entry.routeNode
            ]
        );
        await refreshClassCounts(client);
        await client.query('COMMIT');
        return result.rowCount > 0;
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function deleteTeacherSchedule(id){
    const client = await getPool().connect();

    try{
        await client.query('BEGIN');
        const result = await client.query(
            'DELETE FROM teacher_schedules WHERE id = $1',
            [id]
        );
        await refreshClassCounts(client);
        await client.query('COMMIT');
        return result.rowCount > 0;
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

function mapDocumentRow(row){
    return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        subjectId: row.subject_id,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        teacherId: row.teacher_id,
        teacherCode: row.teacher_code || '',
        teacherName: row.teacher_name || '',
        uploadedBy: row.uploaded_by_student_id,
        originalName: row.original_name,
        storedName: row.stored_name,
        mimeType: row.mime_type,
        fileSize: Number(row.file_size || 0),
        status: row.status,
        rejectionReason: row.rejection_reason || '',
        approvedBy: row.approved_by || '',
        approvedAt: row.approved_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function insertStudyDocument(document){
    await getPool().query(
        `INSERT INTO study_documents (
            id, title, description, subject_id, teacher_id,
            uploaded_by_student_id, original_name, stored_name,
            mime_type, file_size, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
            document.id,
            document.title,
            document.description || null,
            document.subjectId,
            document.teacherId || null,
            document.uploadedBy,
            document.originalName,
            document.storedName,
            document.mimeType,
            document.fileSize,
            document.status || 'pending'
        ]
    );
}

async function listStudyDocuments(filters={}){
    const where = [];
    const params = [];

    if(filters.status){
        params.push(filters.status);
        where.push(`d.status = $${params.length}`);
    }

    if(filters.subjectId){
        params.push(filters.subjectId);
        where.push(`d.subject_id = $${params.length}`);
    }

    if(filters.teacherId){
        params.push(filters.teacherId);
        where.push(`d.teacher_id = $${params.length}`);
    }

    if(filters.uploaderId){
        params.push(filters.uploaderId);
        where.push(`d.uploaded_by_student_id = $${params.length}`);
    }

    if(filters.visibleToStudentId){
        params.push(filters.visibleToStudentId);
        where.push(
            `(d.status = 'approved' OR d.uploaded_by_student_id = $${params.length})`
        );
    }

    if(filters.q){
        params.push(`%${String(filters.q).trim().toLowerCase()}%`);
        where.push(
            `(LOWER(d.title) LIKE $${params.length}
              OR LOWER(COALESCE(d.description, '')) LIKE $${params.length}
              OR LOWER(d.original_name) LIKE $${params.length}
              OR LOWER(s.code) LIKE $${params.length}
              OR LOWER(s.name) LIKE $${params.length}
              OR LOWER(COALESCE(t.code, '')) LIKE $${params.length}
              OR LOWER(COALESCE(t.name, '')) LIKE $${params.length})`
        );
    }

    const limit = Math.min(Number(filters.limit) || 80, 200);
    params.push(limit);

    const result = await getPool().query(
        `SELECT d.*,
                s.code AS subject_code,
                s.name AS subject_name,
                t.code AS teacher_code,
                t.name AS teacher_name
         FROM study_documents d
         JOIN subjects s ON s.id = d.subject_id
         LEFT JOIN teachers t ON t.id = d.teacher_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY d.created_at DESC
         LIMIT $${params.length}`,
        params
    );

    return result.rows.map(mapDocumentRow);
}

async function findStudyDocument(id){
    const result = await getPool().query(
        `SELECT d.*,
                s.code AS subject_code,
                s.name AS subject_name,
                t.code AS teacher_code,
                t.name AS teacher_name
         FROM study_documents d
         JOIN subjects s ON s.id = d.subject_id
         LEFT JOIN teachers t ON t.id = d.teacher_id
         WHERE d.id = $1`,
        [id]
    );

    return result.rows[0] ? mapDocumentRow(result.rows[0]) : null;
}

async function updateStudyDocumentStatus(id, status, adminUsername, reason=''){
    const result = await getPool().query(
        `UPDATE study_documents
         SET status = $2,
             rejection_reason = $3,
             approved_by = CASE WHEN $2 = 'approved' THEN $4 ELSE NULL END,
             approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE NULL END,
             updated_at = NOW()
         WHERE id = $1`,
        [id, status, reason || null, adminUsername]
    );

    return result.rowCount > 0;
}

async function deleteStudyDocument(id){
    const result = await getPool().query(
        `DELETE FROM study_documents
         WHERE id = $1
         RETURNING stored_name`,
        [id]
    );

    return result.rows[0] || null;
}

async function closeDatabase(){
    if(pool){
        await pool.end();
        pool = null;
    }
}

module.exports = {
    closeDatabase,
    createSession,
    createStudent,
    deleteSession,
    deleteStudentSchedule,
    deleteSubject,
    deleteTeacher,
    deleteTeacherSchedule,
    deleteStudyDocument,
    findAdmin,
    findStudyDocument,
    getPool,
    getSession,
    initializeDatabase,
    insertStudentSchedule,
    insertSubject,
    insertTeacher,
    insertTeacherSchedule,
    insertStudyDocument,
    listStudyDocuments,
    loadState,
    setPool,
    updateStudentPassword,
    updateStudentSchedule,
    updateStudyDocumentStatus,
    updateSubject,
    updateTeacher,
    updateTeacherSchedule
};
