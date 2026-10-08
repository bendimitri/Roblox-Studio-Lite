import { Euler, Vector3 } from '../thirdparty/three/three.core.js';
import { isTypingTarget, isDialogOpen } from './InputFocus.js';

const _euler = new Euler(0, 0, 0, 'YXZ');
const LOOK_SENSITIVITY = 0.0025;
const PI_2 = Math.PI / 2;
const MAX_SPEED = 50;
const SLOW_SPEED = 12;
const ACCELERATION = 12;
const WHEEL_STUDS_PER_PIXEL = 0.05;

const MOVE_KEYS = {
	KeyW: "forward",
	KeyS: "backward",
	KeyA: "left",
	KeyD: "right",
	KeyE: "up",
	KeyQ: "down"
};

/**
 * Roblox Studio style camera:
 * - hold RMB to look around (cursor hidden/locked, restored on release)
 * - WASD / QE to fly, Shift to slow down, mouse wheel to dolly
 * - requestPlay() enters a first-person pointer-locked mode (exit with ESC)
 *
 * Emits "modechange" whenever `mode` or `playArmed` changes.
 * mode: "idle" | "look" | "play"
 */
export default class FlyCamera extends EventTarget {
	/**
	 * @param {*} cam THREE.PerspectiveCamera to control
	 * @param {HTMLElement} domElement The canvas to listen for pointer events on
	 * @param {{ isActive?: () => boolean, print?: (s: string) => void }} [options]
	 */
	constructor(cam, domElement, options = {}) {
		super();
		this.cam = cam;
		this.domElement = domElement;
		this.isActive = options.isActive || (() => true);
		this.print = options.print || (() => {});
		this.mode = "idle";
		this.playArmed = false;
		/** When false (Play Mode), every input handler is ignored so another controller owns the camera. */
		this.enabled = true;
		this.velocity = new Vector3();
		this.keys = { forward: false, backward: false, left: false, right: false, up: false, down: false, slow: false };
		this._wantPlay = false;

		domElement.addEventListener("contextmenu", (e) => e.preventDefault());

		domElement.addEventListener("mousedown", (e) => {
			if (!this.enabled || !this.isActive()) return;
			if (e.button === 2 && this.mode === "idle") {
				e.preventDefault();
				this._beginLook();
			} else if (e.button === 0 && this.playArmed && this.mode === "idle") {
				this._wantPlay = true;
				this._requestLock();
			}
		});

		document.addEventListener("mouseup", (e) => {
			if (e.button === 2 && this.mode === "look") this._endLook();
		});

		document.addEventListener("mousemove", (e) => {
			if (!this.enabled || this.mode === "idle") return;
			this._rotate(e.movementX, e.movementY);
		});

		document.addEventListener("pointerlockchange", () => {
			if (!this.enabled) return;
			const locked = document.pointerLockElement === this.domElement;
			if (locked) {
				if (this._wantPlay) {
					this._wantPlay = false;
					this.playArmed = false;
					this._setMode("play");
					this.print("First-person mode (pointer locked) - WASD/QE to fly, press ESC to release");
				} else if (this.mode === "idle") {
					// RMB was released before the browser granted the lock.
					document.exitPointerLock();
				}
				return;
			}
			if (this.mode === "play") {
				this._setMode("idle");
				this.print("Pointer released - back to edit mode");
			} else if (this.mode === "look") {
				this._endLook();
			}
		});

		document.addEventListener("pointerlockerror", () => {
			if (this.enabled) this._onLockFailed();
		});

		window.addEventListener("blur", () => {
			for (const k in this.keys) this.keys[k] = false;
			if (this.mode === "look") this._endLook();
		});

		window.addEventListener("keydown", (e) => {
			if (e.key === "Shift") this.keys.slow = true;
			const dir = MOVE_KEYS[e.code];
			if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
			if (!this.enabled || isTypingTarget(e.target) || isDialogOpen() || !this.isActive()) return;
			this.keys[dir] = true;
		});

		window.addEventListener("keyup", (e) => {
			if (e.key === "Shift") this.keys.slow = false;
			const dir = MOVE_KEYS[e.code];
			if (dir) this.keys[dir] = false;
		});

		domElement.addEventListener("wheel", (e) => {
			if (!this.enabled || !this.isActive()) return;
			e.preventDefault();
			const factor = this.keys.slow ? 0.25 : 1;
			this.cam.translateZ(e.deltaY * WHEEL_STUDS_PER_PIXEL * factor);
		}, { passive: false });
	}

	/** ESC entry point: lock the pointer for first-person flying. */
	requestPlay() {
		if (this.mode !== "idle") return;
		this._wantPlay = true;
		this._requestLock();
	}

	/** Hands the camera over to (or takes it back from) another controller. */
	setEnabled(enabled) {
		if (!enabled) {
			if (this.mode === "look") this._endLook();
			this.cancelPlayArm();
			this._wantPlay = false;
			if (this.mode === "play") this._setMode("idle");
		}
		for (const k in this.keys) this.keys[k] = false;
		this.velocity.set(0, 0, 0);
		this.enabled = enabled;
	}

	cancelPlayArm() {
		if (!this.playArmed) return;
		this.playArmed = false;
		this._wantPlay = false;
		this._emit();
	}

	_beginLook() {
		this.domElement.classList.add("cursor-hidden");
		this._setMode("look");
		this._requestLock();
	}

	_endLook() {
		this._setMode("idle");
		this.domElement.classList.remove("cursor-hidden");
		if (document.pointerLockElement === this.domElement) document.exitPointerLock();
	}

	_requestLock() {
		try {
			const result = this.domElement.requestPointerLock();
			if (result && typeof result.catch === "function") result.catch(() => this._onLockFailed());
		} catch (ignored) {
			this._onLockFailed();
		}
	}

	_onLockFailed() {
		// Browsers refuse pointer lock from the ESC key (it is not a user activation),
		// so arm first-person mode and finish it on the next viewport click.
		if (this._wantPlay && !this.playArmed) {
			this._wantPlay = false;
			this.playArmed = true;
			this._emit();
			this.print("Click the viewport to enter first-person mode (ESC to cancel)");
		}
	}

	_rotate(dx, dy) {
		_euler.setFromQuaternion(this.cam.quaternion);
		_euler.y -= dx * LOOK_SENSITIVITY;
		_euler.x -= dy * LOOK_SENSITIVITY;
		_euler.x = Math.max(-PI_2 + 0.001, Math.min(PI_2 - 0.001, _euler.x));
		this.cam.quaternion.setFromEuler(_euler);
	}

	_setMode(mode) {
		if (this.mode === mode) return;
		this.mode = mode;
		this._emit();
	}

	_emit() {
		this.dispatchEvent(new CustomEvent("modechange", { detail: { mode: this.mode, playArmed: this.playArmed } }));
	}

	/**
	 * Updates this.cam position based on movement keys
	 * @param {number} dt
	 */
	update(dt) {
		if (!this.enabled) return;
		dt = Math.min(dt, 0.1);
		const k = this.keys;
		const max = k.slow ? SLOW_SPEED : MAX_SPEED;
		const tx = ((k.right ? 1 : 0) - (k.left ? 1 : 0)) * max;
		const ty = ((k.up ? 1 : 0) - (k.down ? 1 : 0)) * max;
		const tz = ((k.forward ? 1 : 0) - (k.backward ? 1 : 0)) * max;
		const blend = 1 - Math.exp(-ACCELERATION * dt);
		this.velocity.x += (tx - this.velocity.x) * blend;
		this.velocity.y += (ty - this.velocity.y) * blend;
		this.velocity.z += (tz - this.velocity.z) * blend;
		if (this.velocity.lengthSq() < 1e-4) return;
		this.cam.translateX(this.velocity.x * dt);
		this.cam.translateY(this.velocity.y * dt);
		this.cam.translateZ(-this.velocity.z * dt);
	}
}
