let classItems = [];
let subjectItems = [];
let teacherItems = [];
let editingClassId = '';
let editingSubjectId = '';
let editingTeacherId = '';

function periodText(item){
    const endPeriod = Number(item.period) + Number(item.duration) - 1;
    return `${item.period}-${endPeriod}`;
}

function showTeacherTab(tabName){
    document.querySelectorAll('[data-teacher-tab]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.teacherTab !== tabName);
    });

    document.querySelectorAll('#teacherTabs button').forEach(button => {
        button.classList.toggle('active', button.dataset.tab === tabName);
    });
}

function renderSubjectOptions(){
    const select = document.getElementById('classSubject');
    const selectedValue = select.value;

    select.innerHTML = `
        <option value="">Chọn môn học</option>
        ${subjectItems.map(item => `
            <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
        `).join('')}
    `;

    if(subjectItems.some(item => item.id === selectedValue)){
        select.value = selectedValue;
    }
}

function renderTeacherOptions(){
    const select = document.getElementById('classTeacher');
    const selectedValue = select.value;

    select.innerHTML = `
        <option value="">Chọn giảng viên</option>
        ${teacherItems.map(item => `
            <option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)}</option>
        `).join('')}
    `;

    if(teacherItems.some(item => item.id === selectedValue)){
        select.value = selectedValue;
    }
}

async function loadSubjects(){
    try{
        const data = await api('/api/subjects');
        subjectItems = data.subjects;
        renderSubjectOptions();
        filterSubjects();   // render bảng ở đây
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
            method:editingSubjectId ? 'PUT' : 'POST',
            body:JSON.stringify({
                code:document.getElementById('subjectCode').value,
                name:document.getElementById('subjectName').value
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
    const item = subjectItems.find(subject => subject.id === id);
    if(!item){
        return;
    }

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
    if(!window.confirm('Xóa môn học này khỏi danh mục?')){
        return;
    }

    try{
        const data = await api(`/api/subjects/${encodeURIComponent(id)}`, {
            method:'DELETE'
        });
        setStatus('subjectStatus', data.message);
        await loadSubjects();
    }
    catch(error){
        setStatus('subjectStatus', error.message, true);
    }
}

async function loadTeachers(){
    try{
        const data = await api('/api/teachers');
        teacherItems = data.teachers;
        renderTeacherOptions();
        filterTeachers();   // render bảng ở đây
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
            method:editingTeacherId ? 'PUT' : 'POST',
            body:JSON.stringify({
                code:document.getElementById('teacherCode').value,
                name:document.getElementById('teacherName').value
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
    const item = teacherItems.find(teacher => teacher.id === id);
    if(!item){
        return;
    }

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
    if(!window.confirm('Xóa giảng viên này khỏi danh sách?')){
        return;
    }

    try{
        const data = await api(`/api/teachers/${encodeURIComponent(id)}`, {
            method:'DELETE'
        });
        setStatus('teacherStatus', data.message);
        await loadTeachers();
    }
    catch(error){
        setStatus('teacherStatus', error.message, true);
    }
}

function getClassPayload(){
    return {
        teacherId:document.getElementById('classTeacher').value,
        subjectId:document.getElementById('classSubject').value,
        day:document.getElementById('classDay').value,
        period:document.getElementById('classPeriod').value,
        duration:document.getElementById('classDuration').value,
        room:document.getElementById('classRoom').value
    };
}

async function saveClass(event){
    event.preventDefault();
    try{
        const url = editingClassId
            ? `/api/teacher-schedule/${encodeURIComponent(editingClassId)}`
            : '/api/teacher-schedule';
        const data = await api(url, {
            method:editingClassId ? 'PUT' : 'POST',
            body:JSON.stringify(getClassPayload())
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

function buildClassQuery(){
    const params = new URLSearchParams();
    const q = document.getElementById('classSearch')?.value?.trim() || '';
    
    if(q){
        params.set('q', q);
    }
    return params.toString();
}

async function loadClasses(){
    try{
        const query = buildClassQuery();
        const data = await api(`/api/teacher-schedule${query ? `?${query}` : ''}`);
        classItems = data.schedules;
        const canEdit = currentUser?.role === 'admin';

        const rows = classItems.map(item => `
            <tr>
                <td data-label="Mã lớp">${escapeHtml(item.classCode || '')}</td>
                <td data-label="Môn học">${escapeHtml(item.subject)}</td>
                <td data-label="Mã GV">${escapeHtml(item.teacherCode)}</td>
                <td data-label="Tên GV">${escapeHtml(item.teacherName)}</td>
                <td data-label="Thứ">Thứ ${item.day}</td>
                <td data-label="Tiết">${periodText(item)}</td>
                <td data-label="Phòng">${escapeHtml(item.room)}</td>
                ${canEdit ? `
                    <td data-label="Tìm phòng">
                        <a class="button small" href="index.html?room=${encodeURIComponent(item.room)}">Tìm phòng</a>
                    </td>
                    <td data-label="Cập nhật">
                        <button class="small secondary" type="button" onclick="editClass('${item.id}')">Cập nhật</button>
                    </td>
                    <td data-label="Xóa">
                        <button class="small danger" type="button" onclick="deleteClass('${item.id}')">Xóa</button>
                    </td>
                ` : `
                    <td data-label="Thao tác">
                        <a class="button small" href="index.html?room=${encodeURIComponent(item.room)}">Tìm phòng</a>
                    </td>
                `}
            </tr>
        `).join('');

        const actionHeader = canEdit
            ? '<th>Tìm phòng</th><th>Cập nhật</th><th>Xóa</th>'
            : '<th>Thao tác</th>';

        const colspan = canEdit ? 10 : 8;

        document.getElementById('classTable').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Mã lớp</th>
                        <th>Môn học</th>
                        <th>Mã GV</th>
                        <th>Tên GV</th>
                        <th>Thứ</th>
                        <th>Tiết</th>
                        <th>Phòng</th>
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
    const item = classItems.find(entry => entry.id === id);
    if(!item){
        return;
    }

    editingClassId = id;
    document.getElementById('classTeacher').value = item.teacherId || '';
    document.getElementById('classSubject').value = item.subjectId;
    document.getElementById('classDay').value = item.day;
    document.getElementById('classPeriod').value = item.period;
    document.getElementById('classDuration').value = item.duration;
    document.getElementById('classRoom').value = item.room;
    document.getElementById('classFormTitle').textContent = 'Chỉnh sửa lớp học';
    document.getElementById('classSubmit').textContent = 'Lưu thay đổi';
    document.getElementById('classCancel').classList.remove('hidden');
    document.getElementById('classAdminPanel').scrollIntoView({behavior:'smooth'});
}

function cancelClassEdit(){
    editingClassId = '';
    document.getElementById('classForm').reset();
    document.getElementById('classPeriod').value = 1;
    document.getElementById('classDuration').value = 1;
    document.getElementById('classFormTitle').textContent = 'Thêm lớp học';
    document.getElementById('classSubmit').textContent = 'Thêm lớp học';
    document.getElementById('classCancel').classList.add('hidden');
}

async function deleteClass(id){
    if(!window.confirm('Xóa lớp học này? Sinh viên đã chọn lớp cũng sẽ bị gỡ khỏi TKB.')){
        return;
    }

    try{
        const data = await api(`/api/teacher-schedule/${encodeURIComponent(id)}`, {
            method:'DELETE'
        });
        setStatus('classStatus', data.message);
        await loadSubjects();
        await loadTeachers();
        await loadClasses();
    }
    catch(error){
        setStatus('classStatus', error.message, true);
    }
}

function clearClassFilters(){
    for(const id of ['classSearch', 'buildingFilter', 'dayFilter', 'sessionFilter']){
        const element = document.getElementById(id);
        if(element){
            element.value = '';
        }
    }
    loadClasses();
}

/** Lọc danh sách môn học */
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

/** Lọc danh sách giảng viên */
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

async function loadBuildings(){
    try{
        const data = await api('/api/buildings');
        const select = document.getElementById('buildingFilter');
        if(!select){
            return;
        }
        select.innerHTML = `
            <option value="">Tất cả tòa nhà</option>
            ${data.buildings.map(item => `
                <option value="${item.code}">${escapeHtml(item.name)}</option>
            `).join('')}
        `;
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

    // Lọc lớp học khi gõ
    document.getElementById('classSearch')?.addEventListener('input', () => {
        loadClasses();
    });

    // Lọc môn học & giảng viên (nếu chưa có)
    document.getElementById('subjectSearch')?.addEventListener('input', filterSubjects);
    document.getElementById('teacherSearch')?.addEventListener('input', filterTeachers);

    await loadBuildings();
    await loadSubjects();
    await loadTeachers();
    await loadClasses();
});
