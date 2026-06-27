// src/core/physics.js
// Tinh toan trong luc, nhay, va cham tuong, kiem tra khe hop (Narrow-gap)
// + Frustum Culling

import * as THREE from 'three';

// ===== Hang so vat ly =====
export const GRAVITY = 0.015;
export const JUMP_FORCE = 0.35;
export const PLAYER_RADIUS = 1.0;

// ===== LOD constants =====
export const LOD_MIN_TRIANGLES = 60;
export const LOD_FAR_RATIO = 0.10;
export const LOD_FAR_MIN_TRIANGLES = 12;
export const LOD_SWITCH_DISTANCE = 260;

// ===== Spawn points =====
export const SPAWN_POINTS = [
    { x: 312, y: 6.25, z: -302 },
    { x: 306, y: 6.25, z: -294 },
    { x: 303, y: 6.25, z: -296 },
    { x: 308, y: 6.25, z: -305 },
    { x: 304, y: 6.25, z: -308 },
    { x: 299, y: 6.25, z: -300 },
];

// ===== Frustum Culling =====
const _frustum = new THREE.Frustum();
const _frustumMatrix = new THREE.Matrix4();
const _meshBox3 = new THREE.Box3();
const _meshSphere = new THREE.Sphere();

/**
 * Loc danh sach meshes theo frustum cua camera (Frustum Culling).
 * Tra ve mang mesh nhin thay trong khung hinh.
 * @param {THREE.Mesh[]} meshes
 * @param {THREE.Camera} camera
 * @returns {THREE.Mesh[]}
 */
export function frustumCullMeshes(meshes, camera) {
    _frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_frustumMatrix);
    const result = [];
    for (const mesh of meshes) {
        if (!mesh.geometry) { result.push(mesh); continue; }
        if (mesh.geometry.boundingSphere) {
            _meshSphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
            if (_frustum.intersectsSphere(_meshSphere)) result.push(mesh);
        } else if (mesh.geometry.boundingBox) {
            _meshBox3.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
            if (_frustum.intersectsBox(_meshBox3)) result.push(mesh);
        } else {
            result.push(mesh);
        }
    }
    return result;
}

// ===== Wall collision =====
const WALL_SAMPLE_OFFSETS = [-0.5, -0.25, 0, 0.25, 0.5];
const WALL_SAMPLE_COUNT = WALL_SAMPLE_OFFSETS.length;
const MIN_OPEN_RATIO_TO_PASS = 0.70;

const _wallSampleOrigins = WALL_SAMPLE_OFFSETS.map(() => new THREE.Vector3());
const _sideOffset = new THREE.Vector3();
const wallRaycaster = new THREE.Raycaster();

const _groundNormal = new THREE.Vector3();
const _moveAxisY = new THREE.Vector3(0, 1, 0);
const _rayOrigin = new THREE.Vector3();
const groundRaycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// Head collision raycaster
const headRaycaster = new THREE.Raycaster();
const upVector = new THREE.Vector3(0, 1, 0);

// Pre-allocated temporaries to avoid GC thrashing in high-frequency functions
const _headOrigin = new THREE.Vector3();
const _testDir = new THREE.Vector3();

/**
 * Kiem tra co vat the nao o phia tren player khong (chan nhay xuyen tran).
 * @param {THREE.Vector3} position
 * @param {THREE.Mesh[]} nearbyMeshes
 * @param {number} checkDist
 * @returns {boolean}
 */
export function checkHeadBlocked(position, nearbyMeshes, checkDist = 2.5) {
    if (nearbyMeshes.length === 0) return false;
    _headOrigin.set(position.x, position.y + PLAYER_RADIUS * 0.9, position.z);
    headRaycaster.set(_headOrigin, upVector);
    headRaycaster.far = checkDist;
    const hits = headRaycaster.intersectObjects(nearbyMeshes, false);
    return hits.length > 0;
}

/**
 * Ap dung trong luc + phat hien mat dat.
 * Tra ve groundNormal (THREE.Vector3) de tinh do doc cho movement.
 */
export function applyGravity(sphere, verticalVelocity, isGrounded, nearbyMeshes, spawnInfo) {
    verticalVelocity -= GRAVITY;

    // Neu player dang bay len (vV > 0), kiem tra co tran o phia tren khong
    if (verticalVelocity > 0 && nearbyMeshes.length > 0) {
        const headBlocked = checkHeadBlocked(sphere.position, nearbyMeshes, verticalVelocity + PLAYER_RADIUS + 0.3);
        if (headBlocked) {
            verticalVelocity = 0; // Khoa lai, khong cho xuyen tran
        }
    }

    sphere.position.y += verticalVelocity;

    // groundNormal: normal mat dat o vi tri hien tai (default Y-up neu khong co)
    const groundNormal = new THREE.Vector3(0, 1, 0);

    if (nearbyMeshes.length > 0) {
        _rayOrigin.set(sphere.position.x, sphere.position.y + 0.5, sphere.position.z);
        groundRaycaster.set(_rayOrigin, downVector);
        groundRaycaster.far = verticalVelocity <= 0
            ? Math.abs(verticalVelocity) + PLAYER_RADIUS + 0.5
            : PLAYER_RADIUS + 0.5;

        const intersects = groundRaycaster.intersectObjects(nearbyMeshes, false);

        if (intersects.length > 0) {
            const hit = intersects[0];
            const groundY = hit.point.y;
            const distanceToGround = sphere.position.y - groundY;

            // Lay face normal de tinh do doc
            if (hit.face && hit.face.normal) {
                groundNormal.copy(hit.face.normal);
                // Chuyen normal tu local space cua mesh sang world space
                if (hit.object && hit.object.matrixWorld) {
                    groundNormal.transformDirection(hit.object.matrixWorld);
                }
            }

            if (distanceToGround <= PLAYER_RADIUS && verticalVelocity <= 0) {
                sphere.position.y = groundY + PLAYER_RADIUS;
                verticalVelocity = 0;
                isGrounded = true;
                // KHONG slerp quaternion - body yaw duoc quan ly rieng boi main.js
            } else {
                isGrounded = false;
            }
        } else {
            isGrounded = false;
            if (sphere.position.y < -50) {
                verticalVelocity = 0;
                const spawn = spawnInfo.isHost ? SPAWN_POINTS[0] : SPAWN_POINTS[1];
                sphere.position.set(spawn.x, spawn.y, spawn.z);
            }
        }
    }

    return { verticalVelocity, isGrounded, groundNormal };
}

/**
 * Kiem tra va xu ly va cham tuong + khe hop (narrow-gap).
 * @param {THREE.Vector3} position
 * @param {THREE.Vector3} moveDir
 * @param {THREE.Mesh[]} nearbyMeshes
 * @param {number} modelWidth - chieu rong thuc te cua model hitbox (tinh theo PLAYER_RADIUS neu khong co)
 */
export function checkWallCollisions(position, moveDir, nearbyMeshes, modelWidth) {
    if (nearbyMeshes.length === 0 || moveDir.lengthSq() === 0) return;

    _testDir.copy(moveDir);
    _testDir.y = 0;
    if (_testDir.lengthSq() === 0) return;
    _testDir.normalize();

    const halfWidth = (modelWidth !== undefined ? modelWidth : PLAYER_RADIUS);
    const stepUpHeight = PLAYER_RADIUS / 7;

    _sideOffset.set(-_testDir.z, 0, _testDir.x);

    const centerY = position.y + stepUpHeight + 0.05;
    const farDist = halfWidth + 0.15;
    wallRaycaster.far = farDist;

    let blockedCount = 0;
    let maxOverlap = 0;

    for (let i = 0; i < WALL_SAMPLE_COUNT; i++) {
        const offsetRatio = WALL_SAMPLE_OFFSETS[i];
        const origin = _wallSampleOrigins[i];
        origin.copy(position).addScaledVector(_sideOffset, offsetRatio * halfWidth);
        origin.y = centerY;

        wallRaycaster.set(origin, _testDir);
        const hits = wallRaycaster.intersectObjects(nearbyMeshes, false);

        if (hits.length > 0 && hits[0].distance < halfWidth + 0.1) {
            blockedCount++;
            const overlap = (halfWidth + 0.1) - hits[0].distance;
            if (overlap > maxOverlap) maxOverlap = overlap;
        }
    }

    if (blockedCount === 0) return;

    const openRatio = 1 - (blockedCount / WALL_SAMPLE_COUNT);

    if (openRatio < MIN_OPEN_RATIO_TO_PASS) {
        position.addScaledVector(_testDir, -maxOverlap);
        return;
    }

    position.addScaledVector(_testDir, -maxOverlap * 0.5);
}