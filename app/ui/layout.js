const STORAGE_KEY = "studiolite.layout.v1";
const PANELS = ["toolbox", "explorer", "properties", "output"];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Dockable-ish layout: draggable splitters, closable panels, state persisted in localStorage.
 * Emits "change" whenever sizes or visibility change.
 */
export class Layout extends EventTarget {
	constructor({ workspace, center, right }) {
		super();
		this.workspace = workspace;
		this.center = center;
		this.right = right;
		this.state = this._load();

		for (const splitter of workspace.querySelectorAll("[data-split]")) {
			splitter.addEventListener("pointerdown", (e) => this._startDrag(e, splitter));
			splitter.addEventListener("dblclick", () => {
				delete this.state.sizes[splitter.dataset.split];
				this._apply();
				this._save();
			});
		}
		this._apply();
	}

	isVisible(panel) {
		return this.state.visible[panel] !== false;
	}

	setVisible(panel, visible) {
		this.state.visible[panel] = visible;
		this._apply();
		this._save();
	}

	toggle(panel) {
		this.setVisible(panel, !this.isVisible(panel));
	}

	_load() {
		const fallback = {
			sizes: {},
			visible: Object.fromEntries(PANELS.map((p) => [p, true]))
		};
		if (window.innerWidth < 900) fallback.visible.toolbox = false;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
			if (saved && saved.sizes && saved.visible) return { sizes: saved.sizes, visible: { ...fallback.visible, ...saved.visible } };
		} catch (ignored) {}
		return fallback;
	}

	_save() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	}

	_apply() {
		const { sizes, visible } = this.state;
		const style = this.workspace.style;
		const vars = { left: "--left-w", right: "--right-w", bottom: "--bottom-h", stack: "--stack", anim: "--anim-h" };
		for (const [key, cssVar] of Object.entries(vars)) {
			if (sizes[key] === undefined) style.removeProperty(cssVar);
			else style.setProperty(cssVar, key === "stack" ? `${sizes[key]}%` : `${sizes[key]}px`);
		}

		const rightVisible = visible.explorer !== false || visible.properties !== false;
		this.workspace.classList.toggle("no-left", visible.toolbox === false);
		this.workspace.classList.toggle("no-right", !rightVisible);
		this.center.classList.toggle("no-bottom", visible.output === false);
		this.right.classList.toggle("no-explorer", visible.explorer === false);
		this.right.classList.toggle("no-properties", visible.properties === false);
		this.dispatchEvent(new CustomEvent("change"));
	}

	_startDrag(e, splitter) {
		if (e.button !== 0) return;
		e.preventDefault();
		const kind = splitter.dataset.split;
		const vertical = kind === "left" || kind === "right";
		splitter.setPointerCapture(e.pointerId);
		splitter.classList.add("dragging");
		document.body.classList.add("resizing", vertical ? "resizing-col" : "resizing-row");

		const move = (ev) => {
			const ws = this.workspace.getBoundingClientRect();
			const sizes = this.state.sizes;
			if (kind === "left") {
				sizes.left = Math.round(clamp(ev.clientX - ws.left - 4, 170, Math.min(560, ws.width * .45)));
			} else if (kind === "right") {
				sizes.right = Math.round(clamp(ws.right - ev.clientX - 4, 210, Math.min(620, ws.width * .5)));
			} else if (kind === "bottom") {
				const c = this.center.getBoundingClientRect();
				sizes.bottom = Math.round(clamp(c.bottom - ev.clientY, 70, c.height - 140));
			} else if (kind === "anim") {
				const c = this.center.getBoundingClientRect();
				const panel = this.center.querySelector(".panel-anim").getBoundingClientRect();
				sizes.anim = Math.round(clamp(panel.bottom - ev.clientY, 150, c.height - 160));
			} else if (kind === "stack") {
				const r = this.right.getBoundingClientRect();
				sizes.stack = Math.round(clamp(((ev.clientY - r.top) / r.height) * 100, 15, 85) * 10) / 10;
			}
			this._apply();
		};
		const up = () => {
			splitter.removeEventListener("pointermove", move);
			splitter.removeEventListener("pointerup", up);
			splitter.removeEventListener("pointercancel", up);
			splitter.classList.remove("dragging");
			document.body.classList.remove("resizing", "resizing-col", "resizing-row");
			this._save();
		};
		splitter.addEventListener("pointermove", move);
		splitter.addEventListener("pointerup", up);
		splitter.addEventListener("pointercancel", up);
	}
}
