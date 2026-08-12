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

async function refreshClassCounts(client = getPool()){
    await client.query('UPDATE subjects SET class_count = 0');
    await client.query('UPDATE teachers SET class_count = 0');

    const subjectCounts = await client.query(
        `SELECT subject_id, COUNT(*)::int AS class_count
         FROM class_sections
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
         FROM class_sections
         GROUP BY teacher_id`
    );
    for(const row of teacherCounts.rows){
        await client.query(
            'UPDATE teachers SET class_count = $2 WHERE id = $1',
            [row.teacher_id, row.class_count]
        );
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

async function initializeDatabase(options = {}) {
    if (options.pool) {
        setPool(options.pool);
    }

    await runSchema();

    const username = options.adminUsername || process.env.ADMIN_USERNAME;
    const password = options.adminPassword || process.env.ADMIN_PASSWORD;

    await seedAdmin(username, password);
}

// ==================== AUTH / STUDENTS ====================

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

async function createSession(token, role, userId, maxAgeHours = 8){
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

// ==================== LOAD STATE (lightweight) ====================

async function loadState(){
    const [
        studentsResult,
        subjectsResult,
        teachersResult
    ] = await Promise.all([
        getPool().query(
            `SELECT student_id, password_hash, legacy_salt,
                    legacy_password_hash
             FROM students`
        ),
        getPool().query(
            'SELECT id, code, name, class_count FROM subjects'
        ),
        getPool().query(
            'SELECT id, code, name, class_count FROM teachers'
        )
    ]);

    const students = {};
    for(const row of studentsResult.rows){
        students[row.student_id] = {
            studentId: row.student_id,
            passwordHash: row.password_hash,
            legacySalt: row.legacy_salt,
            legacyPasswordHash: row.legacy_password_hash
        };
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
        }))
    };
}

// ==================== SUBJECTS ====================

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

// ==================== TEACHERS ====================

async function insertTeacher(teacher){
    await getPool().query(
        `INSERT INTO teachers (id, code, name)
         VALUES ($1, $2, $3)`,
        [teacher.id, teacher.code, teacher.name]
    );
}

async function updateTeacher(teacher){
    const result = await getPool().query(
        `UPDATE teachers
         SET code = $2,
             name = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [teacher.id, teacher.code, teacher.name]
    );
    return result.rowCount > 0;
}

async function deleteTeacher(id){
    const result = await getPool().query(
        'DELETE FROM teachers WHERE id = $1',
        [id]
    );
    return result.rowCount > 0;
}

// ==================== CLASS SECTIONS + SCHEDULES ====================

function mapClassSection(row, schedules = []){
    return {
        id: row.id,
        classCode: row.class_code,
        subjectId: row.subject_id,
        subjectCode: row.subject_code || '',
        subject: row.subject_name || '',
        teacherId: row.teacher_id,
        teacherCode: row.teacher_code || '',
        teacherName: row.teacher_name || '',
        schedules: schedules.map(s => ({
            id: s.id,
            day: Number(s.day),
            startPeriod: Number(s.start_period),
            duration: Number(s.duration),
            room: s.room,
            routeNode: s.route_node
        })),
        createdAt: row.created_at
    };
}

async function listClassSections(filters = {}){
    const where = [];
    const params = [];

    if(filters.q){
        params.push(`%${String(filters.q).trim().toLowerCase()}%`);
        where.push(
            `(LOWER(cs.class_code) LIKE $${params.length}
              OR LOWER(s.code) LIKE $${params.length}
              OR LOWER(s.name) LIKE $${params.length}
              OR LOWER(t.code) LIKE $${params.length}
              OR LOWER(t.name) LIKE $${params.length})`
        );
    }

    if(filters.subjectId){
        params.push(filters.subjectId);
        where.push(`cs.subject_id = $${params.length}`);
    }

    if(filters.teacherId){
        params.push(filters.teacherId);
        where.push(`cs.teacher_id = $${params.length}`);
    }

    if(filters.day){
        params.push(Number(filters.day));
        where.push(`EXISTS (
            SELECT 1 FROM class_schedules sch
            WHERE sch.class_section_id = cs.id AND sch.day = $${params.length}
        )`);
    }

    const result = await getPool().query(
        `SELECT cs.id, cs.class_code, cs.subject_id, cs.teacher_id, cs.created_at,
                s.code AS subject_code, s.name AS subject_name,
                t.code AS teacher_code, t.name AS teacher_name
         FROM class_sections cs
         JOIN subjects s ON s.id = cs.subject_id
         JOIN teachers t ON t.id = cs.teacher_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY cs.class_code`,
        params
    );

    if(result.rows.length === 0){
        return [];
    }

    const sectionIds = result.rows.map(r => r.id);
    const schedulesResult = await getPool().query(
        `SELECT id, class_section_id, day, start_period, duration, room, route_node
         FROM class_schedules
         WHERE class_section_id = ANY($1::uuid[])
         ORDER BY day, start_period`,
        [sectionIds]
    );

    const schedulesBySection = {};
    for(const sch of schedulesResult.rows){
        if(!schedulesBySection[sch.class_section_id]){
            schedulesBySection[sch.class_section_id] = [];
        }
        schedulesBySection[sch.class_section_id].push(sch);
    }

    return result.rows.map(row =>
        mapClassSection(row, schedulesBySection[row.id] || [])
    );
}

async function findClassSection(id){
    const result = await getPool().query(
        `SELECT cs.id, cs.class_code, cs.subject_id, cs.teacher_id, cs.created_at,
                s.code AS subject_code, s.name AS subject_name,
                t.code AS teacher_code, t.name AS teacher_name
         FROM class_sections cs
         JOIN subjects s ON s.id = cs.subject_id
         JOIN teachers t ON t.id = cs.teacher_id
         WHERE cs.id = $1`,
        [id]
    );

    if(!result.rows[0]){
        return null;
    }

    const schedulesResult = await getPool().query(
        `SELECT id, class_section_id, day, start_period, duration, room, route_node
         FROM class_schedules
         WHERE class_section_id = $1
         ORDER BY day, start_period`,
        [id]
    );

    return mapClassSection(result.rows[0], schedulesResult.rows);
}

async function insertClassSection(section, schedules){
    const client = await getPool().connect();
    try{
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO class_sections (id, class_code, subject_id, teacher_id)
             VALUES ($1, $2, $3, $4)`,
            [section.id, section.classCode, section.subjectId, section.teacherId]
        );

        for(const sch of schedules){
            await client.query(
                `INSERT INTO class_schedules
                    (id, class_section_id, day, start_period, duration, room, route_node)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    sch.id || crypto.randomUUID(),
                    section.id,
                    sch.day,
                    sch.startPeriod,
                    sch.duration,
                    sch.room,
                    sch.routeNode
                ]
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

async function updateClassSection(section, schedules){
    const client = await getPool().connect();
    try{
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE class_sections
             SET class_code = $2, subject_id = $3, teacher_id = $4
             WHERE id = $1`,
            [section.id, section.classCode, section.subjectId, section.teacherId]
        );

        if(result.rowCount === 0){
            await client.query('ROLLBACK');
            return false;
        }

        await client.query(
            'DELETE FROM class_schedules WHERE class_section_id = $1',
            [section.id]
        );

        for(const sch of schedules){
            await client.query(
                `INSERT INTO class_schedules
                    (id, class_section_id, day, start_period, duration, room, route_node)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    sch.id || crypto.randomUUID(),
                    section.id,
                    sch.day,
                    sch.startPeriod,
                    sch.duration,
                    sch.room,
                    sch.routeNode
                ]
            );
        }

        await refreshClassCounts(client);
        await client.query('COMMIT');
        return true;
    }
    catch(error){
        await client.query('ROLLBACK');
        throw error;
    }
    finally{
        client.release();
    }
}

async function deleteClassSection(id){
    const client = await getPool().connect();
    try{
        await client.query('BEGIN');
        const result = await client.query(
            'DELETE FROM class_sections WHERE id = $1 RETURNING id',
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

// ==================== ENROLLMENTS ====================

async function listStudentEnrollments(studentId){
    const result = await getPool().query(
        `SELECT e.id AS enrollment_id, e.class_section_id,
                cs.class_code,
                s.id AS subject_id, s.code AS subject_code, s.name AS subject_name,
                t.id AS teacher_id, t.code AS teacher_code, t.name AS teacher_name
         FROM student_enrollments e
         JOIN class_sections cs ON cs.id = e.class_section_id
         JOIN subjects s ON s.id = cs.subject_id
         JOIN teachers t ON t.id = cs.teacher_id
         WHERE e.student_id = $1
         ORDER BY cs.class_code`,
        [studentId]
    );

    if(result.rows.length === 0){
        return [];
    }

    const sectionIds = result.rows.map(r => r.class_section_id);
    const schedulesResult = await getPool().query(
        `SELECT id, class_section_id, day, start_period, duration, room, route_node
         FROM class_schedules
         WHERE class_section_id = ANY($1::uuid[])
         ORDER BY day, start_period`,
        [sectionIds]
    );

    const schedulesBySection = {};
    for(const sch of schedulesResult.rows){
        if(!schedulesBySection[sch.class_section_id]){
            schedulesBySection[sch.class_section_id] = [];
        }
        schedulesBySection[sch.class_section_id].push({
            id: sch.id,
            day: Number(sch.day),
            startPeriod: Number(sch.start_period),
            duration: Number(sch.duration),
            room: sch.room,
            routeNode: sch.route_node
        });
    }

    return result.rows.map(row => ({
        id: row.enrollment_id,
        classSectionId: row.class_section_id,
        classCode: row.class_code,
        subjectId: row.subject_id,
        subjectCode: row.subject_code,
        subject: row.subject_name,
        teacherId: row.teacher_id,
        teacherCode: row.teacher_code,
        teacher: row.teacher_name,
        schedules: schedulesBySection[row.class_section_id] || []
    }));
}

async function insertEnrollment(studentId, classSectionId){
    const id = crypto.randomUUID();
    await getPool().query(
        `INSERT INTO student_enrollments (id, student_id, class_section_id)
         VALUES ($1, $2, $3)`,
        [id, studentId, classSectionId]
    );
    return id;
}

async function deleteEnrollment(studentId, enrollmentId){
    const result = await getPool().query(
        `DELETE FROM student_enrollments
         WHERE id = $1 AND student_id = $2`,
        [enrollmentId, studentId]
    );
    return result.rowCount > 0;
}

async function deleteEnrollmentsBySection(classSectionId, studentIds = null){
    if(studentIds && studentIds.length > 0){
        await getPool().query(
            `DELETE FROM student_enrollments
             WHERE class_section_id = $1 AND student_id = ANY($2::varchar[])`,
            [classSectionId, studentIds]
        );
    }
    else{
        await getPool().query(
            `DELETE FROM student_enrollments WHERE class_section_id = $1`,
            [classSectionId]
        );
    }
}

async function getEnrolledStudentIds(classSectionId){
    const result = await getPool().query(
        `SELECT student_id FROM student_enrollments WHERE class_section_id = $1`,
        [classSectionId]
    );
    return result.rows.map(r => r.student_id);
}

// ==================== CONFLICT HELPERS ====================

function periodsOverlap(aStart, aDuration, bStart, bDuration){
    const aEnd = aStart + aDuration - 1;
    const bEnd = bStart + bDuration - 1;
    return aStart <= bEnd && bStart <= aEnd;
}

async function findTeacherConflicts(teacherId, schedules, excludeSectionId = null){
    const params = [teacherId];
    let excludeClause = '';
    if(excludeSectionId){
        params.push(excludeSectionId);
        excludeClause = `AND cs.id != $${params.length}`;
    }

    const result = await getPool().query(
        `SELECT cs.class_code, sch.day, sch.start_period, sch.duration, sch.room
         FROM class_schedules sch
         JOIN class_sections cs ON cs.id = sch.class_section_id
         WHERE cs.teacher_id = $1 ${excludeClause}`,
        params
    );

    const conflicts = [];
    for(const existing of result.rows){
        for(const candidate of schedules){
            if(
                Number(existing.day) === Number(candidate.day) &&
                periodsOverlap(
                    Number(existing.start_period), Number(existing.duration),
                    Number(candidate.startPeriod), Number(candidate.duration)
                )
            ){
                conflicts.push({
                    type: 'teacher',
                    classCode: existing.class_code,
                    day: existing.day,
                    startPeriod: existing.start_period,
                    duration: existing.duration
                });
            }
        }
    }
    return conflicts;
}

async function findRoomConflicts(schedules, excludeSectionId = null){
    const conflicts = [];
    for(const candidate of schedules){
        const params = [candidate.room, candidate.day];
        let excludeClause = '';
        if(excludeSectionId){
            params.push(excludeSectionId);
            excludeClause = `AND cs.id != $${params.length}`;
        }

        const result = await getPool().query(
            `SELECT cs.class_code, sch.day, sch.start_period, sch.duration, sch.room
             FROM class_schedules sch
             JOIN class_sections cs ON cs.id = sch.class_section_id
             WHERE LOWER(sch.room) = LOWER($1) AND sch.day = $2 ${excludeClause}`,
            params
        );

        for(const existing of result.rows){
            if(
                periodsOverlap(
                    Number(existing.start_period), Number(existing.duration),
                    Number(candidate.startPeriod), Number(candidate.duration)
                )
            ){
                conflicts.push({
                    type: 'room',
                    classCode: existing.class_code,
                    day: existing.day,
                    startPeriod: existing.start_period,
                    duration: existing.duration,
                    room: existing.room
                });
            }
        }
    }
    return conflicts;
}

async function findStudentConflicts(studentId, schedules, excludeSectionId = null){
    const params = [studentId];
    let excludeClause = '';
    if(excludeSectionId){
        params.push(excludeSectionId);
        excludeClause = `AND e.class_section_id != $${params.length}`;
    }

    const result = await getPool().query(
        `SELECT cs.class_code, sch.day, sch.start_period, sch.duration
         FROM student_enrollments e
         JOIN class_schedules sch ON sch.class_section_id = e.class_section_id
         JOIN class_sections cs ON cs.id = e.class_section_id
         WHERE e.student_id = $1 ${excludeClause}`,
        params
    );

    const conflicts = [];
    for(const existing of result.rows){
        for(const candidate of schedules){
            if(
                Number(existing.day) === Number(candidate.day) &&
                periodsOverlap(
                    Number(existing.start_period), Number(existing.duration),
                    Number(candidate.startPeriod), Number(candidate.duration)
                )
            ){
                conflicts.push({
                    type: 'student',
                    classCode: existing.class_code,
                    day: existing.day,
                    startPeriod: existing.start_period,
                    duration: existing.duration
                });
            }
        }
    }
    return conflicts;
}

async function findStudentsWithConflict(classSectionId, newSchedules){
    const enrolled = await getEnrolledStudentIds(classSectionId);
    const affected = [];

    for(const studentId of enrolled){
        const conflicts = await findStudentConflicts(
            studentId,
            newSchedules,
            classSectionId
        );
        if(conflicts.length > 0){
            affected.push(studentId);
        }
    }
    return affected;
}

// ==================== NOTIFICATIONS ====================

async function createNotification(studentId, title, message){
    const id = crypto.randomUUID();
    await getPool().query(
        `INSERT INTO notifications (id, student_id, title, message)
         VALUES ($1, $2, $3, $4)`,
        [id, studentId, title, message]
    );
    return id;
}

async function listNotifications(studentId, limit = 50){
    const result = await getPool().query(
        `SELECT id, title, message, is_read, created_at
         FROM notifications
         WHERE student_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [studentId, limit]
    );
    return result.rows.map(row => ({
        id: row.id,
        title: row.title,
        message: row.message,
        isRead: row.is_read,
        createdAt: row.created_at
    }));
}

async function markNotificationRead(studentId, notificationId){
    const result = await getPool().query(
        `DELETE FROM notifications
         WHERE id = $1 AND student_id = $2`,
        [notificationId, studentId]
    );
    return result.rowCount > 0;
}

async function markAllNotificationsRead(studentId){
    await getPool().query(
        `DELETE FROM notifications WHERE student_id = $1`,
        [studentId]
    );
}

async function countUnreadNotifications(studentId){
    const result = await getPool().query(
        `SELECT COUNT(*)::int AS cnt
         FROM notifications
         WHERE student_id = $1 AND is_read = false`,
        [studentId]
    );
    return result.rows[0]?.cnt || 0;
}

// ==================== DOCUMENTS ====================

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

async function listStudyDocuments(filters = {}){
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

async function updateStudyDocumentStatus(id, status, adminUsername, reason = ''){
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
    deleteSubject,
    deleteTeacher,
    deleteClassSection,
    deleteEnrollment,
    deleteEnrollmentsBySection,
    deleteStudyDocument,
    findAdmin,
    findClassSection,
    findStudyDocument,
    findTeacherConflicts,
    findRoomConflicts,
    findStudentConflicts,
    findStudentsWithConflict,
    getEnrolledStudentIds,
    getPool,
    getSession,
    initializeDatabase,
    insertClassSection,
    insertEnrollment,
    insertSubject,
    insertTeacher,
    insertStudyDocument,
    listClassSections,
    listNotifications,
    listStudentEnrollments,
    listStudyDocuments,
    loadState,
    markAllNotificationsRead,
    markNotificationRead,
    countUnreadNotifications,
    createNotification,
    setPool,
    updateClassSection,
    updateStudentPassword,
    updateStudyDocumentStatus,
    updateSubject,
    updateTeacher
};
