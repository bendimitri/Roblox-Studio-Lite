import {
	FONTS,
	INTERACTIVE_GUI,
	adoptGuiInstance,
	fontOfFace,
	guiClassOf,
	isGuiInstance,
	isGuiModifier,
	makeChildrenReactive,
	setInvalidateHook
} from "./GuiClasses.js";
import { assetIdOf, localAsset, onAssetIndex } from "../http/AssetIndex.js";
import { Vector3 } from "../thirdparty/three/three.module.js";

/*
 * DOM renderer for StarterGui. The UI never touches WebGL: every GuiObject is an HTML element
 * inside #ui-overlay, a pointer-events:none layer stacked right above the THREE.js canvas.
 * Only TextButton / ImageButton / TextBox turn pointer-events back on, so clicks on them stay in
 * the DOM and never reach the 3D raycaster; everything else lets the pointer fall through.
 *
 * State reactor: GUI instances report every property write and Children mutation through the
 * invalidate hook. Writes are batched into one microtask flush that reconciles the tree
 * (create / move / remove elements) and restyles only the instances that changed.
 *
 * UI modifiers (UICorner, UIStroke, UIGradient, UIPadding, UIScale, UIAspectRatioConstraint,
 * UISizeConstraint, UITextSizeConstraint, UIListLayout, UIGridLayout) have no element: a change
 * to one restyles its parent (and, for layouts, the siblings it arranges).
 *
 * Sizes and positions are written in container query units (cqw / cqh of the parent's content
 * box), so a UIAspectRatioConstraint can mix both axes. Children of a padded or laid-out object
 * live in a ".gui-content" box inset by the UIPadding; a ScrollingFrame's live in its canvas.
 *
 * Events: "change" { instance, key }, "treechange", "removed" { instances }, "render",
 *         "activated" { instance }
 */

/** Roblox topbar height reserved when ScreenGui.IgnoreGuiInset is false. */
export const TOPBAR_INSET = 58;

const TAGS = { TextButton: "button", ImageButton: "button" };
const JUSTIFY = { Left: "flex-start", Center: "center", Right: "flex-end" };
const ALIGN = { Top: "flex-start", Center: "center", Bottom: "flex-end" };
const TEXT_ALIGN = { Left: "left", Center: "center", Right: "right" };
const BG_SIZE = { Stretch: "100% 100%", Slice: "100% 100%", Fit: "contain", Crop: "cover", Tile: "auto" };
const FLEX_SPACING = { SpaceAround: "space-around", SpaceBetween: "space-between", SpaceEvenly: "space-evenly" };
const MAX_SCALED_TEXT = 100;
/** Per-frame time budget for TextScaled fitting; the rest continues next frame. */
const FIT_BUDGET_MS = 10;

const TEXT_CLASSES = new Set(["TextLabel", "TextButton", "TextBox"]);
const isTextClass = (inst) => TEXT_CLASSES.has(inst.ClassName);
const isImageClass = (inst) => inst.ClassName === "ImageLabel" || inst.ClassName === "ImageButton";
const trim = (n) => String(Math.round(n * 10000) / 10000);

/** One UDim axis in container units of the parent ("cqw" or "cqh"). */
function udimCQ(udim, unit) {
	const px = udim.Offset;
	if (!udim.Scale) return `${px}px`;
	return `calc(${trim(udim.Scale * 100)}${unit} ${px < 0 ? "-" : "+"} ${Math.abs(px)}px)`;
}

/** One UDim axis relative to the element's own box (for padding / corner radius). */
function udimPct(udim) {
	const px = udim.Offset;
	if (!udim.Scale) return `${px}px`;
	return `calc(${trim(udim.Scale * 100)}% ${px < 0 ? "-" : "+"} ${Math.abs(px)}px)`;
}

/** Minimal Roblox RichText: <b> <i> <u> <s> <br> <font color size>, everything else escaped. */
function richTextToHTML(text) {
	const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	let html = escape(text);
	html = html.replace(/&lt;(\/?)(b|i|u|s)&gt;/gi, "<$1$2>").replace(/&lt;br\s*\/?&gt;/gi, "<br>");
	html = html.replace(/&lt;font((?:\s+(?:color|size)\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*&gt;/gi, (_, attrs) => {
		const style = [];
		const color = attrs.match(/color\s*=\s*["']([^"']+)["']/i);
		const size = attrs.match(/size\s*=\s*["'](\d+)["']/i);
		if (color && /^(#[0-9a-f]{3,8}|rgb\([\d\s,]+\)|[a-z]+)$/i.test(color[1].trim())) style.push(`color:${color[1].trim()}`);
		if (size) style.push(`font-size:${Number(size[1])}px`);
		return `<span style="${style.join(";")}">`;
	});
	return html.replace(/&lt;\/font&gt;/gi, "</span>");
}

/**
 * Image content id -> { url, thumbnail } or null. rbxassetid ids resolve to the copies that
 * tools/fetch-assets.mjs saved in asset/ (thumbnail: a 420x420 rendition, not the original).
 */
function resolveImage(value) {
	const src = String(value || "").trim();
	if (!src) return null;
	if (/^rbxasset:\/\//i.test(src)) return { url: "content/" + src.slice(11) };
	if (/^(data:|blob:)/i.test(src) || /^(\.{0,2}\/|images\/|content\/|assets?\/)/i.test(src)) return { url: src };
	const local = localAsset(src, "image");
	if (local) return { url: local.url, thumbnail: !!local.thumbnail };
	if (/^https?:/i.test(src) && !assetIdOf(src)) return { url: src };
	return null;
}

const THUMBNAIL_SIZE = 420;
const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
const cssUrl = (src) => `url("${src.replace(/"/g, "%22")}")`;

/* ---------- 3D-anchored GUIs ---------- */

/**
 * Layout size of one stud for BillboardGui Scale sizes. The element is laid out at this size and
 * scaled with a transform every frame, so distance changes never trigger a relayout.
 */
const WORLD_REF_PX = 50;

/** CFrame record -> { p: [x, y, z], r: row-major 3x3 } */
function cframeOf(rec) {
	const cf = rec.CFrame;
	const c = cf.Components;
	if (Array.isArray(c) && c.length >= 12) return { p: [c[0], c[1], c[2]], r: c.slice(3, 12) };
	const p = cf.Position || { X: 0, Y: 0, Z: 0 };
	return { p: [p.X, p.Y, p.Z], r: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

/** SurfaceGui faces: [sign, part axis] for the face normal, canvas right and canvas up. */
const FACES = {
	Front: { n: [-1, 2], r: [-1, 0], u: [1, 1] },
	Back: { n: [1, 2], r: [1, 0], u: [1, 1] },
	Right: { n: [1, 0], r: [-1, 2], u: [1, 1] },
	Left: { n: [-1, 0], r: [1, 2], u: [1, 1] },
	Top: { n: [1, 1], r: [1, 0], u: [-1, 2] },
	Bottom: { n: [-1, 1], r: [1, 0], u: [1, 2] }
};

/** CSS matrix3d mapping a w x h box onto the screen quad q (TL, TR, BR, BL). */
function quadMatrix(w, h, q) {
	const [p0, p1, p2, p3] = q;
	const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
	const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
	let a, b, d, e, g, hh;
	const det = dx1 * dy2 - dx2 * dy1;
	if (Math.abs(det) < 1e-9 || (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9)) {
		a = p1.x - p0.x; b = p3.x - p0.x; d = p1.y - p0.y; e = p3.y - p0.y; g = 0; hh = 0;
	} else {
		g = (dx3 * dy2 - dx2 * dy3) / det;
		hh = (dx1 * dy3 - dx3 * dy1) / det;
		a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x;
		d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y;
	}
	const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, p0.x, p0.y, 0, 1];
	return `matrix3d(${m.map((v) => +v.toFixed(8)).join(",")})`;
}

/* ---------- UIGradient ---------- */

function sampleColor(seq, t) {
	if (!Array.isArray(seq) || !seq.length) return { R: 1, G: 1, B: 1 };
	const col = (k) => k.Color || k.Value || { R: 1, G: 1, B: 1 };
	if (t <= seq[0].Time) return col(seq[0]);
	for (let i = 1; i < seq.length; i++) {
		const a = seq[i - 1], b = seq[i];
		if (t <= b.Time) {
			const f = b.Time > a.Time ? (t - a.Time) / (b.Time - a.Time) : 0;
			const ca = col(a), cb = col(b);
			return { R: ca.R + (cb.R - ca.R) * f, G: ca.G + (cb.G - ca.G) * f, B: ca.B + (cb.B - ca.B) * f };
		}
	}
	return col(seq[seq.length - 1]);
}

function sampleNumber(seq, t) {
	if (!Array.isArray(seq) || !seq.length) return 0;
	if (t <= seq[0].Time) return seq[0].Value;
	for (let i = 1; i < seq.length; i++) {
		const a = seq[i - 1], b = seq[i];
		if (t <= b.Time) {
			const f = b.Time > a.Time ? (t - a.Time) / (b.Time - a.Time) : 0;
			return a.Value + (b.Value - a.Value) * f;
		}
	}
	return seq[seq.length - 1].Value;
}

/** CSS linear-gradient of a UIGradient multiplied by a base color / transparency. */
function gradientCSS(gradient, base, baseTransparency) {
	const times = new Set([0, 1]);
	for (const k of Array.isArray(gradient.Color) ? gradient.Color : []) times.add(+k.Time);
	for (const k of Array.isArray(gradient.Transparency) ? gradient.Transparency : []) times.add(+k.Time);
	const offset = gradient.Offset;
	const stops = [...times].sort((a, b) => a - b).map((t) => {
		const c = sampleColor(gradient.Color, t);
		const alpha = (1 - baseTransparency) * (1 - Math.min(1, Math.max(0, sampleNumber(gradient.Transparency, t))));
		const rgb = [c.R * base.R, c.G * base.G, c.B * base.B].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
		const shift = offset ? (offset.X * Math.cos(gradient.Rotation * Math.PI / 180) + offset.Y * Math.sin(gradient.Rotation * Math.PI / 180)) : 0;
		return `rgba(${rgb.join(",")},${Math.round(alpha * 1000) / 1000}) ${trim((t + shift) * 100)}%`;
	});
	return `linear-gradient(${trim(90 + gradient.Rotation)}deg, ${stops.join(", ")})`;
}

/** Outline around glyphs: text-shadow ring of radius `t`. */
function strokeShadow(t, color) {
	const steps = t <= 1.5 ? 8 : 16;
	const out = [];
	for (let i = 0; i < steps; i++) {
		const a = (i / steps) * Math.PI * 2;
		out.push(`${trim(Math.cos(a) * t)}px ${trim(Math.sin(a) * t)}px 0 ${color}`);
	}
	return out.join(", ");
}

export class GuiEngine extends EventTarget {
	/**
	 * @param {{ canvas: HTMLCanvasElement, print?: Function }} options
	 */
	constructor({ canvas, print }) {
		super();
		this.print = print || (() => {});
		this.overlay = document.createElement("div");
		this.overlay.id = "ui-overlay";
		this.overlay.setAttribute("aria-label", "StarterGui");
		canvas.after(this.overlay);

		/** @type {Map<object, HTMLElement>} */
		this.elements = new Map();
		this.root = null;
		this.playing = false;
		this.editVisible = true;
		this._dirty = new Set();
		this._treeDirty = false;
		this._dirtyParents = new Set();
		this._scheduled = false;
		this._fonts = new Set();
		this._warned = new Set();
		/** @type {Map<string, {w: number, h: number, failed?: boolean, waiting: Set<object>}>} */
		this._imageSizes = new Map();

		/* BillboardGui / SurfaceGui in the Workspace (or in StarterGui with an Adornee). */
		this.worldLayer = document.createElement("div");
		this.worldLayer.className = "gui-world-layer";
		this.overlay.appendChild(this.worldLayer);
		this.worldSource = null;
		/** @type {Map<object, object>} world root -> 3D parent record */
		this.worldRoots = new Map();
		this._worldScanPending = false;
		this._worldParents = new Map();
		this._v = new Vector3();

		setInvalidateHook((instance, key) => this.invalidate(instance, key));
		onAssetIndex(() => {
			for (const instance of this.elements.keys()) if (isImageClass(instance)) this._dirty.add(instance);
			this._schedule();
		});
		new ResizeObserver(() => {
			this._requestFit(true);
			this.dispatchEvent(new CustomEvent("render"));
		}).observe(this.overlay);
	}

	/** Starts rendering a StarterGui service (plain DataModel record) and its ScreenGuis. */
	attach(starterGui) {
		this.detach();
		if (!starterGui) return;
		this.root = starterGui;
		makeChildrenReactive(starterGui);
		for (const child of starterGui.Children) {
			if (child && guiClassOf(child.ClassName)) adoptGuiInstance(child);
		}
		this._treeDirty = true;
		this.flush();
	}

	detach() {
		for (const el of this.elements.values()) el.remove();
		const removed = [...this.elements.keys()];
		this.elements.clear();
		this._dirty.clear();
		this._dirtyParents.clear();
		this.root = null;
		this.worldRoots.clear();
		this.worldSource = null;
		if (removed.length) this.dispatchEvent(new CustomEvent("removed", { detail: { instances: removed } }));
	}

	invalidate(instance, key) {
		if (key === "Children") {
			this._dirtyParents.add(instance);
			this.dispatchEvent(new CustomEvent("treechange", { detail: { instance } }));
		} else if (isGuiModifier(instance)) {
			const parent = instance.Parent;
			if (parent) {
				this._dirty.add(parent);
				if (instance.constructor.layout) for (const c of parent.Children) if (c && c.__gui) this._dirty.add(c);
			}
			this.dispatchEvent(new CustomEvent("change", { detail: { instance, key } }));
		} else {
			this._dirty.add(instance);
			if ((key === "LayoutOrder" || key === "Name") && instance.Parent && this._layoutOf(instance.Parent)) {
				for (const c of instance.Parent.Children) if (c && c.__gui) this._dirty.add(c);
			}
			this.dispatchEvent(new CustomEvent("change", { detail: { instance, key } }));
		}
		this._schedule();
	}

	_schedule() {
		if (!this._scheduled) {
			this._scheduled = true;
			queueMicrotask(() => this.flush());
		}
	}

	/** Applies pending tree / property changes to the DOM. */
	flush() {
		this._scheduled = false;
		if (!this.root) {
			this._dirty.clear();
			return;
		}
		this._syncTree();
		for (const instance of this._dirty) {
			const el = this.elements.get(instance);
			if (el) this._applyStyle(instance, el);
		}
		this._dirty.clear();
		// Restyling may have added / removed a content box: move children in the same flush.
		this._syncTree();
		this._requestFit();
		this.dispatchEvent(new CustomEvent("render"));
	}

	setPlaying(playing) {
		this.playing = playing;
		this.overlay.classList.toggle("ui-playing", playing);
		this._applyVisibility();
	}

	/** View > UI toggle; ignored in Play mode, where the UI is always shown. */
	setEditVisible(visible) {
		this.editVisible = visible;
		this._applyVisibility();
	}

	get isVisible() {
		return !this.overlay.hidden;
	}

	_applyVisibility() {
		this.overlay.hidden = !this.playing && !this.editVisible;
	}

	elementOf(instance) {
		return this.elements.get(instance) || null;
	}

	instanceOf(node) {
		const el = node && node.closest ? node.closest(".gui-node") : null;
		return el ? el.__guiInstance : null;
	}

	/** Topmost visible GuiObject under a client point (bounding boxes, painter's order). */
	hitTest(clientX, clientY) {
		if (!this.isVisible) return null;
		const nodes = [...this.overlay.querySelectorAll(".gui-screen .gui-obj")].reverse();
		for (const el of nodes) {
			if (!el.getClientRects().length) continue;
			const r = el.getBoundingClientRect();
			if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return el.__guiInstance;
		}
		return null;
	}

	/** Pixel size of the box an instance's UDim2 values are relative to. */
	parentSize(instance) {
		const parent = instance.Parent;
		const el = parent ? this.elements.get(parent) : null;
		const box = el ? this._containerOf(el) : this.overlay;
		return { width: box.clientWidth, height: box.clientHeight };
	}

	_containerOf(el) {
		return el.__content || el.__canvas || el;
	}

	/** Enabled modifiers of an instance, first of each class wins (like Roblox). */
	_modifiersOf(instance) {
		const mods = {};
		for (const c of instance.Children || []) {
			if (!isGuiModifier(c) || mods[c.ClassName]) continue;
			if ("Enabled" in c && !c.Enabled) continue;
			mods[c.ClassName] = c;
		}
		return mods;
	}

	_layoutOf(instance) {
		for (const c of instance.Children || []) if (isGuiModifier(c) && c.constructor.layout) return c;
		return null;
	}

	/* ---------- BillboardGui / SurfaceGui ---------- */

	/** Workspace record whose BillboardGuis / SurfaceGuis are rendered (re-scanned on demand). */
	setWorldSource(workspace) {
		this.worldSource = workspace || null;
		this.requestWorldScan();
	}

	requestWorldScan() {
		this._worldScanPending = true;
	}

	_scanWorld() {
		this._worldScanPending = false;
		const found = new Map();
		const parents = new Map();
		const walk = (rec) => {
			for (const child of rec.Children || []) {
				if (!child || typeof child !== "object") continue;
				parents.set(child, rec);
				const Cls = guiClassOf(child.ClassName);
				if (Cls && Cls.world) {
					found.set(child, rec);
					continue;
				}
				if (Cls) continue;
				walk(child);
			}
		};
		if (this.worldSource) walk(this.worldSource);
		this._worldParents = parents;
		let changed = found.size !== this.worldRoots.size;
		for (const [root, parent] of found) if (this.worldRoots.get(root) !== parent) changed = true;
		if (!changed) return;
		this.worldRoots = found;
		this._treeDirty = true;
		this.flush();
	}

	/** Positions every 3D-anchored GUI for the current camera. Call once per rendered frame. */
	updateWorld(camera) {
		if (this._worldScanPending) this._scanWorld();
		if (!this.worldLayer.childElementCount || this.overlay.hidden) return;
		const W = this.overlay.clientWidth, H = this.overlay.clientHeight;
		if (!W || !H) return;
		camera.updateMatrixWorld();
		const cam = camera.matrixWorld.elements;
		const camPos = [cam[12], cam[13], cam[14]];
		const camRight = [cam[0], cam[1], cam[2]], camUp = [cam[4], cam[5], cam[6]], camBack = [cam[8], cam[9], cam[10]];
		const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
		const project = (p) => {
			const v = this._v.set(p[0], p[1], p[2]);
			v.applyMatrix4(camera.matrixWorldInverse);
			const depth = -v.z;
			v.applyMatrix4(camera.projectionMatrix);
			return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, depth };
		};
		for (const el of this.worldLayer.children) {
			const root = el.__guiInstance;
			if (!root || !el.__worldEnabled) {
				el.style.display = "none";
				continue;
			}
			const shown = root.ClassName === "BillboardGui"
				? this._placeBillboard(root, el, { project, camPos, camRight, camUp, camBack, tanHalf, H })
				: this._placeSurface(root, el, { project, camPos });
			el.style.display = shown ? "" : "none";
		}
	}

	/** World position of a part / attachment / model a BillboardGui is attached to. */
	_worldAnchor(rec) {
		if (!rec || typeof rec !== "object") return null;
		if (rec.CFrame && rec.Size) return { position: cframeOf(rec).p };
		if (rec.ClassName === "Attachment") {
			const part = this._worldParents.get(rec);
			const local = rec.CFrame && rec.CFrame.Position ? rec.CFrame.Position : { X: 0, Y: 0, Z: 0 };
			if (!part || !part.CFrame) return null;
			const f = cframeOf(part);
			return {
				position: [0, 1, 2].map((i) => f.p[i] + f.r[i * 3] * local.X + f.r[i * 3 + 1] * local.Y + f.r[i * 3 + 2] * local.Z)
			};
		}
		if (rec.ClassName === "Model" || rec.ClassName === "Folder") {
			if (rec.PrimaryPart && rec.PrimaryPart.CFrame) return { position: cframeOf(rec.PrimaryPart).p };
			const stack = [...(rec.Children || [])];
			while (stack.length) {
				const c = stack.shift();
				if (c && c.CFrame && c.Size) return { position: cframeOf(c).p };
				if (c && c.Children) stack.push(...c.Children);
			}
		}
		return null;
	}

	_placeBillboard(root, el, view) {
		const anchor = this._worldAnchor(root.Adornee || this.worldRoots.get(root));
		if (!anchor) return false;
		const p = anchor.position.slice();
		const add = (v, axis, k = 1) => {
			if (!v) return;
			p[0] += axis[0] * v * k; p[1] += axis[1] * v * k; p[2] += axis[2] * v * k;
		};
		const off = root.StudsOffset, offW = root.StudsOffsetWorldSpace;
		if (off) {
			add(off.X, view.camRight);
			add(off.Y, view.camUp);
			add(off.Z, view.camBack);
		}
		if (offW) {
			p[0] += offW.X || 0; p[1] += offW.Y || 0; p[2] += offW.Z || 0;
		}
		const dist = Math.hypot(p[0] - view.camPos[0], p[1] - view.camPos[1], p[2] - view.camPos[2]);
		const max = Number(root.MaxDistance);
		if (Number.isFinite(max) && max > 0 && dist > max) return false;
		const s = view.project(p);
		if (s.depth <= 0.05) return false;
		const pxPerStud = view.H / (2 * s.depth * view.tanHalf);
		const size = root.Size;
		const baseW = Math.max(1, size.X.Offset + size.X.Scale * WORLD_REF_PX);
		const baseH = Math.max(1, size.Y.Offset + size.Y.Scale * WORLD_REF_PX);
		const w = size.X.Offset + size.X.Scale * pxPerStud;
		const h = size.Y.Offset + size.Y.Scale * pxPerStud;
		if (w < 0.5 || h < 0.5) return false;
		const st = el.style;
		if (!el.__worldSize || el.__worldSize[0] !== baseW || el.__worldSize[1] !== baseH) {
			el.__worldSize = [baseW, baseH];
			st.width = `${baseW}px`;
			st.height = `${baseH}px`;
			st.display = "";
			this._requestFit();
		}
		const so = root.SizeOffset || { X: 0, Y: 0 };
		const left = s.x - w / 2 + so.X * w;
		const top = s.y - h / 2 - so.Y * h;
		st.transform = `translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) scale(${(w / baseW).toFixed(4)}, ${(h / baseH).toFixed(4)})`;
		st.zIndex = String((root.AlwaysOnTop ? 2000000 : 1000000) - Math.round(dist * 10));
		return true;
	}

	_placeSurface(root, el, view) {
		const part = root.Adornee || this.worldRoots.get(root);
		const frame = part && part.CFrame && part.Size ? cframeOf(part) : null;
		if (!frame) return false;
		const face = FACES[root.Face] || FACES.Front;
		const axis = (i) => [frame.r[i], frame.r[i + 3], frame.r[i + 6]];
		const size = [part.Size.X, part.Size.Y, part.Size.Z];
		const dir = (spec) => {
			const a = axis(spec[1]);
			return [a[0] * spec[0], a[1] * spec[0], a[2] * spec[0]];
		};
		const n = dir(face.n), r = dir(face.r), u = dir(face.u);
		const halfN = size[face.n[1]] / 2 + 0.01, hw = size[face.r[1]] / 2, hh = size[face.u[1]] / 2;
		const c = [0, 1, 2].map((i) => frame.p[i] + n[i] * halfN);
		const toCam = [view.camPos[0] - c[0], view.camPos[1] - c[1], view.camPos[2] - c[2]];
		if (n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] <= 0) return false;
		const corner = (sx, sy) => view.project([0, 1, 2].map((i) => c[i] + r[i] * hw * sx + u[i] * hh * sy));
		const q = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
		if (q.some((pt) => pt.depth <= 0.05)) return false;
		let baseW, baseH;
		if (root.SizingMode === "PixelsPerStud") {
			const pps = Math.max(1, Number(root.PixelsPerStud) || 50);
			baseW = hw * 2 * pps;
			baseH = hh * 2 * pps;
		} else {
			baseW = Math.max(1, root.CanvasSize.X);
			baseH = Math.max(1, root.CanvasSize.Y);
		}
		const st = el.style;
		if (!el.__worldSize || el.__worldSize[0] !== baseW || el.__worldSize[1] !== baseH) {
			el.__worldSize = [baseW, baseH];
			st.width = `${baseW}px`;
			st.height = `${baseH}px`;
			st.display = "";
			this._requestFit();
		}
		st.transform = quadMatrix(baseW, baseH, q);
		const dist = Math.hypot(toCam[0], toCam[1], toCam[2]);
		st.zIndex = String((root.AlwaysOnTop ? 2000000 : 1000000) - Math.round(dist * 10));
		return true;
	}

	/** Full reconcile when the whole tree is stale, else only the subtrees whose Children changed. */
	_syncTree() {
		if (this._treeDirty || this._dirtyParents.has(this.root)) {
			this._treeDirty = false;
			this._dirtyParents.clear();
			this._reconcile();
		} else if (this._dirtyParents.size) {
			const parents = [...this._dirtyParents];
			this._dirtyParents.clear();
			this._reconcile(parents);
		}
	}

	/** @param {object[] | null} [parents] reconcile only these instances' subtrees (null: everything) */
	_reconcile(parents = null) {
		const seen = new Set();
		const adorned = [];
		const dropped = [];
		const sync = (parent, container) => {
			const ordered = [];
			let modSig = "";
			for (const child of parent.Children) {
				if (!child || !guiClassOf(child.ClassName)) continue;
				if (guiClassOf(child.ClassName).modifier) {
					if (!isGuiInstance(child)) adoptGuiInstance(child);
					child.__gui.parent = parent;
					modSig += child.__gui.id + ",";
					continue;
				}
				const atRoot = parent === this.root;
				if (guiClassOf(child.ClassName).world) {
					if (atRoot) {
						if (!isGuiInstance(child)) adoptGuiInstance(child);
						child.__gui.parent = parent;
						adorned.push(child);
					}
					continue;
				}
				if (atRoot !== (child.ClassName === "ScreenGui")) {
					this._warnOnce(child, atRoot
						? `StarterGui só aceita ScreenGui como filho direto: "${child.Name}" (${child.ClassName}) não será renderizado`
						: `ScreenGui "${child.Name}" precisa estar em StarterGui e foi ignorado`);
					continue;
				}
				if (!isGuiInstance(child)) adoptGuiInstance(child);
				child.__gui.parent = parent;
				let el = this.elements.get(child);
				if (!el) {
					el = this._createElement(child);
					this.elements.set(child, el);
					this._applyStyle(child, el);
				}
				seen.add(child);
				ordered.push(el);
				sync(child, this._containerOf(el));
			}
			const parentEl = this.elements.get(parent);
			if (parentEl && parentEl.__modSig !== modSig) {
				const hadLayout = parentEl.__hasLayout;
				parentEl.__modSig = modSig;
				this._applyStyle(parent, parentEl);
				if (hadLayout !== parentEl.__hasLayout || parentEl.__hasLayout) {
					for (const c of parent.Children) {
						const cel = c && this.elements.get(c);
						if (cel) this._applyStyle(c, cel);
					}
				}
			}
			const target = parentEl ? this._containerOf(parentEl) : container;
			const current = [...target.children].filter((n) => n.__guiInstance);
			if (current.length !== ordered.length || current.some((n, i) => n !== ordered[i])) {
				if (parents) {
					const keep = new Set(ordered);
					for (const n of current) if (!keep.has(n)) dropped.push(n);
				}
				for (const el of ordered) target.appendChild(el);
			}
		};

		if (parents) {
			for (const p of parents) {
				const el = this.elements.get(p);
				if (el && el.isConnected) sync(p, this._containerOf(el));
			}
			const removed = [];
			for (const node of dropped) {
				if (seen.has(node.__guiInstance)) continue;
				const nodes = [node, ...node.querySelectorAll("*")].filter((n) => n.__guiInstance);
				for (const n of nodes) {
					const instance = n.__guiInstance;
					if (seen.has(instance) || this.elements.get(instance) !== n) continue;
					this.elements.delete(instance);
					removed.push(instance);
				}
				node.remove();
			}
			if (removed.length) this.dispatchEvent(new CustomEvent("removed", { detail: { instances: removed } }));
			return;
		}

		if (this.root) sync(this.root, this.overlay);

		const roots = [...this.worldRoots.keys(), ...adorned.filter((g) => !this.worldRoots.has(g))];
		for (const root of roots) {
			if (!isGuiInstance(root)) adoptGuiInstance(root);
			const anchor = this.worldRoots.get(root);
			if (anchor) root.__gui.parent = anchor;
			let el = this.elements.get(root);
			if (!el) {
				el = this._createElement(root);
				this.elements.set(root, el);
				this._applyStyle(root, el);
			}
			seen.add(root);
			if (el.parentNode !== this.worldLayer) this.worldLayer.appendChild(el);
			sync(root, el);
		}

		const removed = [];
		for (const [instance, el] of this.elements) {
			if (seen.has(instance)) continue;
			el.remove();
			this.elements.delete(instance);
			removed.push(instance);
		}
		if (removed.length) this.dispatchEvent(new CustomEvent("removed", { detail: { instances: removed } }));
	}

	_warnOnce(instance, message) {
		if (this._warned.has(instance)) return;
		this._warned.add(instance);
		this.print(message, "warn");
	}

	_createElement(instance) {
		const cls = instance.ClassName;
		let el;
		if (cls === "ScreenGui") {
			el = document.createElement("div");
			el.className = "gui-node gui-screen";
		} else if (instance.constructor.world) {
			el = document.createElement("div");
			el.className = `gui-node gui-world gui-${cls}`;
			el.style.display = "none";
		} else {
			el = document.createElement(TAGS[cls] || "div");
			el.className = `gui-node gui-obj gui-${cls}`;
			if (el.tagName === "BUTTON") {
				el.type = "button";
				el.tabIndex = -1;
			}
			if (isImageClass(instance)) {
				const image = document.createElement("div");
				image.className = "gui-image";
				el.appendChild(image);
			}
			if (cls === "TextBox") {
				this._createTextBox(instance, el);
			} else if (isTextClass(instance)) {
				const text = document.createElement("span");
				text.className = "gui-text";
				el.appendChild(text);
			}
			if (cls === "ScrollingFrame") {
				const canvas = document.createElement("div");
				canvas.className = "gui-canvas";
				el.appendChild(canvas);
				el.__canvas = canvas;
				el.addEventListener("scroll", () => {
					if (this._settingScroll) return;
					instance.CanvasPosition = { X: el.scrollLeft, Y: el.scrollTop };
				}, { passive: true });
			}
			if (INTERACTIVE_GUI.has(cls)) this._bindButton(instance, el);
		}
		el.__guiInstance = instance;
		el.dataset.guiId = instance.UniqueId;
		return el;
	}

	_createTextBox(instance, el) {
		const input = document.createElement(instance.MultiLine ? "textarea" : "input");
		input.className = "gui-text gui-input";
		input.spellcheck = false;
		input.addEventListener("pointerdown", (e) => {
			if (!this.playing || !instance.TextEditable) e.preventDefault();
			else e.stopPropagation();
		});
		input.addEventListener("focus", () => {
			if (instance.ClearTextOnFocus) {
				input.value = "";
				instance.Text = "";
			}
			instance.Focused.Fire();
		});
		input.addEventListener("input", () => {
			instance.Text = input.value;
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !instance.MultiLine) {
				e.preventDefault();
				input.dataset.enter = "1";
				input.blur();
			}
			e.stopPropagation();
		});
		input.addEventListener("blur", () => {
			const enter = input.dataset.enter === "1";
			delete input.dataset.enter;
			instance.FocusLost.Fire(enter);
		});
		el.appendChild(input);
	}

	/** Play mode button input: stays in the DOM, fires Activated / MouseButton1Click. */
	_bindButton(instance, el) {
		el.addEventListener("pointerdown", (e) => {
			if (!this.playing) return;
			e.stopPropagation();
		});
		el.addEventListener("mousedown", (e) => {
			if (this.playing) e.stopPropagation();
		});
		el.addEventListener("click", (e) => {
			if (!this.playing) return;
			e.stopPropagation();
			if (!instance.Interactable) return;
			instance.MouseButton1Click.Fire();
			instance.Activated.Fire({ UserInputType: "MouseButton1" });
			this.dispatchEvent(new CustomEvent("activated", { detail: { instance } }));
		});
		el.addEventListener("pointerenter", () => {
			if (this.playing) instance.MouseEnter.Fire();
		});
		el.addEventListener("pointerleave", () => {
			if (this.playing) instance.MouseLeave.Fire();
		});
	}

	/** Adds / removes the ".gui-content" box children live in (padding, layouts). */
	_setContentBox(el, needed) {
		if (el.__canvas) return el.__canvas;
		if (needed && !el.__content) {
			const box = document.createElement("div");
			box.className = "gui-content";
			el.appendChild(box);
			el.__content = box;
			this._dirtyParents.add(el.__guiInstance);
			this._schedule();
		} else if (!needed && el.__content) {
			el.__content.remove();
			el.__content = null;
			this._dirtyParents.add(el.__guiInstance);
			this._schedule();
		}
		return el.__content || el;
	}

	_applyStyle(instance, el) {
		const s = el.style;
		if (instance.ClassName === "ScreenGui") {
			s.display = instance.Enabled ? "" : "none";
			s.zIndex = String(instance.DisplayOrder);
			const topbarOnly = instance.ScreenInsets === "TopbarSafeInsets";
			const inset = !topbarOnly && !instance.IgnoreGuiInset;
			s.top = inset ? `${TOPBAR_INSET}px` : "0px";
			s.bottom = topbarOnly ? `calc(100% - ${TOPBAR_INSET}px)` : "";
			el.classList.toggle("gui-inset", inset);
			return;
		}
		if (instance.constructor.world) {
			el.__worldEnabled = !!instance.Enabled;
			if (!instance.Enabled) s.display = "none";
			el.__worldSize = null;
			const mods = this._modifiersOf(instance);
			const layout = this._layoutOf(instance);
			const padding = mods.UIPadding;
			const container = this._setContentBox(el, !!(padding || layout));
			if (container !== el) this._styleContainer(container, padding, layout, false);
			el.__hasLayout = !!layout;
			return;
		}

		const mods = this._modifiersOf(instance);
		const parent = instance.Parent;
		const layout = parent && parent.ClassName !== "ScreenGui" ? this._layoutOf(parent) : null;
		const grid = layout && layout.ClassName === "UIGridLayout";

		/* Size: grid cell, aspect ratio, size constraint (container units of the parent) */
		let width = grid ? "var(--cell-w)" : udimCQ(instance.Size.X, "cqw");
		let height = grid ? "var(--cell-h)" : udimCQ(instance.Size.Y, "cqh");
		const aspect = mods.UIAspectRatioConstraint;
		if (aspect && aspect.AspectRatio > 0) {
			const r = trim(aspect.AspectRatio);
			if (aspect.AspectType === "ScaleWithParentSize") {
				if (aspect.DominantAxis === "Height") width = `calc(${height} * ${r})`;
				else height = `calc(${width} / ${r})`;
			} else {
				const w = width, h = height;
				width = `min(${w}, calc(${h} * ${r}))`;
				height = `min(${h}, calc(${w} / ${r}))`;
			}
		}
		s.width = width;
		s.height = height;
		const sizeLimit = mods.UISizeConstraint;
		s.minWidth = sizeLimit && sizeLimit.MinSize.X > 0 ? `${sizeLimit.MinSize.X}px` : "";
		s.minHeight = sizeLimit && sizeLimit.MinSize.Y > 0 ? `${sizeLimit.MinSize.Y}px` : "";
		s.maxWidth = sizeLimit && sizeLimit.MaxSize.X > 0 && sizeLimit.MaxSize.X < 1e8 ? `${sizeLimit.MaxSize.X}px` : "";
		s.maxHeight = sizeLimit && sizeLimit.MaxSize.Y > 0 && sizeLimit.MaxSize.Y < 1e8 ? `${sizeLimit.MaxSize.Y}px` : "";

		/* Position: free, or a flex item of the parent's UIListLayout / UIGridLayout */
		el.classList.toggle("gui-in-layout", !!layout);
		const a = instance.AnchorPoint;
		const scale = mods.UIScale ? mods.UIScale.Scale : 1;
		let transform = "";
		if (layout) {
			s.left = "";
			s.top = "";
			s.order = layout.SortOrder === "LayoutOrder" ? String(instance.LayoutOrder) : layout.SortOrder === "Name" ? String(this._nameRank(instance)) : "";
		} else {
			s.left = udimCQ(instance.Position.X, "cqw");
			s.top = udimCQ(instance.Position.Y, "cqh");
			s.order = "";
			if (a.X || a.Y) transform = `translate(${-a.X * 100}%, ${-a.Y * 100}%)`;
		}
		if (instance.Rotation) transform += ` rotate(${instance.Rotation}deg)`;
		if (scale !== 1) transform += ` scale(${trim(scale)})`;
		s.transform = transform.trim();
		s.transformOrigin = scale !== 1 ? `${a.X * 100}% ${a.Y * 100}%` : "";

		s.display = instance.Visible ? "flex" : "none";
		s.zIndex = String(instance.ZIndex);
		s.overflow = instance.ClipsDescendants || instance.ClassName === "CanvasGroup" ? "hidden" : "";
		s.opacity = instance.ClassName === "CanvasGroup" ? String(1 - instance.GroupTransparency) : "";

		/* Background (+ UIGradient) */
		const gradient = mods.UIGradient;
		const bgT = instance.BackgroundTransparency;
		if (gradient && !isImageClass(instance) && !isTextClass(instance) && bgT < 1) {
			s.backgroundColor = "transparent";
			s.backgroundImage = gradientCSS(gradient, instance.BackgroundColor3, bgT);
		} else {
			s.backgroundColor = instance.BackgroundColor3.toCSS(bgT);
			s.backgroundImage = gradient && bgT < 1 && isImageClass(instance) ? gradientCSS(gradient, instance.BackgroundColor3, bgT) : "";
			if (s.backgroundImage) s.backgroundColor = "transparent";
		}

		/* UICorner */
		const corner = mods.UICorner;
		s.borderRadius = !corner ? "" : corner.CornerRadius.Scale >= 0.5 ? "9999px" : udimPct(corner.CornerRadius);

		/* Border + UIStroke (Border mode, or Contextual on non-text objects) */
		const shadows = [];
		const border = instance.BorderSizePixel;
		if (border > 0 && bgT < 1) {
			const color = instance.BorderColor3.toCSS(bgT);
			const half = border / 2;
			shadows.push(instance.BorderMode === "Inset" ? `inset 0 0 0 ${border}px ${color}`
				: instance.BorderMode === "Middle" ? `0 0 0 ${half}px ${color}, inset 0 0 0 ${half}px ${color}`
				: `0 0 0 ${border}px ${color}`);
		}
		const stroke = mods.UIStroke;
		const textStroke = stroke && stroke.ApplyStrokeMode === "Contextual" && isTextClass(instance) ? stroke : null;
		if (stroke && !textStroke && stroke.Thickness > 0 && stroke.Transparency < 1) {
			shadows.push(`0 0 0 ${trim(stroke.Thickness)}px ${stroke.Color.toCSS(stroke.Transparency)}`);
		}
		s.boxShadow = shadows.join(", ");

		const interactive = INTERACTIVE_GUI.has(instance.ClassName) || instance.ClassName === "TextBox";
		s.pointerEvents = (interactive && instance.Interactable) || instance.ClassName === "ScrollingFrame" ? "auto" : "none";
		el.classList.toggle("gui-autocolor", INTERACTIVE_GUI.has(instance.ClassName) && !!instance.AutoButtonColor);

		/* Children box: UIPadding and layouts */
		const padding = mods.UIPadding;
		const ownLayout = this._layoutOf(instance);
		el.__hasLayout = !!ownLayout;
		const container = this._setContentBox(el, !!(padding || ownLayout));
		if (container !== el) this._styleContainer(container, padding, ownLayout, !!el.__canvas);
		if (instance.ClassName === "ScrollingFrame") this._applyScrolling(instance, el);

		if (isTextClass(instance)) this._applyText(instance, el, { padding, stroke: textStroke, gradient, sizeLimit: mods.UITextSizeConstraint });
		if (isImageClass(instance)) this._applyImage(instance, el, gradient);
	}

	_nameRank(instance) {
		const names = instance.Parent.Children.filter((c) => c && c.__gui && !isGuiModifier(c)).map((c) => c.Name).sort();
		return names.indexOf(instance.Name);
	}

	_styleContainer(box, padding, layout, isCanvas) {
		const s = box.style;
		const pad = (k) => (padding ? udimPct(padding[k]) : "0px");
		if (isCanvas) {
			s.padding = padding ? `${pad("PaddingTop")} ${pad("PaddingRight")} ${pad("PaddingBottom")} ${pad("PaddingLeft")}` : "";
		} else {
			s.top = pad("PaddingTop");
			s.right = pad("PaddingRight");
			s.bottom = pad("PaddingBottom");
			s.left = pad("PaddingLeft");
		}
		box.classList.toggle("gui-flex", !!layout);
		box.classList.toggle("gui-flex-fill", !!layout && (layout.HorizontalFlex === "Fill" || layout.VerticalFlex === "Fill"));
		if (!layout) {
			for (const k of ["flexDirection", "flexWrap", "justifyContent", "alignItems", "alignContent", "rowGap", "columnGap"]) s[k] = "";
			s.removeProperty("--cell-w");
			s.removeProperty("--cell-h");
			return;
		}
		const vertical = layout.FillDirection === "Vertical";
		const h = JUSTIFY[layout.HorizontalAlignment] || "flex-start";
		const v = ALIGN[layout.VerticalAlignment] || "flex-start";
		if (layout.ClassName === "UIGridLayout") {
			s.flexDirection = vertical ? "column" : "row";
			s.flexWrap = "wrap";
			s.justifyContent = vertical ? v : h;
			s.alignContent = vertical ? h : v;
			s.alignItems = "flex-start";
			s.columnGap = udimPct(layout.CellPadding.X);
			s.rowGap = udimPct(layout.CellPadding.Y);
			s.setProperty("--cell-w", udimCQ(layout.CellSize.X, "cqw"));
			s.setProperty("--cell-h", udimCQ(layout.CellSize.Y, "cqh"));
			return;
		}
		s.flexDirection = vertical ? "column" : "row";
		s.flexWrap = layout.Wraps ? "wrap" : "nowrap";
		const mainFlex = vertical ? layout.VerticalFlex : layout.HorizontalFlex;
		s.justifyContent = FLEX_SPACING[mainFlex] || (vertical ? v : h);
		s.alignItems = vertical ? h : v;
		s.alignContent = "";
		const gap = udimPct(layout.Padding);
		s.rowGap = vertical ? gap : "";
		s.columnGap = vertical ? "" : gap;
	}

	_applyScrolling(instance, el) {
		const canvas = el.__canvas;
		const dir = instance.ScrollingDirection;
		const enabled = instance.ScrollingEnabled;
		el.style.overflowX = enabled && dir !== "Y" ? "auto" : "hidden";
		el.style.overflowY = enabled && dir !== "X" ? "auto" : "hidden";
		const thickness = instance.ScrollBarThickness;
		el.style.scrollbarWidth = thickness <= 0 ? "none" : thickness <= 8 ? "thin" : "auto";
		el.style.scrollbarColor = `${instance.ScrollBarImageColor3.toCSS(instance.ScrollBarImageTransparency)} transparent`;
		const auto = instance.AutomaticCanvasSize;
		const cs = canvas.style;
		cs.width = auto === "X" || auto === "XY" ? "max-content" : `calc(${trim(instance.CanvasSize.X.Scale * 100)}% + ${instance.CanvasSize.X.Offset}px)`;
		cs.height = auto === "Y" || auto === "XY" ? "max-content" : `calc(${trim(instance.CanvasSize.Y.Scale * 100)}% + ${instance.CanvasSize.Y.Offset}px)`;
		cs.minWidth = "100%";
		cs.minHeight = "100%";
		canvas.classList.toggle("gui-canvas-auto", auto !== "None");
		const pos = instance.CanvasPosition;
		if (Math.abs(el.scrollLeft - pos.X) > 1 || Math.abs(el.scrollTop - pos.Y) > 1) {
			this._settingScroll = true;
			el.scrollLeft = pos.X;
			el.scrollTop = pos.Y;
			this._settingScroll = false;
		}
	}

	_applyText(instance, el, { padding, stroke, gradient, sizeLimit }) {
		const isBox = instance.ClassName === "TextBox";
		const text = el.querySelector(":scope > .gui-text");
		if (isBox) {
			if (document.activeElement !== text && text.value !== instance.Text) text.value = instance.Text;
			text.placeholder = instance.PlaceholderText;
			text.readOnly = !instance.TextEditable || !this.playing;
			text.style.setProperty("--placeholder", instance.PlaceholderColor3.toCSS(0));
		} else if (instance.RichText) {
			text.innerHTML = richTextToHTML(instance.Text);
		} else {
			text.textContent = instance.Text;
		}
		el.style.justifyContent = JUSTIFY[instance.TextXAlignment];
		el.style.alignItems = ALIGN[instance.TextYAlignment];
		const pad = (k) => (padding ? udimPct(padding[k]) : "");
		el.style.padding = padding ? `${pad("PaddingTop")} ${pad("PaddingRight")} ${pad("PaddingBottom")} ${pad("PaddingLeft")}` : "";
		const t = text.style;
		t.textAlign = TEXT_ALIGN[instance.TextXAlignment];
		t.whiteSpace = instance.TextWrapped || instance.TextScaled ? "pre-wrap" : "pre";
		t.lineHeight = String(instance.LineHeight);
		if (!instance.TextScaled) t.fontSize = `${sizeLimit ? Math.min(sizeLimit.MaxTextSize, Math.max(sizeLimit.MinTextSize, instance.TextSize)) : instance.TextSize}px`;
		const face = fontOfFace(instance.FontFace);
		const font = FONTS[face ? face.key : instance.Font] || FONTS.SourceSans;
		this._ensureFont(font);
		t.fontFamily = `"${font.family}", ${font.fallback || "sans-serif"}`;
		t.fontWeight = String(face ? face.weight : font.weight || 400);
		t.fontStyle = face ? face.style : font.style || "normal";

		const strokeColor = stroke && stroke.Thickness > 0 && stroke.Transparency < 1 ? stroke.Color.toCSS(stroke.Transparency)
			: instance.TextStrokeTransparency < 1 ? instance.TextStrokeColor3.toCSS(instance.TextStrokeTransparency) : null;
		const strokeWidth = stroke ? stroke.Thickness : 1;
		if (gradient && instance.TextTransparency < 1) {
			// Gradient text: background clipped to glyphs; text-shadow would show through, so the
			// outline becomes drop-shadows painted around the clipped glyphs.
			t.backgroundImage = gradientCSS(gradient, instance.TextColor3, instance.TextTransparency);
			t.backgroundClip = "text";
			t.webkitBackgroundClip = "text";
			t.color = "transparent";
			t.textShadow = "";
			t.filter = strokeColor ? [0, 90, 180, 270].map((deg) => {
				const r = deg * Math.PI / 180;
				return `drop-shadow(${trim(Math.cos(r) * strokeWidth)}px ${trim(Math.sin(r) * strokeWidth)}px 0 ${strokeColor})`;
			}).join(" ") : "";
		} else {
			t.backgroundImage = "";
			t.backgroundClip = "";
			t.webkitBackgroundClip = "";
			t.filter = "";
			t.color = instance.TextColor3.toCSS(instance.TextTransparency);
			t.textShadow = strokeColor ? strokeShadow(strokeWidth, strokeColor) : "";
		}
		el.classList.toggle("gui-text-scaled", !!instance.TextScaled);
		if (sizeLimit) {
			el.dataset.maxText = String(sizeLimit.MaxTextSize);
			el.dataset.minText = String(sizeLimit.MinTextSize);
		} else {
			delete el.dataset.maxText;
			delete el.dataset.minText;
		}
	}

	_applyImage(instance, el, gradient) {
		const image = el.querySelector(":scope > .gui-image");
		const asset = resolveImage(instance.Image);
		const s = image.style;
		image.classList.toggle("missing", !asset && !!instance.Image);
		image.dataset.asset = asset ? "" : instance.Image;
		image.classList.toggle("pixelated", instance.ResampleMode === "Pixelated");
		s.opacity = String(1 - instance.ImageTransparency);
		const tinted = !!asset && (!!gradient || instance.ImageColor3.toHex() !== "#ffffff");
		image.classList.toggle("tinted", tinted);

		const layout = asset ? this._imageLayout(instance, asset) : null;
		const url = layout ? cssUrl(asset.url) : "";
		const slice = layout && layout.slice;
		image.classList.toggle("sliced", !!slice);
		s.borderImage = slice && !tinted ? `${url} ${slice}` : "";
		s.setProperty("-webkit-mask-box-image", slice && tinted ? `${url} ${slice}` : "");
		s.setProperty("--mask", layout && !slice ? url : "none");
		s.setProperty("--size", layout ? layout.size : "100% 100%");
		s.setProperty("--pos", layout ? layout.pos : "center");
		s.setProperty("--repeat", layout ? layout.repeat : "no-repeat");
		if (!layout || slice) {
			s.backgroundImage = "";
		} else if (tinted && gradient) {
			s.backgroundImage = `${url}, ${gradientCSS(gradient, instance.ImageColor3, 0)}`;
		} else {
			s.backgroundImage = url;
		}
		const twoLayers = layout && !slice && tinted && gradient;
		s.backgroundSize = layout ? (twoLayers ? `${layout.size}, 100% 100%` : layout.size) : "";
		s.backgroundPosition = layout ? (twoLayers ? `${layout.pos}, center` : layout.pos) : "";
		s.backgroundRepeat = layout ? (twoLayers ? `${layout.repeat}, no-repeat` : layout.repeat) : "";
		s.backgroundColor = tinted && !gradient ? instance.ImageColor3.toCSS(0) : "";
	}

	/**
	 * background-size / position / repeat for ScaleType, ImageRectOffset/Size and TileSize, or a
	 * border-image "slice / widths" string for ScaleType.Slice. Returns null while the natural size
	 * of the image (needed for sprite rects and slices) is still loading.
	 */
	_imageLayout(instance, asset) {
		const type = instance.ScaleType;
		const rectSize = instance.ImageRectSize, rectOffset = instance.ImageRectOffset;
		const hasRect = rectSize.X > 0 && rectSize.Y > 0;
		if (type === "Slice") {
			const c = instance.SliceCenter;
			const valid = c && c.Max && (c.Max.X > c.Min.X || c.Max.Y > c.Min.Y);
			if (valid) return this._sliceLayout(instance, asset, c);
		}
		if (type === "Tile") {
			const t = instance.TileSize;
			return { size: `calc(${t.X.Scale * 100}% + ${t.X.Offset}px) calc(${t.Y.Scale * 100}% + ${t.Y.Offset}px)`, pos: "0 0", repeat: "repeat" };
		}
		if (!hasRect) return { size: BG_SIZE[type] || "100% 100%", pos: "center", repeat: "no-repeat" };
		let w, h;
		if (asset.thumbnail) {
			w = h = pow2(Math.max(rectOffset.X + rectSize.X, rectOffset.Y + rectSize.Y));
		} else {
			const natural = this._naturalSize(asset.url, instance);
			if (!natural) return null;
			if (natural.failed) return { size: "100% 100%", pos: "center", repeat: "no-repeat" };
			w = natural.w;
			h = natural.h;
		}
		const pct = (offset, size, total) => (total > size ? (offset / (total - size)) * 100 : 0);
		return {
			size: `${(w / rectSize.X) * 100}% ${(h / rectSize.Y) * 100}%`,
			pos: `${pct(rectOffset.X, rectSize.X, w)}% ${pct(rectOffset.Y, rectSize.Y, h)}%`,
			repeat: "no-repeat"
		};
	}

	_sliceLayout(instance, asset, c) {
		const scale = Math.max(0, Number(instance.SliceScale) || 1);
		let w, h, k = 1, ox = 0, oy = 0;
		if (asset.thumbnail) {
			// Unknown original size: assume symmetric margins, fitted into the square rendition.
			w = c.Max.X + c.Min.X;
			h = c.Max.Y + c.Min.Y;
			k = THUMBNAIL_SIZE / Math.max(w, h, 1);
			ox = (THUMBNAIL_SIZE - w * k) / 2;
			oy = (THUMBNAIL_SIZE - h * k) / 2;
		} else {
			const natural = this._naturalSize(asset.url, instance);
			if (!natural) return null;
			if (natural.failed) return { size: "100% 100%", pos: "center", repeat: "no-repeat" };
			w = natural.w;
			h = natural.h;
		}
		const top = c.Min.Y, left = c.Min.X, right = Math.max(0, w - c.Max.X), bottom = Math.max(0, h - c.Max.Y);
		const slices = [oy + top * k, ox + right * k, oy + bottom * k, ox + left * k].map((v) => Math.round(v));
		const widths = [top, right, bottom, left].map((v) => `${v * scale}px`).join(" ");
		return { slice: `${slices.join(" ")} fill / ${widths} stretch` };
	}

	_naturalSize(src, instance) {
		let entry = this._imageSizes.get(src);
		if (!entry) {
			entry = { w: 0, h: 0, waiting: new Set() };
			this._imageSizes.set(src, entry);
			const img = new Image();
			const done = (ok) => {
				if (ok) {
					entry.w = img.naturalWidth;
					entry.h = img.naturalHeight;
				} else entry.failed = true;
				for (const waiting of entry.waiting) this._dirty.add(waiting);
				entry.waiting.clear();
				this._schedule();
			};
			img.onload = () => done(img.naturalWidth > 0);
			img.onerror = () => done(false);
			img.src = src;
		}
		if (entry.w || entry.failed) return entry;
		entry.waiting.add(instance);
		return null;
	}

	/** Loads a Google Font the first time a Roblox Font enum needs it. */
	_ensureFont(font) {
		if (!font.google || this._fonts.has(font.google)) return;
		this._fonts.add(font.google);
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
		link.addEventListener("load", () => {
			if (document.fonts) document.fonts.ready.then(() => this._requestFit(true));
		});
		document.head.appendChild(link);
	}

	/** Text fitting is layout-bound: run it at most once per frame, however many flushes happen. */
	_requestFit(force = false) {
		if (force) this._fitForce = true;
		if (this._fitPending) return;
		this._fitPending = true;
		requestAnimationFrame(() => {
			this._fitPending = false;
			this._fitScaledText();
		});
	}

	/**
	 * TextScaled: the largest font size (<= 100px, or UITextSizeConstraint) whose text fits the box.
	 * Boxes whose text, font and size didn't change since the last fit are skipped.
	 */
	_fitScaledText() {
		const force = this._fitForce;
		this._fitForce = false;
		const todo = [];
		// Read pass first so the layout is computed once for every unchanged box.
		for (const el of this.overlay.querySelectorAll(".gui-text-scaled")) {
			const text = el.querySelector(":scope > .gui-text");
			if (!text) continue;
			const cs = el.style;
			const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
			const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
			const w = el.clientWidth - padX, h = el.clientHeight - padY;
			if (w <= 0 || h <= 0) continue;
			const key = `${w}|${h}|${el.dataset.minText}|${el.dataset.maxText}|${text.style.fontFamily}|${text.style.fontWeight}|${text.style.whiteSpace}|${text.textContent}`;
			if (!force && el.__fitKey === key) continue;
			el.__fitKey = key;
			todo.push([el, text, w, h]);
		}
		const deadline = performance.now() + FIT_BUDGET_MS;
		for (let i = 0; i < todo.length; i++) {
			const [el, text, w, h] = todo[i];
			if (performance.now() > deadline) {
				for (let j = i; j < todo.length; j++) todo[j][0].__fitKey = null;
				this._requestFit();
				return;
			}
			let lo = Number(el.dataset.minText) || 1, hi = Number(el.dataset.maxText) || MAX_SCALED_TEXT;
			if (hi < lo) hi = lo;
			text.style.fontSize = `${hi}px`;
			const sw = text.scrollWidth, sh = text.scrollHeight;
			if (sw <= w && sh <= h) continue;
			// Text scales ~linearly with font size: start from the proportional guess, then search below it.
			const guess = Math.max(lo, Math.min(hi, Math.floor(hi * Math.min(w / Math.max(1, sw), h / Math.max(1, sh)))));
			text.style.fontSize = `${guess}px`;
			if (text.scrollWidth <= w && text.scrollHeight <= h) continue;
			hi = guess - 1;
			while (lo < hi) {
				const mid = Math.ceil((lo + hi) / 2);
				text.style.fontSize = `${mid}px`;
				if (text.scrollWidth <= w && text.scrollHeight <= h) lo = mid;
				else hi = mid - 1;
			}
			text.style.fontSize = `${lo}px`;
		}
	}
}
