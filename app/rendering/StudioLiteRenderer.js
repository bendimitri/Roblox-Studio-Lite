import {
    Scene,
    PerspectiveCamera,
    TextureLoader,
    Clock,
    Matrix4,
    Color,
    SphereGeometry,
    CylinderGeometry,
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshPhongMaterial,
    MeshStandardMaterial,
    BackSide,
    MeshBasicMaterial,
    BoxGeometry,
    DataTexture,
    SRGBColorSpace,
    AxesHelper,
    Box3,
    Box3Helper,
    Raycaster,
    Vector2,
    Vector3,
    PlaneGeometry,
    RepeatWrapping
} from '../thirdparty/three/three.core.js';
import { applyMaterialLook, getMaterialTexture, getMaterialPBR, peekMaterialPBR, materialHasPBRPack, getBaseplateTexture, BASEPLATE_TILE_STUDS, TILE_STUDS } from './Materials.js';
import { enableTriplanar, syncTriplanarFromPart } from './MaterialTriplanar.js';
import { LightingManager, enablePartShadowLayers, excludeFromLocalShadows } from './LightingManager.js';
import { LightGizmos } from './LightGizmos.js';
import { decode } from "../thirdparty/rbxBinaryParser.js";
import { normalizeServices } from "../datamodel/Services.js";
import FlyCamera from '../controls/FlyCamera.js';
import StudioTools from '../controls/StudioTools.js';
import { WebGLRenderer } from '../thirdparty/three/three.module.js';
import {
    findByClassName
} from '../datamodel/DataModelUtils.js';
import { parseMesh } from './mesh/MeshParser.js';
import {
    tryToFetch
} from '../http/TryToFetch.js';
import AssetManager from '../http/AssetManager.js';
import Effects from './Effects.js';

const DEFAULT_SKY = {
    SkyboxBk: "rbxasset://sky/null_plainsky512_bk.jpg",
    SkyboxDn: "rbxasset://sky/null_plainsky512_dn.jpg",
    SkyboxFt: "rbxasset://sky/null_plainsky512_ft.jpg",
    SkyboxLf: "rbxasset://sky/null_plainsky512_lf.jpg",
    SkyboxRt: "rbxasset://sky/null_plainsky512_rt.jpg",
    SkyboxUp: "rbxasset://sky/null_plainsky512_up.jpg"
};

/** Part face -> outward normal, plane rotation (from +Z facing) and which size axes span it. */
const DECAL_FACES = {
    Front: { n: [0, 0, -1], rot: [0, Math.PI], w: 0, h: 1 },
    Back: { n: [0, 0, 1], rot: [0, 0], w: 0, h: 1 },
    Right: { n: [1, 0, 0], rot: [0, Math.PI / 2], w: 2, h: 1 },
    Left: { n: [-1, 0, 0], rot: [0, -Math.PI / 2], w: 2, h: 1 },
    Top: { n: [0, 1, 0], rot: [-Math.PI / 2, 0], w: 0, h: 2 },
    Bottom: { n: [0, -1, 0], rot: [Math.PI / 2, 0], w: 0, h: 2 }
};
export const partClasses = ["Part", "SpawnLocation", "WedgePart", "CornerWedgePart", "Seat", "VehicleSeat", "MeshPart", "TrussPart", "UnionOperation", "IntersectOperation"];

/**
 * Object-scale UV tiling for BoxGeometry (Roblox Part behavior).
 * Shared PBR maps keep wrap=Repeat / repeat=(1,1); tiling lives in UV space so
 * albedo, normal, roughness and metalness stay locked together.
 * tiles = faceAxisSize / TILE_STUDS — resize never stretches, only repeats.
 */
function setTiledUVs(geometry, sx, sy, sz, tile) {
    const uv = geometry.attributes && geometry.attributes.uv;
    if (!uv || uv.count !== 24) return false;
    const t = Math.max(0.0001, tile || TILE_STUDS);
    const face = (start, u, v) => {
        uv.setXY(start + 0, 0, v);
        uv.setXY(start + 1, u, v);
        uv.setXY(start + 2, 0, 0);
        uv.setXY(start + 3, u, 0);
    };
    face(0, sz / t, sy / t);
    face(4, sz / t, sy / t);
    face(8, sx / t, sz / t);
    face(12, sx / t, sz / t);
    face(16, sx / t, sy / t);
    face(20, sx / t, sy / t);
    uv.needsUpdate = true;
    return true;
}

/** True when geometry should use triplanar instead of box face UVs. */
function needsTriplanar(geometry, part) {
    if (!geometry || !geometry.attributes || !geometry.attributes.uv) return true;
    if (geometry.attributes.uv.count !== 24) return true;
    if (part && (part.Shape === "Ball" || part.Shape === "Cylinder" || part.ClassName === "WedgePart" || part.ClassName === "CornerWedgePart")) return true;
    return false;
}

// jsTree deep-copies its data with JSON on refresh: instances (cyclic through Parent/Part0/… refs)
// stay out of the copy and are looked up by id in `renderer.nodes` instead.
function treeItemToJSON() {
    const { instance, ...rest } = this;
    return rest;
}

export class StudioLiteRenderer {
    constructor(conf) {
        this.conf = conf;
        this.queue = {
            total: 0,
            completed: 0
        }
        this.texturesOfFailedMeshes = {};
        this.imagePlaceholder = false;
        this.mAssetManager = new AssetManager({
            sharedFunctions: {
                print: this.conf.sharedFunctions.print
            }
        });
        /** Geometry imported from external 3D files (FBX/OBJ/GLTF/STL), keyed by a synthetic MeshId. */
        this.importedMeshes = new Map();
        this._importedMeshSeq = 0;
        this.scene = new Scene();
        this.camera = new PerspectiveCamera(75, this.conf.width/this.conf.height, 0.1, 15000);
        this.renderer = new WebGLRenderer({
            antialias: true,
            alpha: true
        });
        this.renderer.autoClear = false;
        this.renderer.setSize(this.conf.width, this.conf.height);
        this.domElement = this.renderer.domElement;
        this.loader = new TextureLoader();
        this.loader.crossOrigin = "Anonymous";
        this.clock = new Clock();
        this.lighting = new LightingManager({
            scene: this.scene,
            renderer: this.renderer,
            camera: this.camera
        });
        // Default Future look until a place's Lighting service is applied
        this.lighting.apply({
            Technology: "Future",
            Ambient: { R: 70 / 255, G: 70 / 255, B: 70 / 255 },
            OutdoorAmbient: { R: 128 / 255, G: 128 / 255, B: 128 / 255 },
            Brightness: 2,
            ClockTime: 14,
            GeographicLatitude: 41.73,
            EnvironmentDiffuseScale: 1,
            EnvironmentSpecularScale: 1,
            ExposureCompensation: 0,
            GlobalShadows: true,
            ShadowSoftness: 0.2,
            FogEnd: 100000
        });
        this.sun = this.lighting.sun;
        this.shadowTier = this.lighting.shadowTier;
        this.lightGizmos = new LightGizmos(this.scene);
        const isActive = this.conf.sharedFunctions.isViewportActive || (() => true);
        this.controls = new FlyCamera(this.camera, this.domElement, {
            isActive,
            print: this.conf.sharedFunctions.print
        });
        this.tools = new StudioTools({
            scene: this.scene,
            camera: this.camera,
            domElement: this.domElement,
            flyCamera: this.controls,
            isPickable: (object, includeLocked) => this.isPickable(object, includeLocked),
            resolveTarget: (mesh, options) => this.resolveTarget(mesh, options),
            // Keep material UV tiling in sync when the scale gizmo / undo changes Size.
            onPartSizeChanged: (mesh, instance) => this.updateMaterialUV(mesh, instance),
            isActive,
            print: this.conf.sharedFunctions.print
        });
        /** Light instance selected in the Explorer — the only thing that shows a hologram. */
        this._selectedLight = null;
        this.tools.addEventListener("selectionchange", (e) => {
            if (e.detail?.source === "explorer") return;
            this._selectedLight = null;
            this.syncLightGizmos();
        });
        this.tools.addEventListener("helpersvisibility", () => this.syncLightGizmos());
        this.setSkybox(DEFAULT_SKY);
        this.effects = new Effects(this.scene);
        this.axesHelper = new AxesHelper(20);
        this.scene.add(this.axesHelper);
        this.raycaster = new Raycaster();
        // Index 0 is reserved: jsTree treats a falsy node id as "generate one for me".
        this.threeids = [1];
        /** DataModel tree nodes by tree id: { id, instance, parentId, childIds } */
        this.nodes = [];
        this.pointer = new Vector2();
        this.useSelectionBox2 = false;
        this.hoverKey = null;
        this.hoverBox = new Box3();
        this.hoverHelper = new Box3Helper(this.hoverBox, new Color(0.55, 0.8, 1));
        this.hoverHelper.name = "HoverBox";
        this.hoverHelper.visible = false;
        this.hoverHelper.raycast = () => {};
        this.scene.add(this.hoverHelper);
        this.pointerInside = false;
        this.domElement.addEventListener("mousemove", (event) => {
            const rect = this.domElement.getBoundingClientRect();
            this.pointer.x = ( (event.clientX - rect.left) / rect.width ) * 2 - 1;
            this.pointer.y = - ( (event.clientY - rect.top) / rect.height ) * 2 + 1;
        });
        this.domElement.addEventListener("mouseenter", () => { this.pointerInside = true; });
        this.domElement.addEventListener("mouseleave", () => { this.pointerInside = false; });
        this.noWorkspace = false;
    }

    get useSelectionBox() {
        return this.tools.showSelectionBox;
    }

    set useSelectionBox(value) {
        this.tools.setShowSelectionBox(value);
    }

    /** Locked parts can't be picked in the viewport (Studio behavior), only through the Explorer. */
    isPickable(object, includeLocked = false) {
        if (object.isMesh !== true || object === this.skybox || !object.visible) return false;
        if (!includeLocked && object.userData.instance && object.userData.instance.Locked) return false;
        return true;
    }

    render() {
        if (this.controls) this.controls.update(this.clock.getDelta());
        if (this.lighting) this.lighting.update(this.camera);
        if (this.lightGizmos) this.lightGizmos.update();
        this.syncSkybox();
        this.updateHover();
        this.renderer.render(this.scene, this.camera);
        if (this.lighting) this.lighting.endShadowPass();
    }

    /**
     * Keep sky textures visible at every Graphics Quality.
     * Low quality shrinks camera.far (e.g. 400) — a fixed 10000³ cube gets clipped.
     * Pin the sky to the camera and size it just inside the far plane.
     */
    syncSkybox() {
        const sky = this.skybox;
        if (!sky || !this.camera || !sky.parent) return;
        sky.position.copy(this.camera.position);
        // Side length ≈ far so faces stay in frustum (corners still under far × √3/2)
        const side = Math.max(20, this.camera.far * 0.9);
        sky.scale.set(side, side, side);
    }

    updateHover() {
        const tools = this.tools;
        const canHover = this.useSelectionBox2 && this.pointerInside && this.controls.mode === "idle" && !tools.dragging && tools.transform.axis === null;
        const hit = canHover ? tools.pickNdc(this.pointer) : null;
        const target = hit ? this.resolveTarget(hit.object, {}) : null;
        const key = target ? (target.isMesh || target.isBone || target.isObject3D ? target.id : `model:${target.treeId}`) : null;
        const selectedKey = tools.target ? (tools.target.kind === "model" ? `model:${tools.target.treeId}` : tools.target.object.id) : null;
        if (!key || key === selectedKey) {
            this.hoverHelper.visible = false;
            this.hoverKey = null;
            return;
        }
        // Bones move every frame while animating, so their box is refreshed continuously.
        if (key !== this.hoverKey || target.isBone || target.userData?.isAnimRig) {
            this.hoverBox.makeEmpty();
            const meshes = target.isBone ? [target.userData.partMesh].filter(Boolean)
                : target.userData?.isAnimRig ? target.userData.partMeshes
                : target.isMesh ? [target] : target.meshes;
            for (const mesh of meshes) this.hoverBox.expandByObject(mesh);
            this.hoverKey = key;
        }
        this.hoverHelper.visible = true;
    }

    renderImage(width = this.conf.width, height = this.conf.height) {
        this.tools.setHelpersVisible(false);
        const hoverVisible = this.hoverHelper.visible;
        this.hoverHelper.visible = false;
	    this.renderer.setSize(width, height);
	    this.camera.aspect = width / height;
	    this.camera.updateProjectionMatrix();
        this.renderer.render(this.scene, this.camera);
        if (this.lighting) this.lighting.endShadowPass();
        const result = this.domElement.toDataURL();
        this.resize();
        this.tools.setHelpersVisible(true);
        this.hoverHelper.visible = hoverVisible;
        return result;
    }

    setAnimationLoop(cb) {
        this.renderer.setAnimationLoop(cb);
    }

    resize() {
	    this.renderer.setSize(this.conf.width, this.conf.height);
	    this.camera.aspect = this.conf.width / this.conf.height;
	    this.camera.updateProjectionMatrix();
    }

    toggleAxes(axes) {
        if (axes) {
            this.scene.add(this.axesHelper);
        } else {
            this.scene.remove(this.axesHelper);
        }
    }

    setAxesPosition(x, y, z) {
        this.axesHelper.position.set(x, y, z);
    }

    zoomTo(cameraFrame, rotate = true) {
        this.camera.position.set(cameraFrame.Position.X, cameraFrame.Position.Y, cameraFrame.Position.Z);
        if (rotate) this.camera.setRotationFromMatrix(new Matrix4().fromArray([
            cameraFrame.Components[3], cameraFrame.Components[6], cameraFrame.Components[9], 0,
            cameraFrame.Components[4], cameraFrame.Components[7], cameraFrame.Components[10], 0,
            cameraFrame.Components[5], cameraFrame.Components[8], cameraFrame.Components[11], 0,
            0, 0, 0, 1
        ]));
    }

    /**
     * Selects what a DataModel tree id represents: a part mesh, a whole Model, or nothing.
     * @param {number|undefined} treeId
     */
    selectFromExplorer(treeId) {
        const node = this.nodes[treeId];
        const cls = node?.instance?.ClassName;
        this._selectedLight = /^(PointLight|SpotLight|SurfaceLight)$/.test(cls || "") ? node.instance : null;
        this.tools.select(this.targetForTreeId(treeId), "explorer");
        this.syncLightGizmos();
    }

    targetForTreeId(treeId) {
        const node = this.nodes[treeId];
        if (!node) return null;
        if (node.instance.__three) return node.instance.__three;
        const mesh = this.getMeshForTreeId(treeId);
        if (mesh) return mesh;
        if (node.instance.ClassName === "Model") {
            const meshes = this.meshesForNode(treeId);
            if (meshes.length > 0) return { treeId, name: node.instance.Name, meshes };
        }
        return null;
    }

    getMeshForTreeId(treeId) {
        if (treeId === undefined || treeId === null) return null;
        const threeid = this.threeids[treeId];
        if (threeid === undefined || threeid === 1) return null;
        return this.scene.getObjectById(threeid) || null;
    }

    /** All rendered meshes at or below a tree node. */
    meshesForNode(treeId) {
        const out = [];
        const stack = [treeId];
        while (stack.length) {
            const id = stack.pop();
            const mesh = this.getMeshForTreeId(id);
            if (mesh) out.push(mesh);
            const node = this.nodes[id];
            if (node) stack.push(...node.childIds);
        }
        return out;
    }

    /**
     * Studio click rule: clicking a part selects its closest Model ancestor; Alt+click selects the part.
     */
    resolveTarget(mesh, { alt = false } = {}) {
        if (mesh.userData.boneTarget) return this.rigResolver ? this.rigResolver(mesh, alt) : mesh.userData.boneTarget;
        const treeId = mesh.userData.treeId;
        if (alt || treeId === undefined) return mesh;
        let node = this.nodes[treeId];
        node = node ? this.nodes[node.parentId] : null;
        while (node && node.instance.ClassName !== "Workspace") {
            if (node.instance.ClassName === "Model") {
                return { treeId: node.id, name: node.instance.Name, meshes: this.meshesForNode(node.id) };
            }
            node = this.nodes[node.parentId];
        }
        return mesh;
    }

    getNode(treeId) {
        return this.nodes[treeId];
    }

    /** Removes a node (and descendants) from the scene, the node map and its parent's Children. */
    deleteNode(treeId) {
        const node = this.nodes[treeId];
        if (!node) return;
        for (const mesh of this.meshesForNode(treeId)) {
            mesh.traverse((o) => {
                if (o.isLight && o.userData && o.userData.lightRef) this._disposeLight(o);
            });
            mesh.removeFromParent();
            if (mesh.geometry) mesh.geometry.dispose();
        }
        const cls = node.instance && node.instance.ClassName;
        if (node.instance === this._selectedLight) this._selectedLight = null;
        if (cls === "PointLight" || cls === "SpotLight" || cls === "SurfaceLight") {
            this.scene.traverse((o) => {
                if (o.isLight && o.userData && o.userData.lightRef === node.instance) this._disposeLight(o);
            });
        }
        const parent = this.nodes[node.parentId];
        if (parent) {
            parent.childIds = parent.childIds.filter((id) => id !== treeId);
            const idx = parent.instance.Children.indexOf(node.instance);
            if (idx !== -1) parent.instance.Children.splice(idx, 1);
        }
        const stack = [treeId];
        while (stack.length) {
            const id = stack.pop();
            const n = this.nodes[id];
            if (n) stack.push(...n.childIds);
            delete this.nodes[id];
            this.threeids[id] = 1;
        }
        this.conf.sharedFunctions.treeRefresh2();
    }

    /** Re-parents a node in the node map and the DataModel instances. */
    moveNode(treeId, newParentId) {
        const node = this.nodes[treeId];
        const target = this.nodes[newParentId];
        if (!node || !target) return;
        const old = this.nodes[node.parentId];
        if (old) {
            old.childIds = old.childIds.filter((id) => id !== treeId);
            const idx = old.instance.Children.indexOf(node.instance);
            if (idx !== -1) old.instance.Children.splice(idx, 1);
        }
        node.parentId = newParentId;
        target.childIds.push(treeId);
        target.instance.Children.push(node.instance);
    }

    findNodeByClassName(className) {
        return this.nodes.find((n) => n && n.parentId === undefined && n.instance.ClassName === className);
    }

    /**
     * Adds a new instance (with its descendants) under `parentId`, rendering parts.
     * @returns {Promise<{ id: number, item: object }>} tree id and jsTree item data
     */
    async addInstance(instance, parentId) {
        const parent = this.nodes[parentId];
        if (parent) parent.instance.Children.push(instance);
        const item = this.registerNode(instance, parentId);
        if (partClasses.indexOf(instance.ClassName) !== -1) await this.renderPart(instance, false, item.id);
        await this.traverse(instance, item.children, true, item.id);
        return { id: item.id, item };
    }

    /**
     * Registers an instance subtree in the node map without rendering it — for objects
     * whose THREE side is built elsewhere (animation rigs). Returns the jsTree item.
     */
    registerInstanceTree(instance, parentId) {
        const parent = this.nodes[parentId];
        if (parent) parent.instance.Children.push(instance);
        const walk = (inst, pid) => {
            const item = this.registerNode(inst, pid);
            for (const child of inst.Children || []) item.children.push(walk(child, item.id));
            return item;
        };
        return walk(instance, parentId);
    }

    registerNode(instance, parentId) {
        const id = this.threeids.push(1) - 1;
        this.nodes[id] = { id, instance, parentId, childIds: [] };
        if (parentId !== undefined && this.nodes[parentId]) this.nodes[parentId].childIds.push(id);
        return { text: instance.Name, icon: `content/icons/${instance.ClassName}.png`, children: [], instance, id, toJSON: treeItemToJSON };
    }

    /** Ground point for inserting assets: under the given NDC point, or in front of the camera. */
    getInsertPoint(ndc = new Vector2(0, 0)) {
        const hit = this.tools.pickNdc(ndc, { includeLocked: true });
        const point = new Vector3();
        if (hit && hit.distance < 600) {
            point.copy(hit.point);
        } else {
            this.camera.getWorldDirection(point);
            point.multiplyScalar(30).add(this.camera.position);
        }
        point.x = Math.round(point.x);
        point.z = Math.round(point.z);
        point.y = Math.round(point.y * 10) / 10;
        return point;
    }

    /** Frames a set of meshes like Studio's "Zoom To" (F). */
    focusOn(meshes) {
        if (!meshes || meshes.length === 0) return;
        const box = new Box3();
        for (const mesh of meshes) box.expandByObject(mesh);
        const center = box.getCenter(new Vector3());
        const radius = Math.max(box.getSize(new Vector3()).length() / 2, 2);
        const dir = new Vector3();
        this.camera.getWorldDirection(dir);
        const dist = radius / Math.sin((this.camera.fov * Math.PI / 180) / 2) * 0.9;
        this.camera.position.copy(center).addScaledVector(dir, -dist);
        this.camera.lookAt(center);
    }

    showSkybox(show) {
        if (show)
            this.scene.add(this.skybox);
        else
            this.scene.remove(this.skybox);
    }

    getThreeId(id) {
        return this.threeids[id];
    }

    async setSkybox(sky) {
        if (this.skybox) {
            this.scene.remove(this.skybox);
            this.skybox.geometry?.dispose();
            for (const m of this.skybox.material || []) m?.dispose?.();
        }
        this.skybox = null;
        const urls = await Promise.all([
            this.mAssetManager.parseAssetPath(sky.SkyboxFt),
            this.mAssetManager.parseAssetPath(sky.SkyboxBk),
            this.mAssetManager.parseAssetPath(sky.SkyboxUp),
            this.mAssetManager.parseAssetPath(sky.SkyboxDn),
            this.mAssetManager.parseAssetPath(sky.SkyboxRt),
            this.mAssetManager.parseAssetPath(sky.SkyboxLf)
        ]);
        const material = urls.map((url) => {
            const mat = new MeshBasicMaterial({
                map: this.loadColorTexture(url),
                side: BackSide,
                depthWrite: false,
                fog: false
            });
            return mat;
        });
        // Unit cube — syncSkybox() scales to camera.far so Graphics Quality never clips clouds
        this.skybox = new Mesh(new BoxGeometry(1, 1, 1), material);
        this.skybox.name = "Skybox";
        this.skybox.frustumCulled = false;
        this.skybox.renderOrder = -1000;
        this.skybox.userData.hideInExplorer = true;
        this.scene.add(this.skybox);
        this.syncSkybox();
        this.conf.sharedFunctions.treeRefresh2();
    }

    queueOperation(cb) {
        (async () => {
            this.queue.total++;
            await cb();
            this.queue.completed++;
        })();
    }
    
    get queueSize() {
        return this.queue.total - this.queue.completed;
    }

    async renderPart(part, forceNoMesh = false, mappedid) {
        const transparent = part.Transparency > 0;
        let geometry, material, decals = [];
        let offset = {x: 0, y: 0, z: 0};
        let scale = {x: 1, y: 1, z: 1};

        // Look for mesh data
        let mesh = findByClassName(part.Children, "SpecialMesh");
        if (!mesh && part.ClassName === "MeshPart") mesh = part;
        const meshTexture = mesh ? (mesh.TextureId || mesh.TextureID || "") : "";

        // Decide part color
        let color = new Color(1, 1, 1);
        if (part.Color3) {
            color = new Color(part.Color3.R, part.Color3.G, part.Color3.B);
        } else if (part.BrickColor) {
            color = new Color(part.BrickColor.Color.R/255, part.BrickColor.Color.G/255, part.BrickColor.Color.B/255)
        }

        // Give meshes special treatment
        const blockMesh = mesh && mesh !== part ? mesh : findByClassName(part.Children, "BlockMesh");
        if (blockMesh) {
            scale = {
                x: blockMesh.Scale.X,
                y: blockMesh.Scale.Y,
                z: blockMesh.Scale.Z
            };
            // offset stays y-only for now. offset coordinates are somehow relative to rotation? tf??
            // to see what I mean, uncomment X and Z, then open City.rbxl from the examples.
            // Look at the stop signs. whaat? I ain't figuring this one out.
            offset = {
                x: 0,//blockMesh.Offset.X,
                y: blockMesh.Offset.Y,
                z: 0,//blockMesh.Offset.Z
            };
        }
        
        // If ball or cylinder, decide geometry
        if (part.Shape == "Ball") {
            geometry = new SphereGeometry(part.Size.X / 2, 24, 16)
        } else if (part.Shape === "Cylinder" || (mesh && mesh.MeshType === "Head")) {
            let x, y, z;
            if (part.Shape === "Cylinder") {
                x = part.Size.X;
                y = part.Size.Y;
                z = part.Size.Z;
            } else {
                x = part.Size.Y;
                y = part.Size.X;
                z = part.Size.Z;
            }
            const cylinderRadius = Math.min(y, z) / 2;
            geometry = new CylinderGeometry(cylinderRadius, cylinderRadius, x, 16, 16);
        } else if (!forceNoMesh && mesh && (mesh.MeshType === "FileMesh" || part.ClassName === "MeshPart")) {
            // Look, a mesh! Let's queue that so it doesn't block place loading.
            this.queueOperation(async () => {
                try {
                    let positions, normal, uv;
                    const imported = this.importedMeshes.get(mesh.MeshId);
                    if (imported) {
                        ({ positions, normal, uv } = imported);
                    } else {
                        var meshData = await this.getMesh(mesh.MeshId || "", this.mAssetManager.getAssetId(meshTexture));
                        ({ positions, normal, uv } = await parseMesh(meshData, mesh.MeshId));
                    }
                    const geometry = new BufferGeometry();
                    const positionNumComponents = 3;
                    const normalNumComponents = 3;
                    const uvNumComponents = 3;
                    geometry.setAttribute(
                    "position",
                    new BufferAttribute(
                        new Float32Array(positions),
                        positionNumComponents
                    )
                    );
                    geometry.setAttribute(
                    "normal",
                    new BufferAttribute(new Float32Array(normal), normalNumComponents)
                    );
                    geometry.setAttribute(
                    "uv",
                    new BufferAttribute(new Float32Array(uv), uvNumComponents)
                    );
                    geometry.computeBoundingBox();
                    let box = geometry.boundingBox;
                    let x = box.max.x - box.min.x;
                    let y = box.max.y - box.min.y;
                    let z = box.max.z - box.min.z;
                    geometry.scale(part.Size.X / x, part.Size.Y / y, part.Size.Z / z);

                    const texturePath = meshTexture ? await this.mAssetManager.parseAssetPath(meshTexture) : "";
                    const tint = mesh !== part && mesh.VertexColor ? new Color(mesh.VertexColor.X, mesh.VertexColor.Y, mesh.VertexColor.Z) : null;
                    material = new MeshStandardMaterial( {
                        map: texturePath ? this.loadColorTexture(texturePath) : null,
                        color: texturePath ? (tint || new Color(1, 1, 1)) : color,
                        transparent: transparent,
                        opacity: 1 - (part.Transparency || 0),
                        roughness: 0.7,
                        metalness: 0.0
                    } )
                
                    let cube = new Mesh(geometry, material);
                    cube.receiveShadow = true
                    cube.castShadow = true
                    enablePartShadowLayers(cube);
                    cube.name = part.Name;
                    cube.position.set(part.CFrame.Position.X, part.CFrame.Position.Y, part.CFrame.Position.Z);
                    cube.setRotationFromMatrix(new Matrix4().fromArray([
                        part.CFrame.Components[3], part.CFrame.Components[6], part.CFrame.Components[9], 0,
                        part.CFrame.Components[4], part.CFrame.Components[7], part.CFrame.Components[10], 0,
                        part.CFrame.Components[5], part.CFrame.Components[8], part.CFrame.Components[11], 0,
                        0, 0, 0, 1
                    ]));
                    this.tagPartMesh(cube, part, mappedid, { x: 0, y: 0, z: 0 });
                    this.scene.add(cube);
                    if (mappedid) this.threeids[mappedid] = cube.id;
                // That didn't work! Let's load the part meshless instead.
                } catch (e) {
                    // forceNoMesh = true skips the mesh code, so this part will follow the regular code path.
                    this.renderPart(part, true, mappedid);
                }
            });
            return;
        } else {
            geometry = new BoxGeometry( part.Size.X * scale.x, part.Size.Y * scale.y, part.Size.Z * scale.z )
        }

        // Render wedgepart
        if (part.ClassName === "WedgePart") {
            let pos = geometry.attributes.position;
            for(let i = 0; i < pos.count; i++){
                if (pos.getZ(i) < 0 && pos.getY(i) > 0) pos.setY(i, (part.Size.Y / 2) * -1); // change Y-coord by condition
            }
            geometry.computeVertexNormals(); // don't forget to re-compute normals
        }

        // Enumerate decals
        for (let child of part.Children) {
            if (child.ClassName === "Decal" || child.ClassName === "Texture") {
                decals.push(child);
            }
        }

        // Stage two. We will queue this if there are decals, to not block.
        const renderPartStageTwo = async () => {
            material = new MeshStandardMaterial( {
                color: color,
                transparent: transparent,
                opacity: part.Transparency*-1+1,
                roughness: 0.7,
                metalness: 0.0
            } )
            if (part.ClassName === "TrussPart") {
                material.wireframe = true;
                material.transparent = false;
            }
            const overlays = [];
            for (const decal of decals) {
                const overlay = await this.buildDecalOverlay(decal, part.Size, scale);
                if (overlay) overlays.push(overlay);
            }

            // Create the mesh for our part.
            var cube = new Mesh( geometry, material )
            cube.receiveShadow = true
            cube.castShadow = true
            enablePartShadowLayers(cube);
            cube.name = part.Name;
            cube.position.set(part.CFrame.Position.X + offset.x, part.CFrame.Position.Y + offset.y, part.CFrame.Position.Z + offset.z);
            // Degrees aren't enough! We need to set the exact rotation matrix.
            // If we use just CFrame.Orientation, it will lead to incorrect placements => destroyed buildings.
            cube.setRotationFromMatrix(new Matrix4().fromArray([
                part.CFrame.Components[3], part.CFrame.Components[6], part.CFrame.Components[9], 0,
                part.CFrame.Components[4], part.CFrame.Components[7], part.CFrame.Components[10], 0,
                part.CFrame.Components[5], part.CFrame.Components[8], part.CFrame.Components[11], 0,
                0, 0, 0, 1
            ]));
            // This is needed for cylinders to rotate correctly. No idea why.
            if (part.Shape === "Cylinder") cube.rotation.z += Math.PI / 2;
            //cube.rotation.set(MathUtils.degToRad(part.CFrame.Orientation.X), MathUtils.degToRad(part.CFrame.Orientation.Y), MathUtils.degToRad(part.CFrame.Orientation.Z));
            this.tagPartMesh(cube, part, mappedid, offset);
            for (const overlay of overlays) cube.add(overlay);
            for (const child of part.Children) {
                const light = child && this.buildLight(child, part.Size);
                if (light) cube.add(light);
            }
            this.scene.add( cube )
            if (mappedid) this.threeids[mappedid] = cube.id;
        };
        
        // If there are no assets to load, render the part synchronously.
        // If there are assets, move rendering to the background,
        // so it doesn't block everything else if the user's connection is slow.
        // (it is just a HEAD request, tho...)
        if (decals.length > 0) {
            this.queueOperation(renderPartStageTwo);
        } else await renderPartStageTwo();
    }

    /** PointLight / SpotLight / SurfaceLight → Range-aware local lights (Future). */
    buildLight(rec, size) {
        return this.lighting.buildLocalLight(rec, size);
    }

    /** Re-apply full Lighting service (Technology, Ambient, ClockTime, shadows, …). */
    applyLighting(lighting) {
        if (!this.lighting) return;
        this.lighting.apply(lighting || null);
        this.shadowTier = this.lighting.shadowTier;
        this.sun = this.lighting.sun;
    }

    /** Maps Lighting.Technology → shadow budget (kept for older call sites). */
    applyLightingTechnology(technology) {
        const lighting = findByClassName(this.data || [], "Lighting") || { Technology: technology };
        if (technology) lighting.Technology = technology;
        this.applyLighting(lighting);
    }

    /** Attaches a light instance to an already-rendered part mesh. Returns true on success. */
    attachLightToPart(partTreeId, lightInstance) {
        const mesh = this.getMeshForTreeId(partTreeId);
        if (!mesh || !lightInstance) return false;
        const stale = [];
        mesh.traverse((o) => {
            if (o.isLight && o.userData && o.userData.lightRef === lightInstance) stale.push(o);
        });
        for (const o of stale) this._disposeLight(o);
        const size = (mesh.userData && mesh.userData.instance && mesh.userData.instance.Size) || null;
        const light = this.buildLight(lightInstance, size);
        if (!light) return false;
        // Parent never casts into its own child lights' shadow maps (Roblox self-shadow bypass)
        excludeFromLocalShadows(mesh);
        mesh.add(light);
        this.syncLightGizmos();
        return true;
    }

    _disposeLight(light) {
        this.lighting.disposeLocalLight(light);
        this.syncLightGizmos();
    }

    /** Rebuilds the THREE light for a DataModel light after property edits. */
    refreshLight(lightInstance) {
        if (!lightInstance) return;
        let partTreeId;
        for (const node of this.nodes) {
            if (!node) continue;
            if (node.instance === lightInstance) {
                partTreeId = node.parentId;
                break;
            }
        }
        if (partTreeId === undefined) return;
        this.attachLightToPart(partTreeId, lightInstance);
    }

    /** Explorer/viewport selection → yellow/magenta/green light holograms (edit mode). */
    syncLightGizmos() {
        if (!this.lightGizmos) return;
        const play = document.body.classList.contains("play-mode");
        const light = this._selectedLight;
        this.lightGizmos.setVisible(!play && this.tools.helpersVisible && !!light);
        if (play || !this.tools.helpersVisible || !light) {
            this.lightGizmos.clear();
            return;
        }
        this.lightGizmos.sync(light, this);
    }

    /** Decal / Texture drawn as a plane just above the part face (the part color shows through alpha). */
    async buildDecalOverlay(decal, size, scale = { x: 1, y: 1, z: 1 }) {
        const face = DECAL_FACES[decal.Face || "Front"];
        if (!face || !size) return null;
        const path = await this.mAssetManager.parseAssetPath(decal.Texture || decal.ColorMap || "");
        if (!path) return null;
        const dims = [size.X * scale.x, size.Y * scale.y, size.Z * scale.z];
        const w = dims[face.w], h = dims[face.h];
        const map = this.loadColorTexture(path);
        if (decal.ClassName === "Texture") {
            const tileU = decal.StudsPerTileU > 0 ? decal.StudsPerTileU : 2;
            const tileV = decal.StudsPerTileV > 0 ? decal.StudsPerTileV : 2;
            map.wrapS = map.wrapT = RepeatWrapping;
            map.repeat.set(w / tileU, h / tileV);
            map.offset.set((decal.OffsetStudsU || 0) / tileU, -(decal.OffsetStudsV || 0) / tileV);
        }
        const tint = decal.Color3 ? new Color(decal.Color3.R, decal.Color3.G, decal.Color3.B) : new Color(1, 1, 1);
        const plane = new Mesh(new PlaneGeometry(w, h), new MeshPhongMaterial({
            map,
            color: tint,
            transparent: true,
            opacity: 1 - (decal.Transparency || 0),
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            specular: 0x111111
        }));
        plane.rotation.set(face.rot[0], face.rot[1], 0);
        plane.position.set(face.n[0] * (dims[0] / 2 + 0.002), face.n[1] * (dims[1] / 2 + 0.002), face.n[2] * (dims[2] / 2 + 0.002));
        plane.name = decal.Name || decal.ClassName;
        plane.raycast = () => {};
        plane.userData.decal = true;
        return plane;
    }

    tagPartMesh(mesh, part, treeId, offset) {
        // Non-enumerable so the THREE.js Scene properties view doesn't walk the whole DataModel.
        Object.defineProperty(mesh.userData, "instance", { value: part, enumerable: false, writable: true });
        mesh.userData.treeId = treeId;
        mesh.userData.positionOffset = offset;
        mesh.userData.cylinder = part.Shape === "Cylinder";
        if (part.Size) mesh.userData.baseSize = { X: part.Size.X, Y: part.Size.Y, Z: part.Size.Z };
        if (part.Material) applyMaterialLook(mesh.material, part.Material, part.Transparency || 0);
        this.applyMaterialTexture(mesh, part);
    }

    /**
     * Applies Roblox PBR maps (albedo/normal/roughness/metalness) with object-scale tiling.
     * Box Parts → per-face UVs (setTiledUVs). Wedge/Cylinder/Ball/MeshPart → triplanar.
     * All maps share the same UV/triplanar coords so they never desync on resize.
     */
    applyMaterialTexture(mesh, part) {
        if (!mesh || !mesh.geometry || !part) return;
        const token = (mesh.userData._matToken = (mesh.userData._matToken || 0) + 1);
        const useTri = needsTriplanar(mesh.geometry, part);
        let tile = TILE_STUDS;

        const applyMaps = (maps, isBaseplate) => {
            if (token !== mesh.userData._matToken) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
                if (!m || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial)) continue;
                if (maps && (maps.map || maps.normalMap)) {
                    m.map = maps.map || null;
                    if (m.isMeshStandardMaterial) {
                        m.normalMap = maps.normalMap || null;
                        m.roughnessMap = maps.roughnessMap || null;
                        m.metalnessMap = maps.metalnessMap || null;
                        if (m.normalMap) m.normalScale.set(1, 1);
                    }
                    m.userData.materialMap = true;
                    // Part.Color tints the albedo (Roblox Color × ColorMap)
                    const c = part.Color3 || part.Color;
                    if (c && !isBaseplate) m.color.setRGB(c.R > 1 ? c.R / 255 : c.R, c.G > 1 ? c.G / 255 : c.G, c.B > 1 ? c.B / 255 : c.B);
                    else m.color.setRGB(1, 1, 1);
                    if (useTri && !isBaseplate) enableTriplanar(m, tile);
                    m.needsUpdate = true;
                } else if (m.userData.materialMap) {
                    m.map = null;
                    if (m.isMeshStandardMaterial) {
                        m.normalMap = null;
                        m.roughnessMap = null;
                        m.metalnessMap = null;
                    }
                    m.userData.materialMap = false;
                    const c = part.Color3 || part.Color;
                    if (c) m.color.setRGB(c.R > 1 ? c.R / 255 : c.R, c.G > 1 ? c.G / 255 : c.G, c.B > 1 ? c.B / 255 : c.B);
                    m.needsUpdate = true;
                }
            }
            mesh.userData.tileStuds = tile;
            mesh.userData.useTriplanar = useTri && !isBaseplate;
            this.updateMaterialUV(mesh, part);
        };

        if (part._baseplateGrid && !useTri) {
            tile = BASEPLATE_TILE_STUDS;
            applyMaps({ map: getBaseplateTexture() }, true);
            return;
        }

        const finishWithFallback = () => {
            const proc = getMaterialTexture(part.Material);
            applyMaps(proc ? { map: proc } : null, false);
        };

        // Already loaded → apply PBR immediately (no procedural flash)
        const cached = peekMaterialPBR(part.Material);
        if (cached !== undefined) {
            if (cached) applyMaps(cached, false);
            else finishWithFallback();
            return;
        }

        // Pack exists but not in memory yet: wait for PBR only (flat Part.Color meanwhile)
        if (materialHasPBRPack(part.Material)) {
            applyMaps(null, false);
            getMaterialPBR(part.Material).then((pbr) => {
                if (token !== mesh.userData._matToken) return;
                if (pbr) applyMaps(pbr, false);
                else finishWithFallback();
            });
            return;
        }

        // No PBR pack (Cardboard, etc.) → procedural only
        finishWithFallback();
    }

    /**
     * Recalculates tiling from Part.Size (and mesh.scale for triplanar).
     * Call on Size / Material / gizmo scale changes — never recreates textures.
     */
    updateMaterialUV(mesh, part) {
        if (!mesh || !mesh.geometry || !part) return false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!mats.some((m) => m && m.userData && m.userData.materialMap)) return false;
        const size = part.Size;
        if (!size) return false;
        const tile = mesh.userData.tileStuds || TILE_STUDS;
        if (mesh.userData.useTriplanar) {
            syncTriplanarFromPart(mesh.material, mesh, part, tile);
            return true;
        }
        return setTiledUVs(mesh.geometry, size.X, size.Y, size.Z, tile);
    }

    /** @deprecated use updateMaterialUV — kept as alias for existing call sites */
    retileMaterial(mesh, instance) {
        return this.updateMaterialUV(mesh, instance);
    }

    async traverse(instance, treeData, render = false, parentId = undefined) {
        for (let child of instance.Children) {
            if (child) {
                if (!Array.isArray(child.Children)) child.Children = [];
                const item = this.registerNode(child, parentId);
                treeData.push(item);
                if (render && partClasses.indexOf(child.ClassName) !== -1) {
                    await this.renderPart(child, false, item.id);
                }
                await this.traverse(child, item.children, render ? true : child.ClassName === "Workspace" || this.noWorkspace, item.id);
            }
        }
    }
    
    loadColorTexture( path ) {
        if (path.trim().length === 0) return new DataTexture(new Uint8Array(4), 1, 1);
        this.conf.sharedFunctions.print("Load texture " + new URL(path, window.location.href));
        const texture = this.loader.load( path );
        texture.colorSpace = SRGBColorSpace;
        return texture;
    }

    async getMesh(mesh, texture) {
        const path = await this.mAssetManager.parseAssetPath(mesh, "mesh", texture);
        if (path.trim().length === 0) throw new Error();
        var d = await fetch(path);
        var data = await d.arrayBuffer();
        return data;
    }

    /**
     * Registers flattened geometry from an external 3D import and returns a synthetic MeshId
     * (`importmesh://N`) that a MeshPart can reference; renderPart picks it up from the cache.
     * @param {{ positions:number[], normal:number[], uv:number[] }} geo
     * @returns {string} the MeshId to store on the MeshPart
     */
    registerImportedMesh(geo) {
        const id = `importmesh://${++this._importedMeshSeq}`;
        this.importedMeshes.set(id, { positions: geo.positions, normal: geo.normal, uv: geo.uv });
        return id;
    }

    /** Unloads the current place so another one can be opened in the same session. */
    clearPlace() {
        this.tools.select(null, "delete");
        const meshes = [];
        this.scene.traverse((o) => { if (o.isMesh && o.userData.instance) meshes.push(o); });
        for (const mesh of meshes) {
            mesh.removeFromParent();
            if (mesh.geometry) mesh.geometry.dispose();
        }
        this.threeids = [1];
        if (this.lighting) {
            this.lighting.localLightCount = 0;
            this.lighting.shadowLightCount = 0;
        }
        this.effects.clear();
        this.effects.setSource(null);
        this.nodes = [];
        this.conf.sharedObjects.jsTreeData.length = 0;
        this.data = null;
        this.hoverHelper.visible = false;
        this.hoverKey = null;
        this.setSkybox(DEFAULT_SKY);
    }

    async loadPlace(ab) {
        let instances = decode(ab);
        // Places (not loose .rbxm models) get Studio's full service list, in Explorer order.
        if (findByClassName(instances, "Workspace")) {
            const { instances: ordered, added } = normalizeServices(instances);
            instances = ordered;
            if (added.length) this.conf.sharedFunctions.print(`DataModel: serviços adicionados para paridade com o Roblox Studio: ${added.join(", ")}`);
        }
        await this.loadDataModel(instances);
    }

    /**
     * @param {object[]} instances top-level DataModel children
     * @param {{ cameraPosition?: number[], cameraTarget?: number[] }} [options]
     */
    async loadDataModel(instances, options = {}) {
        this.data = instances;
        const workspace = findByClassName(this.data, "Workspace");
        if (options.cameraPosition) {
            this.camera.position.fromArray(options.cameraPosition);
            this.camera.lookAt(new Vector3().fromArray(options.cameraTarget || [0, 0, 0]));
        }
        if (workspace) this.noWorkspace = false; else this.noWorkspace = true;
        try {
            const robloxCamera = findByClassName((this.noWorkspace ? findByClassName(this.data, "Model") : workspace).Children, "Camera");
            const cameraFrame = robloxCamera.CFrame || robloxCamera.CoordinateFrame;
            this.zoomTo(cameraFrame);
        } catch (ignored) {
            if (!options.cameraPosition) this.conf.sharedFunctions.print("Could not determine camera position!");
        }
        this.queueOperation(async () => {
            try {
                const sky = findByClassName(findByClassName(this.data, "Lighting").Children, "Sky");
                if (!sky) throw new Error();
                try {
                    for (const key of ["Bk", "Dn", "Ft", "Lf", "Rt", "Up"]) {
                        if (await tryToFetch(await this.mAssetManager.parseAssetPath(sky["Skybox" + key]))) {} else { throw new Error(); }
                    }
                    await this.setSkybox(sky);
                } catch (ignored) {
                    this.conf.sharedFunctions.print("Could not load sky!");
                }
            } catch (ignored) {};
        });
        await this.traverse({"Children": this.data}, this.conf.sharedObjects.jsTreeData);
        this.effects.setSource(workspace || null);
        const lighting = findByClassName(this.data, "Lighting");
        this.applyLighting(lighting);
        // Ensure all part meshes participate in sun/local shadow layer split
        this.scene.traverse((o) => {
            if (o.isMesh && o.userData && o.userData.instance && partClasses.indexOf(o.userData.instance.ClassName) !== -1) {
                enablePartShadowLayers(o);
            }
        });
        this._applyDefaultBaseplateGrid(workspace);
    }

    /**
     * Give the Studio's default baseplate (a Part named "Baseplate" sitting directly
     * in Workspace) the grid texture. Runs after the tree is built, so we re-apply the
     * texture on the already-rendered mesh. User-chosen materials clear the flag later.
     */
    _applyDefaultBaseplateGrid(workspace) {
        if (!workspace || !Array.isArray(workspace.Children)) return;
        const bp = workspace.Children.find(
            (c) => c && c.Name === "Baseplate" && partClasses.indexOf(c.ClassName) !== -1
        );
        if (!bp) return;
        bp._baseplateGrid = true;
        const node = Object.values(this.nodes).find((n) => n.instance === bp);
        if (!node) return;
        const mesh = this.getMeshForTreeId(node.id);
        if (mesh) this.applyMaterialTexture(mesh, bp);
    }
}