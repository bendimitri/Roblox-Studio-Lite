/**
 * Classic Roblox ESC settings menu (Play Mode only).
 * Slide-down open / slide-up close (~0.25s). Consumes gameplay input while open.
 */
import { getGameSettings, setGameSettings } from "./ExperienceSettings.js";

const TABS = [
	{ id: "settings", label: "Settings", icon: "⚙" },
	{ id: "report", label: "Report", icon: "⚑" },
	{ id: "help", label: "Help", icon: "?" },
	{ id: "record", label: "Record", icon: "▣" }
];

const CAMERA_MODES = ["Default (Classic)", "Follow", "Classic", "CameraToggle"];
const MOVEMENT_MODES = ["Default (Keyboard)", "Keyboard", "ClickToMove"];

function blockBar(n, max = 10) {
	let html = "";
	for (let i = 1; i <= max; i++) html += `<span class="esc-block${i <= n ? " on" : ""}"></span>`;
	return html;
}

export class EscapeMenu {
	/**
	 * @param {{
	 *   host: HTMLElement,
	 *   graphics: import('./GraphicsManager.js').GraphicsManager,
	 *   onReset: () => void,
	 *   onLeave: () => void,
	 *   onResume: () => void,
	 *   onSettingsChange?: (settings: object) => void
	 * }} opts
	 */
	constructor(opts) {
		this.host = opts.host;
		this.graphics = opts.graphics;
		this.onReset = opts.onReset;
		this.onLeave = opts.onLeave;
		this.onResume = opts.onResume;
		this.onSettingsChange = opts.onSettingsChange || (() => {});
		this.open = false;
		this.tab = "settings";
		this.root = null;
		this.panel = null;
		this._animating = false;
		this._onKey = this._onKey.bind(this);
		this._onClick = this._onClick.bind(this);
	}

	mount() {
		if (this.root) return;
		const root = document.createElement("div");
		root.className = "esc-menu";
		root.hidden = true;
		root.innerHTML = `
			<div class="esc-backdrop" data-act="resume"></div>
			<div class="esc-panel" role="dialog" aria-modal="true" aria-label="Game Menu">
				<div class="esc-tabs" role="tablist"></div>
				<div class="esc-body"></div>
				<div class="esc-actions">
					<button type="button" class="esc-action" data-act="reset">
						<span class="esc-key">R</span><span>Reset Character</span>
					</button>
					<button type="button" class="esc-action" data-act="leave">
						<span class="esc-key">L</span><span>Leave Game</span>
					</button>
					<button type="button" class="esc-action" data-act="resume">
						<span class="esc-key">ESC</span><span>Resume Game</span>
					</button>
				</div>
			</div>`;
		this.host.appendChild(root);
		this.root = root;
		this.panel = root.querySelector(".esc-panel");
		root.addEventListener("click", this._onClick);
		window.addEventListener("keydown", this._onKey, true);
		this._paint();
	}

	unmount() {
		window.removeEventListener("keydown", this._onKey, true);
		if (this.root) {
			this.root.removeEventListener("click", this._onClick);
			this.root.remove();
		}
		this.root = null;
		this.panel = null;
		this.open = false;
	}

	toggle() {
		if (this.open) this.close();
		else this.show();
	}

	show() {
		this.mount();
		if (this.open || this._animating) return;
		this._paint();
		this.root.hidden = false;
		this.open = true;
		this._animating = true;
		this.panel.classList.remove("esc-out");
		void this.panel.offsetWidth;
		this.panel.classList.add("esc-in");
		const done = () => {
			this._animating = false;
			this.panel.removeEventListener("animationend", done);
		};
		this.panel.addEventListener("animationend", done);
	}

	close() {
		if (!this.root || !this.open) return;
		if (this._animating) return;
		this._animating = true;
		this.panel.classList.remove("esc-in");
		this.panel.classList.add("esc-out");
		const done = () => {
			this.panel.removeEventListener("animationend", done);
			this.root.hidden = true;
			this.open = false;
			this._animating = false;
			this.onResume();
		};
		this.panel.addEventListener("animationend", done);
	}

	_onClick(e) {
		const act = e.target.closest("[data-act]");
		if (act) {
			const a = act.getAttribute("data-act");
			if (a === "reset") this.onReset();
			else if (a === "leave") this.onLeave();
			else if (a === "resume") this.close();
			return;
		}
		const tab = e.target.closest("[data-tab]");
		if (tab) {
			this.tab = tab.getAttribute("data-tab");
			this._paint();
			return;
		}
		const arrow = e.target.closest(".esc-arrow");
		if (!arrow || !this.open) return;
		const row = arrow.closest("[data-opt]");
		if (!row) return;
		const opt = row.getAttribute("data-opt");
		const dir = +(arrow.getAttribute("data-dir") || 1);
		this._change(opt, dir);
	}

	_onKey(e) {
		if (!this.open) return;
		const block = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight",
			"ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
		if (block.includes(e.code)) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (e.repeat) return;
		if (e.code === "KeyR") { e.preventDefault(); e.stopPropagation(); this.onReset(); return; }
		if (e.code === "KeyL") { e.preventDefault(); e.stopPropagation(); this.onLeave(); return; }
		if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(); }
	}

	_change(opt, dir) {
		const s = getGameSettings();
		if (opt === "shiftLockSwitch") {
			this._commit({ shiftLockSwitch: !s.shiftLockSwitch });
		} else if (opt === "cameraMode") {
			const i = CAMERA_MODES.indexOf(s.cameraMode);
			this._commit({ cameraMode: CAMERA_MODES[(i + dir + CAMERA_MODES.length) % CAMERA_MODES.length] });
		} else if (opt === "movementMode") {
			const i = MOVEMENT_MODES.indexOf(s.movementMode);
			this._commit({ movementMode: MOVEMENT_MODES[(i + dir + MOVEMENT_MODES.length) % MOVEMENT_MODES.length] });
		} else if (opt === "fullscreen") {
			const next = !s.fullscreen;
			this._commit({ fullscreen: next });
			this._fullscreen(next);
		} else if (opt === "graphicsMode") {
			const next = s.graphicsMode === "Manual" ? "Automatic" : "Manual";
			this._commit({ graphicsMode: next });
			this.graphics.setMode(next);
		} else if (opt === "mouseSensitivity" || opt === "volume" || opt === "graphicsQuality") {
			const n = Math.max(1, Math.min(10, (s[opt] || 5) + dir));
			this._commit({ [opt]: n });
			if (opt === "graphicsQuality") this.graphics.setQuality(n);
		}
	}

	_commit(patch) {
		const next = setGameSettings(patch);
		this.onSettingsChange(next);
		this._paint();
	}

	_fullscreen(on) {
		try {
			if (on && !document.fullscreenElement) this.host.requestFullscreen?.();
			else if (!on && document.fullscreenElement) document.exitFullscreen?.();
		} catch {}
	}

	_paint() {
		if (!this.root) return;
		const tabs = this.root.querySelector(".esc-tabs");
		tabs.innerHTML = TABS.map((t) => `
			<button type="button" class="esc-tab${this.tab === t.id ? " active" : ""}" data-tab="${t.id}" role="tab">
				<span class="esc-tab-icon" aria-hidden="true">${t.icon}</span><span>${t.label}</span>
			</button>`).join("");

		const body = this.root.querySelector(".esc-body");
		if (this.tab !== "settings") {
			const names = { report: "Report", help: "Help", record: "Record" };
			body.innerHTML = `<div class="esc-placeholder">${names[this.tab]} — coming soon</div>`;
			return;
		}
		const s = getGameSettings();
		const cycle = (opt, label, value) => `
			<div class="esc-row" data-opt="${opt}">
				<span class="esc-label">${label}</span>
				<div class="esc-control">
					<button type="button" class="esc-arrow" data-dir="-1" aria-label="Previous">‹</button>
					<span class="esc-value">${value}</span>
					<button type="button" class="esc-arrow" data-dir="1" aria-label="Next">›</button>
				</div>
			</div>`;
		const blocks = (opt, label, n) => `
			<div class="esc-row" data-opt="${opt}">
				<span class="esc-label">${label}</span>
				<div class="esc-control">
					<button type="button" class="esc-arrow" data-dir="-1" aria-label="Decrease">‹</button>
					<div class="esc-blocks">${blockBar(n)}</div>
					<button type="button" class="esc-arrow" data-dir="1" aria-label="Increase">›</button>
				</div>
			</div>`;
		body.innerHTML = [
			cycle("shiftLockSwitch", "Shift Lock Switch", s.shiftLockSwitch ? "On" : "Off"),
			cycle("cameraMode", "Camera Mode", s.cameraMode),
			cycle("movementMode", "Movement Mode", s.movementMode),
			blocks("mouseSensitivity", "Mouse Sensitivity", s.mouseSensitivity),
			blocks("volume", "Volume", s.volume),
			cycle("fullscreen", "Fullscreen", s.fullscreen ? "On" : "Off"),
			cycle("graphicsMode", "Graphics Mode", s.graphicsMode),
			s.graphicsMode === "Manual"
				? blocks("graphicsQuality", "Graphics Quality", s.graphicsQuality)
				: `<div class="esc-row esc-row-disabled"><span class="esc-label">Graphics Quality</span><span class="esc-value">Automatic</span></div>`
		].join("");
	}
}
