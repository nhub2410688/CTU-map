let pendingDocumentItems = [];
let approvedDocumentItems = [];

function adminFormatBytes(size){
    const value = Number(size || 0);
    if(value < 1024){
        return `${value} B`;
    }
    if(value < 1024 * 1024){
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function findAdminDocument(id){
    return [...pendingDocumentItems, ...approvedDocumentItems]
        .find(document => document.id === id);
}

async function adminFetchFile(documentId, mode){
    const item = findAdminDocument(documentId);
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
            // Keep the generic message for non-JSON file errors.
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

async function loadAdminLookups(){
    const [subjects, teachers] = await Promise.all([
        api('/api/subjects'),
        api('/api/teachers')
    ]);

    const subjectOptions = subjects.subjects.map(item => `
        <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
    `).join('');
    const teacherOptions = teachers.teachers.map(item => `
        <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
    `).join('');

    for(const id of ['pendingSubjectFilter', 'approvedSubjectFilter']){
        document.getElementById(id).innerHTML =
            `<option value="">Tất cả môn học</option>${subjectOptions}`;
    }
    for(const id of ['pendingTeacherFilter', 'approvedTeacherFilter']){
        document.getElementById(id).innerHTML =
            `<option value="">Tất cả giảng viên</option>${teacherOptions}`;
    }
}

function buildDocumentQuery(prefix, status){
    const params = new URLSearchParams();
    const q = document.getElementById(`${prefix}Search`).value;
    const subjectId = document.getElementById(`${prefix}SubjectFilter`).value;
    const teacherId = document.getElementById(`${prefix}TeacherFilter`).value;

    params.set('status', status);
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

function renderDocumentRows(items, mode){
    const canReview = mode === 'pending';
    const emptyText = canReview
        ? 'Không có tài liệu chờ duyệt.'
        : 'Chưa có tài liệu đã duyệt phù hợp.';
    const rows = items.map(item => `
        <tr>
            <td>
                <strong>${escapeHtml(item.title)}</strong>
                ${item.description ? `<br><span class="muted">${escapeHtml(item.description)}</span>` : ''}
            </td>
            <td>${escapeHtml(item.subjectCode)} - ${escapeHtml(item.subjectName)}</td>
            <td>${item.teacherName ? `${escapeHtml(item.teacherCode)} - ${escapeHtml(item.teacherName)}` : '<span class="muted">Không chọn</span>'}</td>
            <td>${escapeHtml(item.uploadedBy)}</td>
            <td>${escapeHtml(item.originalName)}<br><span class="muted">${adminFormatBytes(item.fileSize)}</span></td>
            <td>
                <div class="actions">
                    <button class="small secondary" type="button" onclick="adminOpenDocument('${item.id}')">Mở</button>
                    <button class="small" type="button" onclick="adminDownloadDocument('${item.id}')">Tải</button>
                    ${canReview ? `
                        <button class="small" type="button" onclick="approveDocument('${item.id}')">Duyệt</button>
                        <button class="small secondary" type="button" onclick="rejectDocument('${item.id}')">Từ chối</button>
                    ` : `<button class="small danger" type="button" onclick="deleteDocument('${item.id}')">Xóa</button>`}
                </div>
            </td>
        </tr>
    `).join('');

    return `
        <table>
            <thead>
                <tr>
                    <th>Tài liệu</th><th>Môn học</th><th>Giảng viên</th>
                    <th>Người gửi</th><th>File</th><th>Thao tác</th>
                </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6">${emptyText}</td></tr>`}</tbody>
        </table>
    `;
}

async function loadPendingDocuments(){
    try{
        const query = buildDocumentQuery('pending', 'pending');
        const data = await api(`/api/documents?${query}`);
        pendingDocumentItems = data.documents;
        document.getElementById('pendingDocumentTable').innerHTML =
            renderDocumentRows(pendingDocumentItems, 'pending');
        setStatus('pendingDocumentStatus', '');
    }
    catch(error){
        setStatus('pendingDocumentStatus', error.message, true);
    }
}

async function loadApprovedDocuments(){
    try{
        const query = buildDocumentQuery('approved', 'approved');
        const data = await api(`/api/documents?${query}`);
        approvedDocumentItems = data.documents;
        document.getElementById('approvedDocumentTable').innerHTML =
            renderDocumentRows(approvedDocumentItems, 'approved');
        setStatus('approvedDocumentStatus', '');
    }
    catch(error){
        setStatus('approvedDocumentStatus', error.message, true);
    }
}

async function refreshDocumentTables(){
    await loadPendingDocuments();
    await loadApprovedDocuments();
}

async function changeDocumentStatus(id, status, reason=''){
    try{
        const data = await api(`/api/documents/${encodeURIComponent(id)}/status`, {
            method:'PUT',
            body:JSON.stringify({ status, reason })
        });
        setStatus('pendingDocumentStatus', data.message);
        await refreshDocumentTables();
    }
    catch(error){
        setStatus('pendingDocumentStatus', error.message, true);
    }
}

function approveDocument(id){
    changeDocumentStatus(id, 'approved');
}

function rejectDocument(id){
    const reason = window.prompt('Lý do từ chối nếu có:', '') || '';
    changeDocumentStatus(id, 'rejected', reason);
}

async function deleteDocument(id){
    if(!window.confirm('Xóa tài liệu này khỏi hệ thống?')){
        return;
    }

    try{
        const data = await api(`/api/documents/${encodeURIComponent(id)}`, {
            method:'DELETE'
        });
        setStatus('approvedDocumentStatus', data.message);
        await refreshDocumentTables();
    }
    catch(error){
        setStatus('approvedDocumentStatus', error.message, true);
    }
}

async function adminOpenDocument(id){
    try{
        await adminFetchFile(id, 'view');
    }
    catch(error){
        if(error.message.includes('chưa hỗ trợ mở trực tiếp')){
            const shouldDownload = window.confirm(
                'Tài liệu không thể mở trực tiếp. Bạn có muốn tải file về không?'
            );
            if(shouldDownload){
                await adminDownloadDocument(id);
            }
            return;
        }
        setStatus('pendingDocumentStatus', error.message, true);
    }
}

async function adminDownloadDocument(id){
    try{
        await adminFetchFile(id, 'download');
    }
    catch(error){
        setStatus('pendingDocumentStatus', error.message, true);
    }
}

function clearPendingFilters(){
    document.getElementById('pendingSearch').value = '';
    document.getElementById('pendingSubjectFilter').value = '';
    document.getElementById('pendingTeacherFilter').value = '';
    loadPendingDocuments();
}

function clearApprovedFilters(){
    document.getElementById('approvedSearch').value = '';
    document.getElementById('approvedSubjectFilter').value = '';
    document.getElementById('approvedTeacherFilter').value = '';
    loadApprovedDocuments();
}

window.ctuReady.then(async () => {
    if(requireRole('admin')){
        await loadAdminLookups();
        await refreshDocumentTables();
    }
});
