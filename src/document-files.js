const fs = require('fs');
const path = require('path');
const {
    ALLOWED_DOCUMENT_EXTENSIONS,
    DIRECT_OPEN_EXTENSIONS,
    MAX_DOCUMENT_SIZE,
    UPLOAD_DIR
} = require('./config');

function ensureUploadDir(){
    fs.mkdirSync(UPLOAD_DIR, { recursive:true });
}

function sanitizeFileName(fileName){
    return path.basename(String(fileName || 'document'))
        .replace(/[^\w.\-() ]/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
}

function getDocumentExtension(fileName){
    return path.extname(fileName).toLowerCase();
}

function isAllowedDocument(fileName){
    return ALLOWED_DOCUMENT_EXTENSIONS.has(getDocumentExtension(fileName));
}

function canOpenDocumentDirectly(fileName){
    return DIRECT_OPEN_EXTENSIONS.has(getDocumentExtension(fileName));
}

function inferOpenMime(originalName, fallbackMimeType){
    const extension = getDocumentExtension(originalName);

    if(extension === '.pdf'){
        return 'application/pdf';
    }
    if(extension === '.txt'){
        return 'text/plain; charset=utf-8';
    }
    if(extension === '.csv'){
        return 'text/csv; charset=utf-8';
    }

    return fallbackMimeType;
}

function readRequestBuffer(req, maxSize=MAX_DOCUMENT_SIZE + 1024 * 1024){
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;

        req.on('data', chunk => {
            size += chunk.length;
            if(size > maxSize){
                reject(new Error('FILE_TOO_LARGE'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function parseMultipartForm(req){
    const contentType = req.headers['content-type'] || '';
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

    if(!match){
        throw new Error('INVALID_MULTIPART');
    }

    const boundary = `--${match[1] || match[2]}`;
    const body = (await readRequestBuffer(req)).toString('latin1');
    const fields = {};
    const files = {};

    for(const rawPart of body.split(boundary).slice(1, -1)){
        let part = rawPart;
        if(part.startsWith('\r\n')){
            part = part.slice(2);
        }
        if(part.endsWith('\r\n')){
            part = part.slice(0, -2);
        }

        const separatorIndex = part.indexOf('\r\n\r\n');
        if(separatorIndex === -1){
            continue;
        }

        const rawHeaders = part.slice(0, separatorIndex);
        let content = part.slice(separatorIndex + 4);
        if(content.endsWith('\r\n')){
            content = content.slice(0, -2);
        }

        const disposition = rawHeaders
            .split('\r\n')
            .find(line => /^content-disposition:/i.test(line)) || '';
        const typeHeader = rawHeaders
            .split('\r\n')
            .find(line => /^content-type:/i.test(line)) || '';
        const nameMatch = disposition.match(/name="([^"]+)"/i);
        const fileMatch = disposition.match(/filename="([^"]*)"/i);

        if(!nameMatch){
            continue;
        }

        const fieldName = nameMatch[1];

        if(fileMatch){
            const originalName = sanitizeFileName(fileMatch[1]);
            const buffer = Buffer.from(content, 'latin1');
            files[fieldName] = {
                originalName,
                mimeType: typeHeader.replace(/^content-type:\s*/i, '').trim() ||
                    'application/octet-stream',
                buffer,
                size: buffer.length
            };
        }
        else{
            fields[fieldName] = Buffer.from(content, 'latin1').toString('utf8').trim();
        }
    }

    return { fields, files };
}

function formatDocument(document){
    return {
        ...document,
        downloadUrl: `/api/documents/${encodeURIComponent(document.id)}/download`,
        viewUrl: `/api/documents/${encodeURIComponent(document.id)}/view`
    };
}

module.exports = {
    canOpenDocumentDirectly,
    ensureUploadDir,
    formatDocument,
    inferOpenMime,
    isAllowedDocument,
    parseMultipartForm
};
