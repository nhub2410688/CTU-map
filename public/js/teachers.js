let classItems = [];
let subjectItems = [];
let teacherItems = [];
let editingClassId = '';
let editingSubjectId = '';
let editingTeacherId = '';
let sessionRowCount = 0;

function showTeacherTab(tabName){
    document.querySelectorAll('[data-teacher-tab]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.teacherTab !== tabName);
    });
    document.querySelectorAll('#teacherTabs button').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabName);
    });
}

function periodText(start, duration){
    const end = Number(start) + Number(duration) - 1;
    return `${start}-${end}`;
}

function setupSearchable(inputId, hiddenId, listId, items, getLabel, getValue){
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const list = document.getElementById(listId);
    if(!input || !hidden || !list) return;

    function render(filter = ''){
        const q = filter.trim().toLowerCase();
        const filtered = !q
            ? items
            : items.filter(item => getLabel(item).toLowerCase().includes(q));

        list.innerHTML = filtered.slice(0, 30).map(item =>
            `<div data-value="${getValue(item)}">${escapeHtml(getLabel(item))}</div>`
        ).join('');
        list.classList.toggle('show', filtered.length > 0 && document.activeElement === input);
    }

    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('input', () => {
        hidden.value = '';
        render(input.value);
    });
    input.addEventListener('blur', () => {
        setTimeout(() => list.classList.remove('show'), 150);
    });

    list.addEventListener('mousedown', (e) => {
        const div = e.target.closest('div[data-value]');
        if(!div) return;
        hidden.value = div.dataset.value;
        input.value = div.textContent;
        list.classList.remove('show');
    });
}

function setSearchableValue(inputId, hiddenId, items, id, getLabel, getValue){
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const item = items.find(i => getValue(i) === id);
    if(item){
        hidden.value = id;
        input.value = getLabel(item);
    } else {
        hidden.value = '';
        input.value = '';
    }
}

function addSessionRow(data = {}){
    sessionRowCount++;
    const id = sessionRowCount;
    const div = document.createElement('div');
    div.className = 'session-row';
    div.dataset.rowId = id;
    div.innerHTML = `
        <div class="field">
            <label>Thứ</label>
            <select class="sess-day">
                <option value="2" ${data.day == 2 ? 'selected' : ''}>Thứ 2</option>
                <option value="3" ${data.day == 3 ? 'selected' : ''}>Thứ 3</option>
                <option value="4" ${data.day == 4 ? 'selected' : ''}>Thứ 4</option>
                <option value="5" ${data.day == 5 ? 'selected' : ''}>Thứ 5</option>
                <option value="6" ${data.day == 6 ? 'selected' : ''}>Thứ 6</option>
                <option value="7" ${data.day == 7 ? 'selected' : ''}>Thứ 7</option>
            </select>
        </div>
        <div class="field">
            <label>Tiết bắt đầu</label>
            <input class="sess-period" type="number" min="1" max="9" value="${data.startPeriod || 1}" required>
        </div>
        <div class="field">
            <label>Số tiết</label>
            <input class="sess-duration" type="number" min="1" max="5" value="${data.duration || 1}" required>
        </div>
        <div class="field">
            <label>Phòng học</label>
            <input class="sess-room" placeholder="204/D1" value="${escapeHtml(data.room || '')}" required>
        </div>
        <button type="button" class="small danger" onclick="this.closest('.session-row').remove()">Xóa</button>
    `;
    document.getElementById('sessionsList').appendChild(div);
}

function getSessionsFromForm(){
    const rows = document.querySelectorAll('#sessionsList .session-row');
    return Array.from(rows).map(row => ({
        day: row.querySelector('.sess-day').value,
        startPeriod: row.querySelector('.sess-period').value,
        duration: row.querySelector('.sess-duration').value,
        room: row.querySelector('.sess-room').value
    }));
}

function clearSessions(){
    document.getElementById('sessionsList').innerHTML = '';
    sessionRowCount = 0;
}

async function loadSubjects(){
    try{
        const data = await api('/api/subjects');
        subjectItems = data.subjects;
        setupSearchable(
            'classSubjectInput', 'classSubject', 'classSubjectList',
            subjectItems,
            item => `${item.code} - ${item.name}`,
            item => item.id
        );
        filterSubjects();
    }
    catch(error){
        setStatus('subjectStatus', error.message, true);
    }
}

async function saveSubject(event){
    event.preventDefault();
    try{
        const url = editingSubjectId
            ? `/api/subjects/${encodeURIComponent(editingSubjectId)}`
            : '/api/subjects';
        const data = await api(url, {
            method: editingSubjectId ? 'PUT' : 'POST',
            body: JSON.stringify({
                code: document.getElementById('subjectCode').value,
                name: document.getElementById('subjectName').value
            })
        });
        setStatus('subjectStatus', data.message);
        cancelSubjectEdit();
        await loadSubjects();
        await loadClasses();
    }
    catch(error){
        setStatus('subjectStatus', error.message, true);
    }
}

function editSubject(id){
    const item = subjectItems.find(s => s.id === id);
    if(!item) return;
    editingSubjectId = id;
    document.getElementById('subjectCode').value = item.code;
    document.getElementById('subjectName').value = item.name;
    document.getElementById('subjectFormTitle').textContent = 'Chỉnh sửa môn học';
    document.getElementById('subjectSubmit').textContent = 'Lưu thay đổi';
    document.getElementById('subjectCancel').classList.remove('hidden');
}

function cancelSubjectEdit(){
    editingSubjectId = '';
    document.getElementById('subjectForm').reset();
    document.getElementById('subjectFormTitle').textContent = 'Danh mục môn học';
    document.getElementById('subjectSubmit').textContent = 'Thêm môn học';
    document.getElementById('subjectCancel').classList.add('hidden');
}

async function deleteSubject(id){
    if(!window.confirm('Xóa môn học này khỏi danh mục?')) return;
    try{
        const data = await api(`/api/subjects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setStatus('subjectStatus', data.message);
        await loadSubjects();
    }
    catch(error){
        setStatus('subjectStatus', error.message, true);
    }
}

function filterSubjects(){
    const q = (document.getElementById('subjectSearch')?.value || '').trim().toLowerCase();
    const filtered = !q
        ? subjectItems
        : subjectItems.filter(item =>
            (item.code || '').toLowerCase().includes(q) ||
            (item.name || '').toLowerCase().includes(q)
        );

    const rows = filtered.map(item => `
        <tr>
            <td data-label="Mã môn">${escapeHtml(item.code)}</td>
            <td data-label="Tên môn học">${escapeHtml(item.name)}</td>
            <td data-label="Số lớp">${item.classCount || 0}</td>
            <td data-label="Thao tác">
                <div class="actions">
                    <button class="small secondary" type="button" onclick="editSubject('${item.id}')">Sửa</button>
                    <button class="small danger" type="button" onclick="deleteSubject('${item.id}')">Xóa</button>
                </div>
            </td>
        </tr>
    `).join('');

    document.getElementById('subjectTable').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Mã môn</th>
                    <th>Tên môn học</th>
                    <th>Số lớp</th>
                    <th>Thao tác</th>
                </tr>
            </thead>
            <tbody>
                ${rows || '<tr><td colspan="4">Không tìm thấy môn học.</td></tr>'}
            </tbody>
        </table>
    `;
}

async function loadTeachers(){
    try{
        const data = await api('/api/teachers');
        teacherItems = data.teachers;
        setupSearchable(
            'classTeacherInput', 'classTeacher', 'classTeacherList',
            teacherItems,
            item => `${item.code} - ${item.name}`,
            item => item.id
        );
        filterTeachers();
    }
    catch(error){
        setStatus('teacherStatus', error.message, true);
    }
}

async function saveTeacher(event){
    event.preventDefault();
    try{
        const url = editingTeacherId
            ? `/api/teachers/${encodeURIComponent(editingTeacherId)}`
            : '/api/teachers';
        const data = await api(url, {
            method: editingTeacherId ? 'PUT' : 'POST',
            body: JSON.stringify({
                code: document.getElementById('teacherCode').value,
                name: document.getElementById('teacherName').value
            })
        });
        setStatus('teacherStatus', data.message);
        cancelTeacherEdit();
        await loadTeachers();
        await loadClasses();
    }
    catch(error){
        setStatus('teacherStatus', error.message, true);
    }
}

function editTeacher(id){
    const item = teacherItems.find(t => t.id === id);
    if(!item) return;
    editingTeacherId = id;
    document.getElementById('teacherCode').value = item.code;
    document.getElementById('teacherName').value = item.name;
    document.getElementById('teacherFormTitle').textContent = 'Chỉnh sửa giảng viên';
    document.getElementById('teacherSubmit').textContent = 'Lưu thay đổi';
    document.getElementById('teacherCancel').classList.remove('hidden');
}

function cancelTeacherEdit(){
    editingTeacherId = '';
    document.getElementById('teacherForm').reset();
    document.getElementById('teacherFormTitle').textContent = 'Danh sách giảng viên';
    document.getElementById('teacherSubmit').textContent = 'Thêm giảng viên';
    document.getElementById('teacherCancel').classList.add('hidden');
}

async function deleteTeacher(id){
    if(!window.confirm('Xóa giảng viên này khỏi danh sách?')) return;
    try{
        const data = await api(`/api/teachers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setStatus('teacherStatus', data.message);
        await loadTeachers();
    }
    catch(error){
        setStatus('teacherStatus', error.message, true);
    }
}

function filterTeachers(){
    const q = (document.getElementById('teacherSearch')?.value || '').trim().toLowerCase();
    const filtered = !q
        ? teacherItems
        : teacherItems.filter(item =>
            (item.code || '').toLowerCase().includes(q) ||
            (item.name || '').toLowerCase().includes(q)
        );

    const rows = filtered.map(item => `
        <tr>
            <td data-label="Mã GV">${escapeHtml(item.code)}</td>
            <td data-label="Tên giảng viên">${escapeHtml(item.name)}</td>
            <td data-label="Số lớp">${item.classCount || 0}</td>
            <td data-label="Thao tác">
                <div class="actions">
                    <button class="small secondary" type="button" onclick="editTeacher('${item.id}')">Sửa</button>
                    <button class="small danger" type="button" onclick="deleteTeacher('${item.id}')">Xóa</button>
                </div>
            </td>
        </tr>
    `).join('');

    document.getElementById('teacherListTable').innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Mã GV</th>
                    <th>Tên giảng viên</th>
                    <th>Số lớp</th>
                    <th>Thao tác</th>
                </tr>
            </thead>
            <tbody>
                ${rows || '<tr><td colspan="4">Không tìm thấy giảng viên.</td></tr>'}
            </tbody>
        </table>
    `;
}

function getClassPayload(){
    return {
        classCode: document.getElementById('classCode').value,
        teacherId: document.getElementById('classTeacher').value,
        subjectId: document.getElementById('classSubject').value,
        sessions: getSessionsFromForm()
    };
}

async function saveClass(event){
    event.preventDefault();
    try{
        const payload = getClassPayload();
        if(!payload.teacherId){
            setStatus('classStatus', 'Vui lòng chọn giảng viên từ danh sách', true);
            return;
        }
        if(!payload.subjectId){
            setStatus('classStatus', 'Vui lòng chọn môn học từ danh sách', true);
            return;
        }
        if(payload.sessions.length === 0){
            setStatus('classStatus', 'Vui lòng thêm ít nhất 1 buổi học', true);
            return;
        }

        const url = editingClassId
            ? `/api/classes/${encodeURIComponent(editingClassId)}`
            : '/api/classes';
        const data = await api(url, {
            method: editingClassId ? 'PUT' : 'POST',
            body: JSON.stringify(payload)
        });

        setStatus('classStatus', data.message);
        cancelClassEdit();
        await loadSubjects();
        await loadTeachers();
        await loadClasses();
    }
    catch(error){
        setStatus('classStatus', error.message, true);
    }
}

async function loadClasses(){
    try{
        const q = document.getElementById('classSearch')?.value?.trim() || '';
        const params = q ? `?q=${encodeURIComponent(q)}` : '';
        const data = await api(`/api/classes${params}`);
        classItems = data.classes || [];
        const canEdit = currentUser?.role === 'admin';

        const rows = classItems.map(item => {
            const sessionsHtml = (item.schedules || []).map(s =>
                `Thứ ${s.day}, tiết ${periodText(s.startPeriod, s.duration)}, ${escapeHtml(s.room)}`
            ).join('<br>');

            return `
                <tr>
                    <td data-label="Mã lớp">${escapeHtml(item.classCode || '')}</td>
                    <td data-label="Môn học">${escapeHtml(item.subject)}</td>
                    <td data-label="Giảng viên">${escapeHtml(item.teacherCode)} - ${escapeHtml(item.teacherName)}</td>
                    <td data-label="Buổi học" class="sessions-cell">${sessionsHtml || '—'}</td>
                    ${canEdit ? `
                        <td data-label="Cập nhật">
                            <button class="small secondary" type="button" onclick="editClass('${item.id}')">Cập nhật</button>
                        </td>
                        <td data-label="Xóa">
                            <button class="small danger" type="button" onclick="deleteClass('${item.id}')">Xóa</button>
                        </td>
                    ` : `
                        <td data-label="Thao tác">
                            <a class="button small" href="index.html?room=${encodeURIComponent((item.schedules[0] || {}).room || '')}">Tìm phòng</a>
                        </td>
                    `}
                </tr>
            `;
        }).join('');

        const actionHeader = canEdit
            ? '<th>Cập nhật</th><th>Xóa</th>'
            : '<th>Thao tác</th>';
        const colspan = canEdit ? 6 : 5;

        document.getElementById('classTable').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Mã lớp</th>
                        <th>Môn học</th>
                        <th>Giảng viên</th>
                        <th>Buổi học</th>
                        ${actionHeader}
                    </tr>
                </thead>
                <tbody>
                    ${rows || `<tr><td colspan="${colspan}">Chưa có dữ liệu phù hợp.</td></tr>`}
                </tbody>
            </table>
        `;
    }
    catch(error){
        setStatus('classStatus', error.message, true);
    }
}

function editClass(id){
    const item = classItems.find(c => c.id === id);
    if(!item) return;

    editingClassId = id;
    document.getElementById('classCode').value = item.classCode || '';
    setSearchableValue(
        'classTeacherInput', 'classTeacher', teacherItems,
        item.teacherId,
        t => `${t.code} - ${t.name}`,
        t => t.id
    );
    setSearchableValue(
        'classSubjectInput', 'classSubject', subjectItems,
        item.subjectId,
        s => `${s.code} - ${s.name}`,
        s => s.id
    );

    clearSessions();
    (item.schedules || []).forEach(s => addSessionRow(s));
    if((item.schedules || []).length === 0) addSessionRow();

    document.getElementById('classFormTitle').textContent = 'Chỉnh sửa lớp học';
    document.getElementById('classSubmit').textContent = 'Lưu thay đổi';
    document.getElementById('classCancel').classList.remove('hidden');
    document.getElementById('classAdminPanel').scrollIntoView({ behavior: 'smooth' });
}

function cancelClassEdit(){
    editingClassId = '';
    document.getElementById('classForm').reset();
    document.getElementById('classTeacher').value = '';
    document.getElementById('classSubject').value = '';
    clearSessions();
    addSessionRow();
    document.getElementById('classFormTitle').textContent = 'Thêm lớp học';
    document.getElementById('classSubmit').textContent = 'Thêm lớp học';
    document.getElementById('classCancel').classList.add('hidden');
}

async function deleteClass(id){
    if(!window.confirm('Xóa lớp học này? Sinh viên đã chọn lớp cũng sẽ bị gỡ khỏi TKB.')) return;
    try{
        const data = await api(`/api/classes/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setStatus('classStatus', data.message);
        await loadSubjects();
        await loadTeachers();
        await loadClasses();
    }
    catch(error){
        setStatus('classStatus', error.message, true);
    }
}

window.ctuReady.then(async () => {
    if(currentUser?.role === 'admin'){
        document.getElementById('teacherTabs').classList.remove('hidden');
        showTeacherTab('subjects');
    }
    else{
        document.getElementById('classListPanel').classList.remove('hidden');
    }

    document.getElementById('classSearch')?.addEventListener('input', () => loadClasses());
    document.getElementById('subjectSearch')?.addEventListener('input', filterSubjects);
    document.getElementById('teacherSearch')?.addEventListener('input', filterTeachers);

    await loadSubjects();
    await loadTeachers();
    await loadClasses();
    addSessionRow();
});
