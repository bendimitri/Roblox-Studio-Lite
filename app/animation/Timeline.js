import { CHANNELS, EASINGS } from "./AnimationDocument.js";
import { RIG_SPECS } from "./RigSpecs.js";

const ROW_H = 22;
const PAD_LEFT = 14;
const MIN_PPS = 40;
const MAX_PPS = 1200;
const CHANNEL_LABEL = { rotation: "Rotation", position: "Position" };

function boneDepths(spec) {
	const depth = { HumanoidRootPart: 0 };
	for (const j of spec.joints) depth[j.part] = depth[j.parent] + 1;
	return depth;
}

const capture = (target, pointerId) => {
	try {
		target.setPointerCapture(pointerId);
	} catch (ignored) {}
};

const el = (tag, cls, text) => {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
};

/**
 * Dope sheet: time ruler + playhead, hierarchical R15 bone list, keyframe diamonds
 * (click / shift-click select, drag to retime, Delete to remove, right-click for easing).
 *
 * Emits through callbacks: onScrub(time), onSelectBone(name), onChange(reason),
 * onContextMenu(anchor, refs).
 */
export class Timeline {
	constructor({ container, onScrub, onSelectBone, onChange, onContextMenu }) {
		this.container = container;
		this.onScrub = onScrub;
		this.onSelectBone = onSelectBone;
		this.onChange = onChange;
		this.onContextMenu = onContextMenu;
		this.doc = null;
		this.time = 0;
		this.pps = 160;
		this.selectedBone = null;
		this.expanded = new Set();
		/** Selected key objects. */
		this.selection = new Set();
		this.spec = RIG_SPECS.R15;
		this.depth = boneDepths(this.spec);
		this._build();
	}

	_build() {
		const c = this.container;
		c.classList.add("tl");
		c.tabIndex = 0;
		c.innerHTML = "";

		this.corner = el("div", "tl-corner");
		this.corner.innerHTML = `<span>Ossos</span><span class="tl-legend"><i class="tl-dot rot"></i>Rot <i class="tl-dot pos"></i>Pos</span>`;
		this.rulerWrap = el("div", "tl-ruler");
		this.ruler = el("canvas");
		this.rulerWrap.appendChild(this.ruler);
		this.list = el("div", "tl-list");
		this.lanes = el("div", "tl-lanes");
		this.lanesInner = el("div", "tl-lanes-inner");
		this.endMarker = el("div", "tl-end");
		this.playhead = el("div", "tl-playhead");
		this.lanesInner.append(this.endMarker, this.playhead);
		this.lanes.appendChild(this.lanesInner);
		this.rulerHead = el("div", "tl-ruler-head");
		this.rulerWrap.appendChild(this.rulerHead);
		c.append(this.corner, this.rulerWrap, this.list, this.lanes);

		this.lanes.addEventListener("scroll", () => {
			this.list.scrollTop = this.lanes.scrollTop;
			this._drawRuler();
			this._placePlayhead();
		});
		this.list.addEventListener("wheel", (e) => {
			this.lanes.scrollTop += e.deltaY;
			e.preventDefault();
		}, { passive: false });
		this.lanes.addEventListener("wheel", (e) => {
			if (!e.ctrlKey && !e.altKey) return;
			e.preventDefault();
			const rect = this.lanes.getBoundingClientRect();
			const anchorTime = this.xToTime(e.clientX - rect.left + this.lanes.scrollLeft);
			this.setZoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
			this.lanes.scrollLeft = this.timeToX(anchorTime) - (e.clientX - rect.left);
		}, { passive: false });

		this.rulerWrap.addEventListener("pointerdown", (e) => this._startScrub(e));
		this.lanes.addEventListener("pointerdown", (e) => this._onLanePointerDown(e));
		this.lanes.addEventListener("contextmenu", (e) => this._onContextMenu(e));
		this.lanes.addEventListener("dblclick", (e) => {
			const d = e.target.closest(".tl-key");
			if (d) this.onScrub(Number(d.dataset.time));
		});
		c.addEventListener("keydown", (e) => {
			if (e.target.closest("input, select, textarea")) return;
			if ((e.key === "Delete" || e.key === "Backspace") && this.selection.size) {
				e.preventDefault();
				e.stopPropagation();
				this.deleteSelected();
			}
		});

		new ResizeObserver(() => this._drawRuler()).observe(this.rulerWrap);
	}

	setDocument(doc) {
		this.doc = doc;
		this.selection.clear();
		this.render();
	}

	setTime(time) {
		this.time = time;
		this._placePlayhead();
		this._drawRuler();
	}

	setSelectedBone(name) {
		this.selectedBone = name;
		let index = -1;
		[...this.list.querySelectorAll(".tl-row")].forEach((row, i) => {
			const hit = row.dataset.bone === name && !row.dataset.channel;
			row.classList.toggle("selected", hit);
			if (hit) index = i;
		});
		if (index < 0) return;
		const top = index * ROW_H, view = this.lanes.clientHeight;
		if (top < this.lanes.scrollTop || top + ROW_H > this.lanes.scrollTop + view) this.lanes.scrollTop = Math.max(0, top - view / 2 + ROW_H);
	}

	setZoom(pps) {
		this.pps = Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
		this.render();
	}

	zoomToFit() {
		if (!this.doc) return;
		const w = Math.max(200, this.lanes.clientWidth - PAD_LEFT - 30);
		this.setZoom(w / Math.max(0.5, this.doc.duration));
		this.lanes.scrollLeft = 0;
	}

	timeToX(t) {
		return PAD_LEFT + t * this.pps;
	}

	xToTime(x) {
		return (x - PAD_LEFT) / this.pps;
	}

	/** Switches the bone list to another Humanoid.RigType ("R15" | "R6"). */
	setRigType(rigType) {
		const spec = RIG_SPECS[rigType] || RIG_SPECS.R15;
		if (spec === this.spec) return;
		this.spec = spec;
		this.depth = boneDepths(spec);
		this.render();
	}

	/** Rows: one per rig bone (indented by hierarchy) plus channel rows when expanded. */
	_rows() {
		const rows = [];
		const bones = this.spec.bones;
		const extra = this.doc ? [...this.doc.tracks.keys()].filter((b) => !bones.includes(b)) : [];
		for (const bone of [...bones, ...extra]) {
			const depth = this.depth[bone] ?? 0;
			rows.push({ bone, depth, foreign: !bones.includes(bone) });
			if (this.expanded.has(bone)) for (const channel of CHANNELS) rows.push({ bone, channel, depth: depth + 1 });
		}
		return rows;
	}

	_refsAt(bone, channel, time) {
		const refs = [];
		const entry = this.doc && this.doc.tracks.get(bone);
		if (!entry) return refs;
		for (const c of channel ? [channel] : CHANNELS) {
			for (const key of entry[c]) if (Math.abs(key.time - time) < 1e-4) refs.push({ bone, channel: c, key });
		}
		return refs;
	}

	render() {
		const doc = this.doc;
		const rows = this._rows();
		const duration = doc ? doc.duration : 2;
		const width = this.timeToX(duration) + 240;
		this.lanesInner.style.width = `${width}px`;
		this.lanesInner.style.height = `${rows.length * ROW_H}px`;

		this.list.innerHTML = "";
		for (const node of [...this.lanesInner.children]) if (node !== this.endMarker && node !== this.playhead) node.remove();

		const listFrag = document.createDocumentFragment();
		const laneFrag = document.createDocumentFragment();
		rows.forEach((row, i) => {
			const entry = doc && doc.tracks.get(row.bone);
			const label = el("div", `tl-row${row.channel ? " tl-row-channel" : ""}`);
			label.dataset.bone = row.bone;
			if (row.channel) label.dataset.channel = row.channel;
			label.style.paddingLeft = `${6 + row.depth * 12}px`;
			if (!row.channel) {
				const hasKeys = !!entry;
				const caret = el("button", `tl-caret${this.expanded.has(row.bone) ? " open" : ""}`);
				caret.type = "button";
				caret.title = "Mostrar canais Rotation / Position";
				caret.disabled = !hasKeys;
				caret.addEventListener("click", (e) => {
					e.stopPropagation();
					if (this.expanded.has(row.bone)) this.expanded.delete(row.bone);
					else this.expanded.add(row.bone);
					this.render();
				});
				label.append(caret, el("span", "tl-name", row.bone));
				if (hasKeys) label.classList.add("has-keys");
				if (row.foreign) {
					label.classList.add("foreign");
					label.title = `${row.bone} não existe neste rig`;
				}
				if (row.bone === this.selectedBone) label.classList.add("selected");
				label.addEventListener("click", () => this.onSelectBone(row.bone));
			} else {
				label.append(el("i", `tl-dot ${row.channel === "rotation" ? "rot" : "pos"}`), el("span", "tl-name", CHANNEL_LABEL[row.channel]));
			}
			listFrag.appendChild(label);

			const lane = el("div", `tl-lane${i % 2 ? " odd" : ""}${row.channel ? " channel" : ""}`);
			lane.style.top = `${i * ROW_H}px`;
			laneFrag.appendChild(lane);
			if (!entry) return;

			const times = new Map();
			for (const c of row.channel ? [row.channel] : CHANNELS) {
				for (const key of entry[c]) {
					const t = Math.round(key.time * 1e4) / 1e4;
					if (!times.has(t)) times.set(t, new Set());
					times.get(t).add(c);
				}
			}
			for (const [t, channels] of times) {
				const refs = this._refsAt(row.bone, row.channel, t);
				const d = el("div", "tl-key");
				d.dataset.bone = row.bone;
				d.dataset.time = String(t);
				if (row.channel) d.dataset.channel = row.channel;
				d.classList.add(channels.size === 2 ? "both" : channels.has("rotation") ? "rot" : "pos");
				const ease = refs[0] && refs[0].key.ease;
				if (ease === "constant") d.classList.add("ease-constant");
				else if (ease && ease !== "linear") d.classList.add("ease-smooth");
				if (refs.every((r) => this.selection.has(r.key))) d.classList.add("selected");
				d.style.left = `${this.timeToX(t)}px`;
				d.style.top = `${i * ROW_H + ROW_H / 2}px`;
				d.title = `${row.bone}${row.channel ? ` · ${CHANNEL_LABEL[row.channel]}` : ""} @ ${t.toFixed(2)}s · ${EASINGS[ease]?.label ?? ease}`;
				laneFrag.appendChild(d);
			}
		});
		this.list.appendChild(listFrag);
		this.lanesInner.insertBefore(laneFrag, this.endMarker);
		this.endMarker.style.left = `${this.timeToX(duration)}px`;
		this._placePlayhead();
		this._drawRuler();
	}

	_placePlayhead() {
		const x = this.timeToX(this.time);
		this.playhead.style.left = `${x}px`;
		this.rulerHead.style.left = `${x - this.lanes.scrollLeft}px`;
	}

	_drawRuler() {
		const canvas = this.ruler;
		const w = this.rulerWrap.clientWidth, h = this.rulerWrap.clientHeight;
		if (!w || !h) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;
		}
		const ctx = canvas.getContext("2d");
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		const fps = this.doc ? this.doc.fps : 30;
		const scroll = this.lanes.scrollLeft;
		const frameW = this.pps / fps;
		// Pick a label step that keeps labels at least ~60px apart.
		const steps = [1 / fps, 2 / fps, 5 / fps, 0.25, 0.5, 1, 2, 5, 10, 30];
		const labelStep = steps.find((s) => s * this.pps >= 60) || 30;
		const minorStep = frameW >= 6 ? 1 / fps : labelStep / 5;
		const t0 = Math.max(0, this.xToTime(scroll));
		const t1 = this.xToTime(scroll + w);
		const duration = this.doc ? this.doc.duration : 2;

		ctx.fillStyle = "rgba(0,0,0,.035)";
		const endX = this.timeToX(duration) - scroll;
		if (endX < w) ctx.fillRect(Math.max(0, endX), 0, w - Math.max(0, endX), h);

		ctx.strokeStyle = "#b7b7b7";
		ctx.beginPath();
		for (let t = Math.floor(t0 / minorStep) * minorStep; t <= t1; t += minorStep) {
			const x = Math.round(this.timeToX(t) - scroll) + 0.5;
			ctx.moveTo(x, h);
			ctx.lineTo(x, h - 5);
		}
		ctx.stroke();

		ctx.strokeStyle = "#7d7d7d";
		ctx.fillStyle = "#4a4a4a";
		ctx.font = "11px 'Source Code Pro', Consolas, monospace";
		ctx.textBaseline = "top";
		ctx.beginPath();
		for (let t = Math.floor(t0 / labelStep) * labelStep; t <= t1 + labelStep; t += labelStep) {
			const x = Math.round(this.timeToX(t) - scroll) + 0.5;
			ctx.moveTo(x, h);
			ctx.lineTo(x, h - 11);
			const label = labelStep < 1 ? `${t.toFixed(2)}` : `${Math.round(t)}s`;
			ctx.fillText(labelStep < 1 && Math.abs(t - Math.round(t)) < 1e-6 ? `${Math.round(t)}s` : label, x + 3, 3);
		}
		ctx.stroke();
		this._placePlayhead();
	}

	_eventTime(e) {
		const rect = this.lanes.getBoundingClientRect();
		const t = this.xToTime(e.clientX - rect.left + this.lanes.scrollLeft);
		const fps = this.doc ? this.doc.fps : 30;
		return Math.max(0, Math.round(t * fps) / fps);
	}

	_startScrub(e) {
		if (e.button !== 0) return;
		e.preventDefault();
		this.container.focus({ preventScroll: true });
		const target = e.currentTarget;
		capture(target, e.pointerId);
		this.onScrub(this._eventTime(e));
		const move = (ev) => this.onScrub(this._eventTime(ev));
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	_refsForDiamond(d) {
		return this._refsAt(d.dataset.bone, d.dataset.channel || null, Number(d.dataset.time));
	}

	_onLanePointerDown(e) {
		if (e.button !== 0) return;
		this.container.focus({ preventScroll: true });
		const d = e.target.closest(".tl-key");
		if (!d) {
			if (!e.shiftKey) this.selection.clear();
			this._startScrub(e);
			this._refreshSelection();
			return;
		}
		e.preventDefault();
		const refs = this._refsForDiamond(d);
		const allSelected = refs.every((r) => this.selection.has(r.key));
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			for (const r of refs) allSelected ? this.selection.delete(r.key) : this.selection.add(r.key);
		} else if (!allSelected) {
			this.selection.clear();
			for (const r of refs) this.selection.add(r.key);
		}
		this._refreshSelection();
		if (!this.selection.size) return;

		const moving = this.getSelectedRefs();
		for (const r of moving) r.key.origin = r.key.time;
		const startTime = this._eventTime(e);
		const lanes = this.lanes;
		capture(lanes, e.pointerId);
		let moved = false;
		const minOrigin = Math.min(...moving.map((r) => r.key.origin));
		const move = (ev) => {
			let dt = this._eventTime(ev) - startTime;
			if (minOrigin + dt < 0) dt = -minOrigin;
			if (!moved && Math.abs(dt) < 1e-6) return;
			moved = true;
			this.doc.moveKeys(moving, dt);
			this.render();
			this.container.classList.add("dragging");
			this.onChange("drag");
		};
		const up = () => {
			lanes.removeEventListener("pointermove", move);
			lanes.removeEventListener("pointerup", up);
			lanes.removeEventListener("pointercancel", up);
			this.container.classList.remove("dragging");
			if (moved) this.onChange("move");
		};
		lanes.addEventListener("pointermove", move);
		lanes.addEventListener("pointerup", up);
		lanes.addEventListener("pointercancel", up);
	}

	_onContextMenu(e) {
		const d = e.target.closest(".tl-key");
		if (!d) return;
		e.preventDefault();
		const refs = this._refsForDiamond(d);
		if (!refs.every((r) => this.selection.has(r.key))) {
			this.selection.clear();
			for (const r of refs) this.selection.add(r.key);
			this._refreshSelection();
		}
		this.onContextMenu(d, this.getSelectedRefs(), Number(d.dataset.time));
	}

	_refreshSelection() {
		for (const d of this.lanesInner.querySelectorAll(".tl-key")) {
			const refs = this._refsForDiamond(d);
			d.classList.toggle("selected", refs.length > 0 && refs.every((r) => this.selection.has(r.key)));
		}
		this.onChange("selection");
	}

	/** [{ bone, channel, key }] for every selected key. */
	getSelectedRefs() {
		const refs = [];
		if (!this.doc) return refs;
		for (const [bone, entry] of this.doc.tracks) {
			for (const channel of CHANNELS) for (const key of entry[channel]) if (this.selection.has(key)) refs.push({ bone, channel, key });
		}
		return refs;
	}

	selectAll() {
		for (const r of this._allRefs()) this.selection.add(r.key);
		this._refreshSelection();
	}

	_allRefs() {
		const refs = [];
		if (!this.doc) return refs;
		for (const [bone, entry] of this.doc.tracks) for (const channel of CHANNELS) for (const key of entry[channel]) refs.push({ bone, channel, key });
		return refs;
	}

	deleteSelected() {
		const refs = this.getSelectedRefs();
		if (!refs.length) return 0;
		this.doc.removeKeys(refs);
		this.selection.clear();
		this.render();
		this.onChange("delete");
		return refs.length;
	}
}
