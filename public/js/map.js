let coordinateMode = false;
let nodePosition = {};
let mapGraph = {};
let debugGraphVisible = false;
let mapScale = 1;
let mapX = 0;
let mapY = 0;
let isDragging = false;
let didDrag = false;
let dragStart = {x:0, y:0};
let routeRenderId = 0;

const mapViewport = document.getElementById('map-viewport');
const mapContent = document.getElementById('map-content');
const mapImage = document.getElementById('map');

async function loadNodes(){
    const response = await fetch('/map-data');
    const data = await response.json();
    nodePosition = data.nodes;
    mapGraph = data.graph;
}

function clearMap(){
    document.getElementById('overlay').innerHTML = '';

    if(debugGraphVisible){
        renderDebugGraph();
    }
}

function renderDebugGraph(){
    const overlay = document.getElementById('overlay');
    const renderedEdges = new Set();
    const edges = [];

    for(const [from, neighbors] of Object.entries(mapGraph)){
        for(const to of neighbors){
            if(!nodePosition[from] || !nodePosition[to]){
                continue;
            }

            const edgeKey = [from, to].sort().join('|');
            if(renderedEdges.has(edgeKey)){
                continue;
            }

            renderedEdges.add(edgeKey);
            const start = nodePosition[from];
            const end = nodePosition[to];
            edges.push(`
                <line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"
                    stroke="#111827" stroke-width=".16" stroke-dasharray=".55 .35"
                    opacity=".75"></line>
            `);
        }
    }

    const nodes = Object.entries(nodePosition).map(([name, point]) => `
        <circle cx="${point.x}" cy="${point.y}" r=".32"
            fill="#f97316" stroke="#fff" stroke-width=".1"></circle>
        <text x="${point.x + .45}" y="${point.y - .35}" class="debug-node-label">
            ${escapeHtml(name)}
        </text>
    `);

    overlay.insertAdjacentHTML('beforeend', `
        <g data-debug="graph">${edges.join('')}</g>
        <g data-debug="nodes">${nodes.join('')}</g>
    `);
}

function toggleGraphDebug(){
    debugGraphVisible = !debugGraphVisible;
    document.querySelectorAll('#overlay [data-debug]').forEach(
        element => element.remove()
    );

    if(debugGraphVisible){
        renderDebugGraph();
    }
}

function renderPathResult(containerId, data){
    const instructions = (data.instructions || [])
        .map(item => `<li>${escapeHtml(item)}</li>`)
        .join('');
    const parking = data.parkingSuggestion
        ? `<p>Gợi ý gửi xe trên tuyến: <strong>${escapeHtml(data.parkingSuggestion.name)}</strong></p>`
        : '';

    document.getElementById(containerId).innerHTML = `
        <strong>Khoảng cách: ${escapeHtml(data.distance)} m</strong>
        ${parking}
        <ol>${instructions}</ol>
    `;
}

async function findPath(){
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;
    const response = await fetch(
        `/find-path?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    );
    const data = await response.json();

    if(data.error){
        clearMap();
        document.getElementById('result').innerHTML =
            `<span class="error">${escapeHtml(data.error)}</span>`;
        return;
    }

    renderPathResult('result', data);
    drawPath(data.path);
    drawParkingSuggestion(data.parkingSuggestion);
}

async function findRoom(){
    const roomInput = document.getElementById('roomInput');
    const room = (roomInput?.value || '').trim();

    if (!room) {
        document.getElementById('roomResult').innerHTML =
            `<span class="error">Vui lòng nhập tên phòng, tòa nhà hoặc nhà xe.</span>`;
        clearMap();
        return;
    }

    try {
        const response = await fetch(
            `/find-room?room=${encodeURIComponent(room)}`
        );
        const data = await response.json();

        // Kiểm tra không tìm thấy
        if (data.error || data.x == null || data.y == null) {
            clearMap();
            document.getElementById('roomResult').innerHTML =
                `<span class="error">${escapeHtml(data.error || 'Phòng học / Tòa nhà / Nhà xe này không có trong hệ thống.')}</span>`;
            return;
        }

        clearMap();

        // ========== Xử lý tiêu đề & loại ==========
        // Ưu tiên displayname (dùng cho tòa nhà & nhà xe)
        const title = data.displayname || data.name || data.room || room;

        // Chuyển type sang tiếng Việt
        const typeMap = {
            building: 'Tòa nhà',
            parking: 'Nhà xe',
            room: 'Phòng học',
            gate: 'Cổng',
            transit: 'Điểm trung chuyển'
        };
        const typeVi = typeMap[data.type] || data.type || 'Địa điểm';

        // Chỉ parse tầng / tòa khi là phòng học (dạng 101/C1, 205/D2...)
        let floor = '';
        let building = '';
        if (data.type === 'room' || /^\d+\s*\/\s*[a-zA-Z0-9]+$/i.test(room)) {
            const match = room.match(/^(\d+)\s*\/\s*([a-zA-Z0-9]+)$/i);
            if (match) {
                floor = match[1].charAt(0);          // chữ số đầu = tầng
                building = match[2].toUpperCase();
            }
        }

        const parking = data.parkingSuggestion
            ? `<p>Gợi ý gửi xe: <strong>${escapeHtml(data.parkingSuggestion.name || data.parkingSuggestion.displayname || '')}</strong></p>`
            : '';

        // ========== Render kết quả ==========
        document.getElementById('roomResult').innerHTML = `
            <strong style="text-transform: uppercase;">${escapeHtml(title)}</strong>
            <p>Loại: <strong>${escapeHtml(typeVi)}</strong></p>
            ${floor ? `<p>Tầng: <strong>${escapeHtml(floor)}</strong></p>` : ''}
            ${building ? `<p>Tòa nhà: <strong>${escapeHtml(building)}</strong></p>` : ''}
            ${parking}
        `;

        // Vẽ marker
        drawMarker(data.x, data.y, {
            color: data.type === 'parking' ? '#2563eb' : '#facc15',
            size: 0.9,
            shape: data.type === 'parking' ? 'square' : 'triangle',
            label: data.type === 'parking' ? 'Nhà xe' : 'Điểm đến',
            blink: data.type !== 'parking'
        });

        drawParkingSuggestion(data.parkingSuggestion);
        focusMapCoordinates(data.x, data.y);

    } catch (error) {
        clearMap();
        document.getElementById('roomResult').innerHTML =
            `<span class="error">Không thể tìm kiếm. Vui lòng thử lại sau.</span>`;
        console.error(error);
    }
}

function drawPath(path, append=false){
    const overlay = document.getElementById('overlay');

    if(!append){
        clearMap();
    }

    const validNodes = path.filter(node => nodePosition[node]);
    if(!validNodes.length){
        return;
    }

    const renderId = routeRenderId++;
    const segments = [];

    for(let index = 0; index < validNodes.length - 1; index++){
        const start = nodePosition[validNodes[index]];
        const end = nodePosition[validNodes[index + 1]];
        const markerEnd = index === validNodes.length - 2
            ? `marker-end="url(#route-arrow-${renderId})"`
            : '';

        segments.push(`
            <line class="route-segment" x1="${start.x}" y1="${start.y}"
                x2="${end.x}" y2="${end.y}" stroke-width=".5"
                stroke-linecap="round" ${markerEnd}></line>
        `);
    }

    overlay.insertAdjacentHTML('beforeend', `
        <defs>
            <marker id="route-arrow-${renderId}" markerWidth="1.2" markerHeight="1.2"
                refX="1" refY=".6" orient="auto" markerUnits="userSpaceOnUse">
                <polygon points="0 0, 1.2 .6, 0 1.2" fill="#dc2626"></polygon>
            </marker>
        </defs>
        ${segments.join('')}
    `);

    const start = nodePosition[validNodes[0]];
    const end = nodePosition[validNodes[validNodes.length - 1]];
    drawMarker(start.x, start.y, {
        color:'#16a34a',
        shape:'circle',
        label:'Điểm bắt đầu'
    });
    drawMarker(end.x, end.y, {
        color:'#facc15',
        shape:'triangle',
        size:.75,
        label:'Điểm đến',
        blink: true
    });

    if(!append){
        focusMapArea(validNodes.map(node => nodePosition[node]));
    }
}

function drawMarker(x, y, options={}){
    const {
        color='#facc15',
        size=.62,
        shape='circle',
        label='Vị trí'
    } = options;
    let symbol = `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}"></circle>`;

    if(shape === 'triangle'){
        const top = y - size;
        const left = x - size;
        const right = x + size;
        const bottom = y + size;
        symbol = `
        <polygon points="${x},${top} ${right},${bottom} ${left},${bottom}" fill="${color}">
            ${options.blink ? `
            <animate attributeName="visibility"
                values="visible;hidden;visible"
                dur="1s"
                repeatCount="indefinite" />
            ` : ''}
        </polygon>
        `;
    }
    else if(shape === 'square'){
        symbol = `<rect x="${x - size}" y="${y - size}" width="${size * 2}"
            height="${size * 2}" rx=".12" fill="${color}"></rect>`;
    }

    document.getElementById('overlay').insertAdjacentHTML('beforeend', `
        <g class="map-pin" stroke="#fff" stroke-width=".2">
            <title>${escapeHtml(label)}</title>
            ${symbol}
        </g>
    `);
}

function drawParkingSuggestion(parking){
    if(parking){
        drawMarker(parking.x, parking.y, {
            color:'#2563eb',
            size:.68,
            shape:'square',
            label:'Bãi gửi xe'
        });
    }
}

function focusMapCoordinates(x, y, scale=2){
    mapScale = scale;
    const pointX = x / 100 * mapContent.offsetWidth;
    const pointY = y / 100 * mapContent.offsetHeight;
    mapX = -(pointX - mapContent.offsetWidth / 2) * mapScale;
    mapY = -(pointY - mapContent.offsetHeight / 2) * mapScale;
    updateMapTransform();
}

function focusMapArea(points){
    if(!points.length){
        return;
    }

    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));

    focusMapCoordinates(
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        1.5
    );
}

function fitMap(){
    if(!mapImage.naturalWidth || !mapViewport.clientWidth){
        return;
    }

    const ratio = mapImage.naturalWidth / mapImage.naturalHeight;
    const viewportWidth = mapViewport.clientWidth;
    const viewportHeight = mapViewport.clientHeight;
    const availableWidth = Math.max(1, viewportWidth - 8);
    const availableHeight = Math.max(1, viewportHeight - 8);
    let width = availableWidth;
    let height = width / ratio;

    if(height > availableHeight){
        height = availableHeight;
        width = height * ratio;
    }

    mapContent.style.width = `${width}px`;
    mapContent.style.height = `${height}px`;
    mapContent.style.left = `${(viewportWidth - width) / 2}px`;
    mapContent.style.top = `${(viewportHeight - height) / 2}px`;
    updateMapTransform();
}

function clampMapPosition(){
    if(mapScale <= 1){
        mapX = 0;
        mapY = 0;
        return;
    }

    const maxX = mapContent.offsetWidth * (mapScale - 1) / 2;
    const maxY = mapContent.offsetHeight * (mapScale - 1) / 2;
    mapX = Math.max(-maxX, Math.min(maxX, mapX));
    mapY = Math.max(-maxY, Math.min(maxY, mapY));
}

function updateMapTransform(){
    clampMapPosition();
    mapContent.style.transform =
        `translate(${mapX}px, ${mapY}px) scale(${mapScale})`;
}

function zoomMap(delta){
    mapScale = Math.min(2.5, Math.max(.5, Number((mapScale + delta).toFixed(1))));
    updateMapTransform();
}

function resetMap(){
    mapScale = 1;
    mapX = 0;
    mapY = 0;
    fitMap();
}

function toggleCoordinateMode(){
    coordinateMode = !coordinateMode;
    document.getElementById('coordInfo').textContent = coordinateMode
        ? 'Đã bật chế độ lấy tọa độ. Nhấp vào vị trí cần lấy trên bản đồ.'
        : 'Đã tắt chế độ lấy tọa độ.';
}

mapViewport.addEventListener('pointerdown', event => {
    isDragging = true;
    didDrag = false;
    dragStart = {
        x:event.clientX - mapX,
        y:event.clientY - mapY
    };
    mapViewport.setPointerCapture(event.pointerId);
    mapViewport.classList.add('dragging');
});

mapViewport.addEventListener('pointermove', event => {
    if(!isDragging || mapScale <= 1){
        return;
    }
    didDrag = true;
    mapX = event.clientX - dragStart.x;
    mapY = event.clientY - dragStart.y;
    updateMapTransform();
});

mapViewport.addEventListener('pointerup', event => {
    isDragging = false;
    mapViewport.releasePointerCapture(event.pointerId);
    mapViewport.classList.remove('dragging');
});

mapViewport.addEventListener('click', event => {
    if(!coordinateMode || didDrag){
        return;
    }

    const rect = mapImage.getBoundingClientRect();
    if(
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
    ){
        return;
    }

    const x = (event.clientX - rect.left) / rect.width * 100;
    const y = (event.clientY - rect.top) / rect.height * 100;
    const nodeName = document.getElementById('nodeName').value.trim() || 'node';
    document.getElementById('coordInfo').textContent =
        `"${nodeName}": { x: ${x.toFixed(4)}, y: ${y.toFixed(4)} },`;
});

async function initializeMap(){
    await loadNodes();
    if(mapImage.complete){
        fitMap();
    }
    else{
        mapImage.addEventListener('load', fitMap, {once:true});
    }

    const params = new URLSearchParams(location.search);

    // Xử lý tìm đường (giữ nguyên)
    const end = params.get('end');
    if(end){
        document.getElementById('start').value = params.get('start') || 'cổng a';
        document.getElementById('end').value = end;
        findPath();
    }

    // Xử lý tìm phòng (thêm mới)
    const roomQuery = params.get('room');
    if(roomQuery){
        // Chuyển sang tab Tìm phòng / Tòa nhà
        if (typeof showMapTab === 'function') {
            showMapTab('room');          // tên tab của bạn (có thể là 'room' hoặc 'find-room')
        }

        const roomInput = document.getElementById('roomInput');
        if(roomInput){
            roomInput.value = roomQuery;
            findRoom();
        }
    }
}

window.addEventListener('resize', fitMap);
window.ctuReady.then(initializeMap);
