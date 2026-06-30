// src/player/playerManager.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SPAWN_POINTS } from '../core/physics.js';
import { VEHICLES_CONFIG } from '../config/vehicles.js';

// ===== 3D Spatial Sound System =====
let _audioCtx = null;
const _soundBuffers = {};  // cache buffer theo url
let _listenerPos = new THREE.Vector3(); // vị trí local player (listener)

function _getAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume nếu bị suspend (browser policy)
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

async function _loadSound(url) {
    if (_soundBuffers[url]) return _soundBuffers[url];
    try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        const ctx = _getAudioCtx();
        const buf = await ctx.decodeAudioData(arr);
        _soundBuffers[url] = buf;
        return buf;
    } catch(e) {
        console.warn('[Sound] Failed to load:', url, e);
        return null;
    }
}

/**
 * Phát âm thanh 3D tại vị trí thế giới (soundPos).
 * Âm lượng giảm dần theo khoảng cách đến listener.
 * @param {string} url - đường dẫn file âm thanh
 * @param {THREE.Vector3} soundPos - vị trí phát âm thanh trong thế giới
 * @param {number} [maxDist=20] - khoảng cách tối đa nghe được
 * @param {number} [volume=1.0] - âm lượng tối đa
 */
export async function playSpatialSound(url, soundPos, maxDist = 20, volume = 1.0) {
    try {
        const buf = await _loadSound(url);
        if (!buf) return;
        const ctx = _getAudioCtx();

        // Tính âm lượng dựa vào khoảng cách
        const dist = _listenerPos.distanceTo(soundPos);
        if (dist > maxDist) return; // Quá xa, không nghe được
        const gain = volume * Math.max(0, 1 - dist / maxDist);

        const gainNode = ctx.createGain();
        gainNode.gain.value = gain;

        // Panning trái/phải đơn giản dựa vào góc ngang
        const dx = soundPos.x - _listenerPos.x;
        const dz = soundPos.z - _listenerPos.z;
        const panner = ctx.createStereoPanner();
        const angle = Math.atan2(dx, -dz); // góc so với hướng nhìn
        panner.pan.value = Math.max(-1, Math.min(1, Math.sin(angle) * (dist / maxDist)));

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(ctx.destination);
        src.start();
    } catch(e) {
        console.warn('[Sound] playSpatialSound error:', e);
    }
}

/** Cập nhật vị trí listener (gọi mỗi frame từ main.js) */
export function updateSoundListener(pos) {
    _listenerPos.copy(pos);
}

/**
 * Phát âm thanh 2D (UI / countdown / beep), không phụ thuộc vị trí, không giảm âm theo khoảng cách.
 * @param {string} url - đường dẫn file âm thanh
 * @param {number} [volume=1.0] - âm lượng (0..1)
 */
export async function playUiSound(url, volume = 1.0) {
    try {
        const buf = await _loadSound(url);
        if (!buf) return;
        const ctx = _getAudioCtx();

        const gainNode = ctx.createGain();
        gainNode.gain.value = volume;

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gainNode);
        gainNode.connect(ctx.destination);
        src.start();
    } catch(e) {
        console.warn('[Sound] playUiSound error:', e);
    }
}

// ===== Loop Sound System (move / brakes) =====
// Mỗi "slot" là một AudioBufferSourceNode đang chạy loop
const _loopSounds = {
    move:   { node: null, gainNode: null, url: null, loading: false },
    brakes: { node: null, gainNode: null, url: null, loading: false },
};

/**
 * Bắt đầu phát âm thanh loop.
 * Dùng flag loading để tránh race condition khi await chưa xong.
 */
async function _startLoopSound(slot, soundDef, volume = 1.0) {
    const url = (typeof soundDef === 'string') ? soundDef : Object.values(soundDef)[0];
    if (!url) return;

    const s = _loopSounds[slot];
    // Đang phát / đang load đúng url rồi → bỏ qua
    if (s.url === url && (s.node || s.loading)) return;

    s.loading = false;
    _stopLoopSound(slot);
    s.url = url;
    s.loading = true;

    try {
        const buf = await _loadSound(url);
        // Nếu trong lúc await đã bị stop → huỷ
        if (!s.loading || s.url !== url) return;
        if (!buf) { s.loading = false; return; }

        const ctx = _getAudioCtx();
        const gainNode = ctx.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(ctx.destination);

        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.loop = true;
        node.connect(gainNode);
        node.start();

        s.node = node;
        s.gainNode = gainNode;
        s.loading = false;
    } catch(e) {
        s.loading = false;
        console.warn('[Sound] _startLoopSound error:', slot, e);
    }
}

/** Dừng một slot loop sound */
function _stopLoopSound(slot) {
    const s = _loopSounds[slot];
    s.loading = false;
    s.url = null;
    if (s.node) {
        try { s.node.stop(); } catch(_) {}
        try { s.node.disconnect(); } catch(_) {}
        s.node = null;
    }
    if (s.gainNode) {
        try { s.gainNode.disconnect(); } catch(_) {}
        s.gainNode = null;
    }
}

/**
 * Gọi mỗi frame từ main.js để cập nhật loop sounds của local player.
 * @param {boolean} isMoving    - đang nhấn phím di chuyển
 * @param {boolean} holdShift   - đang giữ shift
 * @param {number}  currentSpeed - tốc độ hiện tại (để detect quán tính)
 * @param {string}  vehicleId
 */
export function updateLoopSounds(isMoving, holdShift, currentSpeed, vehicleId) {
    const vConfig = VEHICLES_CONFIG[vehicleId] || VEHICLES_CONFIG.xelan;
    const sounds = vConfig.sounds || {};
    const isActuallyMoving = isMoving || currentSpeed > 0.01;

    if (holdShift && isActuallyMoving) {
        // Giữ shift VÀ đang chuyển động: phát brakes, tắt move
        _stopLoopSound('move');
        if (sounds.brakes) _startLoopSound('brakes', sounds.brakes, 0.7);
    } else if (!holdShift && isActuallyMoving) {
        // Di chuyển bình thường / quán tính: phát move, tắt brakes
        _stopLoopSound('brakes');
        if (sounds.move) _startLoopSound('move', sounds.move, 0.8);
    } else {
        // Đứng yên (dù có giữ shift hay không): tắt cả hai
        _stopLoopSound('move');
        _stopLoopSound('brakes');
    }
}

/** Dừng tất cả loop sound (gọi khi thoát game) */
export function stopAllLoopSounds() {
    _stopLoopSound('move');
    _stopLoopSound('brakes');
}

const _labelTempV = new THREE.Vector3();

// ===== Player instances =====
let playerSpheres = [null, null, null, null, null, null];
let playerLabels = [null, null, null, null, null, null];
let playerModels = [null, null, null, null, null, null];

// Animation
let playerMixers = [null, null, null, null, null, null];
let playerActions = [{}, {}, {}, {}, {}, {}];
let playerCurrentAnims = [null, null, null, null, null, null];

// Vehicle state
let playerVehicles = ['xelan', 'xelan', 'xelan', 'xelan', 'xelan', 'xelan'];
export let playerHPs = [100, 100, 100, 100, 100, 100];
export let playerMaxHPs = [100, 100, 100, 100, 100, 100];
export let playerInvulnerables = [false, false, false, false, false, false];
let playerHalfWidths = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];

// Bones (local player only)
let boneHead = null;
let boneNeck = null;
let myIndexGlobal = 0; // index local player (0..5)

// Head smooth state
let _headAngle = 0;
let _headPitch = 0;

// ===== Wheel Rotation =====
const WHEEL_RADIUS = 0.38;          // bán kính bánh xe
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS; // chu vi
const WHEEL_TURN_DIFF = 0.32;  // mỗi radian yaw thân xe → ±0.32 rad chênh lệch mỗi bên
const WHEEL_IDLE_LOOK_FACTOR = 0.15; // mỗi radian look.yaw thay đổi → bánh quay 0.15 rad

// Góc tích lũy của từng bánh cho cả 6 người chơi
const _playerWheelAngles = Array.from({ length: 6 }, () => ({
    rearRight: 0,
    frontRight: 0,
    rearLeft: 0,
    frontLeft: 0,
    singleWheel: 0
}));

// Tham chiếu đến mesh bánh của cả 6 người chơi
const _playerWheelMeshes = Array.from({ length: 6 }, () => ({
    rearRight: null,
    frontRight: null,
    rearLeft: null,
    frontLeft: null,
    singleWheel: null
}));

// Last positions to calculate wheel rotation for remote players
const _lastRemotePositions = Array.from({ length: 6 }, () => new THREE.Vector3());
const _lastRemoteYaws = new Array(6).fill(0);
const _remotePosInit = new Array(6).fill(false);

const HEAD_SMOOTH     = 0.18;
const HEAD_TURN_RATIO = 0.90;
const NECK_TURN_RATIO = 0.10;
const HEAD_TURN_MAX   = Math.PI * 0.50;   // 90 deg yaw
const HEAD_MOVING_MAX = Math.PI * 0.61;   // 110 deg khi lui
const HEAD_PITCH_MAX  = Math.PI * 0.25;   // 45 deg pitch

// Draco
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');

// Anim index map (0-based GLTF)
export const ANIM = { ATTACK: 1, IDLE: 2, MOVE: 3, MOVE_BACK: 4, TURN_LEFT: 5, TURN_RIGHT: 6 };

export function setMyIndex(index) {
    myIndexGlobal = index;
    const model = playerModels[index];
    if (model) {
        let fHead = null, fNeck = null;
        model.traverse((child) => {
            if (!child.name) return;
            const n = child.name;
            const nl = n.toLowerCase();
            if (n === 'mixamorig:Head_06' || nl.includes('head_06') || nl.includes('head06')) fHead = child;
            if (n === 'mixamorig:Neck_05' || nl.includes('neck_05') || nl.includes('neck05')) fNeck = child;
        });
        boneHead = fHead;
        boneNeck = fNeck;
    }
}

export function getPlayerCurrentAnim(index) {
    return playerCurrentAnims[index];
}

export function getPlayerHalfWidth(index) {
    return playerHalfWidths[index] !== undefined ? playerHalfWidths[index] : 1.0;
}

// ===== Init =====
export function initPlayers(scene, roomData, labelsContainer, loadingManager) {
    const geo = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ visible: false });

    // Reset dữ liệu
    playerSpheres = [null, null, null, null, null, null];
    playerLabels = [null, null, null, null, null, null];
    playerModels = [null, null, null, null, null, null];
    playerMixers = [null, null, null, null, null, null];
    playerActions = [{}, {}, {}, {}, {}, {}];
    playerCurrentAnims = [null, null, null, null, null, null];
    playerVehicles = ['xelan', 'xelan', 'xelan', 'xelan', 'xelan', 'xelan'];
    playerHPs = [100, 100, 100, 100, 100, 100];
    playerMaxHPs = [100, 100, 100, 100, 100, 100];
    playerInvulnerables = [false, false, false, false, false, false];
    playerHalfWidths = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    boneHead = null;
    boneNeck = null;

    for (let i = 0; i < 6; i++) {
        _playerWheelMeshes[i] = { rearRight: null, frontRight: null, rearLeft: null, frontLeft: null, singleWheel: null };
        _playerWheelAngles[i] = { rearRight: 0, frontRight: 0, rearLeft: 0, frontLeft: 0, singleWheel: 0 };
        _remotePosInit[i] = false;
    }

    labelsContainer.innerHTML = '';

    const loader = new GLTFLoader(loadingManager || new THREE.LoadingManager());
    loader.setDRACOLoader(dracoLoader);

    // Xác định spawn points từ cấu hình map hiện tại nếu có
    const currentSpawns = roomData?.spawnPoints || SPAWN_POINTS;

    for (let i = 0; i < 6; i++) {
        const sphere = new THREE.Mesh(geo, mat.clone());
        const spawnPos = currentSpawns[i] || SPAWN_POINTS[i];
        sphere.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
        scene.add(sphere);
        playerSpheres[i] = sphere;

        const label = document.createElement('div');
        label.className = 'player-label';
        label.style.display = 'none';
        labelsContainer.appendChild(label);
        playerLabels[i] = label;
    }

    // Set label tên trước nếu có sẵn roomData
    const players = roomData?.players || {};
    const playersInfo = roomData?.playersInfo || {};
    for (let i = 0; i < 6; i++) {
        const name = players[`p${i}`];
        if (name && playerLabels[i]) {
            playerLabels[i].textContent = name;
        }
    }

    // Preload các model phương tiện cần thiết và clone
    const vehiclesToLoad = ['xelan', 'xerua'];
    const loadedGltfs = {};
    let loadedCount = 0;

    vehiclesToLoad.forEach(vId => {
        const vConfig = VEHICLES_CONFIG[vId];
        loader.load(vConfig.modelPath, gltf => {
            loadedGltfs[vId] = gltf;
            loadedCount++;

            if (loadedCount === vehiclesToLoad.length) {
                // Tất cả các model đã tải xong, thiết lập cho 6 người chơi
                for (let i = 0; i < 6; i++) {
                    const name = players[`p${i}`];
                    // Nếu là slot có người chơi hoặc là local player (i === myIndexGlobal)
                    if (name || i === myIndexGlobal) {
                        const pInfo = playersInfo[`p${i}`] || {};
                        const vIdSelected = pInfo.vehicle || 'xelan';
                        const gltfObj = loadedGltfs[vIdSelected] || loadedGltfs['xelan'];

                        if (gltfObj) {
                            try {
                                const clonedScene = SkeletonUtils.clone(gltfObj.scene);
                                const clonedGltf = {
                                    scene: clonedScene,
                                    animations: gltfObj.animations
                                };
                                setupModel(clonedGltf, i, vIdSelected);
                            } catch(e) {
                                console.error(`[setupModel error player ${i}]`, e);
                            }
                        }
                    }
                }
            }
        }, undefined, e => console.warn('[ModelLoad Error]', vConfig.modelPath, e));
    });

    return { hostSphere: playerSpheres[0], guestSphere: playerSpheres[1] };
}

function setupModel(gltf, index, vehicleId) {
    const sphere = playerSpheres[index];
    if (!sphere) return;
    const model = gltf.scene;
    model.scale.set(1.3, 1.3, 1.3);

    playerVehicles[index] = vehicleId;
    const vConfig = VEHICLES_CONFIG[vehicleId] || VEHICLES_CONFIG.xelan;
    
    // Cài đặt lượng máu
    playerMaxHPs[index] = vConfig.hp;
    playerHPs[index] = vConfig.hp;

    // Thiết lập kích thước né tránh (hitbox)
    const hs = vConfig.hitboxSize;
    playerHalfWidths[index] = Math.max(hs.x, hs.z) * 0.5;

    // Tạo custom hitbox mesh ẩn để bắn raycast cận chiến chuẩn xác
    const oldHitbox = sphere.getObjectByName("playerHitbox");
    if (oldHitbox) sphere.remove(oldHitbox);

    const hitboxGeo = new THREE.BoxGeometry(hs.x, hs.y, hs.z);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false }); // Ẩn hoàn toàn
    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
    hitboxMesh.position.set(0, hs.y / 2 - 1.0, 0); // Canh giữa theo chiều cao
    hitboxMesh.name = "playerHitbox";
    hitboxMesh.userData = { playerIndex: index }; // Lưu lại index người chơi
    sphere.add(hitboxMesh);

    let fHead = null, fNeck = null;
    let wRearRight  = null;
    let wFrontRight = null;
    let wRearLeft   = null;
    let wFrontLeft  = null;
    let wSingleWheel = null;

    model.traverse((child) => {
        if (!child.name) return;
        const n = child.name;
        const nl = n.toLowerCase();

        // Head / Neck bones
        if (n === 'mixamorig:Head_06' || nl.includes('head_06') || nl.includes('head06')) fHead = child;
        if (n === 'mixamorig:Neck_05' || nl.includes('neck_05') || nl.includes('neck05')) fNeck = child;

        // Tìm bánh xe
        if (vConfig.wheels.type === "four_wheels") {
            const wNames = vConfig.wheels.names;
            if (n === wNames.rearRight)  wRearRight  = child;
            if (n === wNames.frontRight) wFrontRight = child;
            if (n === wNames.rearLeft)   wRearLeft   = child;
            if (n === wNames.frontLeft)  wFrontLeft  = child;
        } else if (vConfig.wheels.type === "single_wheel") {
            if (n === vConfig.wheels.name || nl.includes('wheel')) wSingleWheel = child;
        }

        if (child.isMesh) { child.castShadow = false; child.receiveShadow = false; }
    });

    sphere.add(model);
    model.position.set(0, -1, 0);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    if (gltf.animations?.length > 0) {
        gltf.animations.forEach((clip, idx) => {
            const a = mixer.clipAction(clip);
            a.setLoop(THREE.LoopRepeat, Infinity);
            a.clampWhenFinished = false;
            actions[idx] = a;
        });
    }

    playerModels[index] = model;
    playerMixers[index] = mixer;
    playerActions[index] = actions;

    // Gán tham chiếu xương cho local player
    if (index === myIndexGlobal) {
        boneHead = fHead;
        boneNeck = fNeck;
    }

    // Lưu trữ tham chiếu bánh xe của người chơi này
    _playerWheelMeshes[index].rearRight  = wRearRight;
    _playerWheelMeshes[index].frontRight = wFrontRight;
    _playerWheelMeshes[index].rearLeft   = wRearLeft;
    _playerWheelMeshes[index].frontLeft  = wFrontLeft;
    _playerWheelMeshes[index].singleWheel = wSingleWheel;

    // Reset góc bánh
    _playerWheelAngles[index].rearRight  = 0;
    _playerWheelAngles[index].frontRight = 0;
    _playerWheelAngles[index].rearLeft   = 0;
    _playerWheelAngles[index].frontLeft  = 0;
    _playerWheelAngles[index].singleWheel = 0;

    playAnimation(index, ANIM.IDLE);
}

// ===== Animation =====
export function getAnimDurationMs(playerIndex, animIndex) {
    const actions = playerActions[playerIndex];
    if (!actions || !actions[animIndex]) return 600;
    try { const clip = actions[animIndex].getClip(); return clip ? clip.duration * 1000 : 600; } catch(e) { return 600; }
}

export function playAnimation(playerIndex, animIndex, fadeTime = 0.18) {
    const actions = playerActions[playerIndex];
    const mixer   = playerMixers[playerIndex];
    const current = playerCurrentAnims[playerIndex];
    if (!mixer || !actions || !actions[animIndex]) return;
    if (fadeTime > 0 && current === animIndex) return;
    playerCurrentAnims[playerIndex] = animIndex;
    for (const i in actions) { if (parseInt(i) !== animIndex) actions[i].fadeOut(fadeTime); }
    actions[animIndex].reset().fadeIn(fadeTime).play();
}

export function updatePlayerAnimations(delta) {
    for (let i = 0; i < 6; i++) {
        try { if (playerMixers[i]) playerMixers[i].update(delta); } catch(e) {}
    }
}

// ===== Head Look (ngang + doc) =====
export function updateHeadLook(lookYaw, lookPitch, bodyYawRef, isMovingBack, deltaMs) {
    if (!boneHead && !boneNeck) return;

    let yd = lookYaw - bodyYawRef;
    while (yd >  Math.PI) yd -= Math.PI * 2;
    while (yd < -Math.PI) yd += Math.PI * 2;
    const maxY = isMovingBack ? HEAD_MOVING_MAX : HEAD_TURN_MAX;
    const cy   = Math.max(-maxY, Math.min(maxY, yd));

    const cp = Math.max(-HEAD_PITCH_MAX, Math.min(HEAD_PITCH_MAX, lookPitch));

    const t = Math.min(1, deltaMs * HEAD_SMOOTH);
    _headAngle += (cy - _headAngle) * t;
    _headPitch += (cp - _headPitch) * t;

    try {
        if (boneHead) {
            boneHead.rotation.y =  _headAngle * HEAD_TURN_RATIO;
            boneHead.rotation.x = -_headPitch * HEAD_TURN_RATIO;
        }
        if (boneNeck) {
            boneNeck.rotation.y =  _headAngle * NECK_TURN_RATIO;
            boneNeck.rotation.x = -_headPitch * NECK_TURN_RATIO;
        }
    } catch(e) {}
}

// ===== Wheel Rotation =====
export function updateWheelRotation(playerIdx, wheelState, distMoved, dyaw) {
    const meshes = _playerWheelMeshes[playerIdx];
    const angles = _playerWheelAngles[playerIdx];
    if (!meshes) return;

    const baseAngle = (distMoved / WHEEL_CIRCUMFERENCE) * Math.PI * 2;
    const dir = (wheelState === 'move_back') ? 1 : -1;
    const turnDiff = dyaw * WHEEL_TURN_DIFF;

    if (meshes.singleWheel) {
        // Xe rùa: chỉ có 1 bánh xe quay quanh trục X local
        if (wheelState !== 'idle') {
            angles.singleWheel += baseAngle * dir;
            try { meshes.singleWheel.rotation.x = angles.singleWheel; } catch(e) {}
        }
    } else {
        // Xe lăn: 4 bánh
        if (wheelState === 'idle') {
            const idleTurnAngle = dyaw * WHEEL_IDLE_LOOK_FACTOR * 3.0;
            angles.rearRight  += idleTurnAngle;
            angles.frontRight += idleTurnAngle;
            angles.rearLeft   -= idleTurnAngle;
            angles.frontLeft  -= idleTurnAngle;
        } else {
            angles.rearRight  += (baseAngle + turnDiff) * dir;
            angles.frontRight += (baseAngle + turnDiff) * dir;
            angles.rearLeft   += (baseAngle - turnDiff) * dir;
            angles.frontLeft  += (baseAngle - turnDiff) * dir;
        }

        try {
            if (meshes.rearRight)  meshes.rearRight.rotation.x  = angles.rearRight;
            if (meshes.frontRight) meshes.frontRight.rotation.x = angles.frontRight;
            if (meshes.rearLeft)   meshes.rearLeft.rotation.x   = angles.rearLeft;
            if (meshes.frontLeft)  meshes.frontLeft.rotation.x  = angles.frontLeft;
        } catch(e) {}
    }
}

export function resetWheelAngles() {
    for (let i = 0; i < 6; i++) {
        const angles = _playerWheelAngles[i];
        const meshes = _playerWheelMeshes[i];
        if (angles) {
            angles.rearRight  = 0;
            angles.frontRight = 0;
            angles.rearLeft   = 0;
            angles.frontLeft  = 0;
            angles.singleWheel = 0;
        }
        if (meshes) {
            try {
                if (meshes.rearRight)  meshes.rearRight.rotation.x  = 0;
                if (meshes.frontRight) meshes.frontRight.rotation.x = 0;
                if (meshes.rearLeft)   meshes.rearLeft.rotation.x   = 0;
                if (meshes.frontLeft)  meshes.frontLeft.rotation.x  = 0;
                if (meshes.singleWheel) meshes.singleWheel.rotation.x = 0;
            } catch(e) {}
        }
    }
}

// ===== HP & Damage Logic =====

/**
 * Gây sát thương lên một người chơi.
 * @param {number} playerIdx - người bị đánh
 * @param {number} amount - lượng damage
 * @param {function} onDefeatCallback - gọi khi người chơi này bị hạ gục (chỉ chạy ở local)
 * @param {string} [attackerVehicleId] - id xe của người gây damage (để lấy sound)
 */
export function takeDamage(playerIdx, amount, onDefeatCallback, attackerVehicleId = 'xelan') {
    if (playerInvulnerables[playerIdx]) return;

    playerHPs[playerIdx] = Math.max(0, playerHPs[playerIdx] - amount);

    // Phát âm thanh hit tại vị trí người bị đánh (spatial sound)
    const hitSphere = playerSpheres[playerIdx];
    if (hitSphere) {
        const attackerConfig = VEHICLES_CONFIG[attackerVehicleId] || VEHICLES_CONFIG.xelan;
        const hitSoundUrl = attackerConfig.sounds?.hit;
        if (hitSoundUrl) {
            playSpatialSound(hitSoundUrl, hitSphere.position, 20, 1.0);
        }
    }

    // Nếu là local player và bị hết máu
    if (playerIdx === myIndexGlobal && playerHPs[playerIdx] <= 0) {
        if (onDefeatCallback) onDefeatCallback();
    }
}

/**
 * Hồi sinh người chơi và kích hoạt hiệu ứng nhấp nháy bất tử trong 2 giây.
 * @param {number} playerIdx
 * @param {{x, y, z}} respawnPos
 */
export function respawnPlayer(playerIdx, respawnPos) {
    const sphere = playerSpheres[playerIdx];
    if (!sphere) return;

    // Đặt lại vị trí
    sphere.position.copy(respawnPos);

    // Hồi máu đầy
    const vehicleId = playerVehicles[playerIdx] || 'xelan';
    const vConfig = VEHICLES_CONFIG[vehicleId] || VEHICLES_CONFIG.xelan;
    playerHPs[playerIdx] = vConfig.hp;
    playerInvulnerables[playerIdx] = true;

    // Hiệu ứng nhấp nháy bất tử
    const model = playerModels[playerIdx];
    if (model) {
        let flashCount = 0;
        const interval = setInterval(() => {
            model.visible = !model.visible;
            flashCount++;
            if (flashCount >= 16) { // Nhấp nháy 8 lần (khoảng 2 giây)
                clearInterval(interval);
                model.visible = true;
                playerInvulnerables[playerIdx] = false;
            }
        }, 125);
    } else {
        setTimeout(() => {
            playerInvulnerables[playerIdx] = false;
        }, 2000);
    }
}

// ===== Misc =====
export function getMySphere(myIndex)    { return playerSpheres[myIndex]; }
export function getOtherSphere(myIndex) { return playerSpheres[(myIndex + 1) % 6]; }
export function getVehicleConfig(myIndex) { 
    const vId = playerVehicles[myIndex] || 'xelan';
    return VEHICLES_CONFIG[vId] || VEHICLES_CONFIG.xelan;
}

export function applyRemotePositions(roomData, myIndex) {
    // Không dùng hàm cũ nữa vì ta đã chuyển sang applyRemotePlayerSync
}

/**
 * Cập nhật vị trí, góc quay, hoạt ảnh và lăn bánh xe của đối thủ từ Firebase.
 */
export function applyRemotePlayerSync(i, syncData, playerName) {
    const sphere = playerSpheres[i];
    if (!sphere) return;

    if (!playerName) {
        sphere.visible = false;
        if (playerLabels[i]) playerLabels[i].style.display = 'none';
        return;
    }

    sphere.visible = true;

    if (syncData && syncData.pos) {
        const newPos = new THREE.Vector3(syncData.pos.x, syncData.pos.y, syncData.pos.z);
        const newRotY = syncData.rotY !== undefined ? syncData.rotY : 0;
        
        // Tính toán lăn bánh xe cho đối thủ
        if (!_remotePosInit[i]) {
            _lastRemotePositions[i].copy(newPos);
            _lastRemoteYaws[i] = newRotY;
            _remotePosInit[i] = true;
        } else {
            const dx = newPos.x - _lastRemotePositions[i].x;
            const dz = newPos.z - _lastRemotePositions[i].z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            let dyaw = newRotY - _lastRemoteYaws[i];
            while (dyaw >  Math.PI) dyaw -= Math.PI * 2;
            while (dyaw < -Math.PI) dyaw += Math.PI * 2;
            
            const rAnim = syncData.anim !== undefined ? syncData.anim : ANIM.IDLE;
            let wheelState = 'idle';
            if (rAnim === ANIM.MOVE) wheelState = 'move';
            else if (rAnim === ANIM.MOVE_BACK) wheelState = 'move_back';
            else if (rAnim === ANIM.TURN_LEFT) wheelState = 'turn_left';
            else if (rAnim === ANIM.TURN_RIGHT) wheelState = 'turn_right';

            updateWheelRotation(i, wheelState, dist, dyaw);

            _lastRemotePositions[i].copy(newPos);
            _lastRemoteYaws[i] = newRotY;
        }

        sphere.position.copy(newPos);
        sphere.rotation.y = newRotY;
        
        if (syncData.anim !== undefined) {
            playAnimation(i, syncData.anim);
        }
    }

    if (playerLabels[i]) {
        playerLabels[i].textContent = playerName;
    }
}

export function updateLabelPosition(mesh, labelElement, camera, isOwn) {
    if (!mesh || !labelElement) return;
    if (isOwn) { labelElement.style.display = 'none'; return; }
    if (!mesh.visible) { labelElement.style.display = 'none'; return; }
    try { mesh.updateMatrixWorld(true); } catch(e) { return; }
    _labelTempV.setFromMatrixPosition(mesh.matrixWorld);
    _labelTempV.y += 2.2;
    _labelTempV.project(camera);
    if (_labelTempV.z > 1 || Math.abs(_labelTempV.x) > 1 || Math.abs(_labelTempV.y) > 1) {
        labelElement.style.display = 'none'; return;
    }
    labelElement.style.display = 'block';
    const x = (_labelTempV.x * .5 + .5) * window.innerWidth;
    const y = (_labelTempV.y * -.5 + .5) * window.innerHeight;
    labelElement.style.left = '0';
    labelElement.style.top = '0';
    labelElement.style.transform = `translate(-50%, -100%) translate3d(${x}px, ${y}px, 0)`;
}

export function updateAllLabels(camera, myIndex) {
    if (camera) {
        try { camera.updateMatrixWorld(); } catch(e) {}
    }
    for (let i = 0; i < 6; i++) {
        try {
            updateLabelPosition(playerSpheres[i], playerLabels[i], camera, i === myIndex);
        } catch(e) {}
    }
}