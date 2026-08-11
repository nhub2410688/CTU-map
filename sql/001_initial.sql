-- CTU Map - Schema (multi-session classes)

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

-- Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    class_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subjects_code_unique_idx
    ON subjects (LOWER(code));

CREATE INDEX IF NOT EXISTS subjects_name_idx
    ON subjects (LOWER(name));

-- Teachers
CREATE TABLE IF NOT EXISTS teachers (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    class_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS teachers_code_unique_idx
    ON teachers (LOWER(code));

CREATE INDEX IF NOT EXISTS teachers_name_idx
    ON teachers (LOWER(name));

-- Class Sections (Lớp học phần)
CREATE TABLE IF NOT EXISTS class_sections (
    id UUID PRIMARY KEY,
    class_code TEXT NOT NULL,
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS class_sections_code_unique_idx
    ON class_sections (LOWER(class_code));

CREATE INDEX IF NOT EXISTS class_sections_subject_idx
    ON class_sections (subject_id);

CREATE INDEX IF NOT EXISTS class_sections_teacher_idx
    ON class_sections (teacher_id);

-- Class Schedules (Các buổi học của lớp)
CREATE TABLE IF NOT EXISTS class_schedules (
    id UUID PRIMARY KEY,
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
    day SMALLINT NOT NULL CHECK (day BETWEEN 2 AND 7),
    start_period SMALLINT NOT NULL CHECK (start_period BETWEEN 1 AND 9),
    duration SMALLINT NOT NULL CHECK (duration BETWEEN 1 AND 5),
    room TEXT NOT NULL,
    route_node TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS class_schedules_section_idx
    ON class_schedules (class_section_id);

CREATE INDEX IF NOT EXISTS class_schedules_day_period_idx
    ON class_schedules (day, start_period);

-- Student Enrollments
CREATE TABLE IF NOT EXISTS student_enrollments (
    id UUID PRIMARY KEY,
    student_id VARCHAR(8) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, class_section_id)
);

CREATE INDEX IF NOT EXISTS student_enrollments_student_idx
    ON student_enrollments (student_id);

CREATE INDEX IF NOT EXISTS student_enrollments_section_idx
    ON student_enrollments (class_section_id);

-- Notifications for students
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    student_id VARCHAR(8) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_student_idx
    ON notifications (student_id, is_read, created_at DESC);

-- Study Documents
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
