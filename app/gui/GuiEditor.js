import { isGuiObject } from "./GuiClasses.js";
import { UDim2 } from "./UDim2.js";
import { isTypingTarget, isDialogOpen } from "../controls/InputFocus.js";

/*
 * Edit Mode WYSIWYG for StarterGui:
 *  - the selected GuiObject's element gets the .gui-selected outline and 8 resize handles
 *    injected at its corners and edges;
 *  - dragging the element moves it by writing only Position.X/Y.Offset (Scale is kept);
 *  - dragging a handle writes Size.Offset, plus Position.Offset on the left/top edges so the
 *    opposite edge stays put whatever the AnchorPoint;
 *  - clicks on a GuiObject in the viewport select it and never reach the 3D raycaster.
 *
 * Events: "selectionchange" { instance, source }, "deleterequest" { instance },
 *         "edit" { instance, label, changes: [{ key, before, after }] } (one per finished drag / nudge)
 */

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const DRAG_THRESHOLD = 2;

export class GuiEditor extends EventTarget {
	/**
	 * @param {{ engine: import('./GuiEngine.js').GuiEngine, viewport: HTMLElement, canvas: HTMLElement, isActive: () => boolean }} options
	 */
	constructor({ engine, viewport, canvas, isActive }) {
		super();
		this.engine = engine;
		this.viewport = viewport;
		this.canvas = canvas;
		this.isActive = isActive || (() => true);
		this.selected = null;
		this._hover = null;
		this._drag = null;
		this._nudge = null;

		this.readout = document.createElement("div");
		this.readout.className = "gui-readout";
		this.readout.hidden = true;
		engine.overlay.appendChild(this.readout);

		viewport.addEventListener("pointerdown", (e) => this._onPointerDown(e), true);
		viewport.addEventListener("pointermove", (e) => this._onHover(e));
		viewport.addEventListener("pointerleave", () => this._setHover(null));
		window.addEventListener("pointermove", (e) => this._onDragMove(e));
		window.addEventListener("pointerup", (e) => this._onDragEnd(e));
		window.addEventListener("keydown", (e) => this._onKeyDown(e), true);
		window.addEventListener("keyup", (e) => this._onKeyUp(e), true);

		engine.addEventListener("render", () => this._decorate());
		engine.addEventListener("removed", (e) => {
			if (this.selected && e.detail.instances.includes(this.selected)) this.select(null, "delete");
			if (this._hover && e.detail.instances.includes(this._hover)) this._hover = null;
		});
	}

	get editing() {
		return this.isActive() && !this.engine.playing && this.engine.isVisible;
	}

	/**
	 * @param {object|null} instance ScreenGui / GuiObject
	 * @param {"viewport"|"explorer"|"insert"|"delete"|"history"} source
	 */
	select(instance, source = "explorer") {
		if (instance === this.selected) return;
		this._undecorate();
		this.selected = instance || null;
		this._decorate();
		this.dispatchEvent(new CustomEvent("selectionchange", { detail: { instance: this.selected, source } }));
	}

	/** Puts the outline and the handles on the selected element (idempotent, runs after every render). */
	_decorate() {
		const instance = this.selected;
		const el = instance ? this.engine.elementOf(instance) : null;
		if (!el) return;
		if (instance.ClassName === "ScreenGui") {
			el.classList.add("gui-selected-screen");
			return;
		}
		el.classList.add("gui-selected");
		let handles = el.querySelector(":scope > .gui-handles");
		if (!handles) {
			handles = document.createElement("span");
			handles.className = "gui-handles";
			for (const h of HANDLES) {
				const handle = document.createElement("span");
				handle.className = `gui-handle gui-handle-${h}`;
				handle.dataset.handle = h;
				handles.appendChild(handle);
			}
		}
		if (el.lastElementChild !== handles) el.appendChild(handles);
		handles.hidden = this.engine.playing;
	}

	_undecorate() {
		const el = this.selected ? this.engine.elementOf(this.selected) : null;
		if (!el) return;
		el.classList.remove("gui-selected", "gui-selected-screen");
		const handles = el.querySelector(":scope > .gui-handles");
		if (handles) handles.remove();
	}

	_inViewport(target) {
		return target === this.canvas || this.engine.overlay.contains(target);
	}

	_onPointerDown(e) {
		if (e.button !== 0 || !this.editing || !this._inViewport(e.target)) return;
		const handleEl = e.target.closest ? e.target.closest(".gui-handle") : null;
		const hit = handleEl ? this.selected : this.engine.hitTest(e.clientX, e.clientY);
		if (!hit) {
			if (this.selected) this.select(null, "viewport");
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		this.canvas.focus({ preventScroll: true });
		this.select(hit, "viewport");
		if (!isGuiObject(hit)) return;
		const parent = this.engine.parentSize(hit);
		this._drag = {
			instance: hit,
			handle: handleEl ? handleEl.dataset.handle : null,
			x: e.clientX,
			y: e.clientY,
			moved: false,
			position: hit.Position.clone(),
			size: hit.Size.clone(),
			parent
		};
	}

	_onDragMove(e) {
		const d = this._drag;
		if (!d) return;
		const dx = e.clientX - d.x;
		const dy = e.clientY - d.y;
		if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		d.moved = true;
		const inst = d.instance;
		if (!d.handle) {
			const p = d.position;
			inst.Position = new UDim2(p.X.Scale, p.X.Offset + Math.round(dx), p.Y.Scale, p.Y.Offset + Math.round(dy));
			this._showReadout(e, `Position ${inst.Position}`);
			return;
		}
		this._resize(d, dx, dy, e.shiftKey);
		this._showReadout(e, `Size ${inst.Size}`);
	}

	_resize(d, dx, dy, keepAspect) {
		const inst = d.instance;
		const h = d.handle;
		const a = inst.AnchorPoint;
		const s = d.size, p = d.position;
		const w0 = s.X.Scale * d.parent.width + s.X.Offset;
		const h0 = s.Y.Scale * d.parent.height + s.Y.Offset;
		let dw = h.includes("e") ? dx : h.includes("w") ? -dx : 0;
		let dh = h.includes("s") ? dy : h.includes("n") ? -dy : 0;
		if (keepAspect && dw && dh && w0 > 0 && h0 > 0) {
			const k = Math.max((w0 + dw) / w0, (h0 + dh) / h0);
			dw = w0 * k - w0;
			dh = h0 * k - h0;
		}
		dw = Math.round(Math.max(-w0, dw));
		dh = Math.round(Math.max(-h0, dh));
		const sx = h.includes("w") ? -(1 - a.X) * dw : h.includes("e") ? a.X * dw : 0;
		const sy = h.includes("n") ? -(1 - a.Y) * dh : h.includes("s") ? a.Y * dh : 0;
		inst.Size = new UDim2(s.X.Scale, s.X.Offset + dw, s.Y.Scale, s.Y.Offset + dh);
		inst.Position = new UDim2(p.X.Scale, p.X.Offset + Math.round(sx), p.Y.Scale, p.Y.Offset + Math.round(sy));
	}

	_onDragEnd() {
		const d = this._drag;
		if (!d) return;
		this._drag = null;
		this.readout.hidden = true;
		if (!d.moved) return;
		const inst = d.instance;
		const changes = [];
		if (!d.position.equals(inst.Position)) changes.push({ key: "Position", before: d.position, after: inst.Position });
		if (d.handle && !d.size.equals(inst.Size)) changes.push({ key: "Size", before: d.size, after: inst.Size });
		if (changes.length) this._emitEdit(inst, d.handle ? "Resize" : "Move", changes);
	}

	_emitEdit(instance, label, changes) {
		this.dispatchEvent(new CustomEvent("edit", { detail: { instance, label, changes } }));
	}

	_showReadout(e, text) {
		const box = this.engine.overlay.getBoundingClientRect();
		this.readout.textContent = text;
		this.readout.hidden = false;
		this.readout.style.left = `${e.clientX - box.left + 14}px`;
		this.readout.style.top = `${e.clientY - box.top + 16}px`;
	}

	_onHover(e) {
		if (e.buttons || this._drag || !this.editing || !this._inViewport(e.target)) {
			if (!this._drag) this._setHover(null);
			return;
		}
		this._setHover(this.engine.hitTest(e.clientX, e.clientY));
	}

	_setHover(instance) {
		if (instance === this._hover) return;
		const prev = this._hover ? this.engine.elementOf(this._hover) : null;
		if (prev) prev.classList.remove("gui-hover");
		this._hover = instance;
		const el = instance ? this.engine.elementOf(instance) : null;
		if (el) el.classList.add("gui-hover");
	}

	/** Arrow keys nudge Position.Offset by 1px (Shift: 10px); Delete removes the object. */
	_onKeyDown(e) {
		const inst = this.selected;
		if (!inst || !this.editing || isTypingTarget(e.target) || isDialogOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.code === "Delete") {
			e.preventDefault();
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent("deleterequest", { detail: { instance: inst } }));
			return;
		}
		const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
		if (!dir || !isGuiObject(inst)) return;
		e.preventDefault();
		e.stopPropagation();
		const step = e.shiftKey ? 10 : 1;
		if (!this._nudge || this._nudge.instance !== inst) this._nudge = { instance: inst, before: inst.Position.clone() };
		const p = inst.Position;
		inst.Position = new UDim2(p.X.Scale, p.X.Offset + dir[0] * step, p.Y.Scale, p.Y.Offset + dir[1] * step);
	}

	_onKeyUp(e) {
		if (!e.code.startsWith("Arrow") || !this._nudge) return;
		const { instance, before } = this._nudge;
		this._nudge = null;
		if (!before.equals(instance.Position)) this._emitEdit(instance, "Nudge", [{ key: "Position", before, after: instance.Position }]);
	}
}
