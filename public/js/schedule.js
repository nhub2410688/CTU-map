let scheduleItems = [];
let availableClasses = [];

function periodText(start, duration){
    const end = Number(start) + Number(duration) - 1;
    return `${start}-${end}`;
}

function formatSessions(schedules){
    if(!schedules || !schedules.length) return '—';
    return schedules.map(s =>
        `Thứ ${s.day}, tiết ${periodText(s.startPeriod, s.duration)}, ${escapeHtml(s.room)}`
    ).join('<br>');
}

async function loadAvailableClasses(){
    try{
        const data = await api('/api/classes');
        availableClasses = data.classes || [];
        setupClassFilter();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

function setupClassFilter(){
    const input = document.getElementById('classFilter');
    const hidden = document.getElementById('classSectionId');
    const list = document.getElementById('classFilterList');
    if(!input || !hidden || !list) return;

    function render(filter = ''){
        const q = filter.trim().toLowerCase();
        let filtered = availableClasses;
        if(q){
            filtered = availableClasses.filter(c => {
                const text = `${c.classCode} ${c.subject} ${c.subjectCode} ${c.teacherName} ${c.teacherCode}`.toLowerCase();
                return text.includes(q);
            });
        }

        list.innerHTML = filtered.slice(0, 40).map(c => {
            const sessions = (c.schedules || []).map(s =>
                `T${s.day} tiết ${periodText(s.startPeriod, s.duration)}`
            ).join(', ');
            return `<div data-value="${c.id}">
                <strong>${escapeHtml(c.classCode)}</strong> — ${escapeHtml(c.subject)}
                · ${escapeHtml(c.teacherName)}
                <br><small>${escapeHtml(sessions)}</small>
            </div>`;
        }).join('');
        list.classList.toggle('show', filtered.length > 0 && document.activeElement === input);
    }

    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('input', () => {
        hidden.value = '';
        render(input.value);
    });
    input.addEventListener('blur', () => setTimeout(() => list.classList.remove('show'), 150));

    list.addEventListener('mousedown', (e) => {
        const div = e.target.closest('div[data-value]');
        if(!div) return;
        hidden.value = div.dataset.value;
        const cls = availableClasses.find(c => c.id === div.dataset.value);
        input.value = cls ? `${cls.classCode} — ${cls.subject}` : div.textContent.trim();
        list.classList.remove('show');
    });
}

async function saveSchedule(event){
    event.preventDefault();
    const classSectionId = document.getElementById('classSectionId').value;
    if(!classSectionId){
        setStatus('scheduleStatus', 'Vui lòng chọn lớp học từ danh sách', true);
        return;
    }

    try{
        const data = await api('/api/schedule', {
            method: 'POST',
            body: JSON.stringify({ classSectionId })
        });
        setStatus('scheduleStatus', data.message);
        document.getElementById('classFilter').value = '';
        document.getElementById('classSectionId').value = '';
        await loadSchedule();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

async function loadSchedule(){
    try{
        const data = await api('/api/schedule');
        scheduleItems = data.schedule || [];

        const rows = scheduleItems.map(item => `
            <tr>
                <td data-label="Mã lớp">${escapeHtml(item.classCode || '')}</td>
                <td data-label="Môn học">${escapeHtml(item.subject)}</td>
                <td data-label="Giảng viên">${escapeHtml(item.teacher)}</td>
                <td data-label="Buổi học" class="sessions-cell">${formatSessions(item.schedules)}</td>
                <td data-label="Thao tác">
                    <div class="actions">
                        <button class="small danger" type="button" onclick="deleteSchedule('${item.id}')">Xóa</button>
                    </div>
                </td>
            </tr>
        `).join('');

        document.getElementById('scheduleTable').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Mã lớp</th>
                        <th>Môn học</th>
                        <th>Giảng viên</th>
                        <th>Buổi học</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="5">Chưa có dữ liệu.</td></tr>'}
                </tbody>
            </table>
        `;
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

function cancelScheduleEdit(){
    document.getElementById('classFilter').value = '';
    document.getElementById('classSectionId').value = '';
    document.getElementById('scheduleCancel').classList.add('hidden');
}

async function deleteSchedule(id){
    if(!window.confirm('Xóa lớp học này khỏi thời khóa biểu?')) return;
    try{
        const data = await api(`/api/schedule/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setStatus('scheduleStatus', data.message);
        await loadSchedule();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

window.ctuReady.then(async () => {
    if(requireRole('student')){
        await loadAvailableClasses();
        await loadSchedule();
    }
});
