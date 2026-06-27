// src/player/playerManager.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { SPAWN_POINTS } from '../core/physics.js';

const _labelTempV = new THREE.Vector3();

// ===== Player instances =====
let playerSpheres = [null, null, null, null, null, null];
let playerLabels = [null, null, null, null, null, null];
let playerModels = [null, null, null, null, null, null];

// Animation
let playerMixers = [null, null, null, null, null, null];
let playerActions = [{}, {}, {}, {}, {}, {}];
let playerCurrentAnims = [null, null, null, null, null, null];

// Bones (local player only)
let boneHead = null;
let boneNeck = null;
let myIndexGlobal = 0; // index local player (0..5)

// Hitbox
let modelHalfWidth = 1.0;

// Head smooth state
let _headAngle = 0;
let _headPitch = 0;

// ===== Wheel Rotation =====
// Tên object bánh xe trong model GLTF:
//   defaultMaterial       → bánh phải sau  (rear right)
//   defaultMaterial.003   → bánh phải trước (front right)
//   defaultMaterial.001   → bánh trái sau   (rear left)
//   defaultMaterial.002   → bánh trái trước (front left)
const WHEEL_RADIUS = 0.38;          // bán kính bánh xe (unit trong model, đã nhân scale 2)
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * WHEEL_RADIUS; // chu vi

// Góc tích lũy của từng bánh (radian), lưu riêng để không reset giữa frame
const _wheelAngles = {
    rearRight:  0,   // defaultMaterial
    frontRight: 0,   // defaultMaterial.003
    rearLeft:   0,   // defaultMaterial.001
    frontLeft:  0,   // defaultMaterial.002
};

// Tham chiếu đến mesh bánh của local player (set khi model load xong)
let _wheelMeshes = {
    rearRight:  null,
    frontRight: null,
    rearLeft:   null,
    frontLeft:  null,
};

// Hệ số vi sai khi quay: bánh bên ngoài cua quay nhiều hơn, bên trong ít hơn
const WHEEL_TURN_DIFF = 0.32;  // mỗi radian yaw thân xe → ±0.32 rad chênh lệch mỗi bên
// Hệ số phản ứng với góc nhìn khi đứng yên
const WHEEL_IDLE_LOOK_FACTOR = 0.15; // mỗi radian look.yaw thay đổi → bánh quay 0.15 rad

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
export const ANIM = { IDLE:1, MOVE:2, MOVE_BACK:3, TURN_LEFT:4, TURN_RIGHT:5 };

export function setMyIndex(index) {
    myIndexGlobal = index;
    // Cap nhat boneHead/boneNeck neu model da load truoc do
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

// ===== Init =====
export function initPlayers(scene, roomData, labelsContainer, loadingManager) {
    const geo = new THREE.SphereGeometry(1, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ visible: false });

    // Reset du lieu
    playerSpheres = [null, null, null, null, null, null];
    playerLabels = [null, null, null, null, null, null];
    playerModels = [null, null, null, null, null, null];
    playerMixers = [null, null, null, null, null, null];
    playerActions = [{}, {}, {}, {}, {}, {}];
    playerCurrentAnims = [null, null, null, null, null, null];
    boneHead = null;
    boneNeck = null;

    labelsContainer.innerHTML = '';

    const loader = new GLTFLoader(loadingManager || new THREE.LoadingManager());
    loader.setDRACOLoader(dracoLoader);

    for (let i = 0; i < 6; i++) {
        const sphere = new THREE.Mesh(geo, mat.clone());
        sphere.position.set(SPAWN_POINTS[i].x, SPAWN_POINTS[i].y, SPAWN_POINTS[i].z);
        scene.add(sphere);
        playerSpheres[i] = sphere;

        const label = document.createElement('div');
        label.className = 'player-label';
        label.style.display = 'none';
        labelsContainer.appendChild(label);
        playerLabels[i] = label;
    }

    // Set label ten truoc neu co san roomData
    const players = roomData?.players || {};
    for (let i = 0; i < 6; i++) {
        const name = players[`p${i}`];
        if (name && playerLabels[i]) {
            playerLabels[i].textContent = name;
        }
    }

    const path = 'src/player/models/xelan.glb';
    loader.load(path, gltf => {
        for (let i = 0; i < 6; i++) {
            try {
                // Nhân bản scene độc lập chứa hệ xương của người chơi
                const clonedScene = SkeletonUtils.clone(gltf.scene);
                const clonedGltf = {
                    scene: clonedScene,
                    animations: gltf.animations // Dùng chung mảng clip hành động
                };
                setupModel(clonedGltf, i);
            } catch(e) {
                console.error(`[setupModel error player ${i}]`, e);
            }
        }
    }, undefined, e => console.warn('[ModelLoad]', e));

    return { hostSphere: playerSpheres[0], guestSphere: playerSpheres[1] };
}

function setupModel(gltf, index) {
    const sphere = playerSpheres[index];
    if (!sphere) return;
    const model = gltf.scene;
    model.scale.set(2, 2, 2);

    let hitboxObj = null;
    let fHead = null, fNeck = null;
    // Wheel mesh tìm theo tên object (chính xác tên trong Blender/GLTF)
    let wRearRight  = null; // defaultMaterial       → bánh phải sau
    let wFrontRight = null; // defaultMaterial.003   → bánh phải trước
    let wRearLeft   = null; // defaultMaterial.001   → bánh trái sau
    let wFrontLeft  = null; // defaultMaterial.002   → bánh trái trước

    model.traverse((child) => {
        if (!child.name) return;
        const n = child.name;
        const nl = n.toLowerCase();

        if (nl === 'hitbox') hitboxObj = child;

        // Head / Neck bones
        if (n === 'mixamorig:Head_06' || nl.includes('head_06') || nl.includes('head06')) fHead = child;
        if (n === 'mixamorig:Neck_05' || nl.includes('neck_05') || nl.includes('neck05')) fNeck = child;

        // Wheel meshes — khớp chính xác tên object trong GLTF
        if (n === 'defaultMaterial')     wRearRight  = child;
        if (n === 'defaultMaterial.003') wFrontRight = child;
        if (n === 'defaultMaterial.001') wRearLeft   = child;
        if (n === 'defaultMaterial.002') wFrontLeft  = child;

        if (child.isMesh) { child.castShadow = false; child.receiveShadow = false; }
    });

    if (hitboxObj) {
        const box = new THREE.Box3().setFromObject(hitboxObj);
        const sz = new THREE.Vector3(); box.getSize(sz);
        modelHalfWidth = Math.max(sz.x, sz.z) * 0.5 * 2;
        hitboxObj.visible = false;
    }

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

    if (index === myIndexGlobal) {
        boneHead = fHead;
        boneNeck = fNeck;
        // Gán tham chiếu bánh xe cho local player
        _wheelMeshes.rearRight  = wRearRight;
        _wheelMeshes.frontRight = wFrontRight;
        _wheelMeshes.rearLeft   = wRearLeft;
        _wheelMeshes.frontLeft  = wFrontLeft;
        // Reset góc về 0 khi model mới load
        _wheelAngles.rearRight  = 0;
        _wheelAngles.frontRight = 0;
        _wheelAngles.rearLeft   = 0;
        _wheelAngles.frontLeft  = 0;
        if (wRearRight || wFrontRight || wRearLeft || wFrontLeft) {
            console.log('[Wheels] Tìm thấy bánh xe:',
                wRearRight?.name, wFrontRight?.name,
                wRearLeft?.name,  wFrontLeft?.name);
        } else {
            console.warn('[Wheels] Không tìm thấy mesh bánh xe! Kiểm tra lại tên object trong model.');
        }
    }

    playAnimation(index, ANIM.IDLE);
}

export function getModelHalfWidth() { return modelHalfWidth; }

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

    // --- YAW (ngang) ---
    let yd = lookYaw - bodyYawRef;
    while (yd >  Math.PI) yd -= Math.PI * 2;
    while (yd < -Math.PI) yd += Math.PI * 2;
    const maxY = isMovingBack ? HEAD_MOVING_MAX : HEAD_TURN_MAX;
    const cy   = Math.max(-maxY, Math.min(maxY, yd));

    // --- PITCH (doc) ---
    const cp = Math.max(-HEAD_PITCH_MAX, Math.min(HEAD_PITCH_MAX, lookPitch));

    // Smooth
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

/**
 * Cập nhật góc xoay bánh xe dựa trên quãng đường di chuyển và delta yaw thân xe.
 *
 * @param {string} wheelState  - trạng thái: 'move' | 'move_back' | 'turn_left' | 'turn_right' | 'idle'
 * @param {number} distMoved   - quãng đường di chuyển trong frame (XZ, unit)
 * @param {number} dyaw        - delta góc yaw thân xe trong frame (radian, dương = trái, âm = phải)
 */
export function updateWheelRotation(wheelState, distMoved, dyaw) {
    // Tính góc quay cơ bản từ quãng đường: angle = (dist / circumference) * 2π
    const baseAngle = (distMoved / WHEEL_CIRCUMFERENCE) * Math.PI * 2;

    // Chiều quay: tiến → âm (quay ra trước), lùi → dương
    const dir = (wheelState === 'move_back') ? 1 : -1;

    // ---- Vi sai khi quay thân xe ----
    // Khi turn_right: dyaw < 0, bánh trái (ngoài cua) quay nhiều hơn, bánh phải (trong cua) ít hơn.
    // Khi turn_left:  dyaw > 0, bánh phải (ngoài cua) quay nhiều hơn, bánh trái (trong cua) ít hơn.
    // Công thức: diffAngle = dyaw × WHEEL_TURN_DIFF (radian thêm/bớt cho từng bên)
    const turnDiff = dyaw * WHEEL_TURN_DIFF;
    // turnDiff > 0 → turn_left → thêm vào bánh phải (ngoài), bớt ở bánh trái (trong)
    // turnDiff < 0 → turn_right → bớt ở bánh phải (ngoài), thêm vào bánh trái (trong)

    // ---- Góc xoay theo trạng thái ----
    if (wheelState === 'idle') {
        // Đứng yên: không di chuyển, bánh không quay theo quãng đường
        // Nhưng khi thân xe xoay (idle turn), bánh vẫn phản ứng nhẹ theo dyaw
        // (giả lập kiểu xe tank / differential steering)
        const idleTurnAngle = dyaw * WHEEL_IDLE_LOOK_FACTOR * 3.0;
        _wheelAngles.rearRight  += idleTurnAngle;   // phải quay theo hướng turn
        _wheelAngles.frontRight += idleTurnAngle;
        _wheelAngles.rearLeft   -= idleTurnAngle;   // trái quay ngược lại
        _wheelAngles.frontLeft  -= idleTurnAngle;
    } else {
        // Đang di chuyển: cộng góc cơ bản + vi sai
        // Bánh phải: baseAngle * dir + turnDiff * dir
        // Bánh trái: baseAngle * dir - turnDiff * dir
        _wheelAngles.rearRight  += (baseAngle + turnDiff) * dir;
        _wheelAngles.frontRight += (baseAngle + turnDiff) * dir;
        _wheelAngles.rearLeft   += (baseAngle - turnDiff) * dir;
        _wheelAngles.frontLeft  += (baseAngle - turnDiff) * dir;
    }

    // ---- Áp dụng góc quay lên mesh (xoay quanh trục X local của bánh) ----
    // Trục X local của bánh xe thường là trục xoay khi lăn.
    // Nếu model có orientation khác, đổi sang .z hoặc .y.
    try {
        if (_wheelMeshes.rearRight)  _wheelMeshes.rearRight.rotation.x  = _wheelAngles.rearRight;
        if (_wheelMeshes.frontRight) _wheelMeshes.frontRight.rotation.x = _wheelAngles.frontRight;
        if (_wheelMeshes.rearLeft)   _wheelMeshes.rearLeft.rotation.x   = _wheelAngles.rearLeft;
        if (_wheelMeshes.frontLeft)  _wheelMeshes.frontLeft.rotation.x  = _wheelAngles.frontLeft;
    } catch(e) {}
}

/**
 * Reset góc bánh xe về 0 (dùng khi bắt đầu màn, hoặc sau cutscene).
 */
export function resetWheelAngles() {
    _wheelAngles.rearRight  = 0;
    _wheelAngles.frontRight = 0;
    _wheelAngles.rearLeft   = 0;
    _wheelAngles.frontLeft  = 0;
    try {
        if (_wheelMeshes.rearRight)  _wheelMeshes.rearRight.rotation.x  = 0;
        if (_wheelMeshes.frontRight) _wheelMeshes.frontRight.rotation.x = 0;
        if (_wheelMeshes.rearLeft)   _wheelMeshes.rearLeft.rotation.x   = 0;
        if (_wheelMeshes.frontLeft)  _wheelMeshes.frontLeft.rotation.x  = 0;
    } catch(e) {}
}

// ===== Misc =====
export function getMySphere(myIndex)    { return playerSpheres[myIndex]; }
export function getOtherSphere(myIndex) { return playerSpheres[(myIndex + 1) % 6]; }

export function applyRemotePositions(roomData, myIndex) {
    if (!roomData || !roomData.players) return;
    const players = roomData.players;
    for (let i = 0; i < 6; i++) {
        if (i === myIndex) continue;

        const sphere = playerSpheres[i];
        if (!sphere) continue;

        const playerName = players[`p${i}`];
        if (!playerName) {
            sphere.visible = false;
            if (playerLabels[i]) playerLabels[i].style.display = 'none';
            continue;
        }

        sphere.visible = true;

        const pos = roomData[`p${i}Pos`];
        const rotY = roomData[`p${i}RotY`];
        const anim = roomData[`p${i}Anim`];

        if (pos) sphere.position.copy(pos);
        if (rotY !== undefined) sphere.rotation.y = rotY;
        if (anim !== undefined) {
            playAnimation(i, anim);
        }

        if (playerLabels[i]) {
            playerLabels[i].textContent = playerName;
        }
    }
}

/**
 * Cập nhật vị trí, góc quay và hoạt ảnh của một người chơi cụ thể.
 * Được gọi khi nhận được tín hiệu sync từ Firebase.
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

    if (syncData) {
        if (syncData.pos) sphere.position.copy(syncData.pos);
        if (syncData.rotY !== undefined) sphere.rotation.y = syncData.rotY;
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
