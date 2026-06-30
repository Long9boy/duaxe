// src/core/input.js
// Quan ly su kien ban phim va di chuot (Pointer Lock)

// Sử dụng Proxy để quản lý việc chặn phím khi đang giữ Shift
const _keysState = {
    w: false, a: false, s: false, d: false,
    ' ': false, control: false, shift: false, c: false,
    attack: false, skill: false
};

export const keys = new Proxy(_keysState, {
    get(target, prop) {
        // Nếu đang giữ shift, w/a/s/d/space trả về false (chặn ở getter)
        // nhưng _keysState vẫn lưu giá trị thật -> nhả shift là hoạt động lại ngay
        if (target.shift && ['w', 'a', 's', 'd', ' '].includes(prop)) {
            return false;
        }
        return target[prop];
    },
    set(target, prop, value) {
        if (prop === 'shift' && value === true) {
            // Tắt nitro ngay khi giữ shift
            nitro.active = false;
        }
        // Luôn lưu giá trị thật, không block setter
        target[prop] = value;
        return true;
    }
});

/** playerYaw va playerPitch duoc export de cac module khac co the doc/ghi */
export const look = {
    yaw: 0,
    pitch: -0.25
};

let _canvas = null;
let _isCutsceneActive = () => false;

/** Chat state */
let _chatOpen = false;
let _chatInput = null;
let _chatContainer = null;
let _chatMessages = [];
let _onFlyToggle = null;
let _onShowToggle = null;
let _onNetworkChatSend = null;
let _senderName = 'Bạn';
let _isShowHudOn = false;

/** Nitro state: export de main.js doc */
export const nitro = {
    value: 1.0,       // 0..1
    active: false,    // space dang giu
    depleted: false,  // da het nitro
    regenDelay: 0     // timestamp khi bat dau hoi
};

export function isMobileDevice() {
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return isTouch && (isMobileUA || window.innerWidth < 1025);
}

let touchJoystickId = null;
let touchRotationId = null;
let rotationLastX = 0;
let rotationLastY = 0;

let _joystickTouchStart = null;
let _windowTouchStart = null;
let _windowTouchMove = null;
let _windowTouchEnd = null;
let _nitroTouchStart = null;
let _nitroTouchEnd = null;
let _shiftTouchStart = null;
let _shiftTouchEnd = null;

function _initTouchControls() {
    const joystickBase = document.getElementById('joystickBase');
    const joystickStick = document.getElementById('joystickStick');
    const mobileNitroBtn = document.getElementById('mobileNitroBtn');
    const mobileShiftBtn = document.getElementById('mobileShiftBtn');
    const mobileAttackBtn = document.getElementById('mobileAttackBtn');
    const mobileSkillBtn = document.getElementById('mobileSkillBtn');

    if (!joystickBase || !joystickStick || !mobileNitroBtn || !mobileShiftBtn || !mobileAttackBtn || !mobileSkillBtn) return;

    let baseRect = null;
    let centerX = 0;
    let centerY = 0;
    let maxRadius = 0;

    function updateBaseCoords() {
        baseRect = joystickBase.getBoundingClientRect();
        centerX = baseRect.left + baseRect.width / 2;
        centerY = baseRect.top + baseRect.height / 2;
        maxRadius = baseRect.width / 2;
    }

    updateBaseCoords();
    window.addEventListener('resize', updateBaseCoords);

    _joystickTouchStart = (e) => {
        if (_isCutsceneActive() || keys.shift) return;
        e.preventDefault();
        updateBaseCoords();
        const touch = e.changedTouches[0];
        touchJoystickId = touch.identifier;
        _handleJoystickMove(touch);
    };

    function _handleJoystickMove(touch) {
        if (keys.shift) return;
        const dx = touch.clientX - centerX;
        const dy = touch.clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let stickX = dx;
        let stickY = dy;
        if (distance > maxRadius) {
            stickX = (dx / distance) * maxRadius;
            stickY = (dy / distance) * maxRadius;
        }

        joystickStick.style.transform = `translate(${stickX}px, ${stickY}px)`;

        const threshold = 0.25;
        const normX = stickX / maxRadius;
        const normY = stickY / maxRadius;

        keys.w = normY < -threshold;
        keys.s = normY > threshold;
        keys.a = normX < -threshold;
        keys.d = normX > threshold;
    }

    _windowTouchMove = (e) => {
        if (_isCutsceneActive()) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (touch.identifier === touchJoystickId) {
                _handleJoystickMove(touch);
            } else if (touch.identifier === touchRotationId) {
                const deltaX = touch.clientX - rotationLastX;
                const deltaY = touch.clientY - rotationLastY;
                
                look.yaw -= deltaX * 0.006;
                look.pitch -= deltaY * 0.004;
                const PITCH_LIMIT = 80 * Math.PI / 180;
                look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch));

                rotationLastX = touch.clientX;
                rotationLastY = touch.clientY;
            }
        }
    };

    _windowTouchEnd = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (touch.identifier === touchJoystickId) {
                touchJoystickId = null;
                joystickStick.style.transform = 'translate(0px, 0px)';
                keys.w = false;
                keys.s = false;
                keys.a = false;
                keys.d = false;
            } else if (touch.identifier === touchRotationId) {
                touchRotationId = null;
            }
        }
    };

    _windowTouchStart = (e) => {
        if (_isCutsceneActive()) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const target = touch.target;
            
            if (joystickBase.contains(target) || 
                mobileNitroBtn.contains(target) || 
                mobileShiftBtn.contains(target) ||
                target.closest('.panel') ||
                target.closest('.exitGameBtn') ||
                target.closest('#chatContainer')) {
                continue;
            }

            if (touchRotationId === null) {
                touchRotationId = touch.identifier;
                rotationLastX = touch.clientX;
                rotationLastY = touch.clientY;
            }
        }
    };

    _nitroTouchStart = (e) => {
        if (_isCutsceneActive() || keys.shift) return;
        e.preventDefault();
        keys[' '] = true;
        nitro.active = true;
        mobileNitroBtn.classList.add('active');
    };

    _nitroTouchEnd = (e) => {
        e.preventDefault();
        keys[' '] = false;
        nitro.active = false;
        mobileNitroBtn.classList.remove('active');
    };

    _shiftTouchStart = (e) => {
        if (_isCutsceneActive()) return;
        e.preventDefault();
        keys.shift = true;
        mobileShiftBtn.classList.add('active');
        // Reset joystick UI khi nhấn Shift
        touchJoystickId = null;
        joystickStick.style.transform = 'translate(0px, 0px)';
    };

    _shiftTouchEnd = (e) => {
        e.preventDefault();
        keys.shift = false;
        mobileShiftBtn.classList.remove('active');
    };

    let _attackTouchStart = (e) => {
        if (_isCutsceneActive()) return;
        e.preventDefault();
        keys.attack = true;
        mobileAttackBtn.classList.add('active');
    };

    let _attackTouchEnd = (e) => {
        e.preventDefault();
        keys.attack = false;
        mobileAttackBtn.classList.remove('active');
    };

    let _skillTouchStart = (e) => {
        if (_isCutsceneActive()) return;
        e.preventDefault();
        keys.skill = true;
        mobileSkillBtn.classList.add('active');
    };

    let _skillTouchEnd = (e) => {
        e.preventDefault();
        keys.skill = false;
        mobileSkillBtn.classList.remove('active');
    };

    joystickBase.addEventListener('touchstart', _joystickTouchStart, { passive: false });
    window.addEventListener('touchstart', _windowTouchStart, { passive: true });
    window.addEventListener('touchmove', _windowTouchMove, { passive: true });
    window.addEventListener('touchend', _windowTouchEnd, { passive: true });
    window.addEventListener('touchcancel', _windowTouchEnd, { passive: true });

    mobileNitroBtn.addEventListener('touchstart', _nitroTouchStart, { passive: false });
    mobileNitroBtn.addEventListener('touchend', _nitroTouchEnd, { passive: false });
    mobileNitroBtn.addEventListener('touchcancel', _nitroTouchEnd, { passive: false });

    mobileShiftBtn.addEventListener('touchstart', _shiftTouchStart, { passive: false });
    mobileShiftBtn.addEventListener('touchend', _shiftTouchEnd, { passive: false });
    mobileShiftBtn.addEventListener('touchcancel', _shiftTouchEnd, { passive: false });

    mobileAttackBtn.addEventListener('touchstart', _attackTouchStart, { passive: false });
    mobileAttackBtn.addEventListener('touchend', _attackTouchEnd, { passive: false });
    mobileAttackBtn.addEventListener('touchcancel', _attackTouchEnd, { passive: false });

    mobileSkillBtn.addEventListener('touchstart', _skillTouchStart, { passive: false });
    mobileSkillBtn.addEventListener('touchend', _skillTouchEnd, { passive: false });
    mobileSkillBtn.addEventListener('touchcancel', _skillTouchEnd, { passive: false });
}

function _destroyTouchControls() {
    const joystickBase = document.getElementById('joystickBase');
    const mobileNitroBtn = document.getElementById('mobileNitroBtn');
    const mobileShiftBtn = document.getElementById('mobileShiftBtn');
    const mobileAttackBtn = document.getElementById('mobileAttackBtn');
    const mobileSkillBtn = document.getElementById('mobileSkillBtn');

    if (joystickBase && _joystickTouchStart) {
        joystickBase.removeEventListener('touchstart', _joystickTouchStart);
    }
    if (_windowTouchStart) window.removeEventListener('touchstart', _windowTouchStart);
    if (_windowTouchMove) window.removeEventListener('touchmove', _windowTouchMove);
    if (_windowTouchEnd) {
        window.removeEventListener('touchend', _windowTouchEnd);
        window.removeEventListener('touchcancel', _windowTouchEnd);
    }

    if (mobileNitroBtn && _nitroTouchStart) {
        mobileNitroBtn.removeEventListener('touchstart', _nitroTouchStart);
        mobileNitroBtn.removeEventListener('touchend', _nitroTouchEnd);
        mobileNitroBtn.removeEventListener('touchcancel', _nitroTouchEnd);
    }

    if (mobileShiftBtn && _shiftTouchStart) {
        mobileShiftBtn.removeEventListener('touchstart', _shiftTouchStart);
        mobileShiftBtn.removeEventListener('touchend', _shiftTouchEnd);
        mobileShiftBtn.removeEventListener('touchcancel', _shiftTouchEnd);
    }

    touchJoystickId = null;
    touchRotationId = null;
    keys.w = false;
    keys.s = false;
    keys.a = false;
    keys.d = false;
    keys[' '] = false;
    keys.shift = false;
    keys.attack = false;
    keys.skill = false;
    nitro.active = false;
}

function _onCanvasClick() {
    if (!_chatOpen && _canvas) _canvas.requestPointerLock();
}

function _onMouseDown(e) {
    if (_chatOpen) return;
    if (document.pointerLockElement !== _canvas) return;
    if (_isCutsceneActive()) return;
    if (e.button === 0) { // Left Click
        keys.attack = true;
    }
}

function _onMouseUp(e) {
    if (e.button === 0) {
        keys.attack = false;
    }
}

/**
 * Khoi tao input listeners.
 * @param {HTMLCanvasElement} canvas
 * @param {{ onFlyToggle: function, isCutscene: function, onShowToggle?: function, onNetworkChatSend?: function, senderName?: string }} options
 */
export function initInput(canvas, { onFlyToggle, isCutscene, onShowToggle, onNetworkChatSend, senderName }) {
    _canvas = canvas;
    _onFlyToggle = onFlyToggle;
    _isCutsceneActive = isCutscene;
    _onShowToggle = onShowToggle || null;
    _onNetworkChatSend = onNetworkChatSend || null;
    _senderName = senderName || 'Bạn';

    _createChatUI();

    if (isMobileDevice()) {
        _initTouchControls();
    } else {
        canvas.addEventListener('click', _onCanvasClick);
        document.addEventListener('mousemove', _onMouseMove);
        document.addEventListener('mousedown', _onMouseDown);
        document.addEventListener('mouseup', _onMouseUp);
    }

    window.addEventListener('keydown', _onKeyDown);
    window.addEventListener('keyup', _onKeyUp);
}

export function destroyInput() {
    if (isMobileDevice()) {
        _destroyTouchControls();
    } else {
        document.removeEventListener('mousemove', _onMouseMove);
        document.removeEventListener('mousedown', _onMouseDown);
        document.removeEventListener('mouseup', _onMouseUp);
        _canvas?.removeEventListener('click', _onCanvasClick);
    }
    window.removeEventListener('keydown', _onKeyDown);
    window.removeEventListener('keyup', _onKeyUp);
    for (const k in keys) keys[k] = false;
    nitro.active = false;
    if (_chatContainer) {
        _chatContainer.remove();
        _chatContainer = null;
        _chatInput = null;
    }
}

function _createChatUI() {
    const existing = document.getElementById('chatContainer');
    if (existing) existing.remove();

    _chatContainer = document.createElement('div');
    _chatContainer.id = 'chatContainer';

    const messagesBox = document.createElement('div');
    messagesBox.id = 'chatMessages';

    const inputRow = document.createElement('div');
    inputRow.id = 'chatInputRow';

    _chatInput = document.createElement('input');
    _chatInput.type = 'text';
    _chatInput.id = 'chatInputField';
    _chatInput.maxLength = 120;
    _chatInput.placeholder = 'Go "/" de dung lenh rieng, Enter de gui, Esc de dong...';
    _chatInput.style.cssText = `
        width: 100%;
        background: transparent;
        border: none;
        outline: none;
        color: white;
        font-size: 14px;
        font-family: Arial;
    `;
    _chatInput.addEventListener('keydown', _onChatKeyDown);

    inputRow.appendChild(_chatInput);
    _chatContainer.appendChild(messagesBox);
    _chatContainer.appendChild(inputRow);
    document.body.appendChild(_chatContainer);
}

function _openChat() {
    if (_chatOpen) return;
    _chatOpen = true;
    document.exitPointerLock?.();
    const row = document.getElementById('chatInputRow');
    if (row) row.style.display = 'block';
    setTimeout(() => { if (_chatInput) _chatInput.focus(); }, 10);
}

function _closeChat() {
    _chatOpen = false;
    const row = document.getElementById('chatInputRow');
    if (row) row.style.display = 'none';
    if (_chatInput) _chatInput.value = '';
    if (_canvas) _canvas.requestPointerLock();
}

function _sendChat(text) {
    text = text.trim();
    if (!text) return;

    if (text.startsWith('/')) {
        // Lệnh có prefix "/": chỉ xử lý/hiện cục bộ, KHÔNG gửi cho người chơi khác
        _handleLocalCommand(text);
        return;
    }

    // Tin nhắn thường: hiện cho chính mình (kèm tên) và gửi broadcast cho người khác
    _addChatMessage(text, 'white', _senderName);
    if (_onNetworkChatSend) {
        try { _onNetworkChatSend(text); } catch(e) {}
    }
}

function _handleLocalCommand(raw) {
    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = (parts[1] || '').toLowerCase();

    if (cmd === 'fly') {
        let turnOn;
        if (arg === 'on') turnOn = true;
        else if (arg === 'off') turnOn = false;
        else turnOn = undefined; // không có tham số -> toggle

        if (_onFlyToggle) _onFlyToggle(turnOn);
        _addChatMessage(`* Che do bay: ${arg === 'off' ? 'TAT' : 'BAT'}`, '#00ff88');
    } else if (cmd === 'show') {
        if (arg === 'on') _isShowHudOn = true;
        else if (arg === 'off') _isShowHudOn = false;
        else _isShowHudOn = !_isShowHudOn; // toggle nếu không có tham số

        if (_onShowToggle) _onShowToggle(_isShowHudOn);
        _addChatMessage(`* Hien toa do/che do: ${_isShowHudOn ? 'ON' : 'OFF'}`, '#00b7ff');
    } else {
        _addChatMessage(`* Lenh khong hop le: ${raw}`, '#ff5566');
    }
}

/** Gọi từ main.js khi nhận tin nhắn broadcast từ người chơi khác qua Firebase */
export function addRemoteChatMessage(senderName, text) {
    _addChatMessage(text, '#bfe9ff', senderName);
}

function _addChatMessage(text, color, authorName) {
    const messagesBox = document.getElementById('chatMessages');
    if (!messagesBox) return;

    const msg = document.createElement('div');
    msg.className = 'chat-msg-line';
    msg.style.color = color || 'white';
    msg.style.animation = 'fadeInChat 0.2s ease';

    if (authorName) {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'chat-author';
        authorSpan.textContent = `${authorName}:`;
        msg.appendChild(authorSpan);
        msg.appendChild(document.createTextNode(text));
    } else {
        msg.textContent = text;
    }

    messagesBox.prepend(msg);
    _chatMessages.push(msg);

    while (_chatMessages.length > 8) {
        const old = _chatMessages.shift();
        old.remove();
    }

    setTimeout(() => {
        msg.style.transition = 'opacity 0.5s';
        msg.style.opacity = '0';
        setTimeout(() => { msg.remove(); const idx = _chatMessages.indexOf(msg); if (idx >= 0) _chatMessages.splice(idx, 1); }, 500);
    }, 6000);
}

function _onChatKeyDown(e) {
    if (e.key === 'Enter') {
        const text = _chatInput ? _chatInput.value : '';
        _closeChat();
        if (text.trim()) _sendChat(text);
        e.stopPropagation();
        e.preventDefault();
    } else if (e.key === 'Escape') {
        _closeChat();
        e.stopPropagation();
    }
}

function _onMouseMove(e) {
    if (_chatOpen) return;
    if (document.pointerLockElement !== _canvas) return;
    if (_isCutsceneActive()) return;

    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;

    look.yaw -= movementX * 0.0025;
    look.pitch -= movementY * 0.0015;
    const PITCH_LIMIT = 80 * Math.PI / 180;
    look.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, look.pitch));
}

function _onKeyDown(e) {
    if (_chatOpen) return;
    if (_isCutsceneActive()) return;

    if (e.key === 'Enter' || e.key === 't') {
        _openChat();
        e.preventDefault();
        return;
    }

    let key = e.key.toLowerCase();
    if (e.key === ' ') {
        key = ' ';
        // nitro chỉ active khi không giữ shift; nhưng vẫn lưu keys[' ']=true vào state thật
        if (!keys.shift) nitro.active = true;
    }
    if (e.key === 'e') {
        key = 'skill';
    }
    if (e.key === 'Control') key = 'control';
    if (key in keys) keys[key] = true;
}

function _onKeyUp(e) {
    if (_chatOpen) return;
    let key = e.key.toLowerCase();
    if (e.key === ' ') {
        key = ' ';
        nitro.active = false;
    }
    if (e.key === 'e') {
        key = 'skill';
    }
    if (e.key === 'Control') key = 'control';
    if (key in keys) keys[key] = false;
}

if (!document.getElementById('chatAnimStyle')) {
    const style = document.createElement('style');
    style.id = 'chatAnimStyle';
    style.textContent = `@keyframes fadeInChat { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`;
    document.head.appendChild(style);
}