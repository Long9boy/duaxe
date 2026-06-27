// src/core/spatial.js
// Quản lý lưới không gian (Spatial Uniform Grid) và tích hợp BVH (three-mesh-bvh)
// để tối ưu hiệu năng raycast va chạm.

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// ===== BVH: gắn BVH vào BufferGeometry/Mesh của Three.js =====
// Sau khi gọi geometry.computeBoundsTree(), raycast trên mesh đó sẽ dùng
// cây BVH (O(log n)) thay vì duyệt tuần tự từng tam giác (O(n)).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ===== Spatial Partition: lưới đều (uniform grid) trên mặt phẳng X-Z =====
// Thay vì raycast vào TOÀN BỘ collidableMeshes mỗi frame, ta chỉ lấy ra
// những mesh nằm trong (và sát) ô lưới chứa người chơi rồi mới raycast.
// Kết hợp với BVH ở trên: lọc thô bằng lưới -> raycast nhanh bằng BVH trong
// tập mesh đã lọc.
const SPATIAL_CELL_SIZE = 40; // chỉnh theo tỉ lệ map: map càng to, ô càng lớn
const spatialGrid = new Map(); // key "cx_cz" -> mảng mesh có AABB chạm ô đó
let lastPlayerCellKey = null;
let cachedNearbyMeshes = [];

function spatialKey(cx, cz) {
    return cx + "_" + cz;
}

/**
 * Build lưới không gian từ danh sách collidable meshes.
 * Gọi 1 lần sau khi map load xong (mesh tĩnh, không di chuyển).
 * @param {THREE.Mesh[]} meshes
 */
export function buildSpatialGrid(meshes) {
    spatialGrid.clear();
    const box = new THREE.Box3();
    for (const mesh of meshes) {
        box.setFromObject(mesh); // AABB trong world-space (đã có matrixWorld đúng)
        const minX = Math.floor(box.min.x / SPATIAL_CELL_SIZE);
        const maxX = Math.floor(box.max.x / SPATIAL_CELL_SIZE);
        const minZ = Math.floor(box.min.z / SPATIAL_CELL_SIZE);
        const maxZ = Math.floor(box.max.z / SPATIAL_CELL_SIZE);

        // Một mesh to (chạy dài) có thể nằm trong nhiều ô -> được thêm vào tất cả ô đó
        for (let gx = minX; gx <= maxX; gx++) {
            for (let gz = minZ; gz <= maxZ; gz++) {
                const key = spatialKey(gx, gz);
                let arr = spatialGrid.get(key);
                if (!arr) { arr = []; spatialGrid.set(key, arr); }
                arr.push(mesh);
            }
        }
    }
    console.log(`[Spatial Grid] ${spatialGrid.size} ô, ${meshes.length} mesh va chạm (đã có BVH).`);
}

/**
 * Lấy danh sách mesh ở ô hiện tại + 8 ô lân cận (vùng 3x3).
 * Có cache: chỉ tính lại khi người chơi đổi sang ô lưới khác, không phải mỗi frame.
 * @param {number} x
 * @param {number} z
 * @returns {THREE.Mesh[]}
 */
export function queryNearbyMeshes(x, z) {
    const cx = Math.floor(x / SPATIAL_CELL_SIZE);
    const cz = Math.floor(z / SPATIAL_CELL_SIZE);
    const key = spatialKey(cx, cz);

    if (key === lastPlayerCellKey) {
        return cachedNearbyMeshes;
    }
    lastPlayerCellKey = key;

    const found = new Set();
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const arr = spatialGrid.get(spatialKey(cx + dx, cz + dz));
            if (arr) for (const m of arr) found.add(m);
        }
    }
    cachedNearbyMeshes = Array.from(found);
    return cachedNearbyMeshes;
}
