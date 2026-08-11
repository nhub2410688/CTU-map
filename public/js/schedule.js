let scheduleItems = [];
let availableClasses = [];
let subjectItems = [];
let editingScheduleId = '';

function periodText(item){
    const end = Number(item.period) + Number(item.duration) - 1;
    return `${item.period}-${end}`;
}

/** Load danh sách môn học để làm gợi ý lọc */
async function loadSubjects(){
    try{
        const data = await api('/api/subjects');
        subjectItems = data.subjects || [];

        const datalist = document.getElementById('subjectList');
        if(datalist){
            datalist.innerHTML = subjectItems.map(item => `
                <option value="${escapeHtml(item.code)} - ${escapeHtml(item.name)}">
            `).join('');
        }
    }
    catch(error){
        console.warn('Không tải được danh sách môn học:', error.message);
    }
}

/** Lọc và render lại dropdown lớp học theo môn đã chọn */
function renderFilteredClasses(){
    const select = document.getElementById('teacherScheduleId');
    const filterValue = (document.getElementById('subjectFilter')?.value || '').trim().toLowerCase();
    const selectedValue = select.value;

    let filtered = availableClasses;

    if(filterValue){
        filtered = availableClasses.filter(item => {
            const subject = (item.subject || '').toLowerCase();
            const code = (item.subjectCode || '').toLowerCase();
            const full = `${code} - ${subject}`.toLowerCase();
            return subject.includes(filterValue)
                || code.includes(filterValue)
                || full.includes(filterValue);
        });
    }

    select.innerHTML = `
        <option value="">${filtered.length ? 'Chọn lịch giảng viên' : 'Không có lớp phù hợp'}</option>
        ${filtered.map(item => {
            const end = periodText(item);
            return `
                <option value="${item.id}">
                    ${escapeHtml(item.subjectCode || '')} - ${escapeHtml(item.subject)} 
                    · ${escapeHtml(item.teacherName)} 
                    · Thứ ${item.day}, tiết ${end} 
                    · ${escapeHtml(item.room)}
                </option>
            `;
        }).join('')}
    `;

    // Giữ lại giá trị đã chọn nếu vẫn còn trong danh sách lọc
    if(filtered.some(item => item.id === selectedValue)){
        select.value = selectedValue;
    }
}

async function loadAvailableClasses(){
    try{
        const data = await api('/api/teacher-schedule');
        availableClasses = data.schedules || [];
        renderFilteredClasses();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

async function saveSchedule(event){
    event.preventDefault();
    try{
        const url = editingScheduleId
            ? `/api/schedule/${encodeURIComponent(editingScheduleId)}`
            : '/api/schedule';
        const data = await api(url, {
            method: editingScheduleId ? 'PUT' : 'POST',
            body: JSON.stringify({
                teacherScheduleId: document.getElementById('teacherScheduleId').value
            })
        });

        setStatus('scheduleStatus', data.message);
        cancelScheduleEdit();
        await loadSchedule();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

async function loadSchedule(){
    try{
        // Đảm bảo đã có danh sách lớp (để lấy classCode)
        if(!availableClasses.length){
            await loadAvailableClasses();
        }

        const data = await api('/api/schedule');

        // Gắn classCode từ availableClasses nếu API chưa trả về
        scheduleItems = (data.schedule || []).map(item => {
            if(item.classCode){
                return item;
            }

            const matched = availableClasses.find(
                cls => cls.id === item.teacherScheduleId
            );

            return {
                ...item,
                classCode: matched?.classCode || ''
            };
        });

        const rows = scheduleItems.map(item => {
            const endPeriod = Number(item.startPeriod) + Number(item.duration) - 1;
            return `
                <tr>
                    <td data-label="Mã lớp">${escapeHtml(item.classCode || '')}</td>
                    <td data-label="Môn học">${escapeHtml(item.subject)}</td>
                    <td data-label="Thứ">Thứ ${item.day}</td>
                    <td data-label="Tiết">${item.startPeriod}-${endPeriod}</td>
                    <td data-label="Phòng">${escapeHtml(item.room)}</td>
                    <td data-label="Giảng viên">${escapeHtml(item.teacher)}</td>
                    <td data-label="Thao tác">
                        <div class="actions">
                            <a class="button small" href="index.html?room=${encodeURIComponent(item.room)}">Tìm phòng</a>
                            <button class="small secondary" type="button" onclick="editSchedule('${item.id}')">
                                ${item.linked ? 'Đổi lớp' : 'Chọn lại'}
                            </button>
                            <button class="small danger" type="button" onclick="deleteSchedule('${item.id}')">Xóa</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('scheduleTable').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Mã lớp</th>
                        <th>Môn học</th>
                        <th>Thứ</th>
                        <th>Tiết</th>
                        <th>Phòng</th>
                        <th>Giảng viên</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="7">Chưa có dữ liệu.</td></tr>'}
                </tbody>
            </table>
        `;
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

function editSchedule(id){
    const item = scheduleItems.find(entry => entry.id === id);
    if(!item){
        return;
    }

    editingScheduleId = id;

    // Nếu có subject thì tự điền vào ô lọc để dễ tìm
    const subjectFilter = document.getElementById('subjectFilter');
    if(subjectFilter && item.subject){
        subjectFilter.value = item.subject;
        renderFilteredClasses();
    }

    document.getElementById('teacherScheduleId').value =
        item.teacherScheduleId || '';
    document.getElementById('scheduleFormTitle').textContent =
        item.linked ? 'Đổi sang lớp học khác' : 'Liên kết lại dữ liệu cũ';
    document.getElementById('scheduleSubmit').textContent = 'Lưu thay đổi';
    document.getElementById('scheduleCancel').classList.remove('hidden');
    document.getElementById('scheduleForm').scrollIntoView({behavior:'smooth'});
}

function cancelScheduleEdit(){
    editingScheduleId = '';
    document.getElementById('scheduleForm').reset();
    document.getElementById('subjectFilter').value = '';
    renderFilteredClasses();
    document.getElementById('scheduleFormTitle').textContent =
        'Thêm lớp học từ lịch giảng viên';
    document.getElementById('scheduleSubmit').textContent = 'Thêm vào TKB';
    document.getElementById('scheduleCancel').classList.add('hidden');
}

async function deleteSchedule(id){
    if(!window.confirm('Xóa lớp học này khỏi thời khóa biểu?')){
        return;
    }

    try{
        const data = await api(`/api/schedule/${encodeURIComponent(id)}`, {
            method:'DELETE'
        });
        setStatus('scheduleStatus', data.message);
        await loadSchedule();
    }
    catch(error){
        setStatus('scheduleStatus', error.message, true);
    }
}

async function routeSchedule(){
    try{
        const day = document.getElementById('routeDay').value;
        const start = document.getElementById('routeStart').value || 'cổng a';
        const data = await api(
            `/api/schedule/routes?day=${encodeURIComponent(day)}&start=${encodeURIComponent(start)}`
        );

        if(data.message){
            document.getElementById('scheduleRouteResult').textContent = data.message;
            return;
        }

        document.getElementById('scheduleRouteResult').innerHTML = data.legs
            .map((leg, index) => `
                <h3>Chặng ${index + 1}: ${escapeHtml(leg.subject)} - ${escapeHtml(leg.room)}</h3>
                <p>Khoảng cách: ${escapeHtml(leg.distance)} m</p>
                <ol>${leg.instructions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>
                <a class="button small" href="index.html?start=${encodeURIComponent(index === 0 ? start : data.legs[index - 1].room)}&end=${encodeURIComponent(leg.room)}">Xem trên bản đồ</a>
            `)
            .join('');
    }
    catch(error){
        document.getElementById('scheduleRouteResult').innerHTML =
            `<span class="error">${escapeHtml(error.message)}</span>`;
    }
}

window.ctuReady.then(async () => {
    if(requireRole('student')){
        // Lắng nghe khi người dùng gõ / chọn môn học
        const subjectFilter = document.getElementById('subjectFilter');
        if(subjectFilter){
            subjectFilter.addEventListener('input', renderFilteredClasses);
            subjectFilter.addEventListener('change', renderFilteredClasses);
        }

        await loadSubjects();
        await loadAvailableClasses();
        await loadSchedule();
    }
});