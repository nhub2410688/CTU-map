let authToken = localStorage.getItem('ctuMapToken') || '';
let currentUser = JSON.parse(localStorage.getItem('ctuMapUser') || 'null');

function escapeHtml(value){
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setStatus(id, message, isError=false){
    const element = document.getElementById(id);
    if(!element){
        return;
    }
    element.textContent = message || '';
    element.className = isError ? 'status error' : 'status';
}

async function api(url, options={}){
    const headers = {...(options.headers || {})};

    if(authToken){
        headers.Authorization = `Bearer ${authToken}`;
    }
    if(options.body && !(options.body instanceof FormData) && !headers['Content-Type']){
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {...options, headers});
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : {};

    if(!response.ok){
        const fallback = response.status === 404
            ? 'Không tìm thấy API. Hãy khởi động lại server nếu vừa cập nhật code.'
            : 'Có lỗi xảy ra';
        throw new Error(data.error || fallback);
    }
    return data;
}

function getPageName(){
    const file = location.pathname.split('/').pop() || 'index.html';
    return file || 'index.html';
}

function renderShell(){
    const page = getPageName();
    const role = currentUser?.role;
    const userLabel = currentUser
        ? `${role === 'admin' ? 'Quản trị' : 'Sinh viên'}: ${currentUser.userId}`
        : 'Chưa đăng nhập';

    document.getElementById('siteHeader').innerHTML = `
        <div class="site-banner">
            <img id="bannerImage" src="img/header1.png" alt="Đại học Cần Thơ">
        </div>
        <nav class="site-nav">
            <button class="nav-toggle" type="button" aria-label="Mở menu" aria-expanded="false" onclick="toggleMainNav(this)">☰</button>
            <a class="brand" href="index.html">
                <img src="img/logo.png" alt="Logo Đại học Cần Thơ">
                <span>CTU MAP</span>
            </a>
            <div class="nav-links">
                <a class="${page === 'index.html' ? 'active' : ''}" href="index.html">Bản đồ</a>
                ${role === 'student' ? `<a class="${page === 'schedule.html' ? 'active' : ''}" href="schedule.html">Thời khóa biểu</a>` : ''}
                ${role === 'student' ? `<a class="${page === 'documents.html' ? 'active' : ''}" href="documents.html">Tài liệu học tập</a>` : ''}
                ${role === 'admin' ? `<a class="${page === 'teachers.html' ? 'active' : ''}" href="teachers.html">Quản lý lớp học</a>` : ''}
                ${role === 'admin' ? `<a class="${page === 'admin-documents.html' ? 'active' : ''}" href="admin-documents.html">Quản lý tài liệu</a>` : ''}
                ${!currentUser ? `<a class="${page === 'login.html' ? 'active' : ''}" href="login.html">Đăng nhập / Đăng ký</a>` : ''}
            </div>
            <div class="account-area">
                <button class="search-toggle" type="button" aria-label="Tìm kiếm lớp học" title="Tìm kiếm lớp học" onclick="openGlobalSearch()"></button>
                <span>${escapeHtml(userLabel)}</span>
                ${currentUser ? '<button class="small danger" type="button" onclick="logout()">Đăng xuất</button>' : ''}
            </div>
        </nav>
        <div id="globalSearchPanel" class="global-search hidden" role="dialog" aria-modal="true" aria-labelledby="globalSearchTitle">
            <div class="global-search-box">
                <div class="global-search-head">
                    <h2 id="globalSearchTitle">Tìm kiếm lớp học</h2>
                    <button class="icon secondary" type="button" aria-label="Đóng tìm kiếm" onclick="closeGlobalSearch()">×</button>
                </div>
                <div class="form-grid">
                    <div class="field">
                        <label for="globalSearchInput">Từ khóa</label>
                        <input id="globalSearchInput" placeholder="Môn học, giảng viên, lớp học, phòng...">
                    </div>
                    <div class="field">
                        <label for="globalBuildingFilter">Tòa nhà</label>
                        <select id="globalBuildingFilter">
                            <option value="">Tất cả tòa nhà</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="globalDayFilter">Thứ</label>
                        <select id="globalDayFilter">
                            <option value="">Tất cả các ngày</option>
                            <option value="2">Thứ 2</option>
                            <option value="3">Thứ 3</option>
                            <option value="4">Thứ 4</option>
                            <option value="5">Thứ 5</option>
                            <option value="6">Thứ 6</option>
                            <option value="7">Thứ 7</option>
                        </select>
                    </div>
                    <div class="field">
                        <label for="globalSessionFilter">Buổi</label>
                        <select id="globalSessionFilter">
                            <option value="">Cả ngày</option>
                            <option value="morning">Buổi sáng</option>
                            <option value="afternoon">Buổi chiều</option>
                        </select>
                    </div>
                </div>
                <div class="actions">
                    <button type="button" onclick="runGlobalSearch()">Tìm kiếm</button>
                    <button class="secondary" type="button" onclick="clearGlobalSearch()">Xóa lọc</button>
                </div>
                <div id="globalSearchStatus" class="status"></div>
                <div id="globalSearchResults" class="table-wrap"></div>
            </div>
        </div>
    `;

    document.getElementById('siteFooter').innerHTML = `
        <footer class="site-footer">
            <a href="#top" aria-label="Về đầu trang">
                <img class="footer-art" src="img/fooder.png" alt="60 năm Đại học Cần Thơ">
            </a>
            <div class="footer-info">
                <p><strong>Đại học Cần Thơ</strong></p>
                <p>Khu II, đường 3/2, phường Ninh Kiều, thành phố Cần Thơ</p>
                <p>Điện thoại: +84 292 3832 663 · Email: dhct@ctu.edu.vn</p>
                <div class="social-links">
                    <a href="#top" title="Facebook">FB</a>
                    <a href="#top" title="Instagram">IG</a>
                    <a href="#top" title="YouTube">YT</a>
                    <a href="#top" title="TikTok">TT</a>
                </div>
            </div>
        </footer>
    `;

    let bannerIndex = 0;
    const banner = document.getElementById('bannerImage');
    const bannerImages = ['img/header1.png', 'img/header2.png'];
    window.setInterval(() => {
        bannerIndex = (bannerIndex + 1) % bannerImages.length;
        banner.style.opacity = '0';
        window.setTimeout(() => {
            banner.src = bannerImages[bannerIndex];
            banner.style.opacity = '1';
        }, 180);
    }, 4500);
}

function toggleMainNav(button){
    const nav = button.closest('.site-nav');
    const expanded = nav.classList.toggle('nav-open');
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function closeMainNav(){
    const nav = document.querySelector('.site-nav');
    const button = document.querySelector('.nav-toggle');
    if(nav){
        nav.classList.remove('nav-open');
    }
    if(button){
        button.setAttribute('aria-expanded', 'false');
    }
}

let globalSearchBuildingsLoaded = false;
let globalSearchItems = [];

function periodRangeText(item){
    const end = Number(item.period) + Number(item.duration) - 1;
    return `${item.period}-${end}`;
}

async function loadGlobalSearchBuildings(){
    if(globalSearchBuildingsLoaded){
        return;
    }

    const select = document.getElementById('globalBuildingFilter');
    if(!select){
        return;
    }

    try{
        const data = await api('/api/buildings');
        select.innerHTML = `
            <option value="">Tất cả tòa nhà</option>
            ${data.buildings.map(item => `
                <option value="${item.code}">${escapeHtml(item.name)}</option>
            `).join('')}
        `;
        globalSearchBuildingsLoaded = true;
    }
    catch(error){
        setStatus('globalSearchStatus', error.message, true);
    }
}

function buildGlobalSearchQuery(){
    const params = new URLSearchParams();
    const q = document.getElementById('globalSearchInput').value;
    const building = document.getElementById('globalBuildingFilter').value;
    const day = document.getElementById('globalDayFilter').value;
    const session = document.getElementById('globalSessionFilter').value;

    if(q){
        params.set('q', q);
    }
    if(building){
        params.set('building', building);
    }
    if(day){
        params.set('day', day);
    }
    if(session){
        params.set('session', session);
    }

    return params.toString();
}

async function runGlobalSearch(){
    try{
        const query = buildGlobalSearchQuery();
        const data = await api(`/api/teacher-schedule${query ? `?${query}` : ''}`);
        globalSearchItems = data.schedules;
        const rows = globalSearchItems.map(item => `
            <tr>
                <td data-label="Mã lớp">${escapeHtml(item.classCode || '')}</td>
                <td data-label="Môn học">${escapeHtml(item.subject)}</td>
                <td data-label="Giảng viên">${escapeHtml(item.teacherCode)} - ${escapeHtml(item.teacherName)}</td>
                <td data-label="Thứ">Thứ ${item.day}</td>
                <td data-label="Tiết">${periodRangeText(item)}</td>
                <td data-label="Phòng">${escapeHtml(item.room)}</td>
                <td data-label="Tìm phòng">
                    <a class="button small" href="index.html?room=${encodeURIComponent(item.room)}">Tìm phòng</a>
                </td>
            </tr>
        `).join('');

        document.getElementById('globalSearchResults').innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Mã lớp</th>
                        <th>Môn học</th>
                        <th>Giảng viên</th>
                        <th>Thứ</th>
                        <th>Tiết</th>
                        <th>Phòng</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || '<tr><td colspan="7">Chưa có lớp học phù hợp.</td></tr>'}
                </tbody>
            </table>
        `;
        enhanceResponsiveTables(document.getElementById('globalSearchResults'));
        setStatus('globalSearchStatus', '');
    }
    catch(error){
        setStatus('globalSearchStatus', error.message, true);
    }
}

async function openGlobalSearch(){
    closeMainNav();
    const panel = document.getElementById('globalSearchPanel');
    panel.classList.remove('hidden');
    await loadGlobalSearchBuildings();
    document.getElementById('globalSearchInput').focus();
    if(!globalSearchItems.length){
        await runGlobalSearch();
    }
}

function closeGlobalSearch(){
    document.getElementById('globalSearchPanel').classList.add('hidden');
}

function clearGlobalSearch(){
    document.getElementById('globalSearchInput').value = '';
    document.getElementById('globalBuildingFilter').value = '';
    document.getElementById('globalDayFilter').value = '';
    document.getElementById('globalSessionFilter').value = '';
    runGlobalSearch();
}

function enhanceResponsiveTables(root=document){
    root.querySelectorAll('table').forEach(table => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        if(!headers.length){
            return;
        }

        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.children).forEach((cell, index) => {
                if(!cell.hasAttribute('data-label') && headers[index]){
                    cell.setAttribute('data-label', headers[index]);
                }
            });
        });
    });
}

function watchResponsiveTables(){
    enhanceResponsiveTables();

    const observer = new MutationObserver(records => {
        records.forEach(record => {
            record.addedNodes.forEach(node => {
                if(node.nodeType !== Node.ELEMENT_NODE){
                    return;
                }
                if(node.matches('table')){
                    enhanceResponsiveTables(node.parentElement || document);
                }
                else if(node.querySelector('table')){
                    enhanceResponsiveTables(node);
                }
            });
        });
    });

    observer.observe(document.body, {childList:true, subtree:true});
}

function showMapTab(tabName) {
    // Ẩn tất cả panel
    document.querySelectorAll('[data-map-tab]').forEach(panel => {
        panel.classList.add('hidden');
    });

    // Hiện panel được chọn
    const activePanel = document.querySelector(`[data-map-tab="${tabName}"]`);
    if (activePanel) {
        activePanel.classList.remove('hidden');
    }

    // Đổi trạng thái active của nút tab
    document.querySelectorAll('#mapTabs button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
}


async function refreshSession(){
    if(!authToken){
        return;
    }

    try{
        const data = await api('/api/me');
        currentUser = {userId:data.userId, role:data.role};
        localStorage.setItem('ctuMapUser', JSON.stringify(currentUser));
    }
    catch{
        authToken = '';
        currentUser = null;
        localStorage.removeItem('ctuMapToken');
        localStorage.removeItem('ctuMapUser');
    }
}

async function logout(){
    try{
        if(authToken){
            await api('/api/logout', {method:'POST'});
        }
    }
    catch{
        // Local logout still works if the server session has expired.
    }

    authToken = '';
    currentUser = null;
    localStorage.removeItem('ctuMapToken');
    localStorage.removeItem('ctuMapUser');
    location.href = 'login.html';
}

function requireRole(role){
    if(!currentUser || currentUser.role !== role){
        location.href = 'login.html';
        return false;
    }
    return true;
}

async function initializePage(){
    await refreshSession();
    renderShell();
    watchResponsiveTables();
    document.addEventListener('keydown', event => {
        if(event.key === 'Escape'){
            closeGlobalSearch();
            closeMainNav();
        }
    });
}

function showDocumentTab(tabName) {
    // Ẩn tất cả panel
    document.querySelectorAll('[data-document-tab]').forEach(panel => {
        panel.classList.add('hidden');
    });

    // Hiện panel được chọn
    const activePanel = document.querySelector(`[data-document-tab="${tabName}"]`);
    if (activePanel) {
        activePanel.classList.remove('hidden');
    }

    // Đổi trạng thái active của nút
    document.querySelectorAll('#documentTabs button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
}

window.ctuReady = initializePage();
