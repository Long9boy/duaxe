// src/main.js
// Diem khoi chay (Entry point) - quan ly UI, dieu huong va vong lap chinh (Game Loop)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

import { buildSpatialGrid, queryNearbyMeshes } from './core/spatial.js';
import { keys, look, nitro, initInput, destroyInput, isMobileDevice } from './core/input.js';
import {
    GRAVITY, JUMP_FORCE, PLAYER_RADIUS, SPAWN_POINTS,
    applyGravity, checkWallCollisions, checkHeadBlocked, frustumCullMeshes
} from './core/physics.js';
import {
    randomRoomId, createRoom, joinRoom, listenRoom, unlistenRoom,
    startGame, leaveRoom, syncPosition, NETWORK_SYNC_INTERVAL,
    watchAndDeleteEmptyRoom, listenPlayerSync, unlistenPlayerSync,
    listenWinner, unlistenWinner
} from './core/network.js?v=1';
import {
    initPlayers, getMySphere, getOtherSphere,
    applyRemotePositions, updateAllLabels,
    playAnimation, updatePlayerAnimations, getModelHalfWidth,
    updateHeadLook, getAnimDurationMs, setMyIndex, getPlayerCurrentAnim, ANIM,
    applyRemotePlayerSync, updateWheelRotation, resetWheelAngles
} from './player/playerManager.js';

// ===== State =====
let currentRoom = null;
let currentName = null;
let isHost = false;
let isGameStarted = false;
let currentRoomData = null;
let mySlotKey = null;

// Race state (module scope de updateRoomUI truy cap duoc)
let _raceFinishedRef = { value: false };
let _showRaceResultFn = null;

let isFlying = false;
let verticalVelocity = 0;
let isGrounded = false;

let mainCamera;
let collidableMeshes = [];
let lodObjects = [];

// ===== DOM references =====
const lobby          = document.getElementById('lobby');
const room           = document.getElementById('room');
const roomIdText     = document.getElementById('roomIdText');
const hostBox        = document.getElementById('hostBox');
const guestBox       = document.getElementById('guestBox');
const hostName       = document.getElementById('hostName');
const guestName      = document.getElementById('guestName');
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

function showRoom() {
    if (lobby) lobby.classList.add('hidden');
    if (room) room.classList.remove('hidden');
    if (isHost) {
        if (bottomRow) bottomRow.style.justifyContent = 'space-between';
        if (guestWrapper) guestWrapper.classList.remove('guestControl');
        if (waitingText) waitingText.classList.add('hidden');
        if (startBtn) startBtn.classList.remove('hidden');
    } else {
        if (bottomRow) bottomRow.style.justifyContent = 'center';
        if (guestWrapper) guestWrapper.classList.add('guestControl');
        if (waitingText) waitingText.classList.remove('hidden');
        if (startBtn) startBtn.classList.add('hidden');
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
    const nitroHUD = document.getElementById('nitroHUD');
    if (nitroHUD) nitroHUD.remove();
    const compassHUD = document.getElementById('compassHUD');
    if (compassHUD) compassHUD.remove();
    const chatHint = document.getElementById('chatHint');
    if (chatHint) chatHint.classList.add('hidden');
    const chatCont = document.getElementById('chatContainer');
    if (chatCont) chatCont.remove();
    if (labelsContainer) labelsContainer.innerHTML = '';
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

    // Tim slotKey neu chua co
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

    if (isGameStarted) {
        if (!_raceFinishedRef.value && data.winner) {
            const myRole = isHost ? 'p0' : mySlotKey;
            if (data.winner !== myRole) {
                _raceFinishedRef.value = true;
                if (_showRaceResultFn) _showRaceResultFn(false);
            }
        }
        return; // Thoát sớm để tránh cập nhật DOM phòng chờ ẩn
    }

    // Cap nhat UI 6 slot
    const players = data.players || {};
    let playerCount = 0;
    for (let i = 0; i < 6; i++) {
        const box = document.getElementById(`p${i}Box`);
        const nameEl = document.getElementById(`p${i}Name`);
        const name = players[`p${i}`];
        if (box && nameEl) {
            if (name) {
                nameEl.textContent = name;
                box.classList.add('active');
                playerCount++;
            } else {
                nameEl.textContent = 'Trong';
                box.classList.remove('active');
            }
        }
    }

    // Khoa hoac mo button bat dau game (toi thieu 2 nguoi choi)
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
            await createRoom(currentRoom, currentName, SPAWN_POINTS);
            if (roomIdText) roomIdText.textContent = currentRoom;
            showRoom();
            listenRoom(currentRoom, updateRoomUI);
            // Tu dong xoa phong neu trong nguoi sau 2 phut
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
            const result = await joinRoom(roomId, currentName);
            if (!result.success) return showPopup(result.error);
            currentRoom = roomId; isHost = false;
            mySlotKey = result.slotKey; // Luu lai slotKey
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
        currentName = playerNameEl?.value?.trim() || 'Người chơi thứ';
        currentRoom = null; isHost = true;
        mySlotKey = 'p0';
        currentRoomData = { host: currentName, players: { p0: currentName }, gameState: 'playing' };
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
    }
}
if (exitGameBtn) {
    exitGameBtn.onclick = async () => {
        cleanupSyncListeners();
        try { if (currentRoom) await leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {}
        destroyInput();
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
        try { const r = await startGame(currentRoom); if (!r.success) showPopup(r.error); } catch(e) { showPopup('Lỗi, vui lòng thử lại.'); }
    };
}
window.addEventListener('beforeunload', () => { try { if (currentRoom) leaveRoom(currentRoom, isHost, mySlotKey); } catch(e) {} });
window.addEventListener('error', (e) => { console.warn('[Error]', e.message); });
window.addEventListener('unhandledrejection', (e) => { console.warn('[Promise]', e.reason); e.preventDefault(); });

// ===== 3D Engine Init =====
function init3DEnvironment() {
    if (isGameStarted) return;
    isGameStarted = true;

    if (room) room.classList.add('hidden');
    const loadingScreen = document.getElementById('loadingScreen');
    if (loadingScreen) loadingScreen.classList.remove('hidden');

    const canvas = document.getElementById('gameCanvas');
    const crosshair = document.getElementById('crosshair');
    const hud = document.getElementById('coordinatesHUD');
    if (!canvas) { console.error('Canvas Không tồn tại!'); return; }

    // ===== Scene =====
    const scene = new THREE.Scene();
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
    loadingManager.onLoad = () => {
        // Đặt camera ở vị trí ban đầu của cutscene để chuẩn bị ma trận đúng
        try {
            if (mainCamera && typeof CS_FIXED_POS !== 'undefined') {
                mainCamera.position.copy(CS_FIXED_POS);
                if (typeof CS_LOOK_RADIUS !== 'undefined' && typeof CS_FIXED_PITCH !== 'undefined' && typeof _csLookTarget !== 'undefined') {
                    const h = CS_LOOK_RADIUS * Math.cos(CS_FIXED_PITCH);
                    _csLookTarget.set(
                        CS_FIXED_POS.x + Math.sin(0) * h,
                        CS_FIXED_POS.y + CS_LOOK_RADIUS * Math.sin(CS_FIXED_PITCH),
                        CS_FIXED_POS.z + Math.cos(0) * h
                    );
                    mainCamera.lookAt(_csLookTarget);
                }
                mainCamera.updateMatrixWorld(true);
            }
        } catch(e) { console.warn('[Cam setup fail]', e); }

        // Tạm thời tắt frustum culling trên toàn bộ mesh để bắt buộc GPU compile shaders và upload textures
        const culledMeshes = [];
        try {
            scene.traverse((child) => {
                if (child.isMesh && child.frustumCulled) {
                    child.frustumCulled = false;
                    culledMeshes.push(child);
                }
            });
        } catch(e) { console.warn('[Traverse fail]', e); }

        // Pre-compile shader và force render 1 frame trong bóng tối để upload textures lên GPU
        try {
            if (renderer && scene && mainCamera) {
                renderer.compile(scene, mainCamera);
                renderer.render(scene, mainCamera);
            }
        } catch(e) { console.warn('[Compile/Render fail]', e); }

        // Trả lại trạng thái frustum culling ban đầu
        try {
            culledMeshes.forEach(mesh => {
                mesh.frustumCulled = true;
            });
        } catch(e) {}

        const startLocalScene = () => {
            // Trì hoãn ẩn loading screen một khoảng ngắn (250ms) để GPU kịp xử lý swap buffers, tránh giật hình
            setTimeout(() => {
                if (loadingScreen) loadingScreen.classList.add('hidden');
                if (canvas) canvas.classList.remove('hidden');
                if (crosshair) crosshair.classList.remove('hidden');
                if (hud) hud.classList.remove('hidden');
                if (exitGameBtn) exitGameBtn.classList.remove('hidden');
                
                const mobileControls = document.getElementById('mobileControls');
                const isMobile = isMobileDevice();
                if (isMobile && mobileControls) {
                    mobileControls.classList.remove('hidden');
                }
                if (!isMobile) {
                    try { const lp = canvas.requestPointerLock(); if (lp?.catch) lp.catch(() => {}); } catch(e) {}
                }
                startCutscene(performance.now());
            }, 250);
        };

        if (currentRoom) {
            const lt = document.getElementById('loadingText');
            if (lt) lt.textContent = `Đã tải xong! Đang đợi người chơi khác...`;
            
            // Đồng bộ trạng thái loaded lên Firebase
            const mySlot = isHost ? 'p0' : mySlotKey;
            
            import('../config/firebase.js').then(({ db }) => {
                import('firebase/database').then(({ ref, update, onValue, off }) => {
                    const loadedRef = ref(db, `rooms/${currentRoom}/loaded`);
                    // Đánh dấu mình đã tải xong
                    update(loadedRef, { [mySlot]: true });
                    
                    // Lắng nghe trạng thái cả phòng
                    const roomRef = ref(db, `rooms/${currentRoom}`);
                    onValue(roomRef, (snapshot) => {
                        const data = snapshot.val();
                        if (!data) return;
                        
                        const players = data.players || {};
                        const loaded = data.loaded || {};
                        
                        // Lấy danh sách các slot đang thực sự có người chơi hoạt động
                        const activeSlots = Object.keys(players).filter(k => players[k]);
                        
                        // Kiểm tra xem tất cả các slot hoạt động đã loaded thành công chưa
                        const allLoaded = activeSlots.every(slot => loaded[slot] === true);
                        
                        if (allLoaded) {
                            // Hủy lắng nghe phòng chờ và bắt đầu cảnh chơi
                            off(roomRef);
                            startLocalScene();
                        }
                    });
                });
            }).catch(e => {
                console.error("Lỗi đồng bộ Firebase, tự động chạy game:", e);
                startLocalScene();
            });
        } else {
            // Chế độ chơi thử (offline) chạy luôn
            startLocalScene();
        }
    };
    loadingManager.onError = (url) => { console.warn('[Load Error]', url); };

    // ===== Skybox =====
    try {
        const cubeLoader = new THREE.CubeTextureLoader(loadingManager);
        scene.background = cubeLoader.load([
            'assets/cubemap/cubemap_right.jpg','assets/cubemap/cubemap_left.jpg',
            'assets/cubemap/cubemap_top.jpg','assets/cubemap/cubemap_bottom.jpg',
            'assets/cubemap/cubemap_front.jpg','assets/cubemap/cubemap_back.jpg'
        ]);
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

    // ===== Load Map =====
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(dracoLoader);

    gltfLoader.load('assets/maps/hongkong_city/scene.glb', (gltf) => {
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
    
    // ===== Sync Listeners for other players (Mạng tối ưu hóa) =====
    if (currentRoom) {
        // Huỷ lắng nghe phòng gốc ngay lập tức để ngưng nhận tất cả các position sync của cả phòng
        try { unlistenRoom(currentRoom); } catch(e) {}

        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
        const players = currentRoomData?.players || {};

        // Lắng nghe sync động riêng lẻ cho từng đối thủ
        for (let i = 0; i < 6; i++) {
            if (i === myIdx) continue;
            const slotKey = `p${i}`;
            const name = players[slotKey];
            if (name) {
                listenPlayerSync(currentRoom, slotKey, (syncData) => {
                    try {
                        applyRemotePlayerSync(i, syncData, name);
                    } catch(e) { console.error(`[PlayerSync Error ${slotKey}]`, e); }
                });
            }
        }

        // Lắng nghe người thắng từ xa
        listenWinner(currentRoom, (winnerSlot) => {
            if (winnerSlot && !_raceFinishedRef.value) {
                const myRole = isHost ? 'p0' : mySlotKey;
                if (winnerSlot !== myRole) {
                    _raceFinishedRef.value = true;
                    if (_showRaceResultFn) _showRaceResultFn(false);
                }
            }
        });
    }

    scene.add(mainCamera);

    // ===== Fly Toggle =====
    function onFlyToggle() {
        isFlying = !isFlying;
        verticalVelocity = 0; isGrounded = false;
        const statusHUD = document.getElementById('flyStatus');
        if (statusHUD) {
            statusHUD.textContent = isFlying ? 'Chế độ: bay tự do' : 'Chế độ: đi bộ';
            statusHUD.style.color = isFlying ? '#00ff88' : '#ff3366';
        }
    }

    // ===== Input =====
    try { initInput(canvas, { onFlyToggle, isCutscene: () => isCutscene || isPostCutscene || isCheckpointCam || isCountdownActive }); } catch(e) { console.error('Loi input:', e); }

    // ===== Cutscene =====
    // isPostCutscene: giai doan camera ghim CP_POS (263.50,32.25,128.50), xoay smooth ve sau lung player huong DN
    let isPostCutscene = false;
    let postCutsceneStartTime = 0;
    const POST_CUTSCENE_DURATION = 2200; // ms: thoi gian xoay tu CP_POS ve sau lung player
    const DN_YAW   = -Math.PI * 0.75; // ĐN direction trong Three.js
    const DN_PITCH = -0.08;
    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

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
        
        // 3: Pink/Red
        setNumber('3', '#ff007f', 'rgba(255, 0, 127, 0.6)');
        
        const interval = setInterval(() => {
            countdownNumber--;
            if (countdownNumber === 2) {
                // 2: Blue
                setNumber('2', '#00b7ff', 'rgba(0, 183, 255, 0.6)');
            } else if (countdownNumber === 1) {
                // 1: Green
                setNumber('1', '#00ff88', 'rgba(0, 255, 136, 0.6)');
            } else if (countdownNumber === 0) {
                // GO!: Bright Green
                setNumber('GO!', '#00ff88', 'rgba(0, 255, 136, 0.8)');
                isCountdownActive = false; // Allow movement
            } else {
                clearInterval(interval);
                if (overlay) overlay.classList.add('hidden');
            }
        }, 1000);
    }

    // Yaw/pitch cua camera khi nhin tu CP_POS ve phia player luc ket thuc cutscene
    let _postCutFromYaw = 0, _postCutFromPitch = 0;

    // Bezier control points cho post-cutscene camera path
    const _pcBezP1 = new THREE.Vector3(390, 35.25, 120);
    const _pcBezP2 = new THREE.Vector3(370, 25, 35);
    const _pcBezP3 = new THREE.Vector3(395, 18, -75);

    let isCutscene = true, cutsceneStarted = false, cutscenePhase = 0;
    const CUTSCENE_PHASE0_DURATION = 4000, CUTSCENE_PHASE1_DURATION = 3500;
    const CUTSCENE_TOTAL_DURATION = CUTSCENE_PHASE0_DURATION + CUTSCENE_PHASE1_DURATION;
    let cutsceneStartTime = 0, cutscenePhase1StartTime = 0, cutsceneAngle = 0;
    const CS_CENTER = new THREE.Vector3(306, 7, -301);
    const CS_FIXED_POS = new THREE.Vector3(380, 50, 135);
    const CS_FIXED_PITCH = -0.25, CS_LOOK_RADIUS = 50;
    const CS_P0 = new THREE.Vector3(335, 40, -225);
    const CS_P1 = new THREE.Vector3(275, 60, -230);
    const CS_P2 = new THREE.Vector3(225, 45, -300);
    const _csLookTarget = new THREE.Vector3();

    // Diem ghim camera sau cutscene (Ring 1 / checkpoint) va diem dich Ring 2
    const CP_POS  = new THREE.Vector3(263.50, 32.25, 128.50);
    const FIN_POS = new THREE.Vector3(40,      6.35, -325.50);

    function cubicBezier(p0, p1, p2, t) {
        const mt = 1 - t;
        return new THREE.Vector3(
            mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x,
            mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y,
            mt*mt*p0.z + 2*mt*t*p1.z + t*t*p2.z
        );
    }
    function startCutscene(nowMs) {
        cutsceneStartTime = nowMs; cutscenePhase = 0; cutsceneStarted = true;
        // Force TẤT CẢ player nhin ve ĐN + play idle ngay khi vao game
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
        // Luon play idle trong cutscene + post-cutscene
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            playAnimation(myIdx, ANIM.IDLE, 0.3);
        } catch(e) {}

        if (isCutscene) {
            if (nowMs - cutsceneStartTime >= CUTSCENE_TOTAL_DURATION) {
                isCutscene = false;
                isPostCutscene = true;
                postCutsceneStartTime = nowMs;
                // Tinh yaw/pitch cua camera dang o CP_POS nhin ve player (spawn)
                // De biet "diem xuat phat" cua giai doan xoay
                try {
                    const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                    const mySph = getMySphere(myIdx);
                    if (mySph) {
                        // Vec tu CP_POS → player
                        const toPlayer = new THREE.Vector3().subVectors(mySph.position, CP_POS).normalize();
                        _postCutFromYaw   = Math.atan2(toPlayer.x, toPlayer.z);
                        _postCutFromPitch = Math.asin(Math.max(-1, Math.min(1, toPlayer.y)));
                    } else {
                        _postCutFromYaw   = 0;
                        _postCutFromPitch = 0;
                    }
                } catch(e) { _postCutFromYaw = 0; _postCutFromPitch = 0; }
                return;
            }
            if (cutscenePhase === 0) {
                const t = Math.min((nowMs - cutsceneStartTime) / CUTSCENE_PHASE0_DURATION, 1);
                cutsceneAngle = t * (380 * Math.PI / 180);
                mainCamera.position.copy(CS_FIXED_POS);
                const h = CS_LOOK_RADIUS * Math.cos(CS_FIXED_PITCH);
                _csLookTarget.set(CS_FIXED_POS.x + Math.sin(cutsceneAngle)*h, CS_FIXED_POS.y + CS_LOOK_RADIUS*Math.sin(CS_FIXED_PITCH), CS_FIXED_POS.z + Math.cos(cutsceneAngle)*h);
                mainCamera.lookAt(_csLookTarget);
                if (t >= 1) { cutscenePhase = 1; cutscenePhase1StartTime = nowMs; }
            } else if (cutscenePhase === 1) {
                const t = Math.min((nowMs - cutscenePhase1StartTime) / CUTSCENE_PHASE1_DURATION, 1);
                mainCamera.position.copy(cubicBezier(CS_P0, CS_P1, CS_P2, t));
                mainCamera.lookAt(CS_CENTER);
                if (t >= 1) cutscenePhase = 2;
            } else {
                mainCamera.position.set(-370, 25, -555);
                mainCamera.lookAt(CS_CENTER);
            }
            return;
        }

        // ===== POST-CUTSCENE: cam di theo bezier tu CP_POS → sau lung player =====
        if (isPostCutscene) {
            let mySph;
            try {
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                mySph = getMySphere(myIdx);
            } catch(e) {}

            const t  = Math.min((nowMs - postCutsceneStartTime) / POST_CUTSCENE_DURATION, 1);
            const te = easeInOut(t);

            if (mySph) {
                const ey = mySph.position.y + 1.5;

                // Vi tri dich: sau lung player (third-person, huong DN)
                const _eDN = new THREE.Euler(DN_PITCH, DN_YAW, 0, 'YXZ');
                const camOffset = new THREE.Vector3(0, 0, defaultCamDistance).applyEuler(_eDN);
                const targetPos = new THREE.Vector3(
                    mySph.position.x + camOffset.x,
                    ey + camOffset.y,
                    mySph.position.z + camOffset.z
                );

                // Cubic bezier qua 4 diem kiem soat:
                // P0 = 263.50,32.25,128.50 (CP_POS)
                // P1 = 390,35.25,120
                // P2 = 370,25,35
                // P3 = 395,18,-75
                // Diem cuoi (P4) = vi tri sau lung player
                // Dung hai doan bezier bac 3: P0..P1..P2..P3 (0→0.7) va P3→target (0.7→1)
                // Dung CatmullRomCurve3 di qua ca 5 diem: CP_POS, _pcBezP1, _pcBezP2, _pcBezP3, targetPos
                const curve = new THREE.CatmullRomCurve3([
                    CP_POS,
                    _pcBezP1,
                    _pcBezP2,
                    _pcBezP3,
                    targetPos
                ]);
                const camPos = curve.getPointAt(te);

                mainCamera.position.copy(camPos);
                mainCamera.lookAt(mySph.position.x, ey, mySph.position.z);

                // Dong bo look/bodyYaw dan dan ve DN suot toan bo duong cong te
                let dyaw = DN_YAW - _postCutFromYaw;
                while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
                while (dyaw < -Math.PI) dyaw += Math.PI * 2;
                look.yaw   = _postCutFromYaw   + dyaw * te;
                look.pitch = _postCutFromPitch + (DN_PITCH - _postCutFromPitch) * te;
                bodyYaw    = look.yaw;
                try { mySph.rotation.y = bodyYaw; } catch(e) {}
            }

            if (t >= 1) {
                isPostCutscene = false;
                try { resetWheelAngles(); } catch(e) {}
                look.yaw   = DN_YAW;
                look.pitch = DN_PITCH;
                bodyYaw    = DN_YAW;
                try {
                    const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                    const mySph2 = getMySphere(myIdx);
                    if (mySph2) mySph2.rotation.y = DN_YAW;
                } catch(e) {}
                triggerStartCountdown();
            }
        }
    }

    // ===== CHECKPOINT CAM (khi cham Ring 1 → ghim camera vao Ring 2 roi quay lai) =====
    let isCheckpointCam        = false;
    let cpCamStartTime         = 0;
    const CP_CAM_DURATION      = 1500; // ms: thoi gian camera ghim nhin ve Ring 2
    // Vi tri/huong cam luc bat dau checkpoint cam
    let _cpCamFromPos          = new THREE.Vector3();
    let _cpCamFromYaw          = 0;
    let _cpCamFromPitch        = 0;
    // Vi tri/huong cam luc ket thuc (huong ve Ring 2)
    let _cpCamToYaw            = 0;
    let _cpCamToPitch          = 0;

    function startCheckpointCam(nowMs) {
        isCheckpointCam   = true;
        cpCamStartTime    = nowMs;
        // Luu vi tri camera hien tai lam diem xuat phat
        _cpCamFromPos.copy(mainCamera.position);
        // Tinh yaw/pitch hien tai tu look de noi suy
        _cpCamFromYaw   = look.yaw;
        _cpCamFromPitch = look.pitch;
        // Tinh huong nhin tu spawn → Ring 2 de dung lam diem den
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            const mySph = getMySphere(myIdx);
            if (mySph) {
                const toFin = new THREE.Vector3().subVectors(FIN_POS, mySph.position).normalize();
                _cpCamToYaw   = Math.atan2(-toFin.x, -toFin.z);
                _cpCamToPitch = -Math.asin(Math.max(-1, Math.min(1, toFin.y)));
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

        // Noi suy yaw/pitch tu vi tri hien tai → huong nhin Ring 2
        let dyaw = _cpCamToYaw - _cpCamFromYaw;
        while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const curYaw   = _cpCamFromYaw   + dyaw * te;
        const curPitch = _cpCamFromPitch + (_cpCamToPitch - _cpCamFromPitch) * te;

        // Dat camera phia sau player theo huong nhin Ring 2
        const ey = mySph.position.y + camHeightOffset;
        const _e = new THREE.Euler(curPitch, curYaw, 0, 'YXZ');
        const camOff = new THREE.Vector3(0, 0, 5).applyEuler(_e);
        mainCamera.position.set(mySph.position.x + camOff.x, ey + camOff.y, mySph.position.z + camOff.z);
        mainCamera.lookAt(mySph.position.x, ey, mySph.position.z);

        // Dong bo look de khi ket thuc player tiep tuc dieu khien theo huong nay
        look.yaw   = curYaw;
        look.pitch = curPitch;
        bodyYaw    = curYaw;
        try { mySph.rotation.y = bodyYaw; } catch(e) {}

        if (t >= 1) {
            isCheckpointCam = false;
        }
    }

    // ===== RACE RINGS =====
    // Ring 1: Checkpoint (263.50, 32.25, 128.50)
    //   - depthTest: false → luon thay du xa/bi che
    //   - An khi player nay da cham
    // Ring 2: Finish (40, 6.35, -325.50)
    //   - depthTest: false → luon thay du xa/bi che
    //   - Chi hien khi player nay da qua ring 1
    const RING_RADIUS   = 10;
    const RING_TUBE     = 0.28;
    const RING_SEGMENTS = 80;
    const RING_TUBE_SEG = 16;
    const RING_Y_FADE   = 35;   // fade len tren Y nay (ring 1)
    // CP_POS va FIN_POS da duoc khai bao o tren (dung chung voi post-cutscene)
    const RING_DETECT_DIST = RING_RADIUS * 1.1;

    // Tao ShaderMaterial cho ring - luon depthTest: false
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
                    // Pulse + jet engine
                    float pulse = 0.65 + 0.35 * sin(uTime * 4.0 + vAngle * 3.0);
                    vec3 col = mix(vec3(0.0, 0.9, 0.25), vec3(0.2, 1.0, 0.45), pulse);
                    // Jet tia chay
                    float jet = pow(max(sin(vAngle * 6.0 - uTime * 6.28), 0.0), 4.0) * 0.85;
                    col += vec3(0.0, jet * 0.7, jet * 0.25);
                    // Alpha
                    float alpha = 0.85 + 0.15 * pulse;
                    // Fade theo Y (chi ring 1)
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
            depthTest:   false,   // LUON HIEN du bi che/xa
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
    }

    // Particles bong chay theo vong
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
        // Halo glow
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

    const ring1      = makeRingMesh(CP_POS,  true);   // fade Y
    const ring2      = makeRingMesh(FIN_POS, false);  // khong fade
    const ring1Parts = makeRingParticles(CP_POS);
    const ring2Parts = makeRingParticles(FIN_POS);

    // Ring 1: hien ngay. Ring 2: HIDDEN cho den khi qua ring 1
    scene.add(ring1); scene.add(ring1._halo); scene.add(ring1Parts);
    ring2.visible      = false;
    ring2._halo.visible= false;
    ring2Parts.visible = false;
    scene.add(ring2); scene.add(ring2._halo); scene.add(ring2Parts);

    // Race state
    let myCheckpointDone = false;
    let raceFinished     = false;
    _raceFinishedRef = { get value() { return raceFinished; }, set value(v) { raceFinished = v; } };
    _showRaceResultFn = null; // se gan sau khi ham duoc dinh nghia

    // Firebase race sync
    function syncRaceCheckpoint() {
        if (!currentRoom) return;
        try {
            import('../config/firebase.js').then(({ db }) => {
                import('firebase/database').then(({ ref, update }) => {
                    const key = isHost ? 'hostCheckpoint' : 'guestCheckpoint';
                    update(ref(db, 'rooms/' + currentRoom), { [key]: true });
                });
            }).catch(()=>{});
        } catch(e) {}
    }
    function syncRaceWin() {
        if (!currentRoom) return;
        try {
            import('../config/firebase.js').then(({ db }) => {
                import('firebase/database').then(({ ref, update }) => {
                    update(ref(db, 'rooms/' + currentRoom), { winner: isHost ? 'host' : 'guest' });
                });
            }).catch(()=>{});
        } catch(e) {}
    }

    // ===== WINNER / SPECTATOR =====
    let isSpectator = false; // player da thang, dang xem tiep
    const SPECTATOR_Y_MAX = 100; // gioi han bay cao khi spectate
    const _winnersOrder = []; // danh sach ten player thang theo thu tu

    function getPlayerCount() {
        // Dem player hien co trong phong (2-player game = host + guest)
        if (!currentRoomData) return 2;
        let count = 0;
        if (currentRoomData.host) count++;
        if (currentRoomData.guest) count++;
        return count;
    }

    function hideHudAndRings() {
        // An HUD
        const nitroHUD = document.getElementById('nitroHUD');
        if (nitroHUD) nitroHUD.style.display = 'none';
        const compassHUD = document.getElementById('compassHUD');
        if (compassHUD) compassHUD.style.display = 'none';
        const hud = document.getElementById('coordinatesHUD');
        if (hud) hud.style.display = 'none';
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.style.display = 'none';
        // An ca hai vong ring
        ring1.visible = false; ring1._halo.visible = false; ring1Parts.visible = false;
        ring2.visible = false; ring2._halo.visible = false; ring2Parts.visible = false;
    }

    function showWinnerBoard(winnerName, allWinners, isFinal) {
        // Xoa board cu neu co
        const old = document.getElementById('winnerBoard');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'winnerBoard';
        overlay.style.cssText = `
            position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
            z-index:9999;background:rgba(0,0,0,0.72);pointer-events:all;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background:linear-gradient(135deg,#0a0a1a 0%,#0d1a2a 100%);
            border:2px solid #00ff88;border-radius:18px;padding:40px 56px;
            min-width:380px;max-width:560px;text-align:center;
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
        html += `<div style="font-size:28px;font-weight:900;font-family:monospace;letter-spacing:4px;color:#00ff88;animation:winPulse 2s infinite;margin-bottom:6px;">CHIẾN THẮNG!</div>`;
        html += `<div style="font-size:20px;color:#fff;font-family:monospace;margin-bottom:22px;opacity:0.9;">${winnerName}</div>`;

        if (allWinners && allWinners.length > 0) {
            html += `<div style="font-size:12px;color:#aaa;font-family:monospace;letter-spacing:2px;margin-bottom:10px;">XẾP HẠNG</div>`;
            allWinners.forEach((n, i) => {
                const medals = ['🥇','🥈','🥉'];
                html += `<div style="font-size:15px;color:${i===0?'#ffd700':i===1?'#c0c0c0':'#cd7f32'};font-family:monospace;margin-bottom:4px;">${medals[i]||'  '} ${n}</div>`;
            });
            html += `<div style="margin-top:18px;"></div>`;
        }

        if (isFinal) {
            // 2 player hoac chi con 2: dem nguoc ve lobby
            html += `<div id="winCountdown" style="font-size:14px;color:#aaa;font-family:monospace;margin-top:8px;">Tro ve sanh... <span id="winCdNum">8</span>s</div>`;
        } else {
            // Nhieu player: co nut thoat va xem tiep
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
            // Dem nguoc 8 giay roi ve lobby
            let cd = 8;
            const cdInterval = setInterval(() => {
                cd--;
                const el = document.getElementById('winCdNum');
                if (el) el.textContent = cd;
                if (cd <= 0) {
                    clearInterval(cdInterval);
                    overlay.remove();
                    try { document.exitPointerLock?.(); } catch(e) {}
                    try { if (currentRoom) leaveRoom(currentRoom, isHost); } catch(e) {}
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
                try { if (currentRoom) leaveRoom(currentRoom, isHost); } catch(e) {}
                destroyInput();
                showLobby();
            };
            if (btnSpectate) btnSpectate.onclick = () => {
                overlay.remove();
                isSpectator = true;
                raceFinished = true; // khong check ring nua
                hideHudAndRings();
                // Cho phep di chuyen tu do nhu fly mode nhung co gioi han
                isFlying = true;
                verticalVelocity = 0;
                if (!isMobileDevice()) {
                    try { const lp = document.getElementById('gameCanvas')?.requestPointerLock(); if (lp?.catch) lp.catch(()=>{}); } catch(e) {}
                }
            };
        }
    }

    function onPlayerWin() {
        // Them ten minh vao danh sach thang
        if (!_winnersOrder.includes(currentName)) _winnersOrder.push(currentName);
        const playerCount = getPlayerCount();
        const isFinal = playerCount <= 2;
        showWinnerBoard(currentName, [..._winnersOrder], isFinal);
        hideHudAndRings();
        syncRaceWin();
    }

    function showRaceResult(won) {
        if (won) {
            onPlayerWin();
        } else {
            // Thua: chi hien thong bao nho, khong spectate
            const old = document.getElementById('raceResult'); if (old) old.remove();
            const div = document.createElement('div');
            div.id = 'raceResult';
            div.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9998;pointer-events:none;`;
            div.innerHTML = `<div style="font-size:54px;font-weight:900;font-family:monospace;letter-spacing:5px;color:#ff3344;
                text-shadow:0 0 40px #ff3344,0 0 80px #ff3344cc;animation:raceResultPop 0.5s cubic-bezier(.17,.67,.3,1.3);">
                💀 THUA RỒI...</div>`;
            if (!document.getElementById('racePopStyle')) {
                const st = document.createElement('style');
                st.id = 'racePopStyle';
                st.textContent = `@keyframes raceResultPop{from{transform:scale(0.2) rotate(-8deg);opacity:0;}to{transform:scale(1) rotate(0);opacity:1;}}`;
                document.head.appendChild(st);
            }
            document.body.appendChild(div);
            setTimeout(() => { div.style.transition='opacity 1s'; div.style.opacity='0'; setTimeout(()=>div.remove(),1000); }, 3500);
        }
    }
    _showRaceResultFn = showRaceResult;

    // Update uTime cho rings
    function updateRings(nowMs) {
        const t = nowMs * 0.001;
        if (ring1.visible) {
            ring1.material.uniforms.uTime.value = t;
            ring1._halo.material.uniforms.uTime.value = t;
            ring1Parts.material.uniforms.uTime.value  = t;
        }
        if (ring2.visible) {
            ring2.material.uniforms.uTime.value = t;
            ring2._halo.material.uniforms.uTime.value = t;
            ring2Parts.material.uniforms.uTime.value  = t;
        }
    }

    // Kiem tra player cham ring
    function checkRingCollisions(mySphere) {
        if (raceFinished) return;
        const px = mySphere.position.x, py = mySphere.position.y, pz = mySphere.position.z;

        // Ring 1: checkpoint
        if (!myCheckpointDone && ring1.visible) {
            const dx = px - CP_POS.x, dz = pz - CP_POS.z;
            if (Math.sqrt(dx*dx + dz*dz) < RING_DETECT_DIST && Math.abs(py - CP_POS.y) < RING_RADIUS * 1.5) {
                myCheckpointDone = true;
                // An ring 1
                ring1.visible = false; ring1._halo.visible = false; ring1Parts.visible = false;
                // Hien ring 2
                ring2.visible = true; ring2._halo.visible = true; ring2Parts.visible = true;
                // Bat dau checkpoint cam: ghim vao Ring 2 roi quay lai
                startCheckpointCam(performance.now());
                syncRaceCheckpoint();
            }
        }

        // Ring 2: finish (chi check khi da qua ring 1)
        if (myCheckpointDone && ring2.visible) {
            const dx = px - FIN_POS.x, dz = pz - FIN_POS.z;
            if (Math.sqrt(dx*dx + dz*dz) < RING_DETECT_DIST && Math.abs(py - FIN_POS.y) < RING_RADIUS * 1.5) {
                raceFinished = true;
                showRaceResult(true);
            }
        }
    }

    const camHeightOffset = 1.5;
    const defaultCamDistance = 5;   // khoang cach camera → player (third-person)
    const CAM_COLLISION_BUFFER = 0.3;

    const CAM_MIN_DISTANCE = 0.6;
    const NETWORK_SYNC_INTERVAL_MS = NETWORK_SYNC_INTERVAL;

    // ===== Speed/Nitro constants =====
    const BASE_SPEED = 0.3;
    const MAX_SPEED = 0.45;
    const SPEED_ACCEL = 0.005;
    const SPEED_DECEL = 0.015;
    const SPEED_TURN_PENALTY = 0.008;
    const NITRO_DRAIN_RATE = 0.004;
    const NITRO_REGEN_RATE = 0.002;
    const NITRO_REGEN_DELAY = 3000;
    const NITRO_MULTIPLIER = 1.5;

    // ===== Slope / Doc =====
    // Toc do lui co dinh 15km/h ~ 1/3 BASE_SPEED (BASE ~ 45km/h equiv)
    const BACK_SPEED = 0.100;
    // He so do doc: slope trong [-1, 1], am = len doc, duong = xuong doc
    // SLOPE_STRENGTH: muc anh huong toi da (don vi speed/frame per unit slope)
    const SLOPE_STRENGTH = 0.10;   // +/-10% speed tren moi 1 don vi sin(angle)
    const SLOPE_MAX      = 0.08;   // gioi han toi da bien doi toc do vi slope

    let currentSpeed  = BASE_SPEED;
    let bodyYaw       = look.yaw; // Huong that su cua toan than
    const inertiaVec  = new THREE.Vector3(); // Huong truot inertia
    // Ground normal tu applyGravity (luu lai moi frame)
    let _groundNormal = new THREE.Vector3(0, 1, 0);

    // GTA V anim state
    let prevLookYaw    = look.yaw;   // look.yaw frame truoc (do yaw velocity)
    let animLockUntil  = 0;          // ms: khoa anim de turn hoan thanh
    let moveResyncUntil = 0;         // ms: sau turn, bat buoc cho move chay lai it nhat 1 nhip
                                      // de banh xe duoc dong bo lai (tranh ket goc turn cu)
    let quickTurnAccum = 0;          // tich luy goc quay nhanh khi idle
    let _wheelState    = 'idle';     // trang thai banh xe hien tai
    const TURN_ANIM_MS  = 480;       // ms: thoi gian turn anim khi idle
    const TURN_MOVE_MS  = 320;       // ms: thoi gian turn anim khi di chuyen
    const MOVE_RESYNC_MS = 220;      // ms: thoi gian "nghi" bat buoc o move/idle giua 2 lan turn
    const prevKeys = { w:false, a:false, s:false, d:false }; // keys frame truoc

    // Wheel rotation tracking
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
    let _firstGameFrame = true; // force idle ngay khi vao game

    // ===== HUD: Nitro Bar =====
    (function createNitroBar() {
        const ex = document.getElementById('nitroHUD'); if (ex) ex.remove();
        const div = document.createElement('div');
        div.id = 'nitroHUD';
        div.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;z-index:10;pointer-events:none;min-width:200px;';
        div.innerHTML = '<div style="font-size:11px;color:#aaa;letter-spacing:2px;font-family:monospace;">NITRO</div><div id="nitroBarBg" style="width:200px;height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden;border:1px solid rgba(255,255,255,0.2);"><div id="nitroBarFill" style="height:100%;width:100%;background:linear-gradient(90deg,#00ccff,#00ff88);border-radius:4px;transition:width 0.05s linear,background 0.3s;"></div></div>';
        document.body.appendChild(div);
    })();

    // ===== HUD: Compass =====
    (function createCompass() {
        const ex = document.getElementById('compassHUD'); if (ex) ex.remove();
        const div = document.createElement('div');
        div.id = 'compassHUD';
        div.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:2px;';
        div.innerHTML = '<div style="width:280px;height:28px;background:rgba(0,0,0,0.55);border-radius:6px;border:1px solid rgba(255,255,255,0.15);overflow:hidden;position:relative;"><canvas id="compassCanvas" width="280" height="28" style="display:block;"></canvas><div id="compassNeedle" style="position:absolute;top:0;left:50%;width:2px;height:100%;background:rgba(255,80,80,0.8);transform:translateX(-50%);"></div></div><div id="compassDir" style="font-size:12px;color:#eee;font-family:monospace;letter-spacing:1px;margin-top:1px;">B</div>';
        document.body.appendChild(div);
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

    const COMPASS_POINTS = [
        {label:'B',angle:0},{label:'DB',angle:45},{label:'D',angle:90},{label:'DN',angle:135},
        {label:'N',angle:180},{label:'TN',angle:225},{label:'T',angle:270},{label:'TB',angle:315}
    ];
    function updateCompass(yaw) {
        const canvas = document.getElementById('compassCanvas'); if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        let yawDeg = ((-yaw) * 180 / Math.PI) % 360;
        if (yawDeg < 0) yawDeg += 360;
        const scale = w / 90;
        for (const pt of COMPASS_POINTS) {
            let diff = pt.angle - yawDeg;
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            const px = w / 2 + diff * scale;
            if (px < -20 || px > w + 20) continue;
            const isMain = ['B','N','D','T'].includes(pt.label);
            ctx.fillStyle = pt.label === 'B' ? '#ff5555' : isMain ? '#ffffff' : 'rgba(200,200,200,0.7)';
            ctx.font = isMain ? 'bold 11px monospace' : '9px monospace';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(pt.label, px, h / 2);
            ctx.fillStyle = isMain ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
            ctx.fillRect(px - 0.5, h - 4, 1, 4);
        }
        const dirEl = document.getElementById('compassDir');
        if (dirEl) {
            const idx = Math.round(yawDeg / 45) % 8;
            dirEl.textContent = COMPASS_POINTS[idx]?.label || 'B';
        }
    }

    // ===== Game Loop =====
    function animate() {
        requestAnimationFrame(animate);
        const nowMs = performance.now();
        const delta = Math.min((nowMs - lastFrameTime) / 1000, 0.1);
        lastFrameTime = nowMs;

        if (isCutscene || isPostCutscene) {
            try { updateCutsceneCamera(nowMs); } catch(e) {}
            try { updatePlayerAnimations(delta); } catch(e) {}
            try { renderer.render(scene, mainCamera); } catch(e) {}
            return;
        }

        // Block di chuyen + camera trong khi checkpoint cam dang chay
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

        // Force play idle ngay khi vao game (frame dau tien)
        if (_firstGameFrame) {
            _firstGameFrame = false;
            try {
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                playAnimation(myIdx, ANIM.IDLE, 0);
            } catch(e) {}
        }

        const nearbyMeshes = queryNearbyMeshes(mySphere.position.x, mySphere.position.z);

        // ===== Nitro Logic =====
        try {
            if (!isFlying) {
                if (nitro.active && !nitro.depleted) {
                    nitro.value = Math.max(0, nitro.value - NITRO_DRAIN_RATE);
                    if (nitro.value <= 0) { nitro.depleted = true; nitro.regenDelay = nowMs + NITRO_REGEN_DELAY; }
                } else {
                    if (nitro.depleted) {
                        if (nowMs >= nitro.regenDelay) {
                            nitro.value = Math.min(1, nitro.value + NITRO_REGEN_RATE);
                            if (nitro.value >= 1) nitro.depleted = false;
                        }
                    } else {
                        nitro.value = Math.min(1, nitro.value + NITRO_REGEN_RATE);
                    }
                }
                updateNitroBar(nitro.value, nitro.depleted);
            }
        } catch(e) {}

        // ===== Physics =====
        try {
            if (isSpectator) {
                // Spectator: di chuyen tu do nhu fly nhung co gioi han
                verticalVelocity = 0; isGrounded = false;
                const SPEC_SPEED = BASE_SPEED * 1.2;
                // Xuong (ctrl/shift/c)
                if (keys['control'] || keys['c'] || keys['shift']) {
                    const newY = mySphere.position.y - SPEC_SPEED;
                    // Kiem tra khong di xuyen dat/san
                    const gravCheck = applyGravity(mySphere, -1, false, nearbyMeshes, { isHost });
                    mySphere.position.y = Math.max(gravCheck.isGrounded ? mySphere.position.y : newY, newY);
                    checkWallCollisions(mySphere.position, new THREE.Vector3(0,-SPEC_SPEED,0), nearbyMeshes, getModelHalfWidth());
                }
                // Len (space) - gioi han Y100
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
                // Space trong fly mode: di chuyen len - chi len neu tren dau trong
                if (keys[' ']) {
                    const headBlocked = checkHeadBlocked(mySphere.position, nearbyMeshes, 2.5);
                    if (!headBlocked) mySphere.position.y += BASE_SPEED;
                }
            }
        } catch(e) {}

        // ===== Movement + Speed + Animation (GTA V style) =====
        // Skip movement logic hoan toan neu la spectator (chi camera tu do)
        if (isSpectator) {
            // Spectator: di chuyen theo huong camera nhin
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
                    checkWallCollisions(mySphere.position, mv, nearbyMeshes, getModelHalfWidth());
                    // Gioi han Y
                    if (mySphere.position.y > SPECTATOR_Y_MAX) mySphere.position.y = SPECTATOR_Y_MAX;
                }
            } catch(e) {}
            // Camera spectator: free-look theo sau model (giong third-person nhung full control)
            try {
                _camEuler.set(look.pitch, look.yaw, 0, 'YXZ');
                _eyeOffset.set(0, camHeightOffset, 0);
                _playerEyesPos.copy(mySphere.position).add(_eyeOffset);
                _finalCamPos.set(0, 0, defaultCamDistance).applyEuler(_camEuler).add(_playerEyesPos);
                mainCamera.position.copy(_finalCamPos);
                mainCamera.lookAt(_playerEyesPos);
            } catch(e) {}
            try { updatePlayerAnimations(delta); } catch(e) {}
            try {
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                updateAllLabels(mainCamera, myIdx);
            } catch(e) {}
            try { for (const lod of lodObjects) { try { lod.update(mainCamera); } catch(e) {} } } catch(e) {}
            try { renderer.render(scene, mainCamera); } catch(e) {}
            return;
        }
        // ===== Movement + Speed + Animation (GTA V style) =====
        try {
            // ---- Keys ----
            let movFwd  = keys.w, movBack = keys.s;
            let movLeft = keys.a, movRight = keys.d;
            if (isCountdownActive) {
                movFwd = false;
                movBack = false;
                movLeft = false;
                movRight = false;
                keys.w = false;
                keys.s = false;
                keys.a = false;
                keys.d = false;
                keys[' '] = false;
                keys.shift = false;
                nitro.active = false;
                
                look.yaw = DN_YAW;
                look.pitch = DN_PITCH;
                bodyYaw = DN_YAW;
                try {
                    mySphere.rotation.y = DN_YAW;
                } catch(e) {}
            }
            const isMoving   = movFwd || movBack || movLeft || movRight;
            const isPureBack = movBack && !movFwd && !movLeft && !movRight;
            const holdShift  = keys.shift || keys.control;

            // ---- Nitro ----
            const nitroActive = nitro.active && !nitro.depleted && !isFlying;
            const nitroMult   = nitroActive ? NITRO_MULTIPLIER : 1.0;

            // ---- Helper ----
            function normA(a){ while(a> Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; }

            /**
             * Tinh he so doc (+): xuong doc tang toc, (-): len doc giam toc.
             * movDir: THREE.Vector3 huong di chuyen (da normalize, trong world space).
             * Tra ve gia tri trong [-SLOPE_MAX, +SLOPE_MAX].
             */
            function getSlopeDelta(movDir) {
                if (!isGrounded) return 0;
                // slope vector = chieu nghieng cua mat dat: normal x (normal x up)
                // Don gian hon: sin(angle) ~ 1 - normal.y (goc nho)
                // Huong doc ngang: groundNormal chieu len truc horizontal
                // dot(movDir, -groundNormal_horizontal) > 0 = len doc
                const nx = _groundNormal.x;
                const nz = _groundNormal.z;
                const slopeMag = Math.sqrt(nx * nx + nz * nz); // sin(angle)
                if (slopeMag < 0.01) return 0; // mat phang
                // Huong doc ngang (huong doc xuong thap nhat)
                const downhillX = nx / slopeMag;
                const downhillZ = nz / slopeMag;
                // dot: duong = movDir xuong doc, am = len doc
                const dot = movDir.x * downhillX + movDir.z * downhillZ;
                return Math.max(-SLOPE_MAX, Math.min(SLOPE_MAX, dot * slopeMag * SLOPE_STRENGTH * 10));
            }

            // ---- Yaw velocity (do nhanh cham khi quay camera) ----
            const frameYawDelta = normA(look.yaw - prevLookYaw);
            prevLookYaw = look.yaw;

            // lookDelta = goc giua camera va than nguoi
            const lookDelta = normA(look.yaw - bodyYaw);
            const absLD     = Math.abs(lookDelta);

            // ============================================================
            //  ANIMATION LOCK: khi turn dang phat phai phat xong moi doi
            // ============================================================
            const now = nowMs;
            const locked = now < animLockUntil;

            // ============================================================
            //  IDLE (khong di chuyen + toc do ve 0)
            // ============================================================
            if (!isMoving && currentSpeed < 0.01) {

                // Inertia: truot them neu con toc do
                // (da reset o duoi)

                // --- Phat hien quay nhanh/cham ---
                // quay nhanh = |frameYawDelta| > nguong (~ 1.5 do/frame)
                const FAST_RAD = 0.026; // ~1.5 deg/frame
                const IDLE_TURN_DEG = 25 * Math.PI / 180; // 25 do tich luy

                // Tich luy goc nhanh ke tu lan cuoi than nguoi quay.
                // CHI tich luy khi KHONG bi lock (turn anim dang phat) - neu khong,
                // goc quay se "bank" suot luc lock va kich hoat turn moi NGAY khi
                // vua het lock, khien turn anim noi duoi nhau lien tuc va banh xe
                // (it co trong turn_left/turn_right) khong bao gio duoc "move/idle"
                // chay lai de tro ve dung vi tri.
                if (!locked) {
                    if (Math.abs(frameYawDelta) >= FAST_RAD) {
                        quickTurnAccum += frameYawDelta;
                    } else {
                        quickTurnAccum *= 0.85; // tan dan
                    }
                }

                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);

                if (!locked && Math.abs(quickTurnAccum) >= IDLE_TURN_DEG) {
                    // Quay nhanh vuot nguong: play turn anim
                    const dir = quickTurnAccum > 0 ? ANIM.TURN_LEFT : ANIM.TURN_RIGHT;
                    playAnimation(myIdx, dir, 0.10);
                    animLockUntil = now + getAnimDurationMs(myIdx, dir);
                    // Snap body ngay ve look.yaw
                    bodyYaw = look.yaw;
                    mySphere.rotation.y = bodyYaw;
                    quickTurnAccum = 0;
                    _wheelState = dir === ANIM.TURN_LEFT ? 'turn_left' : 'turn_right';
                } else if (!locked) {
                    // Quay cham: idle + body smooth follow
                    playAnimation(myIdx, ANIM.IDLE, 0.2);
                    bodyYaw += normA(look.yaw - bodyYaw) * 0.06; // follow cham
                    mySphere.rotation.y = bodyYaw;
                    _wheelState = 'idle';
                } else {
                    // Van con lock: tiep tuc quay body
                    bodyYaw += normA(look.yaw - bodyYaw) * 0.12;
                    mySphere.rotation.y = bodyYaw;
                }

            // ============================================================
            //  DI LUI (toc do co dinh 15km/h, bien doi theo do doc)
            // ============================================================
            } else if (isPureBack) {
                inertiaVec.set(0,0,0);

                // Huong lui: +Z trong local, chuyen sang world
                _moveVector.set(0, 0, 1).applyQuaternion(_moveQuat.setFromAxisAngle(_moveAxisY, look.yaw));
                // Tinh slope delta theo huong lui
                const backSlopeDelta = getSlopeDelta(_moveVector);
                // Len doc giam toc, xuong doc tang toc — nhung toc do lui rat thap nen cap toi da
                const backSpeed = Math.max(0.01, Math.min(BACK_SPEED * 1.5, BACK_SPEED + backSlopeDelta));
                currentSpeed = backSpeed;

                _moveVector.multiplyScalar(backSpeed * nitroMult);
                mySphere.position.add(_moveVector);
                checkWallCollisions(mySphere.position, _moveVector, nearbyMeshes, getModelHalfWidth());

                // Body smooth follow
                bodyYaw += normA(look.yaw - bodyYaw) * 0.20;
                mySphere.rotation.y = bodyYaw;

                if (!locked) {
                    const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                    playAnimation(myIdx, ANIM.MOVE_BACK, 0.18);
                }
                _wheelState = 'move_back';
                quickTurnAccum = 0;

            // ============================================================
            //  DI CHUYEN hoac INERTIA
            // ============================================================
            } else {

                // ---- Toc do ----
                if (isMoving) {
                    if (absLD > 25 * Math.PI / 180) {
                        currentSpeed = Math.max(BASE_SPEED, currentSpeed - SPEED_TURN_PENALTY);
                    } else {
                        currentSpeed = Math.min(MAX_SPEED, currentSpeed + SPEED_ACCEL);
                    }
                } else {
                    // Inertia: giam dan
                    if (holdShift) { currentSpeed = 0; inertiaVec.set(0,0,0); }
                    else currentSpeed = Math.max(0, currentSpeed - SPEED_DECEL);
                }

                // ---- Turn detection: KEY transition + camera yaw velocity ----
                if (isMoving) {
                    const pW = prevKeys.w, pA = prevKeys.a, pD = prevKeys.d;
                    let newTurnDir = null;

                    // 1. Key-based: chuyen phim tao doi huong ro rang
                    if ((pW && !pD) && movRight && !movLeft)               newTurnDir = 'right'; // W->WD/D
                    if ((pW && !pA) && movLeft  && !movRight)              newTurnDir = 'left';  // W->WA/A
                    if (pA && !pD && movRight && !movLeft && !keys.a)      newTurnDir = 'right'; // A->D
                    if (pD && !pA && movLeft  && !movRight && !keys.d)     newTurnDir = 'left';  // D->A

                    // 2. Camera yaw velocity: quay camera nhanh khi dang di chuyen
                    const FAST_RAD_MOVE = 0.030; // nguong nhanh khi move (~1.7 deg/frame)
                    const MOVE_TURN_DEG = 22 * Math.PI / 180; // 22 do tich luy
                    // canTriggerTurn: chi cho phep tich luy/kich hoat turn moi khi
                    // KHONG con lock VA da het thoi gian "resync" bat buoc cho move.
                    // Neu thieu dieu kien nay, turn_left/turn_right co the noi duoi
                    // nhau lien tuc (vi turn_left/turn_right trong model chi quay
                    // 2/4 banh) khien move khong bao gio chay lai duoc -> banh xe
                    // con lai ket nguyen o goc turn truoc, khong tro ve vi tri lan binh thuong.
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

                    // 3. Ap dung turn hoac move
                    const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                    if (newTurnDir && canTriggerTurn) {
                        // Bat dau turn: lock animation den khi xong
                        const dir = newTurnDir === 'right' ? ANIM.TURN_RIGHT : ANIM.TURN_LEFT;
                        playAnimation(myIdx, dir, 0.08);
                        // Lock dung chinh xac bang thoi gian clip thuc te
                        animLockUntil = now + getAnimDurationMs(myIdx, dir) * 0.95;
                        // Bat buoc move duoc phat lai it nhat MOVE_RESYNC_MS sau khi
                        // turn ket thuc, de cac banh xe khong nam trong turn anim
                        // duoc dong bo lai dung vong lan banh.
                        moveResyncUntil = animLockUntil + MOVE_RESYNC_MS;
                        quickTurnAccum = 0;
                        _wheelState = newTurnDir === 'right' ? 'turn_right' : 'turn_left';
                    } else if (!canTriggerTurn) {
                        // Dang lock hoac dang trong thoi gian resync: KHONG chen
                        // turn moi vao. Chi snap body, khong doi anim (de move
                        // duoc giu nguyen, banh xe quay deu tro lai).
                        _wheelState = 'move';
                    } else {
                        // Lock het, khong co turn moi: phat move
                        playAnimation(myIdx, ANIM.MOVE, 0.15);
                        _wheelState = 'move';
                    }
                } else {
                    // Inertia (isMoving = false nhung van con toc do)
                    _wheelState = currentSpeed > 0.001 ? 'move' : 'idle';
                }

                // ---- Apply move / inertia ----
                if (isMoving) {
                    _moveVector.set(0,0,0);
                    if (movFwd)   _moveVector.z -= 1;
                    if (movLeft)  _moveVector.x -= 1;
                    if (movRight) _moveVector.x += 1;
                    _moveVector.normalize();
                    _moveQuat.setFromAxisAngle(_moveAxisY, look.yaw);
                    _moveVector.applyQuaternion(_moveQuat);

                    // Slope: tang toc xuong doc, giam toc len doc
                    const fwdSlopeDelta = getSlopeDelta(_moveVector);
                    const slopedSpeed = Math.max(BASE_SPEED * 0.3, Math.min(MAX_SPEED * 1.4, currentSpeed + fwdSlopeDelta));

                    _moveVector.multiplyScalar(slopedSpeed * nitroMult);
                    inertiaVec.copy(_moveVector).normalize();
                    mySphere.position.add(_moveVector);
                    checkWallCollisions(mySphere.position, _moveVector, nearbyMeshes, getModelHalfWidth());
                } else if (currentSpeed > 0.001) {
                    // Inertia truot
                    const iv = inertiaVec.clone().multiplyScalar(currentSpeed * nitroMult);
                    mySphere.position.add(iv);
                    checkWallCollisions(mySphere.position, iv, nearbyMeshes, getModelHalfWidth());
                    if (!locked) {
                        const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                        playAnimation(myIdx, ANIM.MOVE, 0.18);
                    }
                }

                // Body luon follow look.yaw nhanh khi di chuyen
                bodyYaw += normA(look.yaw - bodyYaw) * 0.22;
                mySphere.rotation.y = bodyYaw;
                // Khi da snap xong: reset quickTurnAccum neu goc nho
                if (absLD < 10 * Math.PI / 180) quickTurnAccum *= 0.5;
            }
            // ---- Cap nhat prevKeys ----
            prevKeys.w = movFwd; prevKeys.a = movLeft;
            prevKeys.s = movBack; prevKeys.d = movRight;

            // ---- Wheels ----
            try {
                // Khởi tạo vị trí tham chiếu frame đầu
                if (!_wheelPosInit) {
                    _prevSpherePos.copy(mySphere.position);
                    _prevBodyYaw = bodyYaw;
                    _wheelPosInit = true;
                }
                // Quãng đường di chuyển trong frame (chỉ tính trục XZ)
                const dx = mySphere.position.x - _prevSpherePos.x;
                const dz = mySphere.position.z - _prevSpherePos.z;
                const distMoved = Math.sqrt(dx * dx + dz * dz);
                // Delta góc thân xe
                let dyaw = bodyYaw - _prevBodyYaw;
                while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
                while (dyaw < -Math.PI) dyaw += Math.PI * 2;

                updateWheelRotation(_wheelState, distMoved, dyaw);

                _prevSpherePos.copy(mySphere.position);
                _prevBodyYaw = bodyYaw;
            } catch(e) {}

            // ---- Head + Neck look (luon chay) ----
            updateHeadLook(look.yaw, look.pitch, bodyYaw, isPureBack, delta * 1000);

        } catch(e) { console.warn('[Movement]', e); }



        // ===== Camera =====
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

        // ===== Update animation mixers =====
        try { updatePlayerAnimations(delta); } catch(e) {}

        // ===== HUD =====
        try {
            const hudX = document.getElementById('hudX');
            const hudY = document.getElementById('hudY');
            const hudZ = document.getElementById('hudZ');
            if (hudX) hudX.textContent = mySphere.position.x.toFixed(2);
            if (hudY) hudY.textContent = mySphere.position.y.toFixed(2);
            if (hudZ) hudZ.textContent = mySphere.position.z.toFixed(2);
        } catch(e) {}

        // ===== Compass =====
        try { updateCompass(look.yaw); } catch(e) {}

        // ===== Network sync =====
        try {
            if (currentRoom && nowMs - lastNetworkSync >= NETWORK_SYNC_INTERVAL_MS) {
                lastNetworkSync = nowMs;
                const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
                const mySlot = isHost ? 'p0' : mySlotKey;
                const myAnim = getPlayerCurrentAnim(myIdx);
                syncPosition(currentRoom, mySlot, mySphere.position, bodyYaw, myAnim);
            }
        } catch(e) {}

        // ===== RINGS =====
        try { updateRings(nowMs); } catch(e) {}
        try { checkRingCollisions(mySphere); } catch(e) {}

        // ===== Labels =====
        try {
            const myIdx = isHost ? 0 : (mySlotKey ? parseInt(mySlotKey.slice(1)) : 0);
            updateAllLabels(mainCamera, myIdx);
        } catch(e) {}

        // ===== LOD update =====
        try { for (const lod of lodObjects) { try { lod.update(mainCamera); } catch(e) {} } } catch(e) {}

        // ===== Render =====
        try { renderer.render(scene, mainCamera); } catch(e) {}
    }
    animate();

    window.addEventListener('resize', () => {
        try {
            if (!mainCamera || !renderer) return;
            mainCamera.aspect = window.innerWidth / window.innerHeight;
            mainCamera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        } catch(e) {}
    });

    // Headless testing autoPlay helper
    setTimeout(() => {
        if (new URLSearchParams(window.location.search).get('autoPlay') === 'true') {
            console.log('[AutoPlay] Triggered');
            const nameInput = document.getElementById('playerName');
            if (nameInput) nameInput.value = 'AutoTester';
            const testBtn = document.getElementById('testBtn');
            if (testBtn) testBtn.click();
        }
    }, 1000);
}