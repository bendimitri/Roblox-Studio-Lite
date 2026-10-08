import {
	Group,
	Mesh,
	BoxGeometry,
	MeshLambertMaterial,
	Vector3,
	Raycaster,
	AnimationMixer,
	LoopOnce,
	Box3,
	Euler,
	MathUtils
} from '../thirdparty/three/three.module.js';
import { GLTFLoader } from '../thirdparty/three/addons/loaders/GLTFLoader.js';
import { isTypingTarget, isDialogOpen } from '../controls/InputFocus.js';
import { buildR15Rig } from '../animation/R15Rig.js';
import { buildR6Rig } from '../animation/RigBuilder.js';
import { buildAvatarClips, WALK_CYCLE_SPEED } from './AvatarAnimations.js';
import { buildBlockyAvatar } from './BlockyAvatar.js';
import { loadAnimateClips, rollVariant } from './DefaultAnimate.js';

/* Roblox defaults, in studs: R6 is 5 studs tall, WalkSpeed 16, JumpPower 50, gravity 196.2. */
const HEIGHT = 5;
const HALF_HEIGHT = HEIGHT / 2;
const RADIUS = 1;
const WALK_SPEED = 16;
const JUMP_VELOCITY = 50;
const GRAVITY = 196.2;
const MAX_FALL_SPEED = 250;
const STEP_DOWN = 1.2;
const FALLEN_PARTS_HEIGHT = -500;
const MAX_STEP = 1 / 60;
const MAX_SUBSTEPS = 3;
const BROADPHASE_RADIUS = 60;
const BROADPHASE_INTERVAL = 0.2;
const TURN_RATE = 14;
const SHOULDER_OFFSET = 1.75;

/* Third person camera: 3 studs above and 5 behind the head, adjustable with the wheel. */
const CAMERA_HEIGHT = 3;
const CAMERA_DISTANCE = 5;
const CAMERA_MIN = 2;
const CAMERA_MAX = 40;
const HEAD_FOCUS = 1.5;

/* Animate LocalScript (R15) timings. */
const JUMP_ANIM_DURATION = 0.31;
const RUN_THRESHOLD = 0.75;
const NORMALIZED_WALK_SPEED = 0.5;
const NORMALIZED_RUN_SPEED = 1;
const SMALL_WEIGHT = 0.0001;

const R6_COLORS = {
	head: 0xf5cd30,
	arms: 0xf5cd30,
	torso: 0x0d69ac,
	legs: 0xa4bd47
};

const MOVE_KEYS = {
	KeyW: "forward", ArrowUp: "forward",
	KeyS: "backward", ArrowDown: "backward",
	KeyA: "left", ArrowLeft: "left",
	KeyD: "right", ArrowRight: "right"
};

const _down = new Vector3(0, -1, 0);
const _up = new Vector3(0, 1, 0);
const _v = new Vector3();
const _v2 = new Vector3();
const _euler = new Euler(0, 0, 0, "YXZ");
const _boxHit = new Vector3();

function lerpAngle(a, b, t) {
	const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
	return a + d * t;
}

/**
 * Play Mode character: avatar (GLTF or procedural R6), simple kinematic physics with raycasts,
 * WASD + Space input and a third person camera driven by a pointer-lock "rig" Object3D.
 */
export class PlayerController {
	/**
	 * @param {{ scene, camera, rig, domElement: HTMLElement, print?: Function, rigType?: "R15"|"R6", modelUrl?: string, onShiftLockChange?: (on: boolean) => void }} options
	 *        rig: Object3D whose quaternion (yaw/pitch) is driven by PointerLockControls.
	 *        rigType: Humanoid avatar from the experience settings; without it a GLTF model is tried first.
	 */
	constructor({ scene, camera, rig, domElement, print, rigType = null, modelUrl = "assets/player_model.glb", onShiftLockChange }) {
		this.scene = scene;
		this.camera = camera;
		this.rig = rig;
		this.domElement = domElement;
		this.print = print || (() => {});
		this.rigType = rigType;
		this.modelUrl = modelUrl;
		this.onShiftLockChange = onShiftLockChange || (() => {});
		/** Off: the character faces where it walks. On: it faces the camera, which sits over the right shoulder. */
		this.shiftLock = false;
		/** ESC menu: when true, WASD / jump / look / Shift are ignored (game still simulates). */
		this.inputBlocked = false;
		/** ESC "Shift Lock Switch": when false, Shift key cannot toggle shift lock. */
		this.shiftLockAllowed = true;
		/** Mouse look sensitivity multiplier (1..10 from ESC menu → ~0.4..1.6). */
		this.mouseSensitivity = 5;
		this._shoulder = 0;

		this.group = new Group();
		this.group.name = "Player";
		this.group.userData.hideInExplorer = true;
		this.velocity = new Vector3();
		this.grounded = false;
		/* Humanoid.WalkSpeed / Humanoid.JumpPower, writable from scripts. */
		this.walkSpeed = WALK_SPEED;
		this.jumpPower = JUMP_VELOCITY;
		/** Called after every (re)spawn, e.g. so scripts get CharacterAdded. */
		this.onSpawn = null;
		this.keys = { forward: false, backward: false, left: false, right: false, jump: false };
		this.cameraDistance = CAMERA_DISTANCE;
		this.spawnPoint = new Vector3(0, 10, 0);

		this.mixer = null;
		this.actions = {};
		this.currentAction = null;
		/** Animate-script state for the Blocky avatar; null with procedural / GLTF animations. */
		this.animate = null;
		this.limbs = null;
		this.walkPhase = 0;
		this.animState = "idle";

		this.raycaster = new Raycaster();
		this.raycaster.firstHitOnly = true;
		this.colliders = [];
		this.nearby = [];
		this._broadphaseTimer = 0;

		this._onKeyDown = this._onKeyDown.bind(this);
		this._onKeyUp = this._onKeyUp.bind(this);
		this._onBlur = this._onBlur.bind(this);
		this._onWheel = this._onWheel.bind(this);
	}

	/** Loads the avatar (configured Humanoid rig, else GLTF, else procedural R6) and starts listening for input. */
	async load() {
		let avatar = null;
		if (this.rigType === "R15") avatar = await this._setupBlockyAvatar();
		if (!avatar) {
			avatar = this.rigType ? this._setupHumanoidRig(this.rigType) : await this._loadModel();
			if (this.rigType) this.print(`Personagem ${this.rigType} carregado (Configuração da experiência) - animações idle, walk, jump e fall`);
		}
		this.group.add(avatar);
		this.scene.add(this.group);
		this._collectColliders();
		this._attachInput();
	}

	/** Puts the character on top of the first SpawnLocation, or at (0, 10, 0). */
	spawn() {
		let spawnMesh = null;
		for (const object of this.scene.children) {
			const inst = object.isMesh && object.userData.instance;
			if (inst && inst.ClassName === "SpawnLocation" && object.visible) {
				spawnMesh = object;
				break;
			}
		}
		if (spawnMesh) {
			const box = new Box3().setFromObject(spawnMesh);
			box.getCenter(this.spawnPoint);
			this.spawnPoint.y = box.max.y + HALF_HEIGHT + 0.1;
		} else {
			this.spawnPoint.set(0, 10, 0);
		}
		this.group.position.copy(this.spawnPoint);
		this.velocity.set(0, 0, 0);
		this.grounded = false;
		_euler.setFromQuaternion(this.rig.quaternion, "YXZ");
		this.group.rotation.set(0, _euler.y, 0);
		this._refreshBroadphase();
		this._updateCamera();
		this.print(spawnMesh ? `Spawned at ${spawnMesh.name || "SpawnLocation"}` : "No SpawnLocation found - spawned at (0, 10, 0)");
		this.onSpawn?.();
	}

	/** Moves the character (Character:PivotTo / HumanoidRootPart.CFrame from scripts). */
	teleport(x, y, z) {
		this.group.position.set(x, y, z);
		this.velocity.set(0, 0, 0);
		this.grounded = false;
		this._refreshBroadphase();
	}

	/** Re-reads the collision boxes of meshes that scripts moved, resized, hid or created. */
	updateColliders(meshes) {
		for (const mesh of meshes) {
			const i = this.colliders.findIndex((c) => c.mesh === mesh);
			const inst = mesh.userData.instance;
			const solid = mesh.parent && mesh.visible && inst && inst.CanCollide !== false;
			if (!solid) {
				if (i !== -1) this.colliders.splice(i, 1);
				continue;
			}
			mesh.updateMatrixWorld(true);
			const box = new Box3().setFromObject(mesh);
			if (i === -1) this.colliders.push({ mesh, box });
			else this.colliders[i].box = box;
		}
		this._refreshBroadphase();
	}

	/** @param {number} dt seconds since the last frame */
	update(dt) {
		// Capped so a slow frame can't snowball into ever more physics work.
		dt = Math.min(dt, MAX_STEP * MAX_SUBSTEPS);
		const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
		for (let i = 0; i < steps; i++) this._physicsStep(dt / steps);
		this._broadphaseTimer -= dt;
		if (this._broadphaseTimer <= 0) this._refreshBroadphase();
		this._animate(dt);
		this._updateCamera();
	}

	/** Removes the avatar and frees every GPU resource it created. */
	dispose() {
		this._detachInput();
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer.uncacheRoot(this.mixer.getRoot());
			this.mixer = null;
		}
		this.scene.remove(this.group);
		const materials = new Set();
		this.group.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
			if (o.skeleton) o.skeleton.dispose();
		});
		for (const material of materials) {
			for (const value of Object.values(material)) {
				if (value && value.isTexture) value.dispose();
			}
			material.dispose();
		}
		this.group.clear();
		this.actions = {};
		this.animate = null;
		this.colliders = [];
		this.nearby = [];
	}

	/* ---------- Avatar ---------- */

	_buildR6() {
		const root = new Group();
		root.name = "R6";
		const mat = (color) => new MeshLambertMaterial({ color });
		const box = (w, h, d, material, name) => {
			const mesh = new Mesh(new BoxGeometry(w, h, d), material);
			mesh.name = name;
			return mesh;
		};
		const headMat = mat(R6_COLORS.head);
		const armMat = mat(R6_COLORS.arms);
		const torsoMat = mat(R6_COLORS.torso);
		const legMat = mat(R6_COLORS.legs);
		const faceMat = mat(0x1b1b1b);

		// Local origin is the character's center: feet at -2.5, top of head at +2.7.
		const torso = box(2, 2, 1, torsoMat, "Torso");
		torso.position.y = 0.5;
		root.add(torso);

		const head = box(1.25, 1.2, 1.2, headMat, "Head");
		head.position.y = 2.1;
		const eyeL = box(0.18, 0.28, 0.05, faceMat, "EyeL");
		eyeL.position.set(-0.24, 0.12, -0.61);
		const eyeR = eyeL.clone();
		eyeR.name = "EyeR";
		eyeR.position.x = 0.24;
		const mouth = box(0.5, 0.08, 0.05, faceMat, "Mouth");
		mouth.position.set(0, -0.22, -0.61);
		head.add(eyeL, eyeR, mouth);
		root.add(head);

		// Limbs hang from pivot groups at the shoulder / hip so they can swing.
		const limb = (x, y, material, name) => {
			const pivot = new Group();
			pivot.name = `${name}Pivot`;
			pivot.position.set(x, y, 0);
			const mesh = box(1, 2, 1, material, name);
			mesh.position.y = -1;
			pivot.add(mesh);
			root.add(pivot);
			return pivot;
		};
		this.limbs = {
			leftArm: limb(-1.5, 1.5, armMat, "Left Arm"),
			rightArm: limb(1.5, 1.5, armMat, "Right Arm"),
			leftLeg: limb(-0.5, -0.5, legMat, "Left Leg"),
			rightLeg: limb(0.5, -0.5, legMat, "Right Leg")
		};
		return root;
	}

	async _loadModel() {
		try {
			const gltf = await new GLTFLoader().loadAsync(this.modelUrl);
			this.print(`Loaded character model ${this.modelUrl}`);
			return this._setupGltf(gltf);
		} catch (err) {
			this.print(`Character model ${this.modelUrl} unavailable - using the classic R6 avatar`);
			return this._buildR6();
		}
	}

	/** Same body as the Rig Builder dummies, driven by the default Humanoid animations. */
	_setupHumanoidRig(rigType) {
		const { root } = rigType === "R6" ? buildR6Rig({ name: "R6" }) : buildR15Rig({ name: "R15", studs: 1, wand: false });
		// Rig roots sit at the feet; the controller's origin is the body center.
		root.position.y = -HALF_HEIGHT;
		root.userData.isAnimRig = false;
		root.userData.isPlayerAvatar = true;
		root.traverse((o) => {
			if (o.isMesh) o.castShadow = true;
		});
		this._useProceduralClips(root, rigType);
		return root;
	}

	/** Default R15 character: Roblox's Blocky body driven by the Animate-script animations (DefaultAnimate.js). */
	async _setupBlockyAvatar() {
		let root, rest;
		try {
			({ root, rest } = await buildBlockyAvatar({ name: "R15" }));
		} catch (err) {
			this.print(`Personagem Blocky indisponível (${err.message}) - usando o R15 procedural`);
			return null;
		}
		root.position.y = -HALF_HEIGHT;
		root.userData.isAnimRig = false;
		root.userData.isPlayerAvatar = true;

		const clips = await loadAnimateClips(rest);
		if (!clips.idle || !clips.walk) {
			this.print("Animações do Animate indisponíveis - usando animações procedurais");
			this._useProceduralClips(root, "R15");
			return root;
		}
		this.mixer = new AnimationMixer(root);
		this.animate = { clips, actions: new Map(), playing: new Set(), current: null, walkAction: null, runAction: null, jumpTimer: 0, wasGrounded: true };
		this.mixer.addEventListener("loop", (e) => {
			if (this.animate?.current === "idle" && this.animate.playing.has(e.action)) this._playAnimate("idle", 0.15, true);
		});
		this._playAnimate("idle", 0);
		const loaded = Object.entries(clips).map(([name, v]) => (v.length > 1 ? `${name}×${v.length}` : name)).join(", ");
		this.print(`Personagem Blocky R15 carregado - Animate: ${loaded}`);
		return root;
	}

	_useProceduralClips(root, rigType) {
		this.mixer = new AnimationMixer(root);
		for (const [state, clip] of Object.entries(buildAvatarClips(root, rigType))) {
			const action = this.mixer.clipAction(clip);
			if (clip.userData.once) {
				action.setLoop(LoopOnce, 1);
				action.clampWhenFinished = true;
			}
			this.actions[state] = action;
		}
		this.actions.idle.play();
		this.currentAction = this.actions.idle;
	}

	_setupGltf(gltf) {
		const model = gltf.scene;
		const wrapper = new Group();
		wrapper.name = "GLTFCharacter";
		// glTF characters face +Z; the controller treats -Z as forward.
		model.rotation.y = Math.PI;
		wrapper.add(model);
		wrapper.updateMatrixWorld(true);
		const box = new Box3().setFromObject(wrapper);
		const size = box.getSize(new Vector3());
		const scale = size.y > 0 ? HEIGHT / size.y : 1;
		wrapper.scale.setScalar(scale);
		wrapper.position.y = -HALF_HEIGHT - box.min.y * scale;

		if (gltf.animations && gltf.animations.length) {
			this.mixer = new AnimationMixer(wrapper);
			const find = (...patterns) => gltf.animations.find((clip) => patterns.some((p) => p.test(clip.name)));
			const clips = {
				idle: find(/idle/i, /stand/i),
				walk: find(/walk/i, /run/i),
				jump: find(/jump/i),
				fall: find(/fall/i, /jump/i)
			};
			for (const [state, clip] of Object.entries(clips)) {
				if (!clip) continue;
				const action = this.mixer.clipAction(clip);
				if (state === "jump") {
					action.setLoop(LoopOnce, 1);
					action.clampWhenFinished = true;
				}
				this.actions[state] = action;
			}
			const first = this.actions.idle || Object.values(this.actions)[0];
			if (first) {
				first.play();
				this.currentAction = first;
			}
		}
		return wrapper;
	}

	/* ---------- Input ---------- */

	_attachInput() {
		window.addEventListener("keydown", this._onKeyDown);
		window.addEventListener("keyup", this._onKeyUp);
		window.addEventListener("blur", this._onBlur);
		this.domElement.addEventListener("wheel", this._onWheel, { passive: false });
	}

	_detachInput() {
		window.removeEventListener("keydown", this._onKeyDown);
		window.removeEventListener("keyup", this._onKeyUp);
		window.removeEventListener("blur", this._onBlur);
		this.domElement.removeEventListener("wheel", this._onWheel);
		this._onBlur();
	}

	setShiftLock(on) {
		if (this.shiftLock === on) return;
		this.shiftLock = on;
		this.print(`Shift Lock ${on ? "on" : "off"}`);
		this.onShiftLockChange(on);
	}

	_onKeyDown(e) {
		if (isTypingTarget(e.target) || isDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
		if (this.inputBlocked) return;
		// Toggled on keydown: only keydown counts as a user gesture, which pointer lock requires.
		if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
			if (!e.repeat && this.shiftLockAllowed) this.setShiftLock(!this.shiftLock);
			return;
		}
		if (e.code === "Space") {
			e.preventDefault();
			this.keys.jump = true;
			return;
		}
		const dir = MOVE_KEYS[e.code];
		if (dir) {
			e.preventDefault();
			this.keys[dir] = true;
		}
	}

	_onKeyUp(e) {
		if (e.code === "Space") this.keys.jump = false;
		const dir = MOVE_KEYS[e.code];
		if (dir) this.keys[dir] = false;
	}

	/** Apply ESC menu settings that affect controls. */
	applyGameSettings(settings) {
		if (!settings) return;
		this.shiftLockAllowed = settings.shiftLockSwitch !== false;
		if (!this.shiftLockAllowed && this.shiftLock) this.setShiftLock(false);
		if (typeof settings.mouseSensitivity === "number") this.mouseSensitivity = settings.mouseSensitivity;
	}

	_onBlur() {
		for (const k in this.keys) this.keys[k] = false;
	}

	_onWheel(e) {
		e.preventDefault();
		this.cameraDistance = MathUtils.clamp(this.cameraDistance * (1 + Math.sign(e.deltaY) * 0.12), CAMERA_MIN, CAMERA_MAX);
	}

	/* ---------- Physics ---------- */

	_collectColliders() {
		this.colliders = [];
		for (const object of this.scene.children) {
			const inst = object.isMesh && object.userData.instance;
			if (!inst || !object.visible || inst.CanCollide === false) continue;
			object.updateMatrixWorld(true);
			const box = new Box3().setFromObject(object);
			if (box.isEmpty()) continue;
			this.colliders.push({ mesh: object, box });
		}
	}

	/** Only test parts near the player: big places have thousands of meshes. */
	_refreshBroadphase() {
		this._broadphaseTimer = BROADPHASE_INTERVAL;
		const p = this.group.position;
		this.nearby = [];
		for (const c of this.colliders) {
			if (c.box.distanceToPoint(p) < BROADPHASE_RADIUS) this.nearby.push(c);
		}
	}

	/** Nearest hit; a mesh's triangles are only tested when the ray actually crosses its bounding box. */
	_cast(origin, direction, far) {
		const raycaster = this.raycaster;
		raycaster.set(origin, direction);
		raycaster.far = far;
		const ray = raycaster.ray;
		const hits = this._hits || (this._hits = []);
		hits.length = 0;
		let best = null;
		for (const c of this.nearby) {
			const entry = ray.intersectBox(c.box, _boxHit);
			if (entry === null && !c.box.containsPoint(origin)) continue;
			if (entry !== null && entry.distanceTo(origin) > far) continue;
			if (best && entry !== null && entry.distanceTo(origin) > best.distance) continue;
			c.mesh.raycast(raycaster, hits);
			for (const hit of hits) {
				if (hit.distance <= far && (!best || hit.distance < best.distance)) best = hit;
			}
			hits.length = 0;
		}
		return best;
	}

	_moveDirection(out) {
		_euler.setFromQuaternion(this.rig.quaternion, "YXZ");
		const yaw = _euler.y;
		const k = this.keys;
		const f = (k.forward ? 1 : 0) - (k.backward ? 1 : 0);
		const r = (k.right ? 1 : 0) - (k.left ? 1 : 0);
		// Camera-relative, flattened onto the XZ plane.
		out.set(-Math.sin(yaw) * f + Math.cos(yaw) * r, 0, -Math.cos(yaw) * f - Math.sin(yaw) * r);
		if (out.lengthSq() > 1) out.normalize();
		return yaw;
	}

	_physicsStep(dt) {
		const pos = this.group.position;
		const yaw = this._moveDirection(_v);
		this.velocity.x = _v.x * this.walkSpeed;
		this.velocity.z = _v.z * this.walkSpeed;

		if (this.keys.jump && this.grounded && this.jumpPower > 0) {
			this.velocity.y = this.jumpPower;
			this.grounded = false;
		}

		this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -MAX_FALL_SPEED);

		this._moveHorizontal(this.velocity.x * dt, 0);
		this._moveHorizontal(0, this.velocity.z * dt);

		const dy = this.velocity.y * dt;
		if (dy > 0) {
			const ceiling = this._cast(_v2.copy(pos), _up, HALF_HEIGHT + 0.2 + dy);
			if (ceiling) {
				this.velocity.y = 0;
			} else {
				pos.y += dy;
			}
			this.grounded = false;
		} else {
			const ground = this._groundHit(-dy + (this.grounded ? STEP_DOWN : 0.05));
			if (ground !== null) {
				pos.y = ground + HALF_HEIGHT;
				this.velocity.y = 0;
				this.grounded = true;
			} else {
				pos.y += dy;
				this.grounded = false;
			}
		}

		// Shift Lock: locked rigidly to the camera yaw. Default: turn toward the walking direction.
		if (this.shiftLock) {
			this.group.rotation.y = yaw;
		} else if (_v.lengthSq() > 1e-6) {
			this.group.rotation.y = lerpAngle(this.group.rotation.y, Math.atan2(-_v.x, -_v.z), 1 - Math.exp(-TURN_RATE * dt));
		}

		if (pos.y < FALLEN_PARTS_HEIGHT) {
			this.print("Fell out of the world - respawning");
			this.spawn();
		}
	}

	/**
	 * Raycasts straight down from the character's center (plus 4 points around it so edges hold).
	 * @returns {number|null} the highest ground Y within reach
	 */
	_groundHit(extra) {
		const pos = this.group.position;
		const far = HALF_HEIGHT + extra;
		let best = null;
		const offsets = [[0, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
		for (const [ox, oz] of offsets) {
			const hit = this._cast(_v2.set(pos.x + ox, pos.y, pos.z + oz), _down, far);
			if (hit && hit.distance < far && (best === null || hit.point.y > best)) best = hit.point.y;
		}
		return best;
	}

	/** Moves along one horizontal axis, stopping at walls (knee, waist and head height rays). */
	_moveHorizontal(dx, dz) {
		const amount = Math.abs(dx) + Math.abs(dz);
		if (amount < 1e-6) return;
		const dir = _v2.set(Math.sign(dx), 0, Math.sign(dz));
		const pos = this.group.position;
		let allowed = amount;
		for (const h of [-1.4, 0, 1.6]) {
			const origin = new Vector3(pos.x, pos.y + h, pos.z);
			const hit = this._cast(origin, dir, RADIUS + amount);
			if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - RADIUS));
		}
		pos.x += Math.sign(dx) * allowed;
		pos.z += Math.sign(dz) * allowed;
	}

	/* ---------- Animation ---------- */

	_animate(dt) {
		const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
		let state;
		if (!this.grounded) state = this.velocity.y > 0 ? "jump" : "fall";
		else state = horizontal > 0.1 ? "walk" : "idle";

		if (this.animate) {
			this._animateRoblox(dt, horizontal);
		} else if (this.mixer) {
			this._crossfadeTo(state);
			if (this.rigType && this.actions.walk) this.actions.walk.timeScale = Math.max(0.5, horizontal / WALK_CYCLE_SPEED);
			this.mixer.update(dt);
		} else if (this.limbs) {
			this._animateR6(state, horizontal, dt);
		}
		this.animState = state;
	}

	/** Pose logic of the Animate script: Running / Jumping / FreeFall / Standing. */
	_animateRoblox(dt, horizontal) {
		const a = this.animate;
		if (this.grounded) {
			a.jumpTimer = 0;
			if (horizontal > RUN_THRESHOLD) {
				this._playAnimate("walk", 0.2);
				this._setRunSpeed(horizontal / WALK_SPEED);
			} else {
				this._playAnimate("idle", 0.2);
			}
		} else {
			if (a.wasGrounded && this.velocity.y > 0) {
				a.jumpTimer = JUMP_ANIM_DURATION;
				this._playAnimate("jump", 0.1);
			} else if (a.jumpTimer > 0) {
				a.jumpTimer -= dt;
			}
			if (a.jumpTimer <= 0) this._playAnimate("fall", 0.2);
		}
		a.wasGrounded = this.grounded;
		this.mixer.update(dt);
	}

	_animateAction(clip) {
		const a = this.animate;
		let action = a.actions.get(clip);
		if (!action) {
			action = this.mixer.clipAction(clip);
			if (clip.userData.loop === false) {
				action.setLoop(LoopOnce, 1);
				action.clampWhenFinished = true;
			}
			a.actions.set(clip, action);
		}
		return action;
	}

	/** playAnimation: rolls a weighted variant (idle 1/1/9) and cross-fades; "walk" runs the walk and run tracks together. */
	_playAnimate(name, fade, reroll = false) {
		const a = this.animate;
		if (!a.clips[name] || (a.current === name && !reroll)) return;
		const next = new Set();
		if (name === "walk") {
			a.walkAction = this._animateAction(rollVariant(a.clips.walk).clip);
			a.runAction = a.clips.run ? this._animateAction(rollVariant(a.clips.run).clip) : null;
			next.add(a.walkAction);
			if (a.runAction) next.add(a.runAction);
		} else {
			a.walkAction = a.runAction = null;
			next.add(this._animateAction(rollVariant(a.clips[name]).clip));
		}
		for (const action of a.playing) if (!next.has(action)) action.fadeOut(fade);
		for (const action of next) {
			if (a.playing.has(action)) continue;
			action.reset();
			action.weight = 1;
			action.timeScale = 1;
			if (fade > 0) action.fadeIn(fade);
			action.play();
		}
		a.playing = next;
		a.current = name;
	}

	/** setRunSpeed: blends walk into run by speed (16 studs/s = run at 1.25x, like Roblox). */
	_setRunSpeed(speed) {
		const a = this.animate;
		const runSpeed = speed * 1.25;
		let walkWeight = SMALL_WEIGHT;
		let runWeight = SMALL_WEIGHT;
		if (!a.runAction || runSpeed <= NORMALIZED_WALK_SPEED) {
			walkWeight = 1;
		} else if (runSpeed < NORMALIZED_RUN_SPEED) {
			runWeight = (runSpeed - NORMALIZED_WALK_SPEED) / (NORMALIZED_RUN_SPEED - NORMALIZED_WALK_SPEED);
			walkWeight = 1 - runWeight;
		} else {
			runWeight = 1;
		}
		if (a.walkAction) {
			a.walkAction.weight = walkWeight;
			a.walkAction.timeScale = runSpeed / NORMALIZED_WALK_SPEED;
		}
		if (a.runAction) {
			a.runAction.weight = runWeight;
			a.runAction.timeScale = runSpeed / NORMALIZED_RUN_SPEED;
		}
	}

	_crossfadeTo(state) {
		const next = this.actions[state] || (state === "fall" ? this.actions.jump : null) || (state === "walk" ? null : this.actions.idle);
		if (!next || next === this.currentAction) return;
		next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
		if (this.currentAction) this.currentAction.fadeOut(0.2);
		this.currentAction = next;
	}

	_animateR6(state, speed, dt) {
		const l = this.limbs;
		const blend = 1 - Math.exp(-12 * dt);
		let armL = 0, armR = 0, legL = 0, legR = 0;
		if (state === "walk") {
			this.walkPhase += dt * speed * 0.55;
			const swing = Math.sin(this.walkPhase) * 0.9;
			armL = swing; armR = -swing; legL = -swing; legR = swing;
		} else if (state === "jump" || state === "fall") {
			// Classic Roblox jump pose: both arms raised forward-up.
			armL = armR = Math.PI * 0.95;
			legL = legR = 0;
		} else {
			this.walkPhase = 0;
		}
		l.leftArm.rotation.x += (armL - l.leftArm.rotation.x) * blend;
		l.rightArm.rotation.x += (armR - l.rightArm.rotation.x) * blend;
		l.leftLeg.rotation.x += (legL - l.leftLeg.rotation.x) * blend;
		l.rightLeg.rotation.x += (legR - l.rightLeg.rotation.x) * blend;
	}

	/* ---------- Camera ---------- */

	_updateCamera() {
		// Re-applied right before rendering so mouse motion since the physics step shows up the same frame.
		if (this.shiftLock) {
			_euler.setFromQuaternion(this.rig.quaternion, "YXZ");
			this.group.rotation.y = _euler.y;
		}
		const focus = _v.copy(this.group.position);
		focus.y += HEAD_FOCUS;
		// Ease the over-the-shoulder offset in and out instead of snapping.
		this._shoulder += ((this.shiftLock ? SHOULDER_OFFSET : 0) - this._shoulder) * 0.2;
		if (Math.abs(this._shoulder) > 1e-3) {
			_euler.setFromQuaternion(this.rig.quaternion, "YXZ");
			focus.x += Math.cos(_euler.y) * this._shoulder;
			focus.z -= Math.sin(_euler.y) * this._shoulder;
		}
		// Offset (0, height, distance) in the rig's yaw/pitch space: behind and above the head.
		const offset = _v2.set(0, 0, this.cameraDistance).applyQuaternion(this.rig.quaternion);
		offset.y += CAMERA_HEIGHT * (this.cameraDistance / CAMERA_DISTANCE);
		const length = offset.length();
		offset.divideScalar(length);
		const hit = this._cast(focus, offset, length);
		const distance = hit ? Math.max(CAMERA_MIN * 0.5, hit.distance - 0.4) : length;
		this.camera.position.copy(focus).addScaledVector(offset, distance);
		this.camera.lookAt(focus);
	}
}
