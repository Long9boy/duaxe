// src/core/network.js
// Đồng bộ dữ liệu phòng, vị trí, góc quay Host/Guest qua Firebase Realtime Database

import {
    ref, set, get, update, onValue, remove, onDisconnect, off
} from "firebase/database";
import { db } from "../config/firebase.js";

export const NETWORK_SYNC_INTERVAL = 70; // ms giữa 2 lần push vị trí lên Firebase

// ===== Room helpers =====

/** Tạo mã phòng ngẫu nhiên 6 ký tự viết hoa */
export function randomRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Tạo phòng mới trên Firebase.
 * @param {string} roomId
 * @param {string} hostName
 * @param {object[]} spawns - danh sách spawn points
 * @param {string} avatar - tên file avatar (vd: bat.ico)
 * @param {string} vehicle - tên phương tiện (vd: xelan)
 */
export async function createRoom(roomId, hostName, spawns, avatar, vehicle) {
    const roomRef = ref(db, "rooms/" + roomId);
    const roomData = {
        host: hostName,
        players: { p0: hostName },
        playersInfo: {
            p0: {
                name: hostName,
                avatar: avatar || "bat.ico",
                vehicle: vehicle || "xelan"
            }
        },
        playersHP: {
            p0: 100
        },
        mapId: "hongkong_city",
        gameState: "waiting"
    };
    // Khởi tạo vị trí, góc quay và anim cho cả 6 slot
    for (let i = 0; i < 6; i++) {
        roomData[`p${i}Pos`] = spawns[i];
        roomData[`p${i}RotY`] = 0;
        roomData[`p${i}Anim`] = 1; // ANIM.IDLE
    }
    await set(roomRef, roomData);
    onDisconnect(roomRef).remove();
    onDisconnect(ref(db, "sync/" + roomId)).remove();
    return roomRef;
}

/**
 * Tham gia phòng đã tồn tại.
 * @param {string} roomId
 * @param {string} guestName
 * @param {string} avatar - tên file avatar
 * @param {string} vehicle - tên phương tiện
 * @returns {{ success: boolean, error?: string, slotKey?: string }}
 */
export async function joinRoom(roomId, guestName, avatar, vehicle) {
    const roomRef = ref(db, "rooms/" + roomId);
    const snapshot = await get(roomRef);

    if (!snapshot.exists()) return { success: false, error: "Không tìm thấy phòng!" };
    const data = snapshot.val();
    
    if (data.gameState === "playing") return { success: false, error: "Trận đấu đã bắt đầu, không thể tham gia!" };
    
    const players = data.players || {};
    const playerList = Object.values(players).filter(Boolean);
    if (playerList.length >= 6) return { success: false, error: "Phòng đã đầy!" };
    if (playerList.includes(guestName)) return { success: false, error: "Tên đã tồn tại trong phòng!" };

    // Tìm slot trống đầu tiên từ p1 đến p5 (host luôn là p0)
    let slotKey = "";
    for (let i = 1; i < 6; i++) {
        if (!players[`p${i}`]) {
            slotKey = `p${i}`;
            break;
        }
    }

    if (!slotKey) return { success: false, error: "Không tìm thấy vị trí trống!" };

    // Cập nhật tên, thông tin người chơi và máu lên Firebase
    const updates = {};
    updates[`players/${slotKey}`] = guestName;
    updates[`playersInfo/${slotKey}`] = {
        name: guestName,
        avatar: avatar || "bat.ico",
        vehicle: vehicle || "xelan"
            };
    updates[`playersHP/${slotKey}`] = 100;
    
    await update(roomRef, updates);
    
    // Đăng ký onDisconnect tự động xóa slot này khi rớt mạng
    onDisconnect(ref(db, "rooms/" + roomId + "/players/" + slotKey)).set(null);
    onDisconnect(ref(db, "rooms/" + roomId + "/playersInfo/" + slotKey)).remove();
    onDisconnect(ref(db, "rooms/" + roomId + "/playersHP/" + slotKey)).remove();
    onDisconnect(ref(db, "sync/" + roomId + "/" + slotKey)).remove();
    onDisconnect(ref(db, "rooms/" + roomId + "/loaded/" + slotKey)).remove();

    return { success: true, slotKey };
}

/**
 * Lắng nghe thay đổi dữ liệu phòng.
 * @param {string} roomId
 * @param {function} callback - nhận snapshot.val()
 */
export function listenRoom(roomId, callback) {
    const roomRef = ref(db, "rooms/" + roomId);
    onValue(roomRef, (snapshot) => callback(snapshot.val()));
    return roomRef;
}

/** Hủy lắng nghe phòng */
export function unlistenRoom(roomId) {
    off(ref(db, "rooms/" + roomId));
}

/**
 * Cập nhật bản đồ phòng chơi (chỉ dành cho chủ phòng).
 */
export async function updateRoomMap(roomId, mapId) {
    await update(ref(db, "rooms/" + roomId), { mapId });
}

/**
 * Đồng bộ máu HP của người chơi lên Firebase.
 */
export function syncHP(roomId, slotKey, hp) {
    if (!roomId || !slotKey) return;
    set(ref(db, `rooms/${roomId}/playersHP/${slotKey}`), hp);
}

/**
 * Ghi danh người chơi đã cán đích vào danh sách phòng.
 */
export async function syncFinish(roomId, name) {
    if (!roomId || !name) return;
    // Đọc danh sách hiện tại và thêm tên vào cuối
    const winnersRef = ref(db, `rooms/${roomId}/winners`);
    const snapshot = await get(winnersRef);
    let winnersList = [];
    if (snapshot.exists()) {
        winnersList = snapshot.val();
        if (!Array.isArray(winnersList)) {
            // Nếu là dạng object (Firebase đôi khi tự chuyển đổi), chuyển về array
            winnersList = Object.values(winnersList);
        }
    }
    if (!winnersList.includes(name)) {
        winnersList.push(name);
        await set(winnersRef, winnersList);
    }
}

/**
 * Host bắt đầu game (set gameState = "playing").
 * @param {string} roomId
 */
export async function startGame(roomId) {
    const snapshot = await get(ref(db, "rooms/" + roomId));
    const data = snapshot.val();
    if (!data.players) return { success: false, error: "Không có người chơi tham gia!" };
    await update(ref(db, "rooms/" + roomId), { gameState: "playing" });
    return { success: true };
}

/**
 * Rời phòng hoặc giải tán phòng.
 * @param {string} roomId
 * @param {boolean} isHost
 * @param {string} mySlotKey
 */
export async function leaveRoom(roomId, isHost, mySlotKey) {
    const roomRef = ref(db, "rooms/" + roomId);
    onDisconnect(roomRef).cancel();
    if (mySlotKey) {
        onDisconnect(ref(db, "rooms/" + roomId + "/players/" + mySlotKey)).cancel();
        onDisconnect(ref(db, "rooms/" + roomId + "/playersInfo/" + mySlotKey)).cancel();
        onDisconnect(ref(db, "rooms/" + roomId + "/playersHP/" + mySlotKey)).cancel();
        onDisconnect(ref(db, "sync/" + roomId + "/" + mySlotKey)).cancel();
        onDisconnect(ref(db, "rooms/" + roomId + "/loaded/" + mySlotKey)).cancel();
    }
    if (isHost) {
        onDisconnect(ref(db, "sync/" + roomId)).cancel();
        await remove(roomRef);
        await remove(ref(db, "sync/" + roomId));
    } else if (mySlotKey) {
        await remove(ref(db, "rooms/" + roomId + "/players/" + mySlotKey));
        await remove(ref(db, "rooms/" + roomId + "/playersInfo/" + mySlotKey));
        await remove(ref(db, "rooms/" + roomId + "/playersHP/" + mySlotKey));
        await remove(ref(db, "sync/" + roomId + "/" + mySlotKey));
        await remove(ref(db, "rooms/" + roomId + "/loaded/" + mySlotKey));
    }
}

/**
 * Push vị trí + góc quay + anim lên Firebase.
 * @param {string} roomId
 * @param {string} slotKey
 * @param {{ x, y, z }} pos
 * @param {number} rotY
 * @param {number} animIndex
 */
export function syncPosition(roomId, slotKey, pos, rotY, animIndex) {
    if (!slotKey) return;
    set(ref(db, "sync/" + roomId + "/" + slotKey), {
        pos: { x: pos.x, y: pos.y, z: pos.z },
        rotY: rotY,
        anim: animIndex !== undefined ? animIndex : 1
    });
}

/**
 * Lắng nghe thay đổi vị trí và hoạt ảnh của một người chơi khác.
 * @param {string} roomId
 * @param {string} slotKey
 * @param {function} callback
 */
export function listenPlayerSync(roomId, slotKey, callback) {
    const syncRef = ref(db, "sync/" + roomId + "/" + slotKey);
    onValue(syncRef, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.val());
        }
    });
    return syncRef;
}

/** Hủy lắng nghe vị trí một người chơi */
export function unlistenPlayerSync(roomId, slotKey) {
    off(ref(db, "sync/" + roomId + "/" + slotKey));
}

/** Lắng nghe người chiến thắng cuộc đua */
export function listenWinner(roomId, callback) {
    const winnerRef = ref(db, "rooms/" + roomId + "/winner");
    onValue(winnerRef, (snapshot) => callback(snapshot.val()));
    return winnerRef;
}

/** Hủy lắng nghe người chiến thắng */
export function unlistenWinner(roomId) {
    off(ref(db, "rooms/" + roomId + "/winner"));
}

/**
 * Gửi tin nhắn chat (broadcast) lên phòng. Chỉ dùng cho tin nhắn KHÔNG có prefix "/",
 * vì các lệnh có "/" chỉ xử lý cục bộ và không được gửi lên server.
 * @param {string} roomId
 * @param {string} senderName
 * @param {string} text
 */
/**
 * Gửi tin nhắn chat (broadcast) lên phòng. Chỉ dùng cho tin nhắn KHÔNG có prefix "/",
 * vì các lệnh có "/" chỉ xử lý cục bộ và không được gửi lên server.
 * @param {string} roomId
 * @param {string} senderName
 * @param {string} text
 * @param {string} [senderSlot] - slot của người gửi (ví dụ 'p0'), dùng để loại trùng tin của chính mình khi nhận lại từ Firebase
 */
export function sendChatMessage(roomId, senderName, text, senderSlot) {
    if (!roomId || !text) return;
    const msgRef = ref(db, "rooms/" + roomId + "/chat/" + Date.now() + "_" + Math.random().toString(36).slice(2, 6));
    set(msgRef, { name: senderName, text: text, ts: Date.now(), slot: senderSlot || null });
}

/**
 * Lắng nghe tin nhắn chat mới của phòng.
 * Callback nhận (msgObj) mỗi khi có tin nhắn mới được thêm vào (dùng onChildAdded-like qua onValue + diff thời gian).
 * @param {string} roomId
 * @param {function} callback - nhận { name, text, ts }
 */
export function listenChatMessages(roomId, callback) {
    const chatRef = ref(db, "rooms/" + roomId + "/chat");
    const seen = new Set();
    const startTime = Date.now();
    onValue(chatRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        Object.keys(data).forEach(key => {
            if (seen.has(key)) return;
            seen.add(key);
            const msg = data[key];
            // Chỉ phát các tin nhắn mới (tránh phát lại toàn bộ lịch sử cũ khi mới vào phòng)
            if (msg && msg.ts && msg.ts >= startTime - 1000) {
                callback(msg);
            }
        });
    });
    return chatRef;
}

/** Hủy lắng nghe chat */
export function unlistenChatMessages(roomId) {
    off(ref(db, "rooms/" + roomId + "/chat"));
}

/**
 * Khởi động timer tự xóa phòng nếu không có player trong TIMEOUT_MS.
 * Gọi 1 lần khi tạo phòng (host side).
 * @param {string} roomId
 * @param {number} [timeoutMs=120000] - 2 phút mặc định
 */
export function watchAndDeleteEmptyRoom(roomId, timeoutMs = 120_000) {
    const roomRef = ref(db, "rooms/" + roomId);
    let emptyTimer = null;

    const unsub = onValue(roomRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            // Phong da bi xoa boi nguoi khac
            if (emptyTimer) clearTimeout(emptyTimer);
            off(roomRef);
            return;
        }

        const players = data.players || {};
        const playerList = Object.values(players).filter(Boolean);
        const isEmpty  = playerList.length === 0;

        if (isEmpty) {
            // Bat dau dem nguoc
            if (!emptyTimer) {
                emptyTimer = setTimeout(async () => {
                    try {
                        // Kiem tra lai truoc khi xoa
                        const snap = await get(roomRef);
                        const d = snap.val();
                        const dPlayers = d ? (d.players || {}) : {};
                        const dPlayerList = Object.values(dPlayers).filter(Boolean);
                        if (d && dPlayerList.length === 0) {
                            await remove(roomRef);
                        }
                    } catch(e) {}
                    off(roomRef);
                }, timeoutMs);
            }
        } else {
            // Co player: huy dem nguoc
            if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; }
        }
    });

    return unsub;
}