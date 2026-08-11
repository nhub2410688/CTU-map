require('dotenv').config({ quiet:true });

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const database = require('./database');
const {
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    MAX_DOCUMENT_SIZE,
    PORT,
    UPLOAD_DIR
} = require('./src/config');
const {
    canOpenDocumentDirectly,
    ensureUploadDir,
    formatDocument,
    inferOpenMime,
    isAllowedDocument,
    parseMultipartForm
} = require('./src/document-files');
const {
    createToken,
    hashPassword,
    legacyHashPassword,
    verifyPassword
} = require('./security');

const app = express();

app.use(express.json());

const {
    SCALE,
    nodePosition,
    buildings,
    parkingLots,
    nodeType,
    graph
} = require('./src/map-data');

function normalizeText(value){
    return String(value || '').trim().toLowerCase();
}

function validateStudentId(studentId){
    return /^B\d{7}$/i.test(String(studentId || '').trim());
}

async function getAuthFromRequest(req){
    const header =
        req.headers.authorization || '';

    const token =
        header.startsWith('Bearer ')
            ? header.slice(7)
            : req.headers['x-token'];

    if(!token){
        return null;
    }

    const session = await database.getSession(token);

    if(!session){
        return null;
    }

    const db = await database.loadState();

    if(
        session.role === 'student' &&
        !db.students[session.userId]
    ){
        return null;
    }

    return {
        db,
        token,
        role: session.role,
        userId: session.userId,
        student: session.role === 'student'
            ? db.students[session.userId]
            : null
    };
}

async function requireAuth(req, res){
    const auth = await getAuthFromRequest(req);

    if(!auth){
        res.status(401).json({
            error: "Bạn cần đăng nhập trước"
        });
        return null;
    }

    return auth;
}

async function requireStudent(req, res){
    const auth = await requireAuth(req, res);

    if(!auth){
        return null;
    }

    if(auth.role !== 'student'){
        res.status(403).json({
            error: "Chức năng này chỉ dành cho sinh viên"
        });
        return null;
    }

    return auth;
}

async function requireAdmin(req, res){
    const auth = await requireAuth(req, res);

    if(!auth){
        return null;
    }

    if(auth.role !== 'admin'){
        res.status(403).json({
            error: "Chức năng này chỉ dành cho quản trị viên"
        });
        return null;
    }

    return auth;
}

function canAccessDocument(auth, document){
    return auth.role === 'admin' ||
        document.status === 'approved' ||
        document.uploadedBy === auth.userId;
}

function getLocationPosition(code, location){
    const nodeName =
        location.locationnode || code;

    return nodePosition[nodeName];
}

function getlocationnode(code, location){
    return location.locationnode || code;
}

function calculateDistance(nodeA, nodeB) {
    const keyA = String(nodeA).toLowerCase();
    const keyB = String(nodeB).toLowerCase();

    const posA = nodePosition[keyA];
    const posB = nodePosition[keyB];

    if (!posA || !posB) return Infinity;

    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;

    return Math.sqrt(dx * dx + dy * dy) * SCALE;
}

function dijkstra(start, end) {
    const distances = {};
    const visited = {};
    const previous = {};

    // 👉 state key: "current|prev"
    function makeKey(node, prev) {
        return node + "|" + (prev ?? "null");
    }

    const startKey = makeKey(start, null);

    distances[startKey] = 0;
    previous[startKey] = null;

    while (true) {
        let currentKey = null;
        let minDistance = Infinity;

        for (const key in distances) {
            if (!visited[key] && distances[key] < minDistance) {
                minDistance = distances[key];
                currentKey = key;
            }
        }

        if (currentKey === null) break;

        const [current, prev] = currentKey.split("|");
        const prevNode = prev === "null" ? null : prev;

        if (current === end) break;

        visited[currentKey] = true;

        for (const neighbor of graph[current] || []) {
            const baseDist = calculateDistance(current, neighbor);

            let cost = baseDist;

            // 🔥 CORE LOGIC: node → building → node
            if (
                nodeType[current] === "building" &&
                prevNode !== null
            ) {
                cost += 10000;
            }

            const nextKey = makeKey(neighbor, current);
            const newDist = distances[currentKey] + cost;

            if (newDist < (distances[nextKey] ?? Infinity)) {
                distances[nextKey] = newDist;
                previous[nextKey] = currentKey;
            }
        }
    }

    // 👉 tìm state tốt nhất kết thúc tại end
    let bestKey = null;
    let bestDist = Infinity;

    for (const key in distances) {
        const [node] = key.split("|");
        if (node === end && distances[key] < bestDist) {
            bestDist = distances[key];
            bestKey = key;
        }
    }

    if (bestKey === null) {
        return { error: "Không tìm thấy đường đi" };
    }

    // 🔁 reconstruct path
    const pathResult = [];
    let currentKey = bestKey;

    while (currentKey !== null) {
        const [node] = currentKey.split("|");
        pathResult.unshift(node);
        currentKey = previous[currentKey];
    }

    return {
        distance: bestDist.toFixed(2),
        path: pathResult,
        instructions: buildInstructions(pathResult),
        parkingSuggestion: suggestParkingForPath(pathResult, end)
    };
}

function displayNodeName(node){
    if(buildings[node]){
        return buildings[node].displayname;
    }

    if(parkingLots[node]){
        return parkingLots[node].displayname;
    }

    if(node === "a3_1" || node === "a3_2"){
        return "Nhà học A3";
    }

    if(node === "rlc"){
        return "RLC";
    }

    if(node === "xh"){
        return "Khoa KHXH&NV";
    }

    if(nodeType[node] === "gate"){
        return node;
    }

    return "ngã rẽ tiếp theo";
}

function turnBetween(prev, current, next){
    const a = nodePosition[prev];
    const b = nodePosition[current];
    const c = nodePosition[next];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    // Tọa độ ảnh có trục Y hướng xuống, nên đảo dấu tích có hướng
    // để xác định trái/phải theo góc nhìn của người đang di chuyển.
    const cross = -(v1.x * v2.y - v1.y * v2.x);
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angle = Math.atan2(cross, dot) * 180 / Math.PI;

    if(Math.abs(angle) < 25){
        return "straight";
    }

    return angle > 0 ? "left" : "right";
}

function buildInstructions(routePath){
    if(routePath.length < 2){
        return ["Đã đến điểm đích."];
    }

    const steps = [];
    let currentManeuver = "straight";
    let currentDistance = calculateDistance(routePath[0], routePath[1]);

    for(let i = 1; i < routePath.length - 1; i++){
        const maneuver = turnBetween(
            routePath[i - 1],
            routePath[i],
            routePath[i + 1]
        );
        const segmentDistance = calculateDistance(
            routePath[i],
            routePath[i + 1]
        );

        if(maneuver === "straight"){
            currentDistance += segmentDistance;
            continue;
        }

        steps.push({
            maneuver: currentManeuver,
            distance: currentDistance
        });
        currentManeuver = maneuver;
        currentDistance = segmentDistance;
    }

    steps.push({
        maneuver: currentManeuver,
        distance: currentDistance
    });

    return steps.map(step => {
        const distance = Math.max(1, Math.round(step.distance));

        if(step.maneuver === "left"){
            return `Rẽ trái, đi thẳng ${distance} m.`;
        }

        if(step.maneuver === "right"){
            return `Rẽ phải, đi thẳng ${distance} m.`;
        }

        return `Đi thẳng ${distance} m.`;
    });
}

function validateRoom(roomInput){
    const location = findLocation(roomInput);

    if(location.error || location.type !== "room"){
        return {
            error: "Phòng học phải đúng định dạng và có trong dữ liệu bản đồ"
        };
    }

    return location;
}

function findLocation(input){
    const normalized = normalizeText(input);

    if(!normalized){
        return {
            error: "Vui lòng nhập địa điểm"
        };
    }

    if(normalized.includes("/")){
        const parts = normalized.split("/");

        if(parts.length !== 2){
            return {
                error: "Định dạng phòng phải là xxx/yy"
            };
        }

        const roomText = parts[0].trim();
        const buildingCode = parts[1].trim();

        if(!/^\d+$/.test(roomText)){
            return {
                error: "Số phòng không hợp lệ"
            };
        }

        const roomNumber = parseInt(roomText, 10);
        const building = buildings[buildingCode];

        if(!building){
            return {
                error: "Không tìm thấy tòa nhà"
            };
        }

        const floor = Math.floor(roomNumber / 100);
        const floorInfo = building.floors[floor];

        if(!floorInfo){
            return {
                error: "Tòa nhà không có tầng này"
            };
        }

        const [minRoom, maxRoom] = floorInfo;

        if(roomNumber < minRoom || roomNumber > maxRoom){
            return {
                error: "Không tồn tại phòng học"
            };
        }

        const pos = getLocationPosition(buildingCode, building);

        return {
            found: true,
            type: "room",
            room: roomNumber,
            building: buildingCode,
            name: `${roomNumber.toString().padStart(3, '0')}/${buildingCode.toUpperCase()}`,
            routeNode: getlocationnode(buildingCode, building),
            nearestparking: building.nearestparking,
            x: pos.x,
            y: pos.y
        };
    }

    for(const code in buildings){
        if(code === normalized || buildings[code].aliases.includes(normalized)){
            const building = buildings[code];
            const pos = getLocationPosition(code, building);

            return {
                found: true,
                type: "building",
                name: code,
                displayname: building.displayname,
                routeNode: getlocationnode(code, building),
                nearestparking: building.nearestparking,
                x: pos.x,
                y: pos.y
            };
        }
    }

    for(const code in parkingLots){
        if(code === normalized || parkingLots[code].aliases.includes(normalized)){
            const pos = nodePosition[code];

            return {
                found: true,
                type: "parking",
                name: code,
                displayname: parkingLots[code].displayname,
                routeNode: code,
                x: pos.x,
                y: pos.y
            };
        }
    }

    if(graph[normalized]){
        const pos = nodePosition[normalized];
        return {
            found: true,
            type: nodeType[normalized] || "node",
            name: normalized,
            displayname: displayNodeName(normalized),
            routeNode: normalized,
            x: pos.x,
            y: pos.y
        };
    }

    return {
        error: "Không tìm thấy địa điểm"
    };
}

function resolveRouteNode(input){
    const location = findLocation(input);

    if(location.error){
        return location;
    }

    if(!graph[location.routeNode]){
        return {
            error: "Địa điểm chưa được nối vào bản đồ đường đi"
        };
    }

    return location;
}

function suggestParkingForLocation(location){
    if(!location || !location.nearestparking){
        return null;
    }

    const parking = parkingLots[location.nearestparking];
    const pos = nodePosition[location.nearestparking];

    if(!parking || !pos){
        return null;
    }

    return {
        code: location.nearestparking,
        name: parking.displayname,
        x: pos.x,
        y: pos.y
    };
}

/**
 * Tìm nhà xe gợi ý — chỉ dựa trên node áp cuối của path
 * (node nối với đích trên đúng đường đi đã tìm được)
 */
function suggestParkingForPath(routePath, destinationNode) {
    if (!Array.isArray(routePath) || routePath.length < 2) {
        return fallbackNearestParking(destinationNode || routePath?.[routePath.length - 1]);
    }

    const dest = destinationNode || routePath[routePath.length - 1];
    const approachNode = routePath[routePath.length - 2]; // node nối với đích trên path

    // 1. Chính approachNode là nhà xe
    if (nodeType[approachNode] === 'parking' && parkingLots[approachNode]) {
        return buildParkingSuggestion(approachNode);
    }

    // Hàng xóm của approachNode, BỎ node đích
    const neighbors = (graph[approachNode] || []).filter(n => n !== dest);

    // 2. approachNode nối trực tiếp với nhà xe
    for (const b of neighbors) {
        if (nodeType[b] === 'parking' && parkingLots[b]) {
            return buildParkingSuggestion(b);
        }
    }

    // 3. approachNode → node trung gian → nhà xe (vẫn bỏ đường qua đích)
    for (const b of neighbors) {
        const secondNeighbors = (graph[b] || []).filter(n => n !== dest);
        for (const c of secondNeighbors) {
            if (nodeType[c] === 'parking' && parkingLots[c]) {
                return buildParkingSuggestion(c);
            }
        }
    }

    // 4. Fallback
    return fallbackNearestParking(dest);
}

function fallbackNearestParking(destNode) {
    if (!destNode) return null;

    const preferred = buildings[destNode]?.nearestparking;
    if (preferred && nodePosition[preferred] && parkingLots[preferred]) {
        return buildParkingSuggestion(preferred);
    }
    return null;
}

function buildParkingSuggestion(parkingNode) {
    const info = parkingLots[parkingNode] || {};
    const pos = nodePosition[parkingNode];

    if (!pos) return null;

    return {
        code: parkingNode,
        name: info.displayname || info.displayName || parkingNode,
        x: pos.x,
        y: pos.y
    };
}



function validateScheduleEntry(body){
    const day = Number(body.day);
    const startPeriod = Number(body.startPeriod);
    const duration = Number(body.duration);
    const subject = String(body.subject || '').trim();
    const room = String(body.room || '').trim();
    const teacher = String(body.teacher || '').trim();

    if(!Number.isInteger(day) || day < 2 || day > 7){
        return { error: "Thứ phải từ 2 đến 7" };
    }

    if(!Number.isInteger(startPeriod) || startPeriod < 1 || startPeriod > 9){
        return { error: "Tiết bắt đầu phải từ 1 đến 9" };
    }

    const maxDuration = startPeriod <= 5 ? 5 : 4;

    if(!Number.isInteger(duration) || duration < 1 || duration > maxDuration){
        return { error: `Số tiết phải từ 1 đến ${maxDuration}` };
    }

    if(startPeriod <= 5 && startPeriod + duration - 1 > 5){
        return { error: "Buổi sáng chỉ có tiết 1 đến 5" };
    }

    if(startPeriod >= 6 && startPeriod + duration - 1 > 9){
        return { error: "Buổi chiều chỉ có tiết 6 đến 9" };
    }

    if(!subject){
        return { error: "Vui lòng nhập tên môn học" };
    }

    const roomLocation = validateRoom(room);

    if(roomLocation.error){
        return roomLocation;
    }

    return {
        id: crypto.randomUUID(),
        day,
        startPeriod,
        duration,
        subject,
        room,
        teacher,
        routeNode: roomLocation.routeNode,
        building: roomLocation.building
    };
}

function sortSchedule(entries){
    return [...entries].sort((a, b) =>
        a.day - b.day ||
        (a.startPeriod ?? a.period) - (b.startPeriod ?? b.period)
    );
}

function getPeriodRange(entry){
    const start = Number(entry.startPeriod ?? entry.period);
    const duration = Number(entry.duration || 1);

    return {
        start,
        end: start + duration - 1
    };
}

function schedulesOverlap(first, second){
    if(Number(first.day) !== Number(second.day)){
        return false;
    }

    const firstRange = getPeriodRange(first);
    const secondRange = getPeriodRange(second);

    return firstRange.start <= secondRange.end &&
        secondRange.start <= firstRange.end;
}

function resolveTeacherSchedule(db, schedule){
    const subject = (db.subjects || [])
        .find(item => item.id === schedule.subjectId);
    const teacher = (db.teachers || [])
        .find(item => item.id === schedule.teacherId);
    const roomLocation = validateRoom(schedule.room);

    return {
        ...schedule,
        duration: Number(schedule.duration || 1),
        teacherCode: teacher ? teacher.code : schedule.teacherCode,
        teacherName: teacher ? teacher.name : schedule.teacherName,
        subjectCode: subject ? subject.code : schedule.subjectCode,
        subject: subject ? subject.name : schedule.subject,
        building: roomLocation.error ? '' : roomLocation.building
    };
}

function resolveStudentSchedule(db, student){
    const teacherSchedules = db.teacherSchedules || [];

    return (student.schedule || []).flatMap(item => {
        if(!item.teacherScheduleId){
            return [{
                ...item,
                linked: false,
                legacy: true
            }];
        }

        const teacherSchedule = teacherSchedules.find(
            schedule => schedule.id === item.teacherScheduleId
        );

        if(!teacherSchedule){
            return [];
        }

        const resolved = resolveTeacherSchedule(db, teacherSchedule);

        return [{
            id: item.id,
            teacherScheduleId: teacherSchedule.id,
            day: resolved.day,
            startPeriod: resolved.period,
            duration: resolved.duration,
            subjectId: resolved.subjectId,
            subject: resolved.subject,
            room: resolved.room,
            teacher: resolved.teacherName,
            teacherCode: resolved.teacherCode,
            routeNode: resolved.routeNode,
            linked: true
        }];
    });
}

function findStudentScheduleConflict(db, student, candidate, excludedId=''){
    return resolveStudentSchedule(db, student).find(item =>
        item.id !== excludedId && schedulesOverlap(item, candidate)
    );
}

function findTeacherConflict(db, candidate, excludedId=''){
    for(const item of db.teacherSchedules || []){
        if(item.id === excludedId || !schedulesOverlap(item, candidate)){
            continue;
        }

        const sameTeacher = item.teacherId && candidate.teacherId
            ? item.teacherId === candidate.teacherId
            : normalizeText(item.teacherCode) === normalizeText(candidate.teacherCode);
        const sameRoom =
            normalizeText(item.room) === normalizeText(candidate.room);

        if(sameTeacher){
            return { item, type: 'teacher' };
        }

        if(sameRoom){
            return { item, type: 'room' };
        }
    }

    return null;
}

function findAffectedStudentConflict(db, scheduleId, candidate){
    for(const student of Object.values(db.students || {})){
        const enrollment = (student.schedule || []).find(
            item => item.teacherScheduleId === scheduleId
        );

        if(!enrollment){
            continue;
        }

        const conflict = findStudentScheduleConflict(
            db,
            student,
            {
                ...candidate,
                startPeriod: candidate.period
            },
            enrollment.id
        );

        if(conflict){
            return {
                studentId: student.studentId,
                conflict
            };
        }
    }

    return null;
}

function generateClassCode(db, subjectCode, excludedId = '') {
    const prefix = String(subjectCode || '').trim().toUpperCase();
    if (!prefix) {
        return null;
    }

    const usedNumbers = new Set();

    for (const item of (db.teacherSchedules || [])) {
        if (item.id === excludedId) continue;
        if (!item.classCode) continue;

        const code = String(item.classCode).toUpperCase();
        if (!code.startsWith(prefix)) continue;

        const numPart = code.slice(prefix.length);
        if (/^\d{2}$/.test(numPart)) {
            const num = Number(numPart);
            if (num >= 1 && num <= 99) {
                usedNumbers.add(num);
            }
        }
    }

    // Lấy số nhỏ nhất còn trống từ 01 → 99
    for (let i = 1; i <= 99; i++) {
        if (!usedNumbers.has(i)) {
            return prefix + String(i).padStart(2, '0');
        }
    }

    return null; // hết slot
}

function validateTeacherSchedule(db, body, excludedId = '') {
    const teacher = (db.teachers || []).find(
        item => item.id === String(body.teacherId || '')
    );
    const subject = (db.subjects || []).find(
        item => item.id === String(body.subjectId || '')
    );

    if (!teacher) {
        return { error: "Giảng viên phải được chọn từ danh sách giảng viên" };
    }

    if (!subject) {
        return { error: "Môn học phải được chọn từ danh mục môn học" };
    }

    const validated = validateScheduleEntry({
        day: body.day,
        startPeriod: body.period,
        duration: body.duration,
        subject: subject.name,
        room: body.room,
        teacher: teacher.name
    });

    if (validated.error) {
        return validated;
    }

    const candidate = {
        id: excludedId || crypto.randomUUID(),
        teacherId: teacher.id,
        teacherCode: teacher.code,
        teacherName: teacher.name,
        day: validated.day,
        period: validated.startPeriod,
        duration: validated.duration,
        subjectId: subject.id,
        subjectCode: subject.code,          // thêm
        subject: subject.name,
        room: validated.room,
        routeNode: validated.routeNode
    };

    // ===== Sinh / giữ mã lớp =====
    if (excludedId) {
        // Đang sửa lớp
        const existing = (db.teacherSchedules || []).find(
            item => item.id === excludedId
        );

        if (existing && existing.subjectId === subject.id && existing.classCode) {
            // Cùng môn → giữ nguyên mã lớp
            candidate.classCode = existing.classCode;
        } else {
            // Đổi môn hoặc chưa có mã → sinh mới
            const newCode = generateClassCode(db, subject.code, excludedId);
            if (!newCode) {
                return { error: "Đã hết mã lớp cho môn học này (tối đa 99 lớp)" };
            }
            candidate.classCode = newCode;
        }
    } else {
        // Tạo lớp mới
        const newCode = generateClassCode(db, subject.code);
        if (!newCode) {
            return { error: "Đã hết mã lớp cho môn học này (tối đa 99 lớp)" };
        }
        candidate.classCode = newCode;
    }
    // =============================

    const conflict = findTeacherConflict(db, candidate, excludedId);

    if (conflict) {
        const range = getPeriodRange(conflict.item);
        const reason = conflict.type === 'teacher'
            ? `Giảng viên đã có lịch từ tiết ${range.start}-${range.end}`
            : `Phòng ${conflict.item.room} đã được sử dụng từ tiết ${range.start}-${range.end}`;

        return { error: `${reason} trong thứ ${candidate.day}` };
    }

    if (excludedId) {
        const studentConflict = findAffectedStudentConflict(
            db,
            excludedId,
            candidate
        );

        if (studentConflict) {
            return {
                error: `Thay đổi này làm trùng thời khóa biểu của sinh viên ${studentConflict.studentId}`
            };
        }
    }

    return candidate;
}

function getDaySchedule(db, student, day){
    return sortSchedule(resolveStudentSchedule(db, student))
        .filter(item => item.day === day);
}

function buildScheduleRoute(entries, startInput){
    const startLocation = resolveRouteNode(startInput || "cổng a");

    if(startLocation.error){
        return startLocation;
    }

    const legs = [];
    let currentNode = startLocation.routeNode;

    for(const item of entries){
        const result = dijkstra(currentNode, item.routeNode);

        if(result.error){
            return result;
        }

        legs.push({
            subject: item.subject,
            room: item.room,
            teacher: item.teacher,
            day: item.day,
            startPeriod: item.startPeriod,
            duration: item.duration,
            ...result
        });

        currentNode = item.routeNode;
    }

    return {
        start: startLocation.displayname || startLocation.name,
        legs
    };
}

app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static('public'));

app.get('/map-data', (req, res)=>{
    res.json({
        nodes: nodePosition,
        graph,
        nodeType
    });
});

app.get('/find-path',(req,res)=>{
    if(!req.query.start || !req.query.end){
        return res.json({
            error: "Vui lòng nhập đủ dữ liệu"
        });
    }

    const start = resolveRouteNode(req.query.start);
    const end = resolveRouteNode(req.query.end);

    if(start.error){
        return res.json(start);
    }

    if(end.error){
        return res.json(end);
    }

    const result = dijkstra(start.routeNode, end.routeNode);

    if(result.error){
        return res.json(result);
    }

    res.json({
        ...result,
        startLocation: start,
        endLocation: end
    });
});

app.get('/find-room',(req,res)=>{
    if(!req.query.room){
        return res.json({
            error: "Vui lòng nhập phòng học"
        });
    }

    const result = findLocation(req.query.room);

    if(result.error){
        return res.json(result);
    }

    res.json({
        ...result,
        parkingSuggestion: suggestParkingForLocation(result)
    });
});

app.post('/api/register', async (req, res)=>{
    const studentId = String(req.body.studentId || '').trim().toUpperCase();
    const password = String(req.body.password || '');

    if(!validateStudentId(studentId)){
        return res.status(400).json({
            error: "Mã số sinh viên phải có định dạng Bxxxxxxx"
        });
    }

    if(password.length < 6){
        return res.status(400).json({
            error: "Mật khẩu tối thiểu 6 ký tự"
        });
    }

    const db = await database.loadState();

    if(db.students[studentId]){
        return res.status(409).json({
            error: "Tài khoản đã tồn tại"
        });
    }

    const passwordHash = await hashPassword(password);
    await database.createStudent(studentId, passwordHash);

    res.json({
        message: "Đăng ký thành công"
    });
});

app.post('/api/login', async (req, res)=>{
    const loginId = String(
        req.body.loginId || req.body.studentId || ''
    ).trim();
    const password = String(req.body.password || '');
    const db = await database.loadState();
    const studentId = loginId.toUpperCase();

    if(loginId.toLowerCase() === ADMIN_USERNAME.toLowerCase()){
        const admin = await database.findAdmin(loginId);

        if(!admin || !await verifyPassword(admin.password_hash, password)){
            return res.status(401).json({
                error: "Tên đăng nhập hoặc mật khẩu không đúng"
            });
        }

        const token = createToken();
        await database.createSession(token, 'admin', admin.username);

        return res.json({
            token,
            userId: admin.username,
            role: 'admin'
        });
    }

    const student = db.students[studentId];
    let passwordIsValid = student
        ? await verifyPassword(student.passwordHash, password)
        : false;

    if(
        student &&
        !passwordIsValid &&
        student.legacySalt &&
        student.legacyPasswordHash
    ){
        passwordIsValid =
            legacyHashPassword(password, student.legacySalt) ===
            student.legacyPasswordHash;

        if(passwordIsValid){
            const upgradedHash = await hashPassword(password);
            await database.updateStudentPassword(studentId, upgradedHash);
        }
    }

    if(!student || !passwordIsValid){
        return res.status(401).json({
            error: "MSSV hoặc mật khẩu không đúng"
        });
    }

    const token = createToken();
    await database.createSession(token, 'student', studentId);

    res.json({
        token,
        userId: studentId,
        studentId,
        role: 'student'
    });
});

app.get('/api/demo-credentials', (req, res)=>{
    res.json({
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD
    });
});

app.post('/api/ctu-login', (req, res)=>{
    res.status(501).json({
        error: "Chưa hỗ trợ đăng nhập trực tiếp vào HTQL CTU",
        detail: "Tính năng này cần API chính thức hoặc cơ chế ủy quyền an toàn từ trường. Ứng dụng hiện không lưu hoặc gửi mật khẩu HTQL của sinh viên."
    });
});

app.get('/api/me', async (req, res)=>{
    const auth = await requireAuth(req, res);
    if(!auth){
        return;
    }

    res.json({
        userId: auth.userId,
        studentId: auth.role === 'student' ? auth.userId : null,
        role: auth.role
    });
});

app.post('/api/logout', async (req, res)=>{
    const auth = await requireAuth(req, res);
    if(!auth){
        return;
    }

    await database.deleteSession(auth.token);
    res.json({ message: "Đã đăng xuất" });
});

app.get('/api/schedule', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    res.json({
        schedule: sortSchedule(resolveStudentSchedule(auth.db, auth.student))
    });
});

app.post('/api/schedule', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    const teacherSchedule = (auth.db.teacherSchedules || []).find(
        item => item.id === String(req.body.teacherScheduleId || '')
    );

    if(!teacherSchedule){
        return res.status(400).json({
            error: "Lớp học phải được chọn từ lịch giảng viên"
        });
    }

    auth.student.schedule = auth.student.schedule || [];
    const candidate = {
        ...teacherSchedule,
        startPeriod: teacherSchedule.period
    };
    const conflict = findStudentScheduleConflict(
        auth.db,
        auth.student,
        candidate
    );

    if(conflict){
        const range = getPeriodRange(conflict);
        return res.status(409).json({
            error: `Trùng với ${conflict.subject}, thứ ${conflict.day}, tiết ${range.start}-${range.end}`
        });
    }

    const entry = {
        id: crypto.randomUUID(),
        teacherScheduleId: teacherSchedule.id
    };
    await database.insertStudentSchedule(auth.userId, entry);

    res.json({
        message: "Đã thêm lớp học vào thời khóa biểu",
        entry: resolveStudentSchedule(auth.db, {
            schedule: [entry]
        })[0]
    });
});

app.put('/api/schedule/:id', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    const index = (auth.student.schedule || [])
        .findIndex(item => item.id === req.params.id);

    if(index === -1){
        return res.status(404).json({
            error: "Không tìm thấy môn học cần chỉnh sửa"
        });
    }

    const teacherSchedule = (auth.db.teacherSchedules || []).find(
        item => item.id === String(req.body.teacherScheduleId || '')
    );

    if(!teacherSchedule){
        return res.status(400).json({
            error: "Lớp học phải được chọn từ lịch giảng viên"
        });
    }

    const conflict = findStudentScheduleConflict(
        auth.db,
        auth.student,
        {
            ...teacherSchedule,
            startPeriod: teacherSchedule.period
        },
        req.params.id
    );

    if(conflict){
        const range = getPeriodRange(conflict);
        return res.status(409).json({
            error: `Trùng với ${conflict.subject}, thứ ${conflict.day}, tiết ${range.start}-${range.end}`
        });
    }

    const entry = {
        id: req.params.id,
        teacherScheduleId: teacherSchedule.id
    };
    await database.updateStudentSchedule(auth.userId, entry);

    res.json({
        message: "Đã cập nhật thời khóa biểu",
        entry
    });
});

app.delete('/api/schedule/:id', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    const deleted = await database.deleteStudentSchedule(
        auth.userId,
        req.params.id
    );

    if(!deleted){
        return res.status(404).json({
            error: "Không tìm thấy môn học"
        });
    }

    res.json({
        message: "Đã xóa môn học"
    });
});

app.get('/api/schedule/routes', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    const day = Number(req.query.day);

    if(!Number.isInteger(day) || day < 2 || day > 7){
        return res.status(400).json({
            error: "Thứ phải từ 2 đến 7"
        });
    }

    const entries = getDaySchedule(auth.db, auth.student, day);

    if(entries.length === 0){
        return res.json({
            legs: [],
            message: "Ngày này chưa có môn học"
        });
    }

    res.json(buildScheduleRoute(entries, req.query.start || "cổng a"));
});

app.get('/api/parking', (req, res)=>{
    const target = findLocation(req.query.target);

    if(target.error){
        return res.json(target);
    }

    res.json({
        parkingSuggestion: suggestParkingForLocation(target)
    });
});

app.get('/api/buildings', (req, res)=>{
    res.json({
        buildings: Object.entries(buildings).map(([code, item]) => ({
            code,
            name: item.displayname
        }))
    });
});

app.get('/api/teachers', async (req, res)=>{
    const db = await database.loadState();
    const teachers = [...(db.teachers || [])].sort((a, b) =>
        a.code.localeCompare(b.code, 'vi')
    );

    res.json({ teachers });
});

app.post('/api/teachers', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();

    if(!code || !name){
        return res.status(400).json({
            error: "Vui lòng nhập mã giảng viên và tên giảng viên"
        });
    }

    const duplicate = (auth.db.teachers || []).find(item =>
        normalizeText(item.code) === normalizeText(code)
    );

    if(duplicate){
        return res.status(409).json({
            error: "Mã giảng viên đã tồn tại"
        });
    }

    const teacher = {
        id: crypto.randomUUID(),
        code,
        name,
        classCount: 0
    };

    await database.insertTeacher(teacher);
    res.json({ message: "Đã thêm giảng viên", teacher });
});

app.put('/api/teachers/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const teachers = auth.db.teachers || [];
    const index = teachers.findIndex(item => item.id === req.params.id);

    if(index === -1){
        return res.status(404).json({ error: "Không tìm thấy giảng viên" });
    }

    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();

    if(!code || !name){
        return res.status(400).json({
            error: "Vui lòng nhập mã giảng viên và tên giảng viên"
        });
    }

    const duplicate = teachers.find(item =>
        item.id !== req.params.id &&
        (
            normalizeText(item.code) === normalizeText(code)
        )
    );

    if(duplicate){
        return res.status(409).json({
            error: "Mã giảng viên đã tồn tại"
        });
    }

    const teacher = { id: req.params.id, code, name };
    await database.updateTeacher(teacher);
    res.json({ message: "Đã cập nhật giảng viên", teacher });
});

app.delete('/api/teachers/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    if((auth.db.teacherSchedules || []).some(
        item => item.teacherId === req.params.id
    )){
        return res.status(409).json({
            error: "Không thể xóa giảng viên đang có lớp học"
        });
    }

    const deleted = await database.deleteTeacher(req.params.id);

    if(!deleted){
        return res.status(404).json({ error: "Không tìm thấy giảng viên" });
    }

    res.json({ message: "Đã xóa giảng viên" });
});

app.get('/api/subjects', async (req, res)=>{
    const db = await database.loadState();
    const subjects = [...(db.subjects || [])].sort((a, b) =>
        a.code.localeCompare(b.code, 'vi')
    );

    res.json({ subjects });
});

app.post('/api/subjects', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();

    if(!code || !name){
        return res.status(400).json({
            error: "Vui lòng nhập mã môn và tên môn học"
        });
    }

    const duplicate = (auth.db.subjects || []).find(item =>
        normalizeText(item.code) === normalizeText(code)
    );

    if(duplicate){
        return res.status(409).json({
            error: "Mã môn học đã tồn tại"
        });
    }

    const subject = {
        id: crypto.randomUUID(),
        code,
        name
    };

    await database.insertSubject(subject);
    res.json({ message: "Đã thêm môn học", subject });
});

app.put('/api/subjects/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const subjects = auth.db.subjects || [];
    const index = subjects.findIndex(item => item.id === req.params.id);

    if(index === -1){
        return res.status(404).json({ error: "Không tìm thấy môn học" });
    }

    const code = String(req.body.code || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();

    if(!code || !name){
        return res.status(400).json({
            error: "Vui lòng nhập mã môn và tên môn học"
        });
    }

    const duplicate = subjects.find(item =>
        item.id !== req.params.id &&
        (
            normalizeText(item.code) === normalizeText(code)
        )
    );

    if(duplicate){
        return res.status(409).json({
            error: "Mã môn học đã tồn tại"
        });
    }

    const subject = { id: req.params.id, code, name };
    await database.updateSubject(subject);
    res.json({ message: "Đã cập nhật môn học", subject });
});

app.delete('/api/subjects/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    if((auth.db.teacherSchedules || []).some(
        item => item.subjectId === req.params.id
    )){
        return res.status(409).json({
            error: "Không thể xóa môn học đang có lớp học"
        });
    }

    const deleted = await database.deleteSubject(req.params.id);

    if(!deleted){
        return res.status(404).json({ error: "Không tìm thấy môn học" });
    }

    res.json({ message: "Đã xóa môn học" });
});

app.get('/api/teacher-schedule', async (req, res)=>{
    const db = await database.loadState();
    const keyword = normalizeText(req.query.q || '');
    const building = normalizeText(req.query.building || '');
    const session = normalizeText(req.query.session || '');
    const day = req.query.day ? Number(req.query.day) : null;
    let items = (db.teacherSchedules || []).map(
        item => resolveTeacherSchedule(db, item)
    );

    if(day){
        if(!Number.isInteger(day) || day < 2 || day > 7){
            return res.status(400).json({
                error: "Thứ phải từ 2 đến 7"
            });
        }

        items = items.filter(item => Number(item.day) === day);
    }

    if(building){
        items = items.filter(item =>
            normalizeText(item.building) === building
        );
    }

    if(session){
        if(session === 'morning' || session === 'sang' || session === 'sáng'){
            items = items.filter(item => Number(item.period) <= 5);
        }
        else if(session === 'afternoon' || session === 'chieu' || session === 'chiều'){
            items = items.filter(item => Number(item.period) >= 6);
        }
        else{
            return res.status(400).json({
                error: "Buổi học không hợp lệ"
            });
        }
    }

    if(keyword){
        items = items.filter(item =>
            normalizeText(item.classCode).includes(keyword) ||
            normalizeText(item.teacherCode).includes(keyword) ||
            normalizeText(item.teacherName).includes(keyword) ||
            normalizeText(item.subjectCode).includes(keyword) ||
            normalizeText(item.subject).includes(keyword) ||
            normalizeText(item.room).includes(keyword)
        );
    }

    res.json({
        schedules: sortSchedule(items)
    });
});

app.post('/api/teacher-schedule', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const teacherEntry = validateTeacherSchedule(auth.db, req.body);

    if(teacherEntry.error){
        return res.status(
            teacherEntry.error.includes('đã') ? 409 : 400
        ).json(teacherEntry);
    }

    await database.insertTeacherSchedule(teacherEntry);

    res.json({
        message: "Đã thêm lịch giảng viên",
        entry: teacherEntry
    });
});

app.put('/api/teacher-schedule/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const schedules = auth.db.teacherSchedules || [];
    const index = schedules.findIndex(item => item.id === req.params.id);

    if(index === -1){
        return res.status(404).json({
            error: "Không tìm thấy lịch giảng viên cần chỉnh sửa"
        });
    }

    const teacherEntry = validateTeacherSchedule(
        auth.db,
        req.body,
        req.params.id
    );

    if(teacherEntry.error){
        return res.status(
            teacherEntry.error.includes('trùng') ||
            teacherEntry.error.includes('đã') ? 409 : 400
        ).json(teacherEntry);
    }

    await database.updateTeacherSchedule(teacherEntry);

    res.json({
        message: "Đã cập nhật lịch giảng viên",
        entry: teacherEntry
    });
});

app.delete('/api/teacher-schedule/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const deleted = await database.deleteTeacherSchedule(req.params.id);

    if(!deleted){
        return res.status(404).json({
            error: "Không tìm thấy lịch giảng viên cần xóa"
        });
    }

    res.json({ message: "Đã xóa lịch giảng viên" });
});

app.get('/api/documents', async (req, res)=>{
    const auth = await requireAuth(req, res);
    if(!auth){
        return;
    }

    const status = String(req.query.status || '').trim();
    const filters = {
        q: req.query.q || '',
        subjectId: req.query.subjectId || '',
        teacherId: req.query.teacherId || ''
    };

    if(auth.role === 'admin'){
        if(status){
            filters.status = status;
        }
    }
    else{
        filters.visibleToStudentId = auth.userId;
    }

    const documents = await database.listStudyDocuments(filters);
    res.json({
        documents: documents.map(formatDocument)
    });
});

app.post('/api/documents', async (req, res)=>{
    const auth = await requireStudent(req, res);
    if(!auth){
        return;
    }

    try{
        const { fields, files } = await parseMultipartForm(req);
        const title = String(fields.title || '').trim();
        const description = String(fields.description || '').trim();
        const subjectId = String(fields.subjectId || '').trim();
        const teacherId = String(fields.teacherId || '').trim();
        const subject = (auth.db.subjects || [])
            .find(item => item.id === subjectId);
        const teacher = teacherId
            ? (auth.db.teachers || []).find(item => item.id === teacherId)
            : null;
        const file = files.file;

        if(!title){
            return res.status(400).json({
                error: "Vui lòng nhập tiêu đề tài liệu"
            });
        }

        if(!subject){
            return res.status(400).json({
                error: "Môn học phải được chọn từ danh sách môn học"
            });
        }

        if(teacherId && !teacher){
            return res.status(400).json({
                error: "Giảng viên không hợp lệ"
            });
        }

        if(!file || !file.originalName || file.size === 0){
            return res.status(400).json({
                error: "Vui lòng chọn file tài liệu"
            });
        }

        if(file.size > MAX_DOCUMENT_SIZE){
            return res.status(413).json({
                error: "File tài liệu tối đa 25MB"
            });
        }

        if(!isAllowedDocument(file.originalName)){
            return res.status(400).json({
                error: "Định dạng file chưa được hỗ trợ"
            });
        }

        ensureUploadDir();
        const id = crypto.randomUUID();
        const extension = path.extname(file.originalName).toLowerCase();
        const storedName = `${id}${extension}`;

        await fs.promises.writeFile(
            path.join(UPLOAD_DIR, storedName),
            file.buffer
        );

        await database.insertStudyDocument({
            id,
            title,
            description,
            subjectId: subject.id,
            teacherId: teacher ? teacher.id : null,
            uploadedBy: auth.userId,
            originalName: file.originalName,
            storedName,
            mimeType: file.mimeType,
            fileSize: file.size,
            status: 'pending'
        });

        const document = await database.findStudyDocument(id);

        res.json({
            message: "Đã gửi tài liệu, vui lòng chờ admin duyệt",
            document: formatDocument(document)
        });
    }
    catch(error){
        if(error.message === 'FILE_TOO_LARGE'){
            return res.status(413).json({
                error: "File tài liệu tối đa 25MB"
            });
        }

        return res.status(400).json({
            error: error.message || "Không đọc được file upload"
        });
    }
});

app.put('/api/documents/:id/status', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const status = String(req.body.status || '').trim();
    const reason = String(req.body.reason || '').trim();

    if(!['pending', 'approved', 'rejected'].includes(status)){
        return res.status(400).json({
            error: "Trạng thái tài liệu không hợp lệ"
        });
    }

    const updated = await database.updateStudyDocumentStatus(
        req.params.id,
        status,
        auth.userId,
        reason
    );

    if(!updated){
        return res.status(404).json({
            error: "Không tìm thấy tài liệu"
        });
    }

    const document = await database.findStudyDocument(req.params.id);
    res.json({
        message: status === 'approved'
            ? "Đã duyệt tài liệu"
            : status === 'rejected'
                ? "Đã từ chối tài liệu"
                : "Đã đưa tài liệu về trạng thái chờ duyệt",
        document: formatDocument(document)
    });
});

app.delete('/api/documents/:id', async (req, res)=>{
    const auth = await requireAdmin(req, res);
    if(!auth){
        return;
    }

    const deleted = await database.deleteStudyDocument(req.params.id);

    if(!deleted){
        return res.status(404).json({
            error: "Không tìm thấy tài liệu"
        });
    }

    await fs.promises.unlink(path.join(UPLOAD_DIR, deleted.stored_name))
        .catch(() => {});

    res.json({ message: "Đã xóa tài liệu" });
});

async function sendDocumentFile(req, res, disposition){
    const auth = await requireAuth(req, res);
    if(!auth){
        return;
    }

    const document = await database.findStudyDocument(req.params.id);

    if(!document){
        return res.status(404).json({
            error: "Không tìm thấy tài liệu"
        });
    }

    if(!canAccessDocument(auth, document)){
        return res.status(403).json({
            error: "Tài liệu chưa được duyệt"
        });
    }

    const filePath = path.join(UPLOAD_DIR, document.storedName);

    if(!fs.existsSync(filePath)){
        return res.status(404).json({
            error: "File tài liệu không còn tồn tại"
        });
    }

    if(disposition === 'attachment'){
        res.setHeader('Content-Type', document.mimeType);
        return res.download(filePath, document.originalName);
    }

    if(!canOpenDocumentDirectly(document.originalName)){
        return res.status(409).json({
            error: "Tài liệu này chưa hỗ trợ mở trực tiếp, vui lòng tải file về để xem"
        });
    }

    res.setHeader(
        'Content-Type',
        inferOpenMime(document.originalName, document.mimeType)
    );
    res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(document.originalName)}"`
    );
    return res.sendFile(filePath);
}

app.get('/api/documents/:id/download', async (req, res)=>{
    await sendDocumentFile(req, res, 'attachment');
});

app.get('/api/documents/:id/view', async (req, res)=>{
    await sendDocumentFile(req, res, 'inline');
});

async function start(){
    await database.initializeDatabase({
        adminUsername: ADMIN_USERNAME,
        adminPassword: ADMIN_PASSWORD
    });

    return app.listen(PORT, '0.0.0.0', ()=>{
        console.log(`Server running on port ${PORT}`);
    });
}

if(require.main === module){
    start().catch(error => {
        console.error('Unable to start CTU Map:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    app,
    start
};
