/**
 * dustSystem.js — Sprite-based dust/smoke effect for rear wheels
 *
 * Usage:
 *   import { initDustSystem, updateDustSystem } from './fx/dustSystem.js';
 *
 *   // Once, after scene is ready and texture is loaded:
 *   initDustSystem(scene, smokeTexture);
 *
 *   // Every frame inside the game loop:
 *   updateDustSystem(delta, mySphere, bodyYaw, currentSpeed, isGrounded, _wheelState);
 */

import * as THREE from 'three';

// ─── Tuning ────────────────────────────────────────────────────────────────
const MAX_PARTICLES   = 120;  // pool size — tăng để có nhiều khói hơn
const EMIT_INTERVAL   = 0.022; // giây giữa mỗi lần spawn/bánh (nhanh hơn → dày hơn)
const EMIT_BURST      = 2;    // số hạt spawn cùng lúc mỗi lần emit
const SPEED_THRESHOLD = 0.22; // currentSpeed (~half MAX_SPEED 0.45)
const LIFETIME        = 1.1;  // giây mỗi hạt sống — dài hơn → leo cao hơn

// Wheel offsets relative to sphere center
const WHEEL_OFFSET_X  = 0.55;
const WHEEL_OFFSET_Y  = -0.55;
const WHEEL_OFFSET_Z  = 0.70;

// Particle behaviour
const INIT_SCALE      = 0.35;
const FINAL_SCALE     = 2.0;   // to hơn khi bay lên
const RISE_SPEED      = 1.1;   // lên cao nhanh hơn (x2 so với trước)
const SPREAD_SPEED    = 0.45;
const BACKWARD_SPEED  = 0.55;
// ───────────────────────────────────────────────────────────────────────────

// Bảng màu gradient: xám đen (mới spawn) → nâu xám (giữa) → xám nhạt (tan)
// Mỗi entry: [t_start, t_end, colorHex]
// SpriteMaterial.color nhân với texture → dùng như tint
const COLOR_RAMP = [
    { t: 0.00, color: new THREE.Color(0x1a1612) }, // xám đen khói
    { t: 0.25, color: new THREE.Color(0x3d3028) }, // nâu đen
    { t: 0.55, color: new THREE.Color(0x6b5a4e) }, // nâu xám
    { t: 0.80, color: new THREE.Color(0x9e9590) }, // xám nhạt
    { t: 1.00, color: new THREE.Color(0xb8b0a8) }, // xám trắng tan
];

const _tmpColor = new THREE.Color();

function _sampleRamp(t) {
    // Tìm 2 điểm xung quanh t rồi lerp
    for (let i = 0; i < COLOR_RAMP.length - 1; i++) {
        const a = COLOR_RAMP[i];
        const b = COLOR_RAMP[i + 1];
        if (t >= a.t && t <= b.t) {
            const f = (t - a.t) / (b.t - a.t);
            _tmpColor.copy(a.color).lerp(b.color, f);
            return _tmpColor;
        }
    }
    return COLOR_RAMP[COLOR_RAMP.length - 1].color;
}

let _scene     = null;
let _texture   = null;
let _pool      = [];
let _timers    = { emitters: [] };

// ── Internal helpers ────────────────────────────────────────────────────────

function _createSprite() {
    const mat = new THREE.SpriteMaterial({
        map:        _texture,
        transparent: true,
        opacity:    0,
        depthWrite: false,
        blending:   THREE.NormalBlending,
        color:      new THREE.Color(0x1a1612),
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0);
    sprite.visible = false;
    _scene.add(sprite);
    return { sprite, alive: false, age: 0, lifetime: LIFETIME, vx: 0, vy: 0, vz: 0 };
}

function _getFreeParticle() {
    for (const p of _pool) {
        if (!p.alive) return p;
    }
    return null;
}

function _particleWorldPos(spherePos, bodyYaw, offset) {
    const localX = offset.x;
    const localY = offset.y;
    const localZ = offset.z;
    const cos = Math.cos(bodyYaw);
    const sin = Math.sin(bodyYaw);
    return new THREE.Vector3(
        spherePos.x + cos * localX + sin * localZ,
        spherePos.y + localY,
        spherePos.z - sin * localX + cos * localZ,
    );
}

function _spawnAt(pos, bodyYaw) {
    const p = _getFreeParticle();
    if (!p) return;

    p.alive    = true;
    p.age      = 0;
    p.lifetime = LIFETIME * (0.75 + Math.random() * 0.5);

    // Jitter vị trí spawn quanh bánh một chút
    p.sprite.position.set(
        pos.x + (Math.random() - 0.5) * 0.15,
        pos.y + Math.random() * 0.1,
        pos.z + (Math.random() - 0.5) * 0.15,
    );
    p.sprite.scale.setScalar(INIT_SCALE * (0.8 + Math.random() * 0.4));
    p.sprite.material.opacity = 0;
    p.sprite.visible = true;

    // Màu ban đầu: xám đen
    p.sprite.material.color.copy(COLOR_RAMP[0].color);

    const cos = Math.cos(bodyYaw);
    const sin = Math.sin(bodyYaw);

    const spreadX = (Math.random() - 0.5) * SPREAD_SPEED * 2;
    const spreadZ = (Math.random() - 0.5) * SPREAD_SPEED * 2;

    p.vx = sin * BACKWARD_SPEED + spreadX * cos;
    p.vy = RISE_SPEED * (0.55 + Math.random() * 0.55);  // lên cao hơn
    p.vz = cos * BACKWARD_SPEED + spreadZ * sin;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initDustSystem(scene, smokeTexture) {
    _scene   = scene;
    _texture = smokeTexture;
    _pool    = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
        _pool.push(_createSprite());
    }
    _timers.emitters = [];
}

export function updateDustSystem(delta, mySphere, bodyYaw, currentSpeed, isGrounded, wheelState, vehicleConfig) {
    if (!_scene || !_pool.length || !mySphere || !vehicleConfig) return;

    // ── Emission ─────────────────────────────────────────────────────────────
    const emitters = vehicleConfig.dustParticles || [];
    if (!_timers.emitters || _timers.emitters.length !== emitters.length) {
        _timers.emitters = new Array(emitters.length).fill(0);
    }

    emitters.forEach((emitter, idx) => {
        const shouldEmit = isGrounded
            && currentSpeed >= emitter.speedThreshold
            && wheelState !== 'idle';

        if (shouldEmit) {
            _timers.emitters[idx] -= delta;
            if (_timers.emitters[idx] <= 0) {
                const pos = _particleWorldPos(mySphere.position, bodyYaw, emitter);
                for (let i = 0; i < EMIT_BURST; i++) _spawnAt(pos, bodyYaw);
                _timers.emitters[idx] = EMIT_INTERVAL;
            }
        } else {
            _timers.emitters[idx] = 0;
        }
    });

    // ── Animate alive particles ──────────────────────────────────────────────
    for (const p of _pool) {
        if (!p.alive) continue;

        p.age += delta;
        const t = Math.min(p.age / p.lifetime, 1);

        // Drift
        p.sprite.position.x += p.vx * delta;
        p.sprite.position.y += p.vy * delta;
        p.sprite.position.z += p.vz * delta;

        // Chậm dần theo thời gian (drag)
        p.vx *= 1 - delta * 1.2;
        p.vz *= 1 - delta * 1.2;

        // Scale grow
        const s = INIT_SCALE + (FINAL_SCALE - INIT_SCALE) * (t * t * 0.5 + t * 0.5);
        p.sprite.scale.setScalar(s);

        // Opacity: fade in nhanh (0→15%), giữ đậm, fade out chậm (50%→100%)
        const fadeIn  = Math.min(t / 0.12, 1);
        const fadeOut = 1 - Math.max((t - 0.45) / 0.55, 0);
        p.sprite.material.opacity = fadeIn * fadeOut * 0.75;

        // Màu gradient theo t
        const rampColor = _sampleRamp(t);
        p.sprite.material.color.copy(rampColor);

        if (p.age >= p.lifetime) {
            p.alive = false;
            p.sprite.visible = false;
            p.sprite.material.opacity = 0;
        }
    }
}

export function disposeDustSystem() {
    for (const p of _pool) {
        p.sprite.material.dispose();
        _scene && _scene.remove(p.sprite);
    }
    _pool  = [];
    _scene = null;
}
