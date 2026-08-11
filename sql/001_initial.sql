CREATE TABLE IF NOT EXISTS students (
    student_id VARCHAR(8) PRIMARY KEY,
    password_hash TEXT,
    legacy_salt TEXT,
    legacy_password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON sessions (expires_at);

-- ==========================================
-- SUBJECTS (MÔN HỌC)
-- ==========================================
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    class_count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE subjects
    ADD COLUMN IF NOT EXISTS class_count INTEGER NOT NULL DEFAULT 0;

-- Giữ UNIQUE cho mã môn học
CREATE UNIQUE INDEX IF NOT EXISTS subjects_code_unique_idx
    ON subjects (LOWER(code));

-- BỎ UNIQUE INDEX CHO TÊN MÔN, thay bằng INDEX thường để tối ưu truy vấn
CREATE INDEX IF NOT EXISTS subjects_name_idx
    ON subjects (LOWER(name));

-- ==========================================
-- TEACHERS (GIẢNG VIÊN)
-- ==========================================
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    class_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Giữ UNIQUE cho mã giảng viên
CREATE UNIQUE INDEX IF NOT EXISTS teachers_code_unique_idx
    ON teachers (LOWER(code));

-- BỎ UNIQUE INDEX CHO TÊN GIẢNG VIÊN, thay bằng INDEX thường để tối ưu truy vấn
CREATE INDEX IF NOT EXISTS teachers_name_idx
    ON teachers (LOWER(name));

-- ==========================================
-- TEACHER SCHEDULES (LỊCH TRÌNH)
-- ==========================================
CREATE TABLE IF NOT EXISTS teacher_schedules (
    id UUID PRIMARY KEY,
    teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT,
    teacher_code TEXT NOT NULL,
    teacher_name TEXT NOT NULL,
    day SMALLINT NOT NULL CHECK (day BETWEEN 2 AND 7),
    period SMALLINT NOT NULL CHECK (period BETWEEN 1 AND 9),
    duration SMALLINT NOT NULL CHECK (duration BETWEEN 1 AND 5),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    room TEXT NOT NULL,
    route_node TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teacher_schedules_day_idx
    ON teacher_schedules (day, period);

ALTER TABLE teacher_schedules
    ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS teacher_schedules_teacher_idx
    ON teacher_schedules (teacher_id);

-- ==========================================
-- STUDENT SCHEDULE ENTRIES
-- ==========================================
CREATE TABLE IF NOT EXISTS student_schedule_entries (
    id UUID PRIMARY KEY,
    student_id VARCHAR(8) NOT NULL
        REFERENCES students(student_id) ON DELETE CASCADE,
    teacher_schedule_id UUID
        REFERENCES teacher_schedules(id) ON DELETE CASCADE,
    legacy_day SMALLINT,
    legacy_start_period SMALLINT,
    legacy_duration SMALLINT,
    legacy_subject TEXT,
    legacy_room TEXT,
    legacy_teacher TEXT,
    legacy_route_node TEXT,
    legacy_building TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        teacher_schedule_id IS NOT NULL OR
        (
            legacy_day IS NOT NULL AND
            legacy_start_period IS NOT NULL AND
            legacy_duration IS NOT NULL AND
            legacy_subject IS NOT NULL AND
            legacy_room IS NOT NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS student_schedule_student_idx
    ON student_schedule_entries (student_id);

CREATE UNIQUE INDEX IF NOT EXISTS student_schedule_link_unique_idx
    ON student_schedule_entries (student_id, teacher_schedule_id)
    WHERE teacher_schedule_id IS NOT NULL;

-- ==========================================
-- STUDY DOCUMENTS
-- ==========================================
CREATE TABLE IF NOT EXISTS study_documents (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
    uploaded_by_student_id VARCHAR(8) NOT NULL
        REFERENCES students(student_id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    approved_by TEXT REFERENCES admins(username) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS study_documents_subject_idx
    ON study_documents (subject_id);

CREATE INDEX IF NOT EXISTS study_documents_teacher_idx
    ON study_documents (teacher_id);

CREATE INDEX IF NOT EXISTS study_documents_status_idx
    ON study_documents (status, created_at DESC);

-- Thêm cột mã lớp
ALTER TABLE teacher_schedules
    ADD COLUMN IF NOT EXISTS class_code TEXT;

-- Thêm cột mã môn và tên môn (nếu chưa có, vì code đang dùng)
ALTER TABLE teacher_schedules
    ADD COLUMN IF NOT EXISTS subject_code TEXT;

ALTER TABLE teacher_schedules
    ADD COLUMN IF NOT EXISTS subject TEXT;

-- Tạo index để tìm kiếm nhanh theo mã lớp
CREATE INDEX IF NOT EXISTS teacher_schedules_class_code_idx
    ON teacher_schedules (LOWER(class_code));

CREATE UNIQUE INDEX IF NOT EXISTS teacher_schedules_class_code_unique_idx
    ON teacher_schedules (LOWER(class_code))
    WHERE class_code IS NOT NULL;