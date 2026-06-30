// src/config/vehicles.js
// Cấu hình chỉ số và hành vi riêng cho từng phương tiện

export const VEHICLES_CONFIG = {
    xelan: {
        id: "xelan",
        name: "Xe lăn",
        modelPath: "assets/model/xelan/xelan.glb",
        iconPath: "assets/icons_pack/vehicle/xelan.ico",
        hp: 100,
        maxSpeed: 0.45,         // Tốc độ tối đa trong game (tương đương 50km/h)
        nitroCapacity: 110,     // Chỉ số nitro (càng lớn dùng càng lâu)
        nitroBoostSpeed: 1.5,   // Tốc độ nhân lên khi nitro (tốc độ mới = tốc độ hiện tại * 1.5)
        damage: 20,             // Sát thương khi tấn công trúng đối thủ
        attackRange: 1.5,       // Tầm đánh cận chiến (chuột trái)
        hitboxSize: { x: 1.2, y: 2.0, z: 1.2 },
        sounds: {
            attack: "assets/sounds/swing.ogg",
            hit: "assets/sounds/bonk.ogg",
            move: "assets/sounds/wheelchair.ogg",
            brakes: "assets/sounds/car_drift.ogg" // cái này là lúc giữ shiff
            /**
             * một hành động có thể có nhiều âm thanh ví dụ 
             move: {
                <tên sound>: "assets/sounds/wheelchair.ogg",
                dichuyen2: "assets/sounds/wheelchair2.ogg"
             }
             sau này trong playermanager sẽ viết logic phát từng cái âm thanh sau
             * còn nếu hành động chỉ có 1 âm thanh kiểu 
             move: "assets/sounds/wheelchair.ogg"
             thì chỉ cần phát âm thanh đó
             */
        },
        dustParticles: [
            { x: -0.5, y: -0.55, z: 0.70, speedThreshold: 0.15 }, // Bánh trái sau
            { x: 0.5, y: -0.55, z: 0.70, speedThreshold: 0.15 }   // Bánh phải sau
        ],
        wheels: {
            type: "four_wheels",
            names: {
                rearRight: "defaultMaterial",
                frontRight: "defaultMaterial003",
                rearLeft: "defaultMaterial001",
                frontLeft: "defaultMaterial002"
            }
        }
    },
    xerua: {
        id: "xerua",
        name: "Xe rùa",
        modelPath: "assets/model/xerua/xerua.glb",
        iconPath: "assets/icons_pack/vehicle/xerua.ico",
        hp: 120,
        maxSpeed: 0.38,         // Chậm hơn một chút (tương đương 42km/h)
        nitroCapacity: 90,      // Nitro ngắn hơn
        nitroBoostSpeed: 1.3,   // Tăng tốc nitro ít hơn
        damage: 35,             // Sát thương cực to
        attackRange: 1.8,       // Tầm đánh dài hơn
        hitboxSize: { x: 1.4, y: 1.8, z: 1.4 },
        sounds: {
            attack: "assets/sounds/swing.ogg",
            hit: "assets/sounds/metal_hit.ogg",
            move: "assets/sounds/wheelbarrow.ogg",
            brakes: "assets/sounds/car_drift.ogg" // cái này là lúc giữ shiff
        },
        dustParticles: [
            { x: 0, y: -0.6, z: 0.8, speedThreshold: 0.12 }
        ],
        wheels: {
            type: "single_wheel",
            name: "wheel"
        }
    }
};