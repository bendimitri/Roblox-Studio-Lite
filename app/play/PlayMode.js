import { Object3D, Vector3, Quaternion, Euler, Clock } from '../thirdparty/three/three.module.js';
import { PointerLockControls } from '../thirdparty/three/addons/controls/PointerLockControls.js';
import { PlayerController } from './PlayerController.js';
import { getExperienceSettings, getGameSettings } from './ExperienceSettings.js';
import { EscapeMenu } from './EscapeMenu.js';
import { GraphicsManager } from './GraphicsManager.js';

const _euler = new Euler(0, 0, 0, "YXZ");
const PLAY_HINT = "Hold Right Click to look · WASD walk · Space jump · Shift: Shift Lock · ESC menu · Shift+F5 stop";

/**
 * Switches the studio between EditMode and PlayMode (Roblox Studio "Play", F5 / Shift+F5).
 * ESC opens the classic Roblox settings menu only while isPlayMode.
 *
 * Emits "change" { isPlayMode }.
 */
export class PlayMode extends EventTarget {
	/**
	 * @param {{ renderer: import('../rendering/StudioLiteRenderer.js').StudioLiteRenderer, viewport: HTMLElement, print: Function }} options
	 */
	constructor({ renderer, viewport, print }) {
		super();
		this.renderer = renderer;
		this.viewport = viewport;
		this.print = print || (() => {});
		this.isPlayMode = false;
		this.player = null;
		this.controls = null;
		this.rig = null;
		this.overlay = null;
		this.escapeMenu = null;
		this.graphics = new GraphicsManager({ renderer });
		this.clock = new Clock(false);
		this.savedEditCameraPos = new Vector3();
		this.savedEditCameraQuat = new Quaternion();
		this._saved = null;
		this._session = 0;
		this._looking = false;
		this._hintTimer = null;
		this._onMouseDown = this._onMouseDown.bind(this);
		this._onMouseUp = this._onMouseUp.bind(this);
		this._onEscKey = this._onEscKey.bind(this);
	}

	async start() {
		if (this.isPlayMode) return;
		const r = this.renderer;
		const tools = r.tools;
		const session = ++this._session;
		this.isPlayMode = true;

		this.savedEditCameraPos.copy(r.camera.position);
		this.savedEditCameraQuat.copy(r.camera.quaternion);

		tools.select(null, "delete");
		tools.transform.detach();
		tools.transform.enabled = false;
		tools.setHelpersVisible(false);
		r.controls.setEnabled(false);
		this._saved = { hover: r.useSelectionBox2 };
		r.useSelectionBox2 = false;
		r.hoverHelper.visible = false;

		document.body.classList.add("play-mode");
		this._buildOverlay();
		this._setHint("Loading character…");
		this.dispatchEvent(new CustomEvent("change", { detail: { isPlayMode: true } }));

		this.rig = new Object3D();
		_euler.setFromQuaternion(r.camera.quaternion, "YXZ");
		this.rig.rotation.set(-0.25, _euler.y, 0, "YXZ");
		this.controls = new PointerLockControls(this.rig, r.domElement);
		this.controls.minPolarAngle = 0.25;
		this.controls.maxPolarAngle = Math.PI - 0.6;
		document.removeEventListener("pointerlockerror", this.controls._onPointerlockError);
		this.controls.addEventListener("lock", () => {
			if (!this._looking && !(this.player && this.player.shiftLock)) {
				document.exitPointerLock();
				return;
			}
			this._setHint(null);
		});
		this.controls.addEventListener("unlock", () => {
			if (this.isPlayMode && this.player && this.player.shiftLock && !(this.escapeMenu && this.escapeMenu.open)) {
				this._setHint("Click to lock the mouse again (Shift Lock)");
			}
		});
		r.domElement.addEventListener("mousedown", this._onMouseDown);
		document.addEventListener("mouseup", this._onMouseUp);
		window.addEventListener("keydown", this._onEscKey, true);

		const game = getGameSettings();
		this.graphics.setMode(game.graphicsMode);
		this.graphics.setQuality(game.graphicsQuality);
		this.graphics.apply(game.graphicsQuality);

		this.escapeMenu = new EscapeMenu({
			host: this.viewport,
			graphics: this.graphics,
			onReset: () => this._resetCharacter(),
			onLeave: () => this.stop(),
			onResume: () => this._onMenuResume(),
			onSettingsChange: (s) => this._applyGameSettings(s)
		});
		this.escapeMenu.mount();

		const { avatarRigType } = getExperienceSettings();
		this._setBadge(avatarRigType);
		const player = new PlayerController({
			scene: r.scene,
			camera: r.camera,
			rig: this.rig,
			domElement: r.domElement,
			print: this.print,
			rigType: avatarRigType,
			onShiftLockChange: (on) => this._onShiftLockChange(on)
		});
		await player.load();
		if (session !== this._session || !this.isPlayMode) {
			player.dispose();
			return;
		}
		this.player = player;
		player.applyGameSettings(getGameSettings());
		player.spawn();
		this.clock.start();
		this._setHint(PLAY_HINT, 8000);
		this.print("Play mode — ESC opens the settings menu · Shift+F5 stops");
	}

	_onEscKey(e) {
		if (!this.isPlayMode || e.code !== "Escape" || e.repeat) return;
		// Edit mode never reaches here for menu — only while Play is active
		if (this.escapeMenu && this.escapeMenu.open) return; // EscapeMenu capture handler closes it
		e.preventDefault();
		e.stopPropagation();
		this._openMenu();
	}

	_openMenu() {
		if (!this.escapeMenu || this.escapeMenu.open) return;
		if (document.pointerLockElement) document.exitPointerLock();
		this._looking = false;
		if (this.player) {
			this.player.inputBlocked = true;
			this.player._onBlur();
		}
		this.escapeMenu.show();
	}

	_onMenuResume() {
		if (this.player) this.player.inputBlocked = false;
		if (this.player && this.player.shiftLock) this._lock();
	}

	_applyGameSettings(s) {
		if (this.player) this.player.applyGameSettings(s);
		if (s.graphicsMode) this.graphics.setMode(s.graphicsMode);
		if (typeof s.graphicsQuality === "number" && s.graphicsMode === "Manual") {
			this.graphics.setQuality(s.graphicsQuality);
		}
	}

	_resetCharacter() {
		if (this.player) this.player.spawn();
		if (this.escapeMenu && this.escapeMenu.open) this.escapeMenu.close();
	}

	_onMouseDown(e) {
		if (!this.player || !this.controls) return;
		if (this.escapeMenu && this.escapeMenu.open) return;
		if (this.player.inputBlocked) return;
		if (e.button === 2) {
			e.preventDefault();
			this._looking = true;
			this._lock();
		} else if (e.button === 0 && this.player.shiftLock) {
			this._lock();
		}
	}

	_onMouseUp(e) {
		if (e.button !== 2 || !this._looking) return;
		this._looking = false;
		if (this.player && this.player.shiftLock) return;
		if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
	}

	_onShiftLockChange(on) {
		this._setShiftLockUi(on);
		if (on) {
			this._lock();
		} else if (!this._looking && document.pointerLockElement === this.renderer.domElement) {
			document.exitPointerLock();
			this._setHint(null);
		}
	}

	/** Called every animation frame; physics only runs while in PlayMode. */
	update() {
		if (!this.isPlayMode || !this.player) return 0;
		const dt = this.clock.getDelta();
		this.graphics.update(dt);
		this.player.update(dt);
		return dt;
	}

	stop() {
		if (!this.isPlayMode) return;
		const r = this.renderer;
		const tools = r.tools;
		this.isPlayMode = false;
		this._session++;
		this.clock.stop();

		if (document.pointerLockElement) document.exitPointerLock();
		r.domElement.removeEventListener("mousedown", this._onMouseDown);
		document.removeEventListener("mouseup", this._onMouseUp);
		window.removeEventListener("keydown", this._onEscKey, true);
		this._looking = false;
		clearTimeout(this._hintTimer);

		if (this.escapeMenu) {
			this.escapeMenu.unmount();
			this.escapeMenu = null;
		}
		this.graphics.clear();

		if (this.controls) {
			this.controls.dispose();
			this.controls = null;
		}
		if (this.player) {
			this.player.dispose();
			this.player = null;
		}
		this.rig = null;

		r.camera.position.copy(this.savedEditCameraPos);
		r.camera.quaternion.copy(this.savedEditCameraQuat);
		r.camera.updateMatrixWorld();

		r.controls.setEnabled(true);
		tools.transform.enabled = true;
		tools.setHelpersVisible(true);
		if (this._saved) r.useSelectionBox2 = this._saved.hover;
		this._saved = null;

		this._removeOverlay();
		document.body.classList.remove("play-mode");
		this.print("Play mode stopped - back to edit mode");
		this.dispatchEvent(new CustomEvent("change", { detail: { isPlayMode: false } }));
	}

	_lock() {
		if (!this.controls || this.controls.isLocked) return;
		if (this.escapeMenu && this.escapeMenu.open) return;
		try {
			const result = this.renderer.domElement.requestPointerLock();
			if (result && typeof result.catch === "function") result.catch(() => {});
		} catch (ignored) {}
	}

	_buildOverlay() {
		const overlay = document.createElement("div");
		overlay.className = "play-overlay";
		overlay.innerHTML = `
			<div class="play-bar">
				<span class="play-badge"><span class="play-dot"></span>Playing</span>
				<span class="play-rig" hidden></span>
				<button type="button" class="play-shiftlock" title="Toggle Shift Lock (Shift)" aria-pressed="false">Shift Lock</button>
				<button type="button" class="play-menu-btn" title="Settings (ESC)">Menu</button>
				<button type="button" class="play-stop" title="Stop (Shift+F5)"><span class="play-stop-square"></span>Stop</button>
			</div>
			<div class="play-crosshair" hidden></div>
			<div class="play-hint" hidden></div>`;
		overlay.querySelector(".play-stop").addEventListener("click", () => this.stop());
		overlay.querySelector(".play-menu-btn").addEventListener("click", (e) => {
			e.currentTarget.blur();
			this._openMenu();
		});
		overlay.querySelector(".play-shiftlock").addEventListener("click", (e) => {
			e.currentTarget.blur();
			if (!this.player) return;
			if (!this.player.shiftLockAllowed) {
				this.print("Shift Lock Switch is Off in the ESC menu");
				return;
			}
			this.player.setShiftLock(!this.player.shiftLock);
		});
		this.viewport.appendChild(overlay);
		this.overlay = overlay;
	}

	_removeOverlay() {
		if (!this.overlay) return;
		this.overlay.remove();
		this.overlay = null;
	}

	_setBadge(rigType) {
		const el = this.overlay && this.overlay.querySelector(".play-rig");
		if (!el) return;
		el.hidden = !rigType;
		el.textContent = rigType || "";
		el.className = `play-rig is-${(rigType || "").toLowerCase()}`;
	}

	_setShiftLockUi(on) {
		if (!this.overlay) return;
		const btn = this.overlay.querySelector(".play-shiftlock");
		btn.classList.toggle("active", on);
		btn.setAttribute("aria-pressed", String(on));
		this.overlay.querySelector(".play-crosshair").hidden = !on;
	}

	_setHint(text, duration = 0) {
		clearTimeout(this._hintTimer);
		if (duration && text) this._hintTimer = setTimeout(() => this._setHint(null), duration);
		if (!this.overlay) return;
		const hint = this.overlay.querySelector(".play-hint");
		hint.hidden = !text;
		if (text) hint.textContent = text;
	}
}
