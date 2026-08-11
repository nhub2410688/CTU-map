const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CTUMap@2026';
const UPLOAD_DIR = path.join(__dirname, '..', 'storage', 'uploads');
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;

// Chỉ cho phép PDF: xem trực tiếp trên trình duyệt, không cần tải về
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['.pdf']);

const DIRECT_OPEN_EXTENSIONS = new Set(['.pdf']);

module.exports = {
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    ALLOWED_DOCUMENT_EXTENSIONS,
    DIRECT_OPEN_EXTENSIONS,
    MAX_DOCUMENT_SIZE,
    PORT,
    UPLOAD_DIR
};
