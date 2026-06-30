# Đua Xe Ao Làng

Game đua xe 3D multiplayer sử dụng Three.js và Firebase Realtime Database.

## Cấu trúc dự án

```
Duaxe/
├── index.html              # HTML shell, CSS tĩnh, importmap
├── assets/
│   ├── cubemap/            # 6 mặt skybox texture (.jpg)
│   └── maps/hongkong_city/ # Map 3D đường đua Hồng Kông (scene.glb)
└── src/
    ├── main.js             # Entry point, UI, Game Loop, Camera
    ├── config/
    │   └── firebase.js     # Khởi tạo Firebase App + Database
    ├── core/
    │   ├── input.js        # Bàn phím + Pointer Lock
    │   ├── network.js      # Đồng bộ phòng/vị trí qua Firebase (tối đa 6 người chơi)
    │   ├── physics.js      # Trọng lực, nhảy, va chạm tường, narrow-gap, frustum culling
    │   └── spatial.js      # Spatial Grid setup
    └── player/
        ├── playerManager.js # Quản lý xe (xelan.glb) và animation (idle, move, turn)
        └── models/
            └── xelan.glb    # Model 3D xe đua
```

## Khởi chạy

Cần chạy qua HTTP server (không mở file:// trực tiếp do ES Modules):

```bash
# Python 3
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Sau đó mở `http://localhost:8080` trên trình duyệt.

## Tính năng nổi bật & Tối ưu hiệu năng

- **Lobby 6 Người Chơi**: Phòng chờ đa người chơi thời gian thực (đồng bộ vị trí, hoạt ảnh). Yêu cầu tối thiểu 2 người chơi để bắt đầu game.
- **Frustum Culling**:
  - *Đồ họa*: Three.js tự động lọc các mesh nằm ngoài khung hình camera để không render.
  - *Vật lý*: Lọc và chỉ tính toán va chạm (raycast) cho những phần map 3D nằm trong tầm nhìn camera, tiết kiệm tài nguyên CPU tối đa.
- **Spatial Uniform Grid**: Phân chia bản đồ thành các ô lưới không gian nhỏ để truy vấn vật thể va chạm lân cận nhanh chóng O(1).
- **Logarithmic Depth Buffer**: Giảm tối đa hiện tượng z-fighting trên bản đồ lớn.
- **Hệ thống Camera**: Tự động chuyển đổi mượt mà từ Cinematic Cutscene ban đầu sang góc nhìn phía sau người chơi (Behind Camera).

## Điều khiển

| Phím | Hành động |
|------|-----------|
| W/A/S/D | Di chuyển |
| Space | Nhảy |
| Space x2 | Bật/tắt chế độ bay tự do |
| Ctrl/Shift/C | Bay xuống (fly mode) |
| Chuột | Xoay camera |
