let documentSubjects = [];
let documentTeachers = [];
let documentItems = [];

function formatBytes(size){
    const value = Number(size || 0);
    if(value < 1024){
        return `${value} B`;
    }
    if(value < 1024 * 1024){
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status){
    if(status === 'approved'){
        return 'Đã duyệt';
    }
    if(status === 'rejected'){
        return 'Đã từ chối';
    }
    return 'Chờ duyệt';
}

async function fetchFile(documentId, mode){
    const item = documentItems.find(document => document.id === documentId);
    if(!item){
        return;
    }

    const response = await fetch(
        mode === 'view' ? item.viewUrl : item.downloadUrl,
        {
            headers: authToken ? { Authorization:`Bearer ${authToken}` } : {}
        }
    );

    if(!response.ok){
        let message = 'Không tải được tài liệu';
        try{
            const data = await response.json();
            message = data.error || message;
        }
        catch{
        }
        throw new Error(message);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    if(mode === 'view'){
        window.open(url, '_blank', 'noopener');
        return;
    }

    const link = document.createElement('a');
    link.href = url;
    link.download = item.originalName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadDocumentLookups(){
    const [subjects, teachers] = await Promise.all([
        api('/api/subjects'),
        api('/api/teachers')
    ]);

    documentSubjects = subjects.subjects;
    documentTeachers = teachers.teachers;

    const subjectOptions = documentSubjects.map(item => `
        <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
    `).join('');
    const teacherOptions = documentTeachers.map(item => `
        <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
    `).join('');

    document.getElementById('documentSubject').innerHTML =
        `<option value="">Chọn môn học</option>${subjectOptions}`;
    document.getElementById('filterSubject').innerHTML =
        `<option value="">Tất cả môn học</option>${subjectOptions}`;
    document.getElementById('documentTeacher').innerHTML =
        `<option value="">Không chọn giảng viên</option>${teacherOptions}`;
    document.getElementById('filterTeacher').innerHTML =
        `<option value="">Tất cả giảng viên</option>${teacherOptions}`;
}

function buildDocumentQuery(){
    const params = new URLSearchParams();
    const q = document.getElementById('documentSearch').value;
    const subjectId = document.getElementById('filterSubject').value;
    const teacherId = document.getElementById('filterTeacher').value;

    if(q){
        params.set('q', q);
    }
    if(subjectId){
        params.set('subjectId', subjectId);
    }
    if(teacherId){
        params.set('teacherId', teacherId);
    }

    return params.toString();
}

async function uploadDocument(event){
    event.preventDefault();

    try{
        const file = document.getElementById('documentFile').files[0];
        if(!file){
            setStatus('documentUploadStatus', 'Vui lòng chọn file PDF', true);
            return;
        }
        const name = (file.name || '').toLowerCase();
        if(!name.endsWith('.pdf')){
            setStatus('documentUploadStatus', 'Chỉ chấp nhận file PDF', true);
            return;
        }

        const form = new FormData();
        form.append('title', document.getElementById('documentTitle').value);
        form.append('description', document.getElementById('documentDescription').value);
        form.append('subjectId', document.getElementById('documentSubject').value);
        form.append('teacherId', document.getElementById('documentTeacher').value);
        form.append('file', file);

        const data = await api('/api/documents', {
            method:'POST',
            body:form
        });

        setStatus('documentUploadStatus', data.message);
        document.getElementById('documentForm').reset();
        await loadDocuments();
    }
    catch(error){
        setStatus('documentUploadStatus', error.message, true);
    }
}

async function loadDocuments(){
    try{
        const query = buildDocumentQuery();
        const data = await api(`/api/documents${query ? `?${query}` : ''}`);
        documentItems = data.documents;

        const rows = documentItems.map(item => `
            <tr>
                <td>
                    <strong>${escapeHtml(item.title)}</strong>
                    ${item.description ? `<br><span class="muted">${escapeHtml(item.description)}</span>` : ''}
                </td>
                <td>${escapeHtml(item.subjectCode)} - ${escapeHtml(item.subjectName)}</td>
                <td>${item.teacherName ? `${escapeHtml(item.teacherCode)} - ${escapeHtml(item.teacherName)}` : '<span class="muted">Không chọn</span>'}</td>
                <td>${escapeHtml(item.originalName)}<br><span class="muted">${formatBytes(item.fileSize)}</span></td>
                <td>${statusLabel(item.status)}</td>
                <td>
                    <div class="actions">
                        <button class="small secondary" type="button" onclick="openDocument('${item.id}')">Mở</button>
                        <button class="small" type="button" onclick="downloadDocument('${item.id}')">Tải về</button>
                    </div>
                </td>
            </tr>
        `).join('');

        document.getElementById('documentTable').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Tài liệu</th><th>Môn học</th><th>Giảng viên</th>
                        <th>File</th><th>Trạng thái</th><th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>${rows || '<tr><td colspan="6">Chưa có tài liệu phù hợp.</td></tr>'}</tbody>
            </table>
        `;
    }
    catch(error){
        setStatus('documentListStatus', error.message, true);
    }
}

async function openDocument(id){
    try{
        await fetchFile(id, 'view');
    }
    catch(error){
        if(error.message.includes('chưa hỗ trợ mở trực tiếp')){
            const shouldDownload = window.confirm(
                'Tài liệu không thể mở trực tiếp. Bạn có muốn tải file về không?'
            );
            if(shouldDownload){
                await downloadDocument(id);
            }
            return;
        }
        setStatus('documentListStatus', error.message, true);
    }
}

async function downloadDocument(id){
    try{
        await fetchFile(id, 'download');
    }
    catch(error){
        setStatus('documentListStatus', error.message, true);
    }
}

function clearDocumentFilters(){
    document.getElementById('documentSearch').value = '';
    document.getElementById('filterSubject').value = '';
    document.getElementById('filterTeacher').value = '';
    loadDocuments();
}

window.ctuReady.then(async () => {
    if(requireRole('student')){
        await loadDocumentLookups();
        await loadDocuments();
    }
});
