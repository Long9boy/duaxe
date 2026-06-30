// src/config/maps.js
// Cấu hình động hệ thống bản đồ (Spawnpoints, Checkpoints, Cutscenes)

export const MAPS_CONFIG = {
    hongkong_city: {
        id: "hongkong_city",
        name: "Hồng Kông",
        modelPath: "assets/maps/hongkong_city/scene.glb",
        iconPath: "assets/icons_pack/maps/hongkong_city.ico",
        cubemap: [
            "assets/cubemap/Pack1/cubemap_right.jpg",
            "assets/cubemap/Pack1/cubemap_left.jpg",
            "assets/cubemap/Pack1/cubemap_top.jpg",
            "assets/cubemap/Pack1/cubemap_bottom.jpg",
            "assets/cubemap/Pack1/cubemap_front.jpg",
            "assets/cubemap/Pack1/cubemap_back.jpg"
        ],
        spawnPoints: [
            { x: 312, y: 6.25, z: -302 },
            { x: 306, y: 6.25, z: -294 },
            { x: 303, y: 6.25, z: -296 },
            { x: 308, y: 6.25, z: -305 },
            { x: 304, y: 6.25, z: -308 },
            { x: 299, y: 6.25, z: -300 }
        ],
        checkpoints: [
            { x: 263.50, y: 32.25, z: 128.50 }, // Checkpoint 1
            { x: 40.00,  y: 6.35,  z: -325.50 } // Checkpoint 2 (Đích)
        ],
        cutscene: {
            segments: [
                {
                    type: "rotation",
                    duration: 4000,
                    position: { x: 380, y: 50, z: 135 },
                    rotation: {
                        pitch: -0.25,
                        yawStart: 0,
                        yawEnd: 380 * Math.PI / 180,
                        radius: 50
                    }
                },
                {
                    type: "bezier",
                    duration: 3500,
                    points: [
                        { x: 335, y: 40, z: -225 }, // P0
                        { x: 275, y: 60, z: -230 }, // P1 (Control)
                        { x: 225, y: 45, z: -300 }  // P2
                    ],
                    lookAt: { x: 306, y: 7, z: -301 }
                },
                {
                    // Đoạn cuối: camera đi theo đường cong P0->P1->P2, hướng nhìn xoay mượt
                    // từ hướng Đông (E) sang nhìn thẳng về phía player. Đây cũng là đoạn
                    // "chốt" góc nhìn gameplay (look.yaw/pitch) - không cần postCutscene riêng.
                    type: "bezier",
                    duration: 2200,
                    points: [
                        { x: 390, y: 35.25, z: 120 }, // P0
                        { x: 370, y: 25,    z: 35 },  // P1 (Control)
                        { x: 395, y: 18,    z: -75 }  // P2
                    ],
                    lookAt: [
                        { viewpoint: "E" },
                        { viewpoint: "player" }
                    ]
                }
            ]
        }
    },
    shanghai_international_circuit: {
        id: "shanghai_international_circuit",
        name: "Thượng Hải",
        modelPath: "assets/maps/shanghai_international_circuit/scene.glb",
        iconPath: "assets/icons_pack/maps/shanghai_international_circuit.ico",
        cubemap: [
            "assets/cubemap/pack2/cubemap_right.jpg",
            "assets/cubemap/pack2/cubemap_left.jpg",
            "assets/cubemap/pack2/cubemap_top.jpg",
            "assets/cubemap/pack2/cubemap_bottom.jpg",
            "assets/cubemap/pack2/cubemap_front.jpg",
            "assets/cubemap/pack2/cubemap_back.jpg"
        ],
        spawnPoints: [
            { x: 0,   y: 1.0, z: 0 },
            { x: -5,  y: 1.0, z: 8 },
            { x: 5,   y: 1.0, z: -8 },
            { x: -10, y: 1.0, z: 16 },
            { x: 10,  y: 1.0, z: -16 },
            { x: 0,   y: 1.0, z: 16 }
        ],
        checkpoints: [
            { x: 0,   y: 1.0, z: 150 },   // Checkpoint 1
            { x: 150, y: 1.0, z: 150 },   // Checkpoint 2
            { x: 150, y: 1.0, z: -150 },  // Checkpoint 3
            { x: 0,   y: 1.0, z: -150 }   // Checkpoint 4 (Đích)
        ],
        cutscene: {
            segments: [
                {
                    type: "linear",
                    duration: 4000,
                    points: [
                        { x: 0, y: 40, z: -100 },
                        { x: 0, y: 15, z: -20 }
                    ],
                    lookAt: { x: 0, y: 1.0, z: 30 }
                }
            ]
        }
    }
};