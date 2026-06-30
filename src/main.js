// src/main.js
// Điểm khởi chạy (Entry point) - quản lý UI, điều hướng, vòng lặp chính, tấn công, HP và bản đồ động

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

import { buildSpatialGrid, queryNearbyMeshes } from './core/spatial.js';
import { keys, look, nitro, initInput, destroyInput, isMobileDevice, addRemoteChatMessage } from './core/input.js';
import {
    GRAVITY, JUMP_FORCE, PLAYER_RADIUS, SPAWN_POINTS,
    applyGravity, checkWallCollisions, checkHeadBlocked
} from './core/physics.js';
import {
    randomRoomId, createRoom, joinRoom, listenRoom, unlistenRoom,
    startGame, leaveRoom, syncPosition, syncHP, syncFinish, updateRoomMap, NETWORK_SYNC_INTERVAL,
    watchAndDeleteEmptyRoom, listenPlayerSync, unlistenPlayerSync,
    listenWinner, unlistenWinner, sendChatMessage, listenChatMessages, unlistenChatMessages
} from './core/network.js';
import {
    initPlayers, getMySphere, getOtherSphere,
    playAnimation, updatePlayerAnimations, getPlayerHalfWidth,
    updateHeadLook, getAnimDurationMs, setMyIndex, getPlayerCurrentAnim, ANIM,
    applyRemotePlayerSync, updateWheelRotation, resetWheelAngles,
    playerHPs, playerMaxHPs, playerInvulnerables, takeDamage, respawnPlayer, getVehicleConfig,
    updateSoundListener, playSpatialSound, playUiSound, updateLoopSounds, stopAllLoopSounds
} from './player/playerManager.js';
import { initDustSystem, updateDustSystem, disposeDustSystem } from './fx/dustSystem.js';
import { VEHICLES_CONFIG } from './config/vehicles.js';
import { MAPS_CONFIG } from './config/maps.js';

// ===== State =====
let currentRoom = null;
let currentName = null;
let isHost = false;
let isGameStarted = false;
let currentRoomData = null;
let mySlotKey = null;

// Avatar & Vehicle selection
const AVATARS = [
    'bat.ico', 'bear.ico', 'candy_cat.ico', 'cherry_Bunny.ico',
    'crystal_crocodile.ico', 'crystal_golem.ico', 'fire_owl.ico',
    'galaxy_cat_jellyfish.ico', 'griffin_lion.ico', 'mushroom.ico',
    'peach_dino.ico', 'phoenix.ico', 'sheep_moon.ico',
    'slime_cactus.ico', 'star_cat.ico', 'storm_cloud.ico'
];
let currentAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
let currentVehicle = 'xelan';
let _selectedSinglePlayerMapId = 'hongkong_city';

// Race state
let _raceFinishedRef = { value: false };
let isFlying = false;
let verticalVelocity = 0;
let isGrounded = false;

let mainCamera;
let collidableMeshes = [];
let lodObjects = [];

// Dynamic Checkpoint System
let mapConfig = MAPS_CONFIG.hongkong_city;
let checkpoints = [];
let currentCheckpointIdx = 0;
let lastPassedCheckpointIdx = -1;
let activeRing = null;
let activeRingParts = null;

// ===== Theo dõi scene/renderer của phiên chơi hiện tại =====
// Dùng để dọn dẹp TOÀN BỘ dữ liệu cũ (scene, renderer, vòng lặp animate, mesh va chạm...)
// trước khi nạp dữ liệu của map mới, tránh tình trạng dữ liệu 2 map bị trồng chéo lên nhau.
let currentScene = null;
let currentRenderer = null;
let currentAnimationFrameId = null;
let gameSessionId = 0;

// Attack cooldown
let lastAttackTime = 0;
let _prevAttackKey = false;

// ===== DOM references =====
const lobby          = document.getElementById('lobby');
const room           = document.getElementById('room');
const roomIdText     = document.getElementById('roomIdText');
const bottomRow      = document.getElementById('bottomRow');
const guestWrapper   = document.getElementById('guestWrapper');
const waitingText    = document.getElementById('waitingText');
const startBtn       = document.getElementById('startBtn');
const leaveBtn       = document.getElementById('leaveBtn');
const exitGameBtn    = document.getElementById('exitGameBtn');
const labelsContainer= document.getElementById('labelsContainer');
const customDialog   = document.getElementById('customDialog');
const dialogMessage  = document.getElementById('dialogMessage');
const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');
const copyRoomIdBtn  = document.getElementById('copyRoomIdBtn');
const playerNameEl   = document.getElementById('playerName');
const createBtn      = document.getElementById('createBtn');
const joinBtn        = document.getElementById('joinBtn');
const testBtn        = document.getElementById('testBtn');

// Modals
const avatarModal = document.getElementById('avatarModal');
const closeAvatarModalBtn = document.getElementById('closeAvatarModalBtn');
const avatarGrid = document.getElementById('avatarGrid');

const vehicleModal = document.getElementById('vehicleModal');
const closeVehicleModalBtn = document.getElementById('closeVehicleModalBtn');
const vehicleGrid = document.getElementById('vehicleGrid');

const mapModal = document.getElementById('mapModal');
const closeMapModalBtn = document.getElementById('closeMapModalBtn');
const mapGrid = document.getElementById('mapGrid');
const singlePlayerMapBtn = document.getElementById('singlePlayerMapBtn');
const singlePlayerMapIcon = document.getElementById('singlePlayerMapIcon');

const roomMapDropdown = document.getElementById('roomMapDropdown');
const roomMapDropdownSelected = document.getElementById('roomMapDropdownSelected');
const roomMapDropdownIcon = document.getElementById('roomMapDropdownIcon');
const roomMapDropdownLabel = document.getElementById('roomMapDropdownLabel');
const roomMapDropdownList = document.getElementById('roomMapDropdownList');

const lobbyAvatar = document.getElementById('lobbyAvatar');
const lobbyVehicle = document.getElementById('lobbyVehicle');
const lobbyVehicleIcon = document.getElementById('lobbyVehicleIcon');
const lobbyVehicleName = document.getElementById('lobbyVehicleName');
const lobbyVehicleStats = document.getElementById('lobbyVehicleStats');

// ===== Mobile Setup =====
if (isMobileDevice()) {
    document.body.classList.add('is-mobile');
}

// ===== UI helpers =====
function showPopup(msg) {
    if (dialogMessage) dialogMessage.textContent = msg;
    if (customDialog) customDialog.classList.remove('hidden');
}

if (dialogConfirmBtn) {
    dialogConfirmBtn.onclick = () => {
        if (customDialog) customDialog.classList.add('hidden');
        try { document.exitPointerLock?.(); } catch(e) {}
        showLobby();
    };
}

// Cấu hình hiển thị chỉ số dạng thanh "lollipop" (chấm + thanh dài tỉ lệ giá trị)
const STAT_BAR_DEFS = [
    { key: 'hp',     label: 'HP',     color: '#ff4d6d', max: 150 },
    { key: 'speed',  label: 'Speed',  color: '#00b7ff', max: 0.5 },
    { key: 'damage', label: 'Dmg',    color: '#ffaa00', max: 40 },
    { key: 'dodge',  label: 'Né',    color: '#00ff88', max: 3.0 }
];

function getVehicleStatValues(vConfig) {
    const hs = vConfig.hitboxSize;
    const dodge = hs ? (hs.x * hs.y) : 1;
    // Né tránh: hitbox càng nhỏ thì né càng tốt -> đảo ngược lại để thanh dài = né tốt
    const dodgeScore = Math.max(0.1, 3.2 - dodge);
    return {
        hp: vConfig.hp,
        speed: vConfig.maxSpeed,
        damage: vConfig.damage,
        dodge: dodgeScore
    };
}

/** Tạo HTML các thanh chỉ số kiểu chấm tròn + thanh dài (xem ảnh mẫu) */
function buildStatBarsHTML(vConfig) {
    const values = getVehicleStatValues(vConfig);
    return STAT_BAR_DEFS.map(def => {
        const raw = values[def.key] || 0;
        const pct = Math.max(6, Math.min(100, (raw / def.max) * 100));
        // Format numeric value: speed in km/h, hp/damage as integer, dodge as ratio
        let displayVal;
        if (def.key === 'speed') {
            displayVal = `${Math.round(raw * 100)} km/h`;
        } else if (def.key === 'dodge') {
            displayVal = raw.toFixed(1);
        } else {
            displayVal = Math.round(raw);
        }
        return `
            <div class="stat-bar-row">
                <span class="stat-bar-label">${def.label}</span>
                <div class="stat-bar-track">
                    <span class="stat-bar-dot" style="background:${def.color};color:${def.color};"></span>
                    <span class="stat-bar-fill" style="width:${pct}%;background:${def.color};"></span>
                </div>
                <span class="stat-bar-value" style="color:${def.color};">${displayVal}</span>
            </div>
        `;
    }).join('');
}

// Initial UI setup
function initLobbyUI() {
    // Set random avatar initially
    updateAvatarUI();
    updateVehicleUI();
    
    // Avatar modal trigger
    lobbyAvatar.onclick = () => {
        avatarGrid.innerHTML = '';
        AVATARS.forEach(av => {
            const item = document.createElement('div');
            item.className = 'avatar-grid-item';
            if (av === currentAvatar) item.classList.add('selected');
            item.style.backgroundImage = `url('assets/icons_pack/icons/${av}')`;
            item.onclick = () => {
                currentAvatar = av;
                updateAvatarUI();
                avatarModal.classList.add('hidden');
            };
            avatarGrid.appendChild(item);
        });
        avatarModal.classList.remove('hidden');
    };
    
    closeAvatarModalBtn.onclick = () => avatarModal.classList.add('hidden');
    
    // Vehicle modal trigger
    lobbyVehicle.onclick = () => {
        vehicleGrid.innerHTML = '';
        Object.values(VEHICLES_CONFIG).forEach(v => {
            const item = document.createElement('div');
            item.className = 'vehicle-grid-item';
            if (v.id === currentVehicle) item.classList.add('selected');
            
            item.innerHTML = `
                <div class="vehicle-icon-square">
                    <img src="${v.iconPath}" alt="${v.name}">
                </div>
                <div class="vehicle-info">
                    <span class="vehicle-name">${v.name}</span>
                    <div class="stat-bars">${buildStatBarsHTML(v)}</div>
                </div>
            `;
            item.onclick = () => {
                currentVehicle = v.id;
                updateVehicleUI();
                vehicleModal.classList.add('hidden');
            };
            vehicleGrid.appendChild(item);
        });
        vehicleModal.classList.remove('hidden');
    };
    
    closeVehicleModalBtn.onclick = () => vehicleModal.classList.add('hidden');

    // Map modal trigger (chơi đơn): bấm icon tròn để mở bảng chọn map
    if (singlePlayerMapBtn) {
        singlePlayerMapBtn.onclick = (e) => {
            e.stopPropagation();
            mapGrid.innerHTML = '';
            Object.values(MAPS_CONFIG).forEach(m => {
                const item = document.createElement('div');
                item.className = 'map-grid-item';
                if (m.id === _selectedSinglePlayerMapId) item.classList.add('selected');
                item.innerHTML = `
                    <img src="${m.iconPath}" alt="${m.name}" onerror="this.style.visibility='hidden'">
                    <span>${m.name}</span>
                `;
                item.onclick = () => {
                    _selectedSinglePlayerMapId = m.id;
                    updateSinglePlayerMapUI();
                    mapModal.classList.add('hidden');
                };
                mapGrid.appendChild(item);
            });
            mapModal.classList.remove('hidden');
        };
    }
    if (closeMapModalBtn) closeMapModalBtn.onclick = () => mapModal.classList.add('hidden');

    // Custom map dropdown (phòng chờ) - chỉ host mới mở/chọn được
    if (roomMapDropdownSelected) {
        roomMapDropdownSelected.onclick = () => {
            if (!isHost) return;
            roomMapDropdownList.classList.toggle('hidden');
        };
    }
    if (roomMapDropdownList) {
        roomMapDropdownList.querySelectorAll('.map-dropdown-item').forEach(item => {
            item.onclick = async () => {
                const mapId = item.dataset.mapId;
                roomMapDropdownList.classList.add('hidden');
                if (isHost && currentRoom) {
                    setRoomMapDropdownValue(mapId);
                    await updateRoomMap(currentRoom, mapId);
                }
            };
        });
    }
    document.addEventListener('click', (e) => {
        if (roomMapDropdown && !roomMapDropdown.contains(e.target)) {
            roomMapDropdownList?.classList.add('hidden');
        }
    });

    updateSinglePlayerMapUI();
}

function updateAvatarUI() {
    lobbyAvatar.style.backgroundImage = `url('assets/icons_pack/icons/${currentAvatar}')`;
}

function updateVehicleUI() {
    const vConfig = VEHICLES_CONFIG[currentVehicle];
    if (vConfig) {
        lobbyVehicleIcon.src = vConfig.iconPath;
        lobbyVehicleName.textContent = vConfig.name;
        if (lobbyVehicleStats) lobbyVehicleStats.innerHTML = buildStatBarsHTML(vConfig);
    }
}

function updateSinglePlayerMapUI() {
    const mapConfigSel = MAPS_CONFIG[_selectedSinglePlayerMapId];
    if (mapConfigSel && singlePlayerMapIcon) {
        singlePlayerMapIcon.src = mapConfigSel.iconPath;
        singlePlayerMapIcon.alt = mapConfigSel.name;
        if (singlePlayerMapBtn) singlePlayerMapBtn.title = `Bản đồ: ${mapConfigSel.name} (bấm để đổi)`;
    }
}

function setRoomMapDropdownValue(mapId) {
    const m = MAPS_CONFIG[mapId];
    if (!m || !roomMapDropdownLabel) return;
    roomMapDropdownLabel.textContent = m.name;
    roomMapDropdownLabel.dataset.mapId = mapId;
    if (roomMapDropdownIcon) roomMapDropdownIcon.src = m.iconPath;
    roomMapDropdownList?.querySelectorAll('.map-dropdown-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mapId === mapId);
    });
}

function showRoom() {
    if (lobby) lobby.classList.add('hidden');
    if (room) room.classList.remove('hidden');
    
    if (isHost) {
        if (bottomRow) bottomRow.style.justifyContent = 'space-between';
        if (guestWrapper) guestWrapper.classList.remove('guestControl');
        if (waitingText) waitingText.classList.add('hidden');
        if (startBtn) startBtn.classList.remove('hidden');
        roomMapDropdown?.classList.remove('disabled');
    } else {
        if (bottomRow) bottomRow.style.justifyContent = 'center';
        if (guestWrapper) guestWrapper.classList.add('guestControl');
        if (waitingText) waitingText.classList.remove('hidden');
        if (startBtn) startBtn.classList.add('hidden');
        roomMapDropdown?.classList.add('disabled');
    }
}

function showLobby() {
    if (room) room.classList.add('hidden');
    if (lobby) lobby.classList.remove('hidden');
    const mobileControls = document.getElementById('mobileControls');
    if (mobileControls) mobileControls.classList.add('hidden');
    const gameCanvas = document.getElementById('gameCanvas');
    const crosshair = document.getElementById('crosshair');
    const hud = document.getElementById('coordinatesHUD');
    if (gameCanvas) gameCanvas.classList.add('hidden');
    if (crosshair) crosshair.classList.add('hidden');
    if (hud) hud.classList.add('hidden');
    if (exitGameBtn) exitGameBtn.classList.add('hidden');
    
    const vitalsHUD = document.getElementById('vitalsHUD');
    if (vitalsHUD) vitalsHUD.remove();
    const compassHUD = document.getElementById('compassHUD');
    if (compassHUD) compassHUD.remove();
    
    const chatHint = document.getElementById('chatHint');
    if (chatHint) chatHint.classList.add('hidden');
    const chatCont = document.getElementById('chatContainer');
    if (chatCont) chatCont.remove();
    if (labelsContainer) labelsContainer.innerHTML = '';
    
    const winnerBoard = document.getElementById('winnerBoard');
    if (winnerBoard) winnerBoard.remove();

    // Dừng vòng lặp animate() + giải phóng scene/renderer/mesh va chạm của phiên chơi vừa thoát,
    // không đợi đến lần load map kế tiếp mới dọn (tránh render/tính vật lý ngầm khi đang ở sảnh).
    try { disposeGameEnvironment(); } catch(e) {}

    isGameStarted = false;
    isFlying = false;
    look.yaw = 0;
    look.pitch = -0.25;
    if (currentRoom) { try { unlistenRoom(currentRoom); } catch(e) {} }
    currentRoom = null;
    isHost = false;
}

function updateRoomUI(data) {
    currentRoomData = data;
    if (!data) {
        if (!isHost && currentRoom) showPopup('Chủ phòng đã thoát!.');
        return;
    }

    // Tìm slotKey của mình nếu chưa có
    if (!isHost && currentRoom && !mySlotKey) {
        if (data.players) {
            for (let i = 0; i < 6; i++) {
                if (data.players[`p${i}`] === currentName) {
                    mySlotKey = `p${i}`;
                    break;
                }
            }
        }
    }

    const myIndex = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
    setMyIndex(myIndex);

    // Đồng bộ lựa chọn bản đồ từ Host
    if (data.mapId && roomMapDropdownLabel && roomMapDropdownLabel.dataset.mapId !== data.mapId) {
        setRoomMapDropdownValue(data.mapId);
    }

    if (isGameStarted) return;

    // Cập nhật giao diện 6 slot người chơi
    const players = data.players || {};
    const playersInfo = data.playersInfo || {};
    let playerCount = 0;
    
    for (let i = 0; i < 6; i++) {
        const box = document.getElementById(`p${i}Box`);
        const nameEl = document.getElementById(`p${i}Name`);
        const avatarImg = document.getElementById(`p${i}Avatar`);
        const avatarPlaceholder = document.getElementById(`p${i}AvatarPlaceholder`);
        const vehicleTag = document.getElementById(`p${i}VehicleTag`);
        const vehicleIcon = document.getElementById(`p${i}VehicleIcon`);
        const vehicleName = document.getElementById(`p${i}VehicleName`);
        
        const name = players[`p${i}`];
        const info = playersInfo[`p${i}`];
        
        if (box && nameEl) {
            if (name) {
                nameEl.textContent = name;
                box.classList.add('active');
                playerCount++;
                
                // Hiển thị avatar và vehicle
                if (info) {
                    if (avatarImg && avatarPlaceholder) {
                        avatarImg.src = `assets/icons_pack/icons/${info.avatar}`;
                        avatarImg.style.display = 'block';
                        avatarPlaceholder.style.display = 'none';
                    }
                    if (vehicleTag && vehicleIcon && vehicleName) {
                        const vConfig = VEHICLES_CONFIG[info.vehicle] || VEHICLES_CONFIG.xelan;
                        vehicleIcon.src = vConfig.iconPath;
                        vehicleName.textContent = vConfig.name;
                        vehicleTag.style.display = 'flex';
                    }
                }
            } else {
                nameEl.textContent = 'Trống';
                box.classList.remove('active');
                if (avatarImg && avatarPlaceholder) {
                    avatarImg.style.display = 'none';
                    avatarPlaceholder.style.display = 'flex';
                }
                if (vehicleTag) {
                    vehicleTag.style.display = 'none';
                }
            }
        }
    }

    // Khóa hoặc mở nút bắt đầu game (tối thiểu 2 người chơi)
    if (isHost && startBtn) {
        if (playerCount >= 2) {
            startBtn.disabled = false;
            startBtn.classList.remove('disabled');
        } else {
            startBtn.disabled = true;
            startBtn.classList.add('disabled');
        }
    }

    if (data.gameState === 'playing') init3DEnvironment();
}

function requestMobileFullscreen() {
    if (isMobileDevice()) {
        try {
            const de = document.documentElement;
            if (de.requestFullscreen) {
                de.requestFullscreen().catch(() => {});
            } else if (de.webkitRequestFullscreen) {
                de.webkitRequestFullscreen();
            } else if (de.msRequestFullscreen) {
                de.msRequestFullscreen();
            }
        } catch(e) { console.warn('Fullscreen request failed:', e); }
    }
}

// ===== Room actions =====
if (createBtn) {
    createBtn.onclick = async () => {
        requestMobileFullscreen();
        try {
            currentName = playerNameEl?.value?.trim();
            if (!currentName) return showPopup('Vui lòng nhập tên!');
            currentRoom = randomRoomId();
            isHost = true;
            mySlotKey = 'p0';
            
            // Lấy spawn points mặc định của map Hồng Kông ban đầu
            const spawns = MAPS_CONFIG.hongkong_city.spawnPoints;
            await createRoom(currentRoom, currentName, spawns, currentAvatar, currentVehicle);
            if (roomIdText) roomIdText.textContent = currentRoom;
            showRoom();
            listenRoom(currentRoom, updateRoomUI);
            watchAndDeleteEmptyRoom(currentRoom, 120_000);
        } catch(e) { showPopup('Lỗi kết nối. Vui lòng thử lại.'); }
    };
}

if (joinBtn) {
    joinBtn.onclick = async () => {
        requestMobileFullscreen();
        try {
            currentName = playerNameEl?.value?.trim();
            const roomId = document.getElementById('roomId')?.value?.trim();
            if (!currentName) return showPopup('Vui lòng nhập tên!');
            if (!roomId) return showPopup('Chưa nhập ID phòng!');
            
            const result = await joinRoom(roomId, currentName, currentAvatar, currentVehicle);
            if (!result.success) return showPopup(result.error);
            currentRoom = roomId; isHost = false;
            mySlotKey = result.slotKey;
            if (roomIdText) roomIdText.textContent = currentRoom;
            showRoom();
            listenRoom(currentRoom, updateRoomUI);
        } catch(e) { showPopup('Lỗi kết nối. Vui lòng thử lại.'); }
    };
}

if (copyRoomIdBtn) {
    copyRoomIdBtn.onclick = async () => {
        if (!currentRoom) return;
        try { await navigator.clipboard.writeText(currentRoom); } catch(e) {
            try { const r = document.createRange(); r.selectNodeContents(roomIdText); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch(e2) {}
        }
        const orig = copyRoomIdBtn.textContent;
        copyRoomIdBtn.textContent = '✅';
        setTimeout(() => { copyRoomIdBtn.textContent = orig; }, 1200);
    };
}

if (testBtn) {
    testBtn.onclick = () => {
        requestMobileFullscreen();
        currentName = playerNameEl?.value?.trim() || 'Người chơi';
        currentRoom = null; isHost = true;
        mySlotKey = 'p0';
        
        // Chơi đơn: dùng bản đồ người chơi đã chọn qua nút icon tròn (mặc định nếu chưa chọn)
        const mapId = _selectedSinglePlayerMapId || 'hongkong_city';

        currentRoomData = { 
            host: currentName, 
            players: { p0: currentName }, 
            playersInfo: { p0: { name: currentName, avatar: currentAvatar, vehicle: currentVehicle } },
            mapId: mapId,
            gameState: 'playing' 
        };
        if (lobby) lobby.classList.add('hidden');
        init3DEnvironment();
    };
}

function cleanupSyncListeners() {
    if (currentRoom) {
        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        for (let i = 0; i < 6; i++) {
            if (i === myIdx) continue;
            try { unlistenPlayerSync(currentRoom, `p${i}`); } catch(e) {}
        }
        try { unlistenWinner(currentRoom); } catch(e) {}
        try { unlistenChatMessages(currentRoom); } catch(e) {}
    }
}

if (exitGameBtn) {
    exitGameBtn.onclick = async () => {
        cleanupSyncListeners();
        try { if (currentRoom) await leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {}
        destroyInput();
        try { disposeDustSystem(); } catch(e) {}
        try { stopAllLoopSounds(); } catch(e) {}
        try { document.exitPointerLock?.(); } catch(e) {}
        showLobby();
    };
}

if (leaveBtn) {
    leaveBtn.onclick = async () => {
        cleanupSyncListeners();
        try { if (currentRoom) await leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {}
        showLobby();
    };
}

if (startBtn) {
    startBtn.onclick = async () => {
        if (!isHost) return;
        const playerCount = currentRoomData ? Object.values(currentRoomData.players || {}).filter(Boolean).length : 0;
        if (playerCount < 2) {
            return showPopup('Cần tối thiểu 2 người chơi để bắt đầu game!');
        }
        try { 
            // Cập nhật vị trí xuất phát chính xác của map được chọn trước khi lưu gameState = "playing"
            const mapId = (currentRoomData && currentRoomData.mapId) || roomMapDropdownLabel?.dataset.mapId || 'hongkong_city';
            const spawns = MAPS_CONFIG[mapId].spawnPoints;
            
            import('./config/firebase.js').then(({ db }) => {
                import('firebase/database').then(({ ref, update }) => {
                    const roomRef = ref(db, `rooms/${currentRoom}`);
                    const updates = { gameState: "playing" };
                    for (let i = 0; i < 6; i++) {
                        updates[`p${i}Pos`] = spawns[i];
                    }
                    update(roomRef, updates);
                });
            });
        } catch(e) { showPopup('Lỗi, vui lòng thử lại.'); }
    };
}

window.addEventListener('beforeunload', () => { try { if (currentRoom) leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {} });

// ===== Dọn dẹp toàn bộ dữ liệu phiên chơi cũ (scene/renderer/mesh va chạm/checkpoint...) =====
// Gọi hàm này TRƯỚC khi nạp dữ liệu map mới để đảm bảo không còn sót lại bất kỳ dữ liệu
// nào của map trước đó (tránh hiện tượng 2 map bị trồng/chéo dữ liệu lên nhau khi người
// chơi thoát map này rồi vào map khác, hoặc đấu xong rồi chơi lại).
function disposeGameEnvironment() {
    // Vô hiệu hoá + dừng hẳn vòng lặp animate() của phiên chơi cũ (nếu còn đang chạy)
    gameSessionId++;
    if (currentAnimationFrameId !== null) {
        try { cancelAnimationFrame(currentAnimationFrameId); } catch(e) {}
        currentAnimationFrameId = null;
    }

    // Giải phóng geometry/material/texture của scene cũ
    if (currentScene) {
        try {
            currentScene.traverse((obj) => {
                try { if (obj.geometry) { obj.geometry.disposeBoundsTree?.(); obj.geometry.dispose(); } } catch(e) {}
                const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
                mats.forEach((mat) => {
                    try {
                        for (const key in mat) {
                            const val = mat[key];
                            if (val && val.isTexture) { try { val.dispose(); } catch(e2) {} }
                        }
                        mat.dispose();
                    } catch(e) {}
                });
            });
            if (currentScene.background && currentScene.background.isTexture) {
                try { currentScene.background.dispose(); } catch(e) {}
            }
            currentScene.clear();
        } catch(e) {}
    }
    currentScene = null;

    // Giải phóng renderer / WebGL context cũ
    if (currentRenderer) {
        try { currentRenderer.dispose(); } catch(e) {}
        try { currentRenderer.forceContextLoss(); } catch(e) {}
    }
    currentRenderer = null;

    // Xoá toàn bộ dữ liệu va chạm, checkpoint, ring của map cũ - không để dữ liệu của map cũ
    // bị cộng dồn/chồng chéo với map mới ở lần load tiếp theo.
    collidableMeshes.length = 0;
    lodObjects.length = 0;
    checkpoints = [];
    currentCheckpointIdx = 0;
    lastPassedCheckpointIdx = -1;
    activeRing = null;
    activeRingParts = null;

    try { disposeDustSystem(); } catch(e) {}
    try { stopAllLoopSounds(); } catch(e) {}
}

// ===== 3D Engine Init =====
function init3DEnvironment() {
    if (isGameStarted) return;
    isGameStarted = true;

    // Xoá toàn bộ dữ liệu cũ TRƯỚC khi nạp dữ liệu map mới (sửa lỗi 2 map trồng chéo dữ liệu)
    disposeGameEnvironment();
    const mySessionId = gameSessionId;

    if (room) room.classList.add('hidden');
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) loadingScreen.classList.remove('hidden');

    const canvas = document.getElementById('gameCanvas');
    const crosshair = document.getElementById('crosshair');
    const hud = document.getElementById('coordinatesHUD');
    if (!canvas) { console.error('Canvas Không tồn tại!'); return; }

    // ===== Scene =====
    const scene = new THREE.Scene();
    currentScene = scene;
    scene.fog = new THREE.FogExp2(0xcfe3f0, 0.0022);

    // ===== Loading Manager =====
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onProgress = (url, loaded, total) => {
        const pct = Math.floor((loaded / Math.max(total, 1)) * 100);
        const lt = document.getElementById('loadingText');
        const lb = document.getElementById('loadingBar');
        if (lt) lt.textContent = `Đang tải tài nguyên... ${pct}%`;
        if (lb) lb.style.width = `${pct}%`;
    };
    
    // Lấy thông tin map được chọn
    const selectedMapId = currentRoomData?.mapId || _selectedSinglePlayerMapId || 'hongkong_city';
    mapConfig = MAPS_CONFIG[selectedMapId] || MAPS_CONFIG.hongkong_city;
    checkpoints = mapConfig.checkpoints;
    currentCheckpointIdx = 0;
    lastPassedCheckpointIdx = -1;

    loadingManager.onLoad = () => {
        // Tắt frustum culling tạm thời để compile shaders
        const culledMeshes = [];
        try {
            scene.traverse((child) => {
                if (child.isMesh && child.frustumCulled) {
                    child.frustumCulled = false;
                    culledMeshes.push(child);
                }
            });
        } catch(e) {}

        try {
            if (renderer && scene && mainCamera) {
                renderer.compile(scene, mainCamera);
                renderer.render(scene, mainCamera);
            }
        } catch(e) {}

        try {
            culledMeshes.forEach(mesh => { mesh.frustumCulled = true; });
        } catch(e) {}

        const startLocalScene = () => {
            setTimeout(() => {
                if (loadingScreen) loadingScreen.classList.add('hidden');
                if (canvas) canvas.classList.remove('hidden');
                if (crosshair) crosshair.classList.remove('hidden');
                // coordinatesHUD chỉ hiện qua lệnh chat "/show on", không tự hiện ở đây
                if (exitGameBtn) exitGameBtn.classList.remove('hidden');
                
                const mobileControls = document.getElementById('mobileControls');
                const isMobile = isMobileDevice();
                if (isMobile && mobileControls) {
                    mobileControls.classList.remove('hidden');
                }
                if (!isMobile) {
                    try { canvas.requestPointerLock(); } catch(e) {}
                }
                startCutscene(performance.now());
            }, 250);
        };

        if (currentRoom) {
            const lt = document.getElementById('loadingText');
            if (lt) lt.textContent = `Đã tải xong! Đang đợi người chơi khác...`;
            
            const mySlot = isHost ? 'p0' : mySlotKey;
            
            import('./config/firebase.js').then(({ db }) => {
                import('firebase/database').then(({ ref, update, onValue, off }) => {
                    const loadedRef = ref(db, `rooms/${currentRoom}/loaded`);
                    update(loadedRef, { [mySlot]: true });
                    
                    const roomRef = ref(db, `rooms/${currentRoom}`);
                    onValue(roomRef, (snapshot) => {
                        const data = snapshot.val();
                        if (!data) return;
                        
                        const players = data.players || {};
                        const loaded = data.loaded || {};
                        const activeSlots = Object.keys(players).filter(k => players[k]);
                        const allLoaded = activeSlots.every(slot => loaded[slot] === true);
                        
                        if (allLoaded) {
                            off(roomRef);
                            startLocalScene();
                        }
                    });
                });
            }).catch(e => {
                startLocalScene();
            });
        } else {
            startLocalScene();
        }
    };

    // ===== Skybox (đọc từ map config) =====
    try {
        const cubeLoader = new THREE.CubeTextureLoader(loadingManager);
        const cubemapFaces = mapConfig.cubemap || [
            'assets/cubemap/Pack1/cubemap_right.jpg',
            'assets/cubemap/Pack1/cubemap_left.jpg',
            'assets/cubemap/Pack1/cubemap_top.jpg',
            'assets/cubemap/Pack1/cubemap_bottom.jpg',
            'assets/cubemap/Pack1/cubemap_front.jpg',
            'assets/cubemap/Pack1/cubemap_back.jpg'
        ];
        scene.background = cubeLoader.load(cubemapFaces);
    } catch(e) { scene.background = new THREE.Color(0xcfe3f0); }

    // ===== Lights =====
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(50, 150, 50);
    scene.add(dirLight);

    // ===== Camera =====
    mainCamera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1100);

    // ===== Renderer =====
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    } catch(e) {
        showPopup('Trình duyệt không hỗ trợ WebGL.'); return;
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    currentRenderer = renderer;

    // ===== Load Map =====
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load(mapConfig.modelPath, (gltf) => {
        try {
            const model = gltf.scene;
            scene.add(model);
            model.traverse((child) => {
                if (!child.isMesh) return;
                const applyMat = (mat) => {
                    if (!mat) return;
                    mat.depthTest = true;
                    const isTrans = mat.transparent === true;
                    const hasAlphaMap = !!mat.alphaMap;
                    const hasAlphaTest = mat.alphaTest > 0;
                    const hasPartialOp = mat.opacity < 0.99;
                    const wasDouble = mat.side === THREE.DoubleSide;
                    if (mat.emissiveIntensity > 0 && mat.emissive && !mat.emissive.equals(new THREE.Color(0,0,0))) {
                        mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.0);
                    }
                    if (isTrans && hasPartialOp && !hasAlphaMap && !hasAlphaTest) {
                        mat.transparent = true; mat.depthWrite = false;
                        mat.side = THREE.DoubleSide;
                        mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
                    } else if (isTrans || hasAlphaMap || hasAlphaTest) {
                        mat.transparent = false;
                        mat.alphaTest = mat.alphaTest > 0 ? mat.alphaTest : 0.5;
                        mat.depthWrite = true;
                        mat.side = wasDouble ? THREE.DoubleSide : THREE.FrontSide;
                    } else {
                        mat.transparent = false; mat.depthWrite = true;
                    }
                    if (mat.map) {
                        mat.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
                        mat.map.minFilter = THREE.LinearMipmapLinearFilter;
                    }
                    mat.needsUpdate = true;
                };
                if (Array.isArray(child.material)) child.material.forEach(applyMat);
                else applyMat(child.material);
                child.matrixAutoUpdate = false;
                child.updateMatrix();
                try { child.geometry.computeBoundsTree(); } catch(e) {}
                try { if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere(); } catch(e) {}
                collidableMeshes.push(child);
            });
            model.updateMatrixWorld(true);
            buildSpatialGrid(collidableMeshes);
        } catch(e) { console.error('Loi xu ly model map:', e); }
    }, undefined, (e) => { console.error('Loi tai map:', e); });

    // ===== Players =====
    initPlayers(scene, currentRoomData, labelsContainer, loadingManager);

    // ===== Dust / Smoke Particle System =====
    try {
        const smokeTexture = new THREE.TextureLoader().load('assets/fx/better_smoke.png');
        initDustSystem(scene, smokeTexture);
    } catch(e) { console.warn('[Dust] init failed:', e); }
    
    // ===== Sync Listeners for other players =====
    if (currentRoom) {
        try { unlistenRoom(currentRoom); } catch(e) {}

        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        const players = currentRoomData?.players || {};

        for (let i = 0; i < 6; i++) {
            if (i === myIdx) continue;
            const slotKey = `p${i}`;
            const name = players[slotKey];
            if (name) {
                listenPlayerSync(currentRoom, slotKey, (syncData) => {
                    try {
                        applyRemotePlayerSync(i, syncData, name);
                    } catch(e) {}
                });
            }
        }

        // Lắng nghe HP của các đối thủ từ xa
        import('./config/firebase.js').then(({ db }) => {
            import('firebase/database').then(({ ref, onValue }) => {
                onValue(ref(db, `rooms/${currentRoom}/playersHP`), (snapshot) => {
                    const hps = snapshot.val();
                    if (hps) {
                        for (let i = 0; i < 6; i++) {
                            if (i !== myIdx && hps[`p${i}`] !== undefined) {
                                playerHPs[i] = hps[`p${i}`];
                            }
                        }
                    }
                });
            });
        });
    }

    scene.add(mainCamera);

    // ===== Fly Toggle (ho tro "/fly on" | "/fly off" | toggle khi khong co tham so) =====
    function onFlyToggle(turnOn) {
        isFlying = (typeof turnOn === 'boolean') ? turnOn : !isFlying;
        verticalVelocity = 0; isGrounded = false;
        const statusHUD = document.getElementById('flyStatus');
        if (statusHUD) {
            statusHUD.textContent = isFlying ? 'Chế độ: bay tự do' : 'Chế độ: đi bộ';
            statusHUD.style.color = isFlying ? '#00ff88' : '#ff3366';
        }
    }

    // ===== Show HUD Toggle ("/show on" | "/show off") - chi hien toa do + che do khi duoc yeu cau =====
    function onShowToggle(isOn) {
        const hudEl = document.getElementById('coordinatesHUD');
        if (hudEl) hudEl.classList.toggle('hidden', !isOn);
    }

    // ===== Network chat: gửi tin nhắn broadcast (chỉ cho tin KHÔNG có prefix "/") =====
    function onNetworkChatSend(text) {
        if (currentRoom) {
            try { sendChatMessage(currentRoom, currentName, text, mySlotKey); } catch(e) {}
        }
    }

    // ===== Input =====
    try {
        initInput(canvas, {
            onFlyToggle,
            onShowToggle,
            onNetworkChatSend,
            senderName: currentName,
            isCutscene: () => isCutscene || isCheckpointCam || isCountdownActive
        });
    } catch(e) { console.error('Loi input:', e); }

    // Lắng nghe tin nhắn chat broadcast từ người chơi khác trong phòng
    if (currentRoom) {
        try {
            listenChatMessages(currentRoom, (msg) => {
                if (!msg || msg.slot === mySlotKey) return; // tin của chính mình đã hiện local lúc gửi
                addRemoteChatMessage(msg.name, msg.text);
            });
        } catch(e) {}
    }

    // ===== Cutscene =====
    const DN_YAW   = -Math.PI * 0.75; // Đông Nam direction
    const DN_PITCH = -0.08;
    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

    // Bảng quy đổi hướng la bàn -> vector hướng nhìn trong thế giới 3D.
    // Đồng bộ với thanh la bàn HUD: yaw = 0 => hướng N, yaw quay theo chiều
    // -compass (xem updateCompass). Dùng cho lookAt dạng "viewpoint" trong cutscene.
    const VIEWPOINT_COMPASS_DEG = { N:0, NE:45, E:90, SE:135, S:180, SW:225, W:270, NW:315 };
    function getViewpointDirection(viewpoint, camPos, mySpherePos) {
        if (viewpoint === 'player') {
            if (!mySpherePos) return new THREE.Vector3(0, 0, -1);
            return new THREE.Vector3().subVectors(mySpherePos, camPos).normalize();
        }
        const deg = VIEWPOINT_COMPASS_DEG[viewpoint] ?? 0;
        const rad = deg * Math.PI / 180;
        return new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad)).normalize();
    }

    // Nội suy điểm "nhìn vào" (lookAt) của 1 đoạn cutscene. Hỗ trợ 2 dạng:
    //  - Điểm cố định: { x, y, z } -> camera luôn ghim nhìn vào điểm này suốt đoạn.
    //  - Dãy waypoint hướng nhìn: [{ viewpoint: 'E' }, { viewpoint: 'player' }, ...] -> camera
    //    xoay mượt (slerp) từ hướng nhìn này sang hướng kế tiếp theo tiến trình t (0..1) của đoạn.
    //    Có thể trộn lẫn waypoint dạng { x, y, z } (điểm cố định) với { viewpoint } trong cùng 1 dãy.
    const _lookQuatA = new THREE.Quaternion();
    const _lookQuatB = new THREE.Quaternion();
    const _lookQuatT = new THREE.Quaternion();
    const _lookFwdAxis = new THREE.Vector3(0, 0, -1);
    function resolveCutsceneLookAt(lookAtSpec, t, camPos, mySpherePos) {
        if (!lookAtSpec) return null;
        if (!Array.isArray(lookAtSpec)) {
            return new THREE.Vector3(lookAtSpec.x, lookAtSpec.y, lookAtSpec.z);
        }
        const n = lookAtSpec.length;
        if (n === 0) return null;

        const dirOf = (wp) => wp.viewpoint
            ? getViewpointDirection(wp.viewpoint, camPos, mySpherePos)
            : new THREE.Vector3().subVectors(new THREE.Vector3(wp.x, wp.y, wp.z), camPos).normalize();

        if (n === 1) return camPos.clone().add(dirOf(lookAtSpec[0]));

        const segLen = 1 / (n - 1);
        const idx = Math.min(n - 2, Math.floor(t / segLen));
        const localT = Math.min(1, Math.max(0, (t - idx * segLen) / segLen));

        _lookQuatA.setFromUnitVectors(_lookFwdAxis, dirOf(lookAtSpec[idx]));
        _lookQuatB.setFromUnitVectors(_lookFwdAxis, dirOf(lookAtSpec[idx + 1]));
        _lookQuatT.copy(_lookQuatA).slerp(_lookQuatB, easeInOut(localT));

        return camPos.clone().add(_lookFwdAxis.clone().applyQuaternion(_lookQuatT));
    }

    let isCountdownActive = false;
    let countdownNumber = 3;

    function triggerStartCountdown() {
        isCountdownActive = true;
        countdownNumber = 3;
        
        const overlay = document.getElementById('countdownOverlay');
        const numEl = document.getElementById('countdownNumber');
        if (overlay) overlay.classList.remove('hidden');
        
        const setNumber = (num, color, shadowColor) => {
            if (!numEl) return;
            numEl.textContent = num;
            numEl.style.color = color;
            numEl.style.textShadow = `0 0 40px ${shadowColor}`;
            numEl.classList.remove('count-animate');
            void numEl.offsetWidth; // trigger reflow
            numEl.classList.add('count-animate');
        };
        
        setNumber('3', '#ff007f', 'rgba(255, 0, 127, 0.6)');
        try { playUiSound('assets/sounds/beep1.ogg', 0.8); } catch(e) {}
        
        const interval = setInterval(() => {
            countdownNumber--;
            if (countdownNumber === 2) {
                setNumber('2', '#00b7ff', 'rgba(0, 183, 255, 0.6)');
                try { playUiSound('assets/sounds/beep1.ogg', 0.8); } catch(e) {}
            } else if (countdownNumber === 1) {
                setNumber('1', '#00ff88', 'rgba(0, 255, 136, 0.6)');
                try { playUiSound('assets/sounds/beep1.ogg', 0.8); } catch(e) {}
            } else if (countdownNumber === 0) {
                setNumber('GO!', '#00ff88', 'rgba(0, 255, 136, 0.8)');
                try { playUiSound('assets/sounds/beep2.ogg', 1.0); } catch(e) {}
                isCountdownActive = false; // Bắt đầu di chuyển
            } else {
                clearInterval(interval);
                if (overlay) overlay.classList.add('hidden');
            }
        }, 1000);
    }

    let isCutscene = true, cutsceneStarted = false;
    let cutsceneStartTime = 0;
    const _csLookTarget = new THREE.Vector3();

    // Trạng thái "chốt" góc nhìn người chơi (look.yaw/pitch) về DN_YAW/DN_PITCH, được thực hiện
    // ngầm trong suốt ĐOẠN CUỐI CÙNG của cutscene - thay thế hoàn toàn cho postCutscene cũ.
    // Nhờ vậy khi cutscene kết thúc, camera gameplay (bám sau lưng player) tiếp nối ngay, mượt mà.
    let _settleStarted = false;
    let _settleFromYaw = 0, _settleFromPitch = 0;

    // Hàm nội suy Bezier bậc 2 (3 điểm điều khiển P0, P1, P2)
    function cubicBezier(p0, p1, p2, t) {
        const mt = 1 - t;
        return new THREE.Vector3(
            mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x,
            mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y,
            mt*mt*p0.z + 2*mt*t*p1.z + t*t*p2.z
        );
    }

    function startCutscene(nowMs) {
        cutsceneStartTime = nowMs;
        cutsceneStarted = true;
        isCutscene = true;
        _settleStarted = false;
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            const mySph = getMySphere(myIdx);
            if (mySph) { mySph.rotation.y = DN_YAW; }
            bodyYaw = DN_YAW;
            look.yaw = DN_YAW; look.pitch = DN_PITCH;
            
            for (let i = 0; i < 6; i++) {
                const sph = getMySphere(i);
                if (sph && i !== myIdx) {
                    sph.rotation.y = DN_YAW;
                }
                playAnimation(i, ANIM.IDLE, 0);
            }
        } catch(e) {}
    }

    function updateCutsceneCamera(nowMs) {
        if (!cutsceneStarted) return;
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            playAnimation(myIdx, ANIM.IDLE, 0.3);
        } catch(e) {}

        const elapsed = nowMs - cutsceneStartTime;

        // Tổng thời lượng các phân đoạn cutscene
        const segments = mapConfig.cutscene.segments;
        let totalDuration = 0;
        segments.forEach(s => totalDuration += s.duration);

        let mySph = null;
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            mySph = getMySphere(myIdx);
        } catch(e) {}

        if (elapsed >= totalDuration) {
            // ===== Kết thúc toàn bộ cutscene: chốt thẳng góc nhìn gameplay rồi đếm ngược =====
            isCutscene = false;
            try {
                resetWheelAngles();
                look.yaw   = DN_YAW;
                look.pitch = DN_PITCH;
                bodyYaw    = DN_YAW;
                if (mySph) mySph.rotation.y = DN_YAW;
            } catch(e) {}
            triggerStartCountdown();
            return;
        }

        // Tìm phân đoạn hiện tại
        let accumTime = 0;
        let currentSegment = null;
        let segmentIdx = -1;
        let segmentElapsed = 0;

        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            if (elapsed >= accumTime && elapsed < accumTime + s.duration) {
                currentSegment = s;
                segmentIdx = i;
                segmentElapsed = elapsed - accumTime;
                break;
            }
            accumTime += s.duration;
        }
        if (!currentSegment) return;

        const isLastSegment = segmentIdx === segments.length - 1;
        const t = Math.min(segmentElapsed / currentSegment.duration, 1);

        // ===== Đoạn cuối cùng: ngầm chốt dần look.yaw/pitch/bodyYaw về DN_YAW/DN_PITCH =====
        // Bắt đầu ngay khi vào đoạn cuối, hoàn tất đúng lúc đoạn cuối kết thúc -> không cần
        // postCutscene riêng, camera gameplay nhận lại điều khiển ngay mà không bị giật/snap.
        if (isLastSegment) {
            if (!_settleStarted) {
                _settleStarted = true;
                try {
                    if (mySph) {
                        const toPlayer = new THREE.Vector3().subVectors(mySph.position, mainCamera.position).normalize();
                        _settleFromYaw   = Math.atan2(toPlayer.x, toPlayer.z);
                        _settleFromPitch = Math.asin(Math.max(-1, Math.min(1, toPlayer.y)));
                    } else {
                        _settleFromYaw = 0; _settleFromPitch = 0;
                    }
                } catch(e) { _settleFromYaw = 0; _settleFromPitch = 0; }
            }
            const te = easeInOut(t);
            let dyaw = DN_YAW - _settleFromYaw;
            while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            look.yaw   = _settleFromYaw   + dyaw * te;
            look.pitch = _settleFromPitch + (DN_PITCH - _settleFromPitch) * te;
            bodyYaw    = look.yaw;
            try { if (mySph) mySph.rotation.y = bodyYaw; } catch(e) {}
        }

        if (currentSegment.type === 'rotation') {
            const r = currentSegment.rotation;
            const angle = r.yawStart + t * (r.yawEnd - r.yawStart);
            mainCamera.position.copy(currentSegment.position);
            const h = r.radius * Math.cos(r.pitch);
            _csLookTarget.set(
                currentSegment.position.x + Math.sin(angle) * h,
                currentSegment.position.y + r.radius * Math.sin(r.pitch),
                currentSegment.position.z + Math.cos(angle) * h
            );
            mainCamera.lookAt(_csLookTarget);
        } else if (currentSegment.type === 'bezier') {
            const pts = currentSegment.points;
            mainCamera.position.copy(cubicBezier(pts[0], pts[1], pts[2], t));
            const target = resolveCutsceneLookAt(currentSegment.lookAt, t, mainCamera.position, mySph ? mySph.position : null);
            if (target) mainCamera.lookAt(target);
        } else if (currentSegment.type === 'linear') {
            const pStart = currentSegment.points[0];
            const pEnd = currentSegment.points[1];
            mainCamera.position.lerpVectors(pStart, pEnd, t);
            const target = resolveCutsceneLookAt(currentSegment.lookAt, t, mainCamera.position, mySph ? mySph.position : null);
            if (target) mainCamera.lookAt(target);
        }
    }

    // ===== CHECKPOINT CAM =====
    let isCheckpointCam        = false;
    let cpCamStartTime         = 0;
    const CP_CAM_DURATION      = 1500;
    let _cpCamFromPos          = new THREE.Vector3();
    let _cpCamFromYaw          = 0;
    let _cpCamFromPitch        = 0;
    let _cpCamToYaw            = 0;
    let _cpCamToPitch          = 0;

    function startCheckpointCam(nowMs) {
        isCheckpointCam   = true;
        cpCamStartTime    = nowMs;
        _cpCamFromPos.copy(mainCamera.position);
        _cpCamFromYaw   = look.yaw;
        _cpCamFromPitch = look.pitch;
        
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            const mySph = getMySphere(myIdx);
            if (mySph && currentCheckpointIdx < checkpoints.length) {
                const nextCP = checkpoints[currentCheckpointIdx];
                const toNext = new THREE.Vector3().subVectors(nextCP, mySph.position).normalize();
                _cpCamToYaw   = Math.atan2(-toNext.x, -toNext.z);
                _cpCamToPitch = -Math.asin(Math.max(-1, Math.min(1, toNext.y)));
            }
        } catch(e) {}
    }

    function updateCheckpointCam(nowMs) {
        if (!isCheckpointCam) return;

        let mySph;
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            mySph = getMySphere(myIdx);
        } catch(e) { return; }
        if (!mySph) return;

        const elapsed = nowMs - cpCamStartTime;
        const t       = Math.min(elapsed / CP_CAM_DURATION, 1);
        const te      = easeInOut(t);

        let dyaw = _cpCamToYaw - _cpCamFromYaw;
        while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const curYaw   = _cpCamFromYaw   + dyaw * te;
        const curPitch = _cpCamFromPitch + (_cpCamToPitch - _cpCamFromPitch) * te;

        const ey = mySph.position.y + camHeightOffset;
        const _e = new THREE.Euler(curPitch, curYaw, 0, 'YXZ');
        const camOff = new THREE.Vector3(0, 0, 5).applyEuler(_e);
        mainCamera.position.set(mySph.position.x + camOff.x, ey + camOff.y, mySph.position.z + camOff.z);
        mainCamera.lookAt(mySph.position.x, ey, mySph.position.z);

        look.yaw   = curYaw;
        look.pitch = curPitch;
        bodyYaw    = curYaw;
        try { mySph.rotation.y = bodyYaw; } catch(e) {}

        if (t >= 1) {
            isCheckpointCam = false;
        }
    }

    // ===== DYNAMIC CHECKPOINT RING =====
    const RING_RADIUS   = 10;
    const RING_TUBE     = 0.28;
    const RING_SEGMENTS = 80;
    const RING_TUBE_SEG = 16;
    const RING_Y_FADE   = 35;
    const RING_DETECT_DIST = RING_RADIUS * 1.1;

    function makeRingMaterial(withYFade) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime:      { value: 0 },
                uRingWorldY:{ value: 0 },
                uFadeTop:   { value: RING_Y_FADE },
                uWithFade:  { value: withYFade ? 1.0 : 0.0 }
            },
            vertexShader: `
                uniform float uTime;
                varying vec3  vWorldPos;
                varying float vAngle;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    vAngle = atan(position.z, position.x);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uRingWorldY;
                uniform float uFadeTop;
                uniform float uWithFade;
                varying vec3  vWorldPos;
                varying float vAngle;
                void main() {
                    float pulse = 0.65 + 0.35 * sin(uTime * 4.0 + vAngle * 3.0);
                    vec3 col = mix(vec3(0.0, 0.9, 0.25), vec3(0.2, 1.0, 0.45), pulse);
                    float jet = pow(max(sin(vAngle * 6.0 - uTime * 6.28), 0.0), 4.0) * 0.85;
                    col += vec3(0.0, jet * 0.7, jet * 0.25);
                    float alpha = 0.85 + 0.15 * pulse;
                    if (uWithFade > 0.5) {
                        float fy = smoothstep(uRingWorldY, uRingWorldY + uFadeTop, vWorldPos.y);
                        alpha *= (1.0 - fy * 0.92);
                        alpha = max(alpha, 0.06);
                    }
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            transparent: true,
            depthWrite:  false,
            depthTest:   false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
    }

    function makeRingParticles(pos) {
        const count = 110;
        const geo   = new THREE.BufferGeometry();
        const pa    = new Float32Array(count * 3);
        const ang   = new Float32Array(count);
        const spd   = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            ang[i] = (i / count) * Math.PI * 2;
            spd[i] = 0.5 + Math.random() * 0.9;
            pa[i*3]=0; pa[i*3+1]=0; pa[i*3+2]=0;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pa,  3));
        geo.setAttribute('aAngle',   new THREE.BufferAttribute(ang, 1));
        geo.setAttribute('aSpd',     new THREE.BufferAttribute(spd, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPX: { value: pos.x }, uPY: { value: pos.y }, uPZ: { value: pos.z }
            },
            vertexShader: `
                attribute float aAngle;
                attribute float aSpd;
                uniform float uTime, uPX, uPY, uPZ;
                varying float vLife;
                void main() {
                    float a   = aAngle + uTime * aSpd * 0.9;
                    float r   = ${RING_RADIUS.toFixed(1)} + sin(uTime*2.5+aAngle*4.0)*0.6;
                    float yOff= sin(uTime*1.8 + aAngle*2.5) * 1.1;
                    vec3 p    = vec3(uPX + cos(a)*r, uPY + yOff, uPZ + sin(a)*r);
                    vLife     = fract(uTime * aSpd * 0.3 + aAngle);
                    vec4 mv   = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = (1.0-vLife)*5.5*(280.0/-mv.z);
                    gl_Position  = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying float vLife;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    if (d > 0.5) discard;
                    float a = (1.0-vLife)*(1.0-d*2.0);
                    gl_FragColor = vec4(0.1, 1.0, 0.35, a*0.85);
                }
            `,
            transparent: true, depthWrite: false, depthTest: false,
            blending: THREE.AdditiveBlending
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        return pts;
    }

    function makeRingMesh(pos, withYFade) {
        const geo  = new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, RING_TUBE_SEG, RING_SEGMENTS);
        const mat  = makeRingMaterial(withYFade);
        mat.uniforms.uRingWorldY.value = pos.y;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.rotation.x = Math.PI / 2;
        mesh.frustumCulled = false;
        
        const hGeo  = new THREE.TorusGeometry(RING_RADIUS + 0.9, RING_TUBE * 2.8, RING_TUBE_SEG, RING_SEGMENTS);
        const hMat  = makeRingMaterial(withYFade);
        hMat.uniforms.uRingWorldY.value = pos.y;
        const hMesh = new THREE.Mesh(hGeo, hMat);
        hMesh.position.copy(pos);
        hMesh.rotation.x = Math.PI / 2;
        hMesh.frustumCulled = false;
        mesh._halo = hMesh;
        return mesh;
    }

    // Tạo vòng tại vị trí checkpoint đầu tiên
    const firstCP = checkpoints[0];
    activeRing      = makeRingMesh(firstCP,  true);
    activeRingParts = makeRingParticles(firstCP);
    scene.add(activeRing);
    scene.add(activeRing._halo);
    scene.add(activeRingParts);

    // Race state
    let raceFinished     = false;
    _raceFinishedRef = { get value() { return raceFinished; }, set value(v) { raceFinished = v; } };

    // Cập nhật vị trí của vòng sang checkpoint kế tiếp
    function advanceCheckpoint() {
        if (currentCheckpointIdx < checkpoints.length) {
            const cp = checkpoints[currentCheckpointIdx];
            activeRing.position.copy(cp);
            activeRing._halo.position.copy(cp);
            activeRing.material.uniforms.uRingWorldY.value = cp.y;
            activeRing._halo.material.uniforms.uRingWorldY.value = cp.y;
            
            activeRingParts.material.uniforms.uPX.value = cp.x;
            activeRingParts.material.uniforms.uPY.value = cp.y;
            activeRingParts.material.uniforms.uPZ.value = cp.z;
        } else {
            // Đã hết checkpoint (về đích)
            activeRing.visible = false;
            activeRing._halo.visible = false;
            activeRingParts.visible = false;
        }
    }

    // ===== Vitals HUD Setup (HP + Nitro, gộp chung góc dưới giữa màn hình) =====
    (function createVitalsHUD() {
        const ex = document.getElementById('vitalsHUD'); if (ex) ex.remove();
        const div = document.createElement('div');
        div.id = 'vitalsHUD';
        div.innerHTML = `
            <div class="vitals-bar-label">NITRO</div>
            <div id="nitroBarBg"><div id="nitroBarFill"></div></div>
            <div class="vitals-bar-label">MÁU (HP)</div>
            <div id="hpBarBg"><div id="hpBarFill"></div></div>
        `;
        document.body.appendChild(div);
    })();

    function updateHPHUD(value) {
        const fill = document.getElementById('hpBarFill'); if (!fill) return;
        fill.style.width = `${Math.max(0, value * 100).toFixed(1)}%`;
    }

    // ===== WINNER / SPECTATOR =====
    let isSpectator = false;
    const SPECTATOR_Y_MAX = 100;
    let _winnersOrder = [];

    function getPlayerCount() {
        if (!currentRoomData || !currentRoomData.players) return 1;
        return Object.values(currentRoomData.players).filter(Boolean).length;
    }

    function hideHudAndRings() {
        const vitalsHUD = document.getElementById('vitalsHUD');
        if (vitalsHUD) vitalsHUD.style.display = 'none';
        const compassHUD = document.getElementById('compassHUD');
        if (compassHUD) compassHUD.style.display = 'none';
        const hud = document.getElementById('coordinatesHUD');
        if (hud) hud.style.display = 'none';
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = 'none';
        
        activeRing.visible = false; activeRing._halo.visible = false; activeRingParts.visible = false;
    }

    function showWinnerBoard(winnerName, allWinners, isFinal) {
        const old = document.getElementById('winnerBoard');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'winnerBoard';
        overlay.style.cssText = `
            position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
            z-index:9999;background:rgba(0,0,0,0.75);pointer-events:all;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background:linear-gradient(135deg,#0a0a1a 0%,#0d1a2a 100%);
            border:2px solid #00ff88;border-radius:18px;padding:40px 56px;
            min-width:400px;max-width:560px;text-align:center;
            box-shadow:0 0 60px #00ff8844,0 0 120px #00ff8822;
            animation:winBoardIn 0.45s cubic-bezier(.17,.67,.3,1.3);
        `;

        if (!document.getElementById('winBoardStyle')) {
            const st = document.createElement('style');
            st.id = 'winBoardStyle';
            st.textContent = `
                @keyframes winBoardIn{from{transform:scale(0.3) translateY(60px);opacity:0;}to{transform:scale(1) translateY(0);opacity:1;}}
                @keyframes winPulse{0%,100%{text-shadow:0 0 30px #00ff88,0 0 60px #00ff8888;}50%{text-shadow:0 0 60px #00ff88,0 0 120px #00ff88cc;}}
            `;
            document.head.appendChild(st);
        }

        let html = `<div style="font-size:42px;margin-bottom:8px;">🏆</div>`;
        html += `<div style="font-size:28px;font-weight:900;font-family:monospace;letter-spacing:4px;color:#00ff88;animation:winPulse 2s infinite;margin-bottom:6px;">BẢNG XẾP HẠNG</div>`;

        if (allWinners && allWinners.length > 0) {
            html += `<div style="font-size:12px;color:#aaa;font-family:monospace;letter-spacing:2px;margin-bottom:10px;margin-top:16px;">THỨ HẠNG</div>`;
            allWinners.forEach((n, i) => {
                const medals = ['🥇','🥈','🥉'];
                html += `<div style="font-size:18px;color:${i===0?'#ffd700':i===1?'#c0c0c0':'#cd7f32'};font-family:monospace;margin-bottom:6px;display:flex;justify-content:space-between;padding:0 20px;">
                    <span>${medals[i] || (i+1) + '. '} ${n}</span>
                    <span>${i === 0 ? 'VÔ ĐỊCH' : 'HOÀN THÀNH'}</span>
                </div>`;
            });
            html += `<div style="margin-top:18px;"></div>`;
        }

        if (isFinal) {
            html += `<div id="winCountdown" style="font-size:14px;color:#aaa;font-family:monospace;margin-top:8px;">Trở về sảnh... <span id="winCdNum">10</span>s</div>`;
        } else {
            html += `
                <div style="display:flex;gap:16px;justify-content:center;margin-top:8px;">
                    <button id="winBtnLeave" style="padding:12px 28px;font-size:15px;font-family:monospace;font-weight:700;
                        background:rgba(255,60,60,0.15);color:#ff4444;border:2px solid #ff4444;border-radius:10px;
                        cursor:pointer;letter-spacing:2px;transition:all 0.2s;">
                        THOÁT
                    </button>
                    <button id="winBtnSpectate" style="padding:12px 28px;font-size:15px;font-family:monospace;font-weight:700;
                        background:rgba(0,255,136,0.12);color:#00ff88;border:2px solid #00ff88;border-radius:10px;
                        cursor:pointer;letter-spacing:2px;transition:all 0.2s;">
                        XEM TIẾP
                    </button>
                </div>
            `;
        }

        card.innerHTML = html;
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        if (isFinal) {
            let cd = 10;
            const cdInterval = setInterval(() => {
                cd--;
                const el = document.getElementById('winCdNum');
                if (el) el.textContent = cd;
                if (cd <= 0) {
                    clearInterval(cdInterval);
                    overlay.remove();
                    try { document.exitPointerLock?.(); } catch(e) {}
                    try { if (currentRoom) leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {}
                    destroyInput();
                    showLobby();
                }
            }, 1000);
        } else {
            const btnLeave = document.getElementById('winBtnLeave');
            const btnSpectate = document.getElementById('winBtnSpectate');
            if (btnLeave) btnLeave.onclick = () => {
                overlay.remove();
                try { document.exitPointerLock?.(); } catch(e) {}
                try { if (currentRoom) leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {}
                destroyInput();
                showLobby();
            };
            if (btnSpectate) btnSpectate.onclick = () => {
                overlay.remove();
                isSpectator = true;
                raceFinished = true;
                hideHudAndRings();
                isFlying = true;
                verticalVelocity = 0;
                if (!isMobileDevice()) {
                    try { canvas.requestPointerLock(); } catch(e) {}
                }
            };
        }
    }

    function onPlayerWin() {
        if (!_winnersOrder.includes(currentName)) {
            _winnersOrder.push(currentName);
        }
        
        // Ẩn mô hình của chính mình đối với người chơi khác
        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        const myModel = playerModels[myIdx];
        if (myModel) myModel.visible = false;

        // Đồng bộ lên Firebase trạng thái cán đích
        if (currentRoom) {
            syncFinish(currentRoom, currentName);
        } else {
            // Chơi đơn: hiện bảng kết quả ngay lập tức
            showWinnerBoard(currentName, [currentName], true);
            hideHudAndRings();
        }
    }

    // Lắng nghe danh sách người thắng từ Firebase
    if (currentRoom) {
        import('./config/firebase.js').then(({ db }) => {
            import('firebase/database').then(({ ref, onValue }) => {
                const winnersRef = ref(db, `rooms/${currentRoom}/winners`);
                onValue(winnersRef, (snapshot) => {
                    if (snapshot.exists()) {
                        let winners = snapshot.val();
                        if (!Array.isArray(winners)) winners = Object.values(winners);
                        _winnersOrder = winners;
                        
                        // Ẩn mô hình của các đối thủ đã thắng cuộc trên màn hình của mình
                        const players = currentRoomData?.players || {};
                        for (let i = 0; i < 6; i++) {
                            const name = players[`p${i}`];
                            if (name && _winnersOrder.includes(name)) {
                                if (playerModels[i]) playerModels[i].visible = false;
                            }
                        }

                        // Nếu là người chơi cuối cùng cán đích hoặc tất cả mọi người đã về đích
                        const totalPlayers = getPlayerCount();
                        
                        // Nếu mình đã thắng cuộc và tất cả mọi người đã về đích
                        if (raceFinished && _winnersOrder.length >= totalPlayers) {
                            showWinnerBoard(currentName, _winnersOrder, true);
                        } else if (raceFinished && !isSpectator) {
                            // Mình đã về đích nhưng chưa đủ người, hiện bảng tạm với nút Spectate
                            showWinnerBoard(currentName, _winnersOrder, false);
                        }
                    }
                });
            });
        });
    }

    // Cập nhật uTime cho vòng tròn
    function updateRings(nowMs) {
        const t = nowMs * 0.001;
        if (activeRing.visible) {
            activeRing.material.uniforms.uTime.value = t;
            activeRing._halo.material.uniforms.uTime.value = t;
            activeRingParts.material.uniforms.uTime.value  = t;
        }
    }

    // Kiểm tra chạm vòng Checkpoint
    function checkRingCollisions(mySphere) {
        if (raceFinished || isSpectator) return;
        const px = mySphere.position.x, py = mySphere.position.y, pz = mySphere.position.z;

        if (currentCheckpointIdx < checkpoints.length) {
            const targetCP = checkpoints[currentCheckpointIdx];
            const dx = px - targetCP.x, dz = pz - targetCP.z;
            if (Math.sqrt(dx*dx + dz*dz) < RING_DETECT_DIST && Math.abs(py - targetCP.y) < RING_RADIUS * 1.5) {
                lastPassedCheckpointIdx = currentCheckpointIdx;
                currentCheckpointIdx++;
                
                if (currentCheckpointIdx < checkpoints.length) {
                    advanceCheckpoint();
                    startCheckpointCam(performance.now());
                } else {
                    // Cán đích!
                    raceFinished = true;
                    onPlayerWin();
                }
            }
        }
    }

    // Hồi sinh khi hết máu
    function handleLocalDefeat() {
        showPopup("Bạn đã bị tiêu diệt! Đang hồi sinh tại checkpoint gần nhất...");
        
        let respawnPos = mapConfig.spawnPoints[myIdx]; // Mặc định là spawn point ban đầu
        if (lastPassedCheckpointIdx >= 0) {
            respawnPos = checkpoints[lastPassedCheckpointIdx];
        }
        
        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        respawnPlayer(myIdx, respawnPos);
        
        // Đồng bộ máu mới lên Firebase
        if (currentRoom) {
            const mySlot = isHost ? 'p0' : mySlotKey;
            syncHP(currentRoom, mySlot, playerHPs[myIdx]);
        }
    }

    const camHeightOffset = 1.5;
    const defaultCamDistance = 5;
    const CAM_COLLISION_BUFFER = 0.3;
    const CAM_MIN_DISTANCE = 0.6;
    const NETWORK_SYNC_INTERVAL_MS = NETWORK_SYNC_INTERVAL;

    // Lấy chỉ số phương tiện đang chọn
    const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
    const vConfig = VEHICLES_CONFIG[currentVehicle] || VEHICLES_CONFIG.xelan;
    
    // Cập nhật lại tốc độ và thông số từ xe của mình
    const BASE_SPEED = vConfig.maxSpeed * 0.65;
    const MAX_SPEED = vConfig.maxSpeed;
    const SPEED_ACCEL = 0.005;
    const SPEED_DECEL = 0.015;
    const SPEED_TURN_PENALTY = 0.008;
    
    // Dung tích nitro càng lớn thì drain càng chậm
    const NITRO_DRAIN_RATE = 0.004 * (100 / vConfig.nitroCapacity);
    const NITRO_REGEN_RATE = 0.002;
    const NITRO_REGEN_DELAY = 3000;
    const NITRO_MULTIPLIER = vConfig.nitroBoostSpeed;

    const BACK_SPEED = vConfig.maxSpeed * 0.22;
    const SLOPE_STRENGTH = 0.10;
    const SLOPE_MAX      = 0.08;
    const DRIFT_DECEL    = 0.006; // giảm tốc khi giữ shift (quán tính ngắn hơn)
    const INERTIA_DECEL  = 0.003; // giảm tốc quán tính khi nhả phím (dài hơn một chút)

    let currentSpeed  = BASE_SPEED;
    let bodyYaw       = look.yaw;
    const inertiaVec  = new THREE.Vector3();
    let _groundNormal = new THREE.Vector3(0, 1, 0);

    let prevLookYaw    = look.yaw;
    let animLockUntil  = 0;
    let attackLockUntil = 0;
    let moveResyncUntil = 0;
    let quickTurnAccum = 0;
    let _wheelState    = 'idle';
    let _isMoving  = false;
    let _holdShift = false;
    let _curSpeed  = 0;
    const TURN_ANIM_MS  = 480;
    const TURN_MOVE_MS  = 320;
    const MOVE_RESYNC_MS = 220;
    const prevKeys = { w:false, a:false, s:false, d:false };

    let _prevSpherePos = new THREE.Vector3();
    let _prevBodyYaw   = 0;
    let _wheelPosInit  = false;

    // Pre-allocated vectors
    const _moveVector = new THREE.Vector3();
    const _moveAxisY = new THREE.Vector3(0, 1, 0);
    const _moveQuat = new THREE.Quaternion();
    const _camEuler = new THREE.Euler();
    const _playerEyesPos = new THREE.Vector3();
    const _eyeOffset = new THREE.Vector3();
    const _finalCamPos = new THREE.Vector3();
    const _camDir = new THREE.Vector3();
    const camRaycaster = new THREE.Raycaster();

    let lastNetworkSync = 0;
    let lastFrameTime = performance.now();
    let _firstGameFrame = true;

    // ===== HUD: Compass (thước kẻ hướng nhìn, không khung mờ) =====
    (function createCompass() {
        const ex = document.getElementById('compassHUD'); if (ex) ex.remove();
        const div = document.createElement('div');
        div.id = 'compassHUD';
        div.innerHTML = `
            <canvas id="compassCanvas" width="320" height="52"></canvas>
            <div id="compassSpeedValue">0 km/h</div>
            <div id="compassOtherIcons" style="display:flex;gap:6px;justify-content:center;margin-top:4px;min-height:22px;"></div>
        `;
        document.body.appendChild(div);

        // Chỉ hiện icon avatar người chơi KHÁC, không hiện bản thân
        const myIdx2 = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        const iconsContainer = document.getElementById('compassOtherIcons');
        if (iconsContainer && currentRoomData && currentRoomData.playersInfo) {
            const playersInfo = currentRoomData.playersInfo;
            for (const [key, info] of Object.entries(playersInfo)) {
                const idx = parseInt(key.slice(1));
                if (idx === myIdx2 || !info || !info.avatar) continue;
                const img = document.createElement('img');
                img.src = `assets/icons_pack/icons/${info.avatar}`;
                img.alt = info.name || '';
                img.title = info.name || '';
                img.style.cssText = 'width:18px;height:18px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.6);box-shadow:0 0 4px rgba(0,0,0,0.6);';
                iconsContainer.appendChild(img);
            }
        }
    })();

    // ===== HUD: HP + Nitro Bar (giá trị khởi tạo) =====
    (function initVitalsBar() {
        updateHPHUD(playerHPs[myIdx] / playerMaxHPs[myIdx]);
    })();

    function updateNitroBar(value, isDepleted) {
        const fill = document.getElementById('nitroBarFill'); if (!fill) return;
        fill.style.width = `${Math.max(0, value * 100).toFixed(1)}%`;
        fill.style.background = isDepleted
            ? 'rgba(255,60,60,0.6)'
            : value > 0.5 ? 'linear-gradient(90deg,#00ccff,#00ff88)'
            : value > 0.2 ? 'linear-gradient(90deg,#ffaa00,#ffcc00)'
            : 'linear-gradient(90deg,#ff3300,#ff6600)';
    }

    // Thanh hướng nhìn (la bàn): 1 thanh ngang trắng dài làm trục chính, các vạch chia
    // ngắn màu đen theo từng độ; các hướng chính N/E/S/W và phụ NE/SE/SW/NW có vạch
    // dài hơn màu trắng kèm chữ to để dễ nhìn.
    const COMPASS_POINTS = [
        { label: 'N',  angle: 0,   major: true },
        { label: 'NE', angle: 45,  major: false },
        { label: 'E',  angle: 90,  major: true },
        { label: 'SE', angle: 135, major: false },
        { label: 'S',  angle: 180, major: true },
        { label: 'SW', angle: 225, major: false },
        { label: 'W',  angle: 270, major: true },
        { label: 'NW', angle: 315, major: false }
    ];
    function updateCompass(yaw) {
        const canvas = document.getElementById('compassCanvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        let yawDeg = ((-yaw) * 180 / Math.PI) % 360;
        if (yawDeg < 0) yawDeg += 360;
        const scale = w / 90;
        const baseline = h - 8;

        // Thanh ngang dài màu trắng - trục chính của la bàn, kéo dài hết chiều rộng
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, baseline);
        ctx.lineTo(w, baseline);
        ctx.stroke();

        // Vạch chia phụ - to hơn, dài hơn nhưng ít lại (mỗi 5°) so với trước
        const MINOR_TICK_H = 10;
        for (let a = 0; a < 360; a += 5) {
            if (a % 45 === 0) continue;
            let diff = a - yawDeg;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            const px = w / 2 + diff * scale;
            if (px < -5 || px > w + 5) continue;
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, baseline);
            ctx.lineTo(px, baseline - MINOR_TICK_H);
            ctx.stroke();
        }

        // Hướng chính (N/E/S/W) và phụ (NE/SE/SW/NW): vạch dài hơn, màu trắng + chữ to
        for (const pt of COMPASS_POINTS) {
            let diff = pt.angle - yawDeg;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            const px = w / 2 + diff * scale;
            if (px < -25 || px > w + 25) continue;

            const tickH = pt.major ? 19 : 15;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = pt.major ? 3 : 2.5;
            ctx.beginPath();
            ctx.moveTo(px, baseline);
            ctx.lineTo(px, baseline - tickH);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = 'rgba(0,0,0,0.8)';
            ctx.shadowBlur = 3;
            ctx.font = pt.major ? 'bold 17px monospace' : 'bold 13px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(pt.label, px, baseline - tickH - 4);
            ctx.shadowBlur = 0;
        }
    }

    // ===== Game Loop =====
    function animate() {
        // Nếu một phiên chơi mới đã được khởi tạo (map khác / chơi lại), dừng hẳn vòng lặp cũ này
        // để không render/tính toán vật lý chồng lên dữ liệu của map mới.
        if (mySessionId !== gameSessionId) return;
        currentAnimationFrameId = requestAnimationFrame(animate);
        const nowMs = performance.now();
        const delta = Math.min((nowMs - lastFrameTime) / 1000, 0.1);
        lastFrameTime = nowMs;

        if (isCutscene) {
            try { updateCutsceneCamera(nowMs); } catch(e) {}
            try { updatePlayerAnimations(delta); } catch(e) {}
            try { renderer.render(scene, mainCamera); } catch(e) {}
            return;
        }

        if (isCheckpointCam) {
            try { updateCheckpointCam(nowMs); } catch(e) {}
            try { updatePlayerAnimations(delta); } catch(e) {}
            try { updateRings(nowMs); } catch(e) {}
            try {
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                updateAllLabels(mainCamera, myIdx);
            } catch(e) {}
            try { renderer.render(scene, mainCamera); } catch(e) {}
            return;
        }

        let mySphere;
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            mySphere = getMySphere(myIdx);
        } catch(e) { return; }
        if (!mySphere) return;

        if (_firstGameFrame) {
            _firstGameFrame = false;
            try {
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                playAnimation(myIdx, ANIM.IDLE, 0);
            } catch(e) {}
        }

        const nearbyMeshes = queryNearbyMeshes(mySphere.position.x, mySphere.position.z);

        // ===== HP Bar Update =====
        updateHPHUD(playerHPs[myIdx] / playerMaxHPs[myIdx]);
        if (playerHPs[myIdx] <= 0 && !playerInvulnerables[myIdx] && !isSpectator) {
            handleLocalDefeat();
        }

        // ===== Attack system (Left Click / Touch) =====
        // Click liên tục: chờ ~7 frame (250ms) rồi restart animation
        // Giữ chuột: chỉ tấn công 1 lần (edge detection)
        const attackPressed = keys.attack && !_prevAttackKey;
        _prevAttackKey = keys.attack;
        if (attackPressed && nowMs - lastAttackTime >= 292 && !isSpectator) {
            lastAttackTime = nowMs;
            
            // Reset và phát lại animation tấn công ngay lập tức
            playAnimation(myIdx, ANIM.ATTACK, 0.0);
            const attackDuration = getAnimDurationMs(myIdx, ANIM.ATTACK);
            animLockUntil = nowMs + attackDuration;
            attackLockUntil = nowMs + attackDuration;

            // Phát âm thanh vẫy/đánh ngay khi bấm tấn công (luôn nghe được, không phụ thuộc trúng hay không)
            try {
                const myVConfigForSwing = getVehicleConfig(myIdx);
                if (myVConfigForSwing?.sounds?.attack) {
                    playUiSound(myVConfigForSwing.sounds.attack, 0.8);
                }
            } catch(e) {}
            
            // Raycast từ tâm camera để quét trúng đối thủ
            const camDir = new THREE.Vector3();
            mainCamera.getWorldDirection(camDir);
            
            const attackRay = new THREE.Raycaster();
            attackRay.set(mainCamera.position, camDir);
            
            // Tìm tất cả các hitbox mesh
            const targetHitboxes = [];
            for (let i = 0; i < 6; i++) {
                if (i !== myIdx) {
                    const opponentSphere = getMySphere(i);
                    if (opponentSphere && opponentSphere.visible) {
                        const hitbox = opponentSphere.getObjectByName("playerHitbox");
                        if (hitbox) targetHitboxes.push(hitbox);
                    }
                }
            }

            if (targetHitboxes.length > 0) {
                const hits = attackRay.intersectObjects(targetHitboxes, false);
                if (hits.length > 0) {
                    const hit = hits[0];
                    const hitPlayerIdx = hit.object.userData.playerIndex;
                    const distance = mySphere.position.distanceTo(getMySphere(hitPlayerIdx).position);
                    
                    const vConfig = getVehicleConfig(myIdx);
                    // Nếu nằm trong tầm tấn công của xe
                    if (distance <= vConfig.attackRange) {
                        const damage = vConfig.damage;
                        const myVehicleId = vConfig.id;

                        // Phát âm thanh hit tại vị trí người bị đánh (spatial, người gần nghe thấy)
                        const hitSphere = getMySphere(hitPlayerIdx);
                        if (hitSphere && vConfig.sounds?.hit) {
                            playSpatialSound(vConfig.sounds.hit, hitSphere.position, 20, 1.0);
                        }

                        if (currentRoom) {
                            const hitSlotKey = `p${hitPlayerIdx}`;
                            // Trừ máu đối thủ và đồng bộ
                            const currentOpponentHP = playerHPs[hitPlayerIdx];
                            const newHP = Math.max(0, currentOpponentHP - damage);
                            syncHP(currentRoom, hitSlotKey, newHP);
                        } else {
                            // Chơi đơn offline
                            takeDamage(hitPlayerIdx, damage, () => {}, myVehicleId);
                        }
                    }
                }
            }
        }

        // ===== Nitro Logic =====
        try {
            if (!isFlying && !isSpectator) {
                if (nitro.active && !nitro.depleted) {
                    nitro.value = Math.max(0, nitro.value - NITRO_DRAIN_RATE);
                    if (nitro.value <= 0) { nitro.depleted = true; nitro.regenDelay = nowMs + NITRO_REGEN_DELAY; }
                } else {
                    if (nitro.depleted) {
                        if (nowMs >= nitro.regenDelay) {
                            nitro.value = Math.min(1, Math.max(0, nitro.value + NITRO_REGEN_RATE));
                            if (nitro.value >= 1) nitro.depleted = false;
                        }
                    } else {
                        nitro.value = Math.min(1, Math.max(0, nitro.value + NITRO_REGEN_RATE));
                    }
                }
                updateNitroBar(nitro.value, nitro.depleted);
            }
        } catch(e) {}

        // ===== Physics =====
        try {
            if (isSpectator) {
                verticalVelocity = 0; isGrounded = false;
                const SPEC_SPEED = BASE_SPEED * 1.2;
                
                // Bay xuống (Ctrl/Shift/C) - không xuyên đất
                if (keys['control'] || keys['c'] || keys['shift']) {
                    const newY = mySphere.position.y - SPEC_SPEED;
                    const gravCheck = applyGravity(mySphere, -1, false, nearbyMeshes, { isHost });
                    mySphere.position.y = Math.max(gravCheck.isGrounded ? mySphere.position.y : newY, newY);
                    checkWallCollisions(mySphere.position, new THREE.Vector3(0,-SPEC_SPEED,0), nearbyMeshes, getPlayerHalfWidth(myIdx));
                }
                // Bay lên (Space) - giới hạn Y100
                if (keys[' ']) {
                    if (mySphere.position.y < SPECTATOR_Y_MAX) {
                        const headBlocked = checkHeadBlocked(mySphere.position, nearbyMeshes, 2.5);
                        if (!headBlocked) mySphere.position.y = Math.min(SPECTATOR_Y_MAX, mySphere.position.y + SPEC_SPEED);
                    }
                }
            } else if (!isFlying) {
                const gravResult = applyGravity(mySphere, verticalVelocity, isGrounded, nearbyMeshes, { isHost });
                verticalVelocity = gravResult.verticalVelocity;
                isGrounded = gravResult.isGrounded;
                if (gravResult.groundNormal) _groundNormal.copy(gravResult.groundNormal);
            } else {
                verticalVelocity = 0; isGrounded = false;
                if (keys['control'] || keys['c'] || keys['shift']) mySphere.position.y -= BASE_SPEED;
                if (keys[' ']) {
                    const headBlocked = checkHeadBlocked(mySphere.position, nearbyMeshes, 2.5);
                    if (!headBlocked) mySphere.position.y += BASE_SPEED;
                }
            }
        } catch(e) {}

        // ===== Movement & Speeds =====
        if (isSpectator) {
            try {
                const SPEC_SPEED = BASE_SPEED * 1.2;
                const movFwd  = keys.w, movBack = keys.s;
                const movLeft = keys.a, movRight = keys.d;
                if (movFwd || movBack || movLeft || movRight) {
                    const mv = new THREE.Vector3();
                    if (movFwd)   mv.z -= 1;
                    if (movBack)  mv.z += 1;
                    if (movLeft)  mv.x -= 1;
                    if (movRight) mv.x += 1;
                    mv.normalize();
                    mv.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), look.yaw));
                    mv.multiplyScalar(SPEC_SPEED);
                    mySphere.position.add(mv);
                    checkWallCollisions(mySphere.position, mv, nearbyMeshes, getPlayerHalfWidth(myIdx));
                    if (mySphere.position.y > SPECTATOR_Y_MAX) mySphere.position.y = SPECTATOR_Y_MAX;
                }
            } catch(e) {}
            
            try {
                _camEuler.set(look.pitch, look.yaw, 0, 'YXZ');
                _eyeOffset.set(0, camHeightOffset, 0);
                _playerEyesPos.copy(mySphere.position).add(_eyeOffset);
                _finalCamPos.set(0, 0, defaultCamDistance).applyEuler(_camEuler).add(_playerEyesPos);
                mainCamera.position.copy(_finalCamPos);
                mainCamera.lookAt(_playerEyesPos);
            } catch(e) {}
            try { updatePlayerAnimations(delta); } catch(e) {}
            try { updateAllLabels(mainCamera, myIdx); } catch(e) {}
            try { if (mySphere) updateSoundListener(mySphere.position); } catch(e) {}
            try { for (const lod of lodObjects) { try { lod.update(mainCamera); } catch(e) {} } } catch(e) {}
            try { renderer.render(scene, mainCamera); } catch(e) {}
            return;
        }

        // Đi bộ/đua bình thường
        try {
            let movFwd  = keys.w, movBack = keys.s;
            let movLeft = keys.a, movRight = keys.d;
            if (isCountdownActive) {
                movFwd = false; movBack = false; movLeft = false; movRight = false;
                keys.w = false; keys.s = false; keys.a = false; keys.d = false; keys[' '] = false; keys.shift = false;
                nitro.active = false;
                look.yaw = DN_YAW; look.pitch = DN_PITCH; bodyYaw = DN_YAW;
                try { mySphere.rotation.y = DN_YAW; } catch(e) {}
            }
            // animLockUntil được set khi tấn công để block animation khác
            const isMoving   = movFwd || movBack || movLeft || movRight;
            const isPureBack = movBack && !movFwd && !movLeft && !movRight;
            const holdShift  = keys.shift || keys.control;
            _isMoving = isMoving; _holdShift = holdShift; _curSpeed = currentSpeed;

            const nitroActive = nitro.active && !nitro.depleted && !isFlying;
            const nitroMult   = nitroActive ? NITRO_MULTIPLIER : 1.0;

            function normA(a){ while(a> Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; }

            function getSlopeDelta(movDir) {
                if (!isGrounded) return 0;
                const nx = _groundNormal.x;
                const nz = _groundNormal.z;
                const slopeMag = Math.sqrt(nx * nx + nz * nz);
                if (slopeMag < 0.01) return 0;
                const downhillX = nx / slopeMag;
                const downhillZ = nz / slopeMag;
                const dot = movDir.x * downhillX + movDir.z * downhillZ;
                return Math.max(-SLOPE_MAX, Math.min(SLOPE_MAX, dot * slopeMag * SLOPE_STRENGTH * 10));
            }

            const frameYawDelta = normA(look.yaw - prevLookYaw);
            prevLookYaw = look.yaw;

            const lookDelta = normA(look.yaw - bodyYaw);
            const absLD     = Math.abs(lookDelta);

            const now = nowMs;
            const isAttackLocked = now < attackLockUntil;
            const locked = (now < animLockUntil) || isAttackLocked;

            // ============================================================
            //  IDLE (đứng yên)
            // ============================================================
            if (!isMoving && currentSpeed < 0.01) {
                const FAST_RAD = 0.026;
                const IDLE_TURN_DEG = 25 * Math.PI / 180;

                if (!locked) {
                    if (Math.abs(frameYawDelta) >= FAST_RAD) {
                        quickTurnAccum += frameYawDelta;
                    } else {
                        quickTurnAccum *= 0.85;
                    }
                }

                if (!locked && Math.abs(quickTurnAccum) >= IDLE_TURN_DEG) {
                    const dir = quickTurnAccum > 0 ? ANIM.TURN_LEFT : ANIM.TURN_RIGHT;
                    playAnimation(myIdx, dir, 0.10);
                    if (!isAttackLocked) animLockUntil = now + getAnimDurationMs(myIdx, dir);
                    bodyYaw = look.yaw;
                    mySphere.rotation.y = bodyYaw;
                    quickTurnAccum = 0;
                    _wheelState = dir === ANIM.TURN_LEFT ? 'turn_left' : 'turn_right';
                } else if (!locked) {
                    playAnimation(myIdx, ANIM.IDLE, 0.2);
                    bodyYaw += normA(look.yaw - bodyYaw) * 0.06;
                    mySphere.rotation.y = bodyYaw;
                    _wheelState = 'idle';
                } else {
                    bodyYaw += normA(look.yaw - bodyYaw) * 0.12;
                    mySphere.rotation.y = bodyYaw;
                }

            // ============================================================
            //  ĐI LÙI
            // ============================================================
            } else if (isPureBack) {
                inertiaVec.set(0,0,0);
                _moveVector.set(0, 0, 1).applyQuaternion(_moveQuat.setFromAxisAngle(_moveAxisY, look.yaw));
                const backSlopeDelta = getSlopeDelta(_moveVector);
                const backSpeed = Math.max(0.01, Math.min(BACK_SPEED * 1.5, BACK_SPEED + backSlopeDelta));
                currentSpeed = backSpeed;

                _moveVector.multiplyScalar(backSpeed * nitroMult);
                mySphere.position.add(_moveVector);
                checkWallCollisions(mySphere.position, _moveVector, nearbyMeshes, getPlayerHalfWidth(myIdx));

                bodyYaw += normA(look.yaw - bodyYaw) * 0.20;
                mySphere.rotation.y = bodyYaw;

                if (!locked) {
                    playAnimation(myIdx, ANIM.MOVE_BACK, 0.18);
                }
                _wheelState = 'move_back';
                quickTurnAccum = 0;

            // ============================================================
            //  ĐI TỚI / TRƯỢT QUÁN TÍNH
            // ============================================================
            } else {
                if (isMoving) {
                    if (holdShift) {
                        // Giữ shift + di chuyển: tốc độ giảm dần (drift, không tăng thêm)
                        currentSpeed = Math.max(BASE_SPEED * 0.3, currentSpeed - DRIFT_DECEL);
                    } else {
                        if (absLD > 25 * Math.PI / 180) {
                            currentSpeed = Math.max(BASE_SPEED, currentSpeed - SPEED_TURN_PENALTY);
                        } else {
                            currentSpeed = Math.min(MAX_SPEED, currentSpeed + SPEED_ACCEL);
                        }
                    }
                } else {
                    if (holdShift) {
                        // Giữ shift khi nhả phím: trượt rất chậm (drift dài)
                        currentSpeed = Math.max(0, currentSpeed - DRIFT_DECEL);
                    } else {
                        // Nhả phím bình thường: quán tính dài hơn trước
                        currentSpeed = Math.max(0, currentSpeed - INERTIA_DECEL);
                    }
                }

                if (isMoving) {
                    const pW = prevKeys.w, pA = prevKeys.a, pD = prevKeys.d;
                    let newTurnDir = null;

                    if ((pW && !pD) && movRight && !movLeft)               newTurnDir = 'right';
                    if ((pW && !pA) && movLeft  && !movRight)              newTurnDir = 'left';
                    if (pA && !pD && movRight && !movLeft && !keys.a)      newTurnDir = 'right';
                    if (pD && !pA && movLeft  && !movRight && !keys.d)     newTurnDir = 'left';

                    const FAST_RAD_MOVE = 0.030;
                    const MOVE_TURN_DEG = 22 * Math.PI / 180;
                    const canTriggerTurn = !locked && now >= moveResyncUntil;
                    
                    if (canTriggerTurn) {
                        if (Math.abs(frameYawDelta) >= FAST_RAD_MOVE) {
                            quickTurnAccum += frameYawDelta;
                        } else {
                            quickTurnAccum *= 0.80;
                        }
                    }
                    if (!newTurnDir && canTriggerTurn && Math.abs(quickTurnAccum) >= MOVE_TURN_DEG) {
                        newTurnDir = quickTurnAccum > 0 ? 'left' : 'right';
                        quickTurnAccum = 0;
                    }

                    if (newTurnDir && canTriggerTurn) {
                        const dir = newTurnDir === 'right' ? ANIM.TURN_RIGHT : ANIM.TURN_LEFT;
                        playAnimation(myIdx, dir, 0.08);
                        if (!isAttackLocked) {
                            animLockUntil = now + getAnimDurationMs(myIdx, dir) * 0.95;
                            moveResyncUntil = animLockUntil + MOVE_RESYNC_MS;
                        }
                        quickTurnAccum = 0;
                        _wheelState = newTurnDir === 'right' ? 'turn_right' : 'turn_left';
                    } else if (!canTriggerTurn) {
                        _wheelState = 'move';
                    } else {
                        playAnimation(myIdx, ANIM.MOVE, 0.15);
                        _wheelState = 'move';
                    }
                } else {
                    _wheelState = currentSpeed > 0.001 ? 'move' : 'idle';
                }

                if (isMoving && !holdShift) {
                    // Di chuyển bình thường theo hướng nhấn phím
                    _moveVector.set(0,0,0);
                    if (movFwd)   _moveVector.z -= 1;
                    if (movLeft)  _moveVector.x -= 1;
                    if (movRight) _moveVector.x += 1;
                    _moveVector.normalize();
                    _moveQuat.setFromAxisAngle(_moveAxisY, look.yaw);
                    _moveVector.applyQuaternion(_moveQuat);

                    const fwdSlopeDelta = getSlopeDelta(_moveVector);
                    const slopedSpeed = Math.max(BASE_SPEED * 0.3, Math.min(MAX_SPEED * 1.4, currentSpeed + fwdSlopeDelta));

                    _moveVector.multiplyScalar(slopedSpeed * nitroMult);
                    inertiaVec.copy(_moveVector).normalize();
                    mySphere.position.add(_moveVector);
                    checkWallCollisions(mySphere.position, _moveVector, nearbyMeshes, getPlayerHalfWidth(myIdx));
                } else if (currentSpeed > 0.001) {
                    // Trượt quán tính theo hướng cũ (cả khi nhả phím lẫn khi giữ shift)
                    const iv = inertiaVec.clone().multiplyScalar(currentSpeed * nitroMult);
                    mySphere.position.add(iv);
                    checkWallCollisions(mySphere.position, iv, nearbyMeshes, getPlayerHalfWidth(myIdx));
                    if (!locked) {
                        playAnimation(myIdx, ANIM.MOVE, 0.18);
                    }
                }

                // Xoay model:
                // - Giữ shift: model KHÔNG tự xoay theo camera, trừ khi góc lệch > 60°
                // - Bình thường: model xoay mượt theo camera
                const SHIFT_MAX_ANGLE = 60 * Math.PI / 180;
                if (holdShift) {
                    if (absLD > SHIFT_MAX_ANGLE) {
                        // Góc quá lớn: xoay về phía camera
                        bodyYaw += normA(look.yaw - bodyYaw) * 0.10;
                        mySphere.rotation.y = bodyYaw;
                    }
                    // Animation turn left/right liên tục theo góc nhìn so với model
                    if (!locked) {
                        if (lookDelta > 0.05) {
                            playAnimation(myIdx, ANIM.TURN_LEFT, 0.12);
                            _wheelState = 'turn_left';
                        } else if (lookDelta < -0.05) {
                            playAnimation(myIdx, ANIM.TURN_RIGHT, 0.12);
                            _wheelState = 'turn_right';
                        } else {
                            playAnimation(myIdx, ANIM.MOVE, 0.15);
                            _wheelState = 'move';
                        }
                    }
                } else {
                    bodyYaw += normA(look.yaw - bodyYaw) * 0.22;
                    mySphere.rotation.y = bodyYaw;
                    if (absLD < 10 * Math.PI / 180) quickTurnAccum *= 0.5;
                }
            }
            
            prevKeys.w = movFwd; prevKeys.a = movLeft;
            prevKeys.s = movBack; prevKeys.d = movRight;

            // Bánh xe và khói bụi (Local Player)
            try {
                if (!_wheelPosInit) {
                    _prevSpherePos.copy(mySphere.position);
                    _prevBodyYaw = bodyYaw;
                    _wheelPosInit = true;
                }
                const dx = mySphere.position.x - _prevSpherePos.x;
                const dz = mySphere.position.z - _prevSpherePos.z;
                const distMoved = Math.sqrt(dx * dx + dz * dz);

                // Cập nhật chỉ số tốc độ hiện tại (km/h) hiển thị dưới thanh hướng nhìn -
                // dùng cùng hệ số quy đổi với thanh chỉ số tốc độ ở màn chọn xe (raw * 100)
                try {
                    const speedEl = document.getElementById('compassSpeedValue');
                    if (speedEl) speedEl.textContent = `${Math.round(distMoved * 100)} km/h`;
                } catch(e) {}

                let dyaw = bodyYaw - _prevBodyYaw;
                while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
                while (dyaw < -Math.PI) dyaw += Math.PI * 2;

                updateWheelRotation(myIdx, _wheelState, distMoved, dyaw);

                try {
                    updateDustSystem(delta, mySphere, bodyYaw, currentSpeed, isGrounded, _wheelState, vConfig);
                } catch(e) {}

                _prevSpherePos.copy(mySphere.position);
                _prevBodyYaw = bodyYaw;
            } catch(e) {}

            updateHeadLook(look.yaw, look.pitch, bodyYaw, isPureBack, delta * 1000);

        } catch(e) { console.warn('[Movement]', e); }

        // ===== Camera Update =====
        try {
            _camEuler.set(look.pitch, look.yaw, 0, 'YXZ');
            _eyeOffset.set(0, camHeightOffset, 0);
            _playerEyesPos.copy(mySphere.position).add(_eyeOffset);
            _finalCamPos.set(0, 0, defaultCamDistance).applyEuler(_camEuler).add(_playerEyesPos);

            _camDir.subVectors(_finalCamPos, _playerEyesPos);
            const fullDist = _camDir.length();
            if (fullDist > 0.0001 && nearbyMeshes.length > 0) {
                _camDir.multiplyScalar(1 / fullDist);
                camRaycaster.set(_playerEyesPos, _camDir);
                camRaycaster.far = fullDist;
                const camHits = camRaycaster.intersectObjects(nearbyMeshes, false);
                if (camHits.length > 0) {
                    const cd = Math.max(CAM_MIN_DISTANCE, camHits[0].distance - CAM_COLLISION_BUFFER);
                    _finalCamPos.copy(_playerEyesPos).addScaledVector(_camDir, cd);
                }
            }
            mainCamera.position.copy(_finalCamPos);
            mainCamera.lookAt(_playerEyesPos);
        } catch(e) {}

        try { updatePlayerAnimations(delta); } catch(e) {}
        try { if (mySphere) updateSoundListener(mySphere.position); } catch(e) {}
        try { updateLoopSounds(_isMoving, _holdShift, _curSpeed, currentVehicle); } catch(e) {}

        // Coordinates HUD
        try {
            const hudX = document.getElementById('hudX');
            const hudY = document.getElementById('hudY');
            const hudZ = document.getElementById('hudZ');
            if (hudX) hudX.textContent = mySphere.position.x.toFixed(2);
            if (hudY) hudY.textContent = mySphere.position.y.toFixed(2);
            if (hudZ) hudZ.textContent = mySphere.position.z.toFixed(2);
        } catch(e) {}

        try { updateCompass(look.yaw); } catch(e) {}

        // ===== Network sync =====
        try {
            if (currentRoom && nowMs - lastNetworkSync >= NETWORK_SYNC_INTERVAL_MS) {
                lastNetworkSync = nowMs;
                const mySlot = isHost ? 'p0' : mySlotKey;
                const myAnim = getPlayerCurrentAnim(myIdx);
                syncPosition(currentRoom, mySlot, mySphere.position, bodyYaw, myAnim);
            }
        } catch(e) {}

        // Checkpoint Ring collisions
        try { updateRings(nowMs); } catch(e) {}
        try { checkRingCollisions(mySphere); } catch(e) {}

        // Labels update
        try {
            updateAllLabels(mainCamera, myIdx);
        } catch(e) {}

        // LOD update
        try { for (const lod of lodObjects) { try { lod.update(mainCamera); } catch(e) {} } } catch(e) {}

        // Render
        try { renderer.render(scene, mainCamera); } catch(e) {}
    }
    
    // Gọi callback khi local player hết máu
    playerHPs[myIdx] = vConfig.hp;
    window.localDefeatTrigger = handleLocalDefeat;

    animate();

    window.addEventListener('resize', () => {
        try {
            if (!mainCamera || !renderer) return;
            mainCamera.aspect = window.innerWidth / window.innerHeight;
            mainCamera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        } catch(e) {}
    });
}

// Khởi chạy hệ thống Lobby UI ban đầu khi tải trang
window.addEventListener('DOMContentLoaded', () => {
    initLobbyUI();
});