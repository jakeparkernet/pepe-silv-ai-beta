import { View } from "./View.js";
import * as THREE from "three";
import { createPooledMesh } from "../utils/AssetPool.js";

class DebugPlaneView extends View {

    constructor({ options = {} }) {
        super();

        this.options = options;

        const scale = options.scale ?? new THREE.Vector3(10, 0.25, 1);

        const thickness = options.thickness ?? 0.1;
        const doubleSided = options.doubleSided ?? true;
        const color = options.color ?? 0xffffff;
        const opacity = options.opacity ?? 1.0;
        const materialType = (options.materialType ?? "standard").toLowerCase();

        const textures = options.textures ?? {
            "map": {
                texture: "resources/edge_middle_albedo.png",
                params: {
                    wrapS: THREE.RepeatWrapping,
                },
                onLoad: function (texture) {
                    const repX = Math.max(1e-6, scale.x);
                    texture.repeat.set(repX, 1);
                }.bind(this)
            },
            "alphaMap": {
                texture: "resources/edge_middle_alpha.png",
                params: {
                    wrapS: THREE.RepeatWrapping,
                },
                onLoad: function (texture) {
                    const repX = Math.max(1e-6, scale.x);
                    texture.repeat.set(repX, 1);
                }.bind(this)
            },
            "normal": {
                texture: "resources/edge_middle_normal.png",
                params: {
                    wrapS: THREE.RepeatWrapping,
                },
                onLoad: function (texture) {
                    const repX = Math.max(1e-6, scale.x);
                    texture.repeat.set(repX, 1);
                }.bind(this)
            }
        }

        const geometryParams = { width: 1, height: 1 };
        const materialParams = {
            color,
            opacity,
            transparent: true,
            side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            textures: textures
        };

        this.mesh = createPooledMesh("plane", geometryParams, materialType, materialParams);
        this.mesh.scale.copy(scale);
        this.getRootGroup().add(this.mesh);
        this.getRootGroup().scale.set(2, 2, 2);
    }
}

export { DebugPlaneView };
