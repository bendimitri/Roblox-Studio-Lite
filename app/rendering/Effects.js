/*
 * ParticleEmitter and Beam rendering. Records are read every frame (scripts move parts and
 * change properties through the bridge), so nothing is cached except the parent map from the
 * last scan of the Workspace.
 */
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	DataTexture,
	DoubleSide,
	DynamicDrawUsage,
	Mesh,
	MeshBasicMaterial,
	NormalBlending,
	Points,
	RepeatWrapping,
	ShaderMaterial,
	SRGBColorSpace,
	TextureLoader,
	Vector3
} from "../thirdparty/three/three.core.js";
import { assetIndexReady, localAsset } from "../http/AssetIndex.js";

const MAX_PARTICLES = 400;
const MAX_TOTAL = 6000;
const MAX_SEGMENTS = 24;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const EMIT_DIRS = {
	Top: [0, 1, 0], Bottom: [0, -1, 0], Right: [1, 0, 0], Left: [-1, 0, 0], Front: [0, 0, -1], Back: [0, 0, 1]
};

/* ---------- value helpers ---------- */

function sampleNumber(seq, t, fallback = 0) {
	if (typeof seq === "number") return seq;
	if (!Array.isArray(seq) || !seq.length) return fallback;
	if (t <= seq[0].Time) return +seq[0].Value;
	for (let i = 1; i < seq.length; i++) {
		const a = seq[i - 1], b = seq[i];
		if (t <= b.Time) {
			const k = b.Time > a.Time ? (t - a.Time) / (b.Time - a.Time) : 0;
			return +a.Value + (b.Value - a.Value) * k;
		}
	}
	return +seq[seq.length - 1].Value;
}

function sampleColor(seq, t, out) {
	if (seq && "R" in seq) return out.setRGB(seq.R, seq.G, seq.B);
	if (!Array.isArray(seq) || !seq.length) return out.setRGB(1, 1, 1);
	const col = (k) => k.Color || k.Value || { R: 1, G: 1, B: 1 };
	if (t <= seq[0].Time) { const c = col(seq[0]); return out.setRGB(c.R, c.G, c.B); }
	for (let i = 1; i < seq.length; i++) {
		const a = seq[i - 1], b = seq[i];
		if (t <= b.Time) {
			const k = b.Time > a.Time ? (t - a.Time) / (b.Time - a.Time) : 0;
			const ca = col(a), cb = col(b);
			return out.setRGB(ca.R + (cb.R - ca.R) * k, ca.G + (cb.G - ca.G) * k, ca.B + (cb.B - ca.B) * k);
		}
	}
	const c = col(seq[seq.length - 1]);
	return out.setRGB(c.R, c.G, c.B);
}

function range(r, fallback) {
	if (typeof r === "number") return r;
	if (!r || !("Min" in r)) return fallback;
	return r.Min + Math.random() * (r.Max - r.Min);
}

/** CFrame record -> { p, r } (r row-major) */
function frameOf(cf) {
	const c = cf && cf.Components;
	if (Array.isArray(c) && c.length >= 12) return { p: [c[0], c[1], c[2]], r: c.slice(3, 12) };
	const p = (cf && cf.Position) || { X: 0, Y: 0, Z: 0 };
	return { p: [p.X, p.Y, p.Z], r: IDENTITY };
}

function compose(a, b) {
	const r = new Array(9);
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
		r[i * 3 + j] = a.r[i * 3] * b.r[j] + a.r[i * 3 + 1] * b.r[3 + j] + a.r[i * 3 + 2] * b.r[6 + j];
	}
	return { p: [0, 1, 2].map((i) => a.p[i] + a.r[i * 3] * b.p[0] + a.r[i * 3 + 1] * b.p[1] + a.r[i * 3 + 2] * b.p[2]), r };
}

const rotate = (f, v) => [0, 1, 2].map((i) => f.r[i * 3] * v[0] + f.r[i * 3 + 1] * v[1] + f.r[i * 3 + 2] * v[2]);

/* ---------- particle shader ---------- */

const PARTICLE_VERTEX = /* glsl */ `
attribute float size;
attribute vec4 tint;
varying vec4 vTint;
uniform float uScale;
void main() {
	vTint = tint;
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	gl_PointSize = size * uScale / max(0.1, -mv.z);
	gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
varying vec4 vTint;
void main() {
	vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
	vec4 tex = uHasMap > 0.5 ? texture2D(uMap, uv) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.2, length(gl_PointCoord - 0.5)));
	vec4 c = tex * vTint;
	if (c.a < 0.01) discard;
	gl_FragColor = c;
}`;

export default class Effects {
	constructor(scene) {
		this.scene = scene;
		this.source = null;
		this.parents = new Map();
		this.emitters = new Map();
		this.beams = new Map();
		this.loader = new TextureLoader();
		this.textures = new Map();
		this.blank = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
		this.blank.needsUpdate = true;
		this._scanPending = false;
		this._color = new Color();
		this._v = new Vector3();
		this.total = 0;
		/** 0..1 multiplier from Graphics Quality (Escape menu). */
		this.particleRateScale = 1;
	}

	setSource(workspace) {
		this.source = workspace || null;
		this.requestScan();
	}

	requestScan() {
		this._scanPending = true;
	}

	clear() {
		for (const e of this.emitters.values()) this._disposeEmitter(e);
		for (const b of this.beams.values()) this._disposeBeam(b);
		this.emitters.clear();
		this.beams.clear();
		this.total = 0;
	}

	/** ParticleEmitter:Emit(n) */
	emit(rec, count) {
		if (this._scanPending) this._scan();
		const e = this.emitters.get(rec);
		if (e) this._spawn(e, Math.min(MAX_PARTICLES, Math.max(0, Math.floor(count ?? 16))));
	}

	/** ParticleEmitter:Clear() */
	clearEmitter(rec) {
		const e = this.emitters.get(rec);
		if (e) {
			this.total -= e.count;
			e.count = 0;
		}
	}

	_scan() {
		this._scanPending = false;
		const parents = new Map();
		const emitters = new Set(), beams = new Set();
		const walk = (rec) => {
			for (const child of rec.Children || []) {
				if (!child || typeof child !== "object") continue;
				parents.set(child, rec);
				if (child.ClassName === "ParticleEmitter") emitters.add(child);
				else if (child.ClassName === "Beam") beams.add(child);
				walk(child);
			}
		};
		if (this.source) walk(this.source);
		this.parents = parents;
		for (const [rec, e] of this.emitters) if (!emitters.has(rec)) {
			this.total -= e.count;
			this._disposeEmitter(e);
			this.emitters.delete(rec);
		}
		for (const [rec, b] of this.beams) if (!beams.has(rec)) {
			this._disposeBeam(b);
			this.beams.delete(rec);
		}
		for (const rec of emitters) if (!this.emitters.has(rec)) this.emitters.set(rec, this._createEmitter(rec));
		for (const rec of beams) if (!this.beams.has(rec)) this.beams.set(rec, this._createBeam(rec));
	}

	/** World frame of a part, attachment or model; null when it isn't in the Workspace. */
	_frame(rec) {
		if (!rec || typeof rec !== "object") return null;
		if (rec.ClassName === "Attachment") {
			const parent = this.parents.get(rec);
			const base = parent && parent.CFrame && parent.Size ? frameOf(parent.CFrame) : null;
			return base ? compose(base, frameOf(rec.CFrame)) : null;
		}
		if (rec.CFrame && rec.Size) return frameOf(rec.CFrame);
		return null;
	}

	_texture(content) {
		const key = String(content || "");
		if (!key) return null;
		if (this.textures.has(key)) return this.textures.get(key);
		const entry = { texture: null };
		this.textures.set(key, entry);
		assetIndexReady.then(() => {
			let url = null;
			const local = localAsset(key, "image");
			if (local) url = local.url;
			else if (key.startsWith("rbxasset://")) url = "content/" + key.slice(11);
			if (!url) return;
			const tex = this.loader.load(url);
			tex.colorSpace = SRGBColorSpace;
			tex.wrapS = tex.wrapT = RepeatWrapping;
			entry.texture = tex;
		});
		return entry;
	}

	/* ---------- particles ---------- */

	_createEmitter(rec) {
		const geometry = new BufferGeometry();
		const pos = new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(DynamicDrawUsage);
		const size = new BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(DynamicDrawUsage);
		const tint = new BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4).setUsage(DynamicDrawUsage);
		geometry.setAttribute("position", pos);
		geometry.setAttribute("size", size);
		geometry.setAttribute("tint", tint);
		geometry.setDrawRange(0, 0);
		const material = new ShaderMaterial({
			uniforms: { uMap: { value: this.blank }, uHasMap: { value: 0 }, uScale: { value: 500 } },
			vertexShader: PARTICLE_VERTEX,
			fragmentShader: PARTICLE_FRAGMENT,
			transparent: true,
			depthWrite: false
		});
		const points = new Points(geometry, material);
		points.frustumCulled = false;
		points.raycast = () => {};
		points.name = rec.Name || "ParticleEmitter";
		this.scene.add(points);
		return {
			rec, points, material,
			count: 0,
			accum: 0,
			p: new Float32Array(MAX_PARTICLES * 3),
			v: new Float32Array(MAX_PARTICLES * 3),
			age: new Float32Array(MAX_PARTICLES),
			life: new Float32Array(MAX_PARTICLES),
			seed: new Float32Array(MAX_PARTICLES),
			tex: this._texture(rec.Texture)
		};
	}

	_disposeEmitter(e) {
		e.points.removeFromParent();
		e.points.geometry.dispose();
		e.material.dispose();
	}

	_spawn(e, n) {
		const rec = e.rec;
		const host = this.parents.get(rec);
		const frame = this._frame(host);
		if (!frame) return;
		const sizeHalf = host.Size ? [host.Size.X / 2, host.Size.Y / 2, host.Size.Z / 2] : [0, 0, 0];
		const dir = EMIT_DIRS[rec.EmissionDirection] || EMIT_DIRS.Top;
		const spread = rec.SpreadAngle || { X: 0, Y: 0 };
		for (let k = 0; k < n; k++) {
			if (e.count >= MAX_PARTICLES || this.total >= MAX_TOTAL) return;
			const i = e.count++;
			this.total++;
			const local = host.ClassName === "Attachment"
				? [0, 0, 0]
				: [(Math.random() * 2 - 1) * sizeHalf[0], (Math.random() * 2 - 1) * sizeHalf[1], (Math.random() * 2 - 1) * sizeHalf[2]];
			const world = [0, 1, 2].map((j) => frame.p[j] + frame.r[j * 3] * local[0] + frame.r[j * 3 + 1] * local[1] + frame.r[j * 3 + 2] * local[2]);
			const ax = ((Math.random() * 2 - 1) * (spread.X || 0) * Math.PI) / 180;
			const ay = ((Math.random() * 2 - 1) * (spread.Y || 0) * Math.PI) / 180;
			const d = spreadDir(dir, ax, ay);
			const wd = rotate(frame, d);
			const speed = range(rec.Speed, 5);
			e.p[i * 3] = world[0]; e.p[i * 3 + 1] = world[1]; e.p[i * 3 + 2] = world[2];
			e.v[i * 3] = wd[0] * speed; e.v[i * 3 + 1] = wd[1] * speed; e.v[i * 3 + 2] = wd[2] * speed;
			e.age[i] = 0;
			e.life[i] = Math.max(0.05, range(rec.Lifetime, 2));
			e.seed[i] = Math.random();
		}
	}

	_updateEmitter(e, dt, scale) {
		const rec = e.rec;
		const rateMul = this.particleRateScale ?? 1;
		if (rec.Enabled !== false && (rec.Rate ?? 0) > 0 && rateMul > 0) {
			e.accum += Math.min(rec.Rate, 500) * (rec.TimeScale ?? 1) * rateMul * dt;
			const n = Math.floor(e.accum);
			if (n > 0) {
				e.accum -= n;
				this._spawn(e, n);
			}
		}
		const ts = (rec.TimeScale ?? 1) * dt;
		const acc = rec.Acceleration || { X: 0, Y: 0, Z: 0 };
		const drag = Math.exp(-(rec.Drag || 0) * ts);
		const geo = e.points.geometry;
		const pos = geo.attributes.position.array, size = geo.attributes.size.array, tint = geo.attributes.tint.array;
		let w = 0;
		for (let i = 0; i < e.count; i++) {
			const age = e.age[i] + ts;
			if (age >= e.life[i]) continue;
			if (w !== i) {
				for (let j = 0; j < 3; j++) { e.p[w * 3 + j] = e.p[i * 3 + j]; e.v[w * 3 + j] = e.v[i * 3 + j]; }
				e.life[w] = e.life[i];
				e.seed[w] = e.seed[i];
			}
			e.age[w] = age;
			e.v[w * 3] = (e.v[w * 3] + acc.X * ts) * drag;
			e.v[w * 3 + 1] = (e.v[w * 3 + 1] + acc.Y * ts) * drag;
			e.v[w * 3 + 2] = (e.v[w * 3 + 2] + acc.Z * ts) * drag;
			e.p[w * 3] += e.v[w * 3] * ts;
			e.p[w * 3 + 1] += e.v[w * 3 + 1] * ts;
			e.p[w * 3 + 2] += e.v[w * 3 + 2] * ts;
			w++;
		}
		this.total -= e.count - w;
		e.count = w;
		const brightness = rec.Brightness ?? 1;
		for (let i = 0; i < w; i++) {
			const t = e.age[i] / e.life[i];
			pos[i * 3] = e.p[i * 3]; pos[i * 3 + 1] = e.p[i * 3 + 1]; pos[i * 3 + 2] = e.p[i * 3 + 2];
			size[i] = Math.max(0, sampleNumber(rec.Size, t, 1));
			sampleColor(rec.Color, t, this._color);
			tint[i * 4] = this._color.r * brightness;
			tint[i * 4 + 1] = this._color.g * brightness;
			tint[i * 4 + 2] = this._color.b * brightness;
			tint[i * 4 + 3] = 1 - Math.min(1, Math.max(0, sampleNumber(rec.Transparency, t, 0)));
		}
		geo.setDrawRange(0, w);
		geo.attributes.position.needsUpdate = true;
		geo.attributes.size.needsUpdate = true;
		geo.attributes.tint.needsUpdate = true;
		const m = e.material;
		const tex = e.tex && e.tex.texture;
		m.uniforms.uMap.value = tex || this.blank;
		m.uniforms.uHasMap.value = tex ? 1 : 0;
		m.uniforms.uScale.value = scale;
		const additive = (rec.LightEmission ?? 0) > 0.5;
		if ((m.blending === AdditiveBlending) !== additive) {
			m.blending = additive ? AdditiveBlending : NormalBlending;
			m.needsUpdate = true;
		}
		e.points.visible = w > 0;
	}

	/* ---------- beams ---------- */

	_createBeam(rec) {
		const verts = (MAX_SEGMENTS + 1) * 2;
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new BufferAttribute(new Float32Array(verts * 3), 3).setUsage(DynamicDrawUsage));
		geometry.setAttribute("uv", new BufferAttribute(new Float32Array(verts * 2), 2).setUsage(DynamicDrawUsage));
		geometry.setAttribute("color", new BufferAttribute(new Float32Array(verts * 4), 4).setUsage(DynamicDrawUsage));
		const index = [];
		for (let i = 0; i < MAX_SEGMENTS; i++) {
			const a = i * 2;
			index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		geometry.setIndex(index);
		const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide });
		const mesh = new Mesh(geometry, material);
		mesh.frustumCulled = false;
		mesh.raycast = () => {};
		mesh.name = rec.Name || "Beam";
		this.scene.add(mesh);
		return { rec, mesh, material, scroll: 0, tex: this._texture(rec.Texture) };
	}

	_disposeBeam(b) {
		b.mesh.removeFromParent();
		b.mesh.geometry.dispose();
		b.material.dispose();
	}

	_updateBeam(b, dt, camPos) {
		const rec = b.rec;
		const f0 = this._frame(rec.Attachment0), f1 = this._frame(rec.Attachment1);
		if (!f0 || !f1 || rec.Enabled === false) {
			b.mesh.visible = false;
			return;
		}
		b.mesh.visible = true;
		const segs = Math.max(1, Math.min(MAX_SEGMENTS, Math.round(rec.Segments ?? 10)));
		const ax0 = rotate(f0, [1, 0, 0]), ax1 = rotate(f1, [1, 0, 0]);
		const c0 = rec.CurveSize0 || 0, c1 = rec.CurveSize1 || 0;
		const P0 = f0.p, P3 = f1.p;
		const P1 = [0, 1, 2].map((i) => P0[i] + ax0[i] * c0);
		const P2 = [0, 1, 2].map((i) => P3[i] - ax1[i] * c1);
		const bez = (t) => {
			const u = 1 - t;
			return [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
		};
		const geo = b.mesh.geometry;
		const pos = geo.attributes.position.array, uv = geo.attributes.uv.array, col = geo.attributes.color.array;
		const length = Math.hypot(P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]);
		const texLen = Math.max(0.01, rec.TextureLength ?? 1);
		const repeats = rec.TextureMode === "Stretch" ? 1 : length / texLen;
		b.scroll += (rec.TextureSpeed ?? 1) * dt;
		const w0 = rec.Width0 ?? 1, w1 = rec.Width1 ?? 1;
		const brightness = rec.Brightness ?? 1;
		const up0 = rotate(f0, [0, 1, 0]);
		for (let s = 0; s <= segs; s++) {
			const t = s / segs;
			const p = bez(t);
			const q = bez(Math.min(1, t + 1 / segs)), o = bez(Math.max(0, t - 1 / segs));
			const tan = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
			let side;
			if (rec.FaceCamera !== false) {
				const view = [camPos.x - p[0], camPos.y - p[1], camPos.z - p[2]];
				side = cross(tan, view);
			} else side = cross(tan, cross(up0, tan));
			const sl = Math.hypot(side[0], side[1], side[2]) || 1;
			const half = (w0 + (w1 - w0) * t) / 2;
			for (let k = 0; k < 2; k++) {
				const sign = k === 0 ? 1 : -1;
				const vi = s * 2 + k;
				for (let j = 0; j < 3; j++) pos[vi * 3 + j] = p[j] + (side[j] / sl) * half * sign;
				uv[vi * 2] = t * repeats - b.scroll / texLen;
				uv[vi * 2 + 1] = k;
				sampleColor(rec.Color, t, this._color);
				col[vi * 4] = this._color.r * brightness;
				col[vi * 4 + 1] = this._color.g * brightness;
				col[vi * 4 + 2] = this._color.b * brightness;
				col[vi * 4 + 3] = 1 - Math.min(1, Math.max(0, sampleNumber(rec.Transparency, t, 0)));
			}
		}
		geo.setDrawRange(0, segs * 6);
		geo.attributes.position.needsUpdate = true;
		geo.attributes.uv.needsUpdate = true;
		geo.attributes.color.needsUpdate = true;
		const tex = b.tex && b.tex.texture;
		if (b.material.map !== tex) {
			b.material.map = tex || null;
			b.material.needsUpdate = true;
		}
		const additive = (rec.LightEmission ?? 0) > 0.5;
		if ((b.material.blending === AdditiveBlending) !== additive) {
			b.material.blending = additive ? AdditiveBlending : NormalBlending;
			b.material.needsUpdate = true;
		}
	}

	/** Call once per rendered frame. */
	update(dt, camera, viewportHeight) {
		if (this._scanPending) this._scan();
		if (!this.emitters.size && !this.beams.size) return;
		dt = Math.min(0.1, Math.max(0, dt || 0));
		const scale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
		for (const e of this.emitters.values()) this._updateEmitter(e, dt, scale);
		camera.getWorldPosition(this._v);
		for (const b of this.beams.values()) this._updateBeam(b, dt, this._v);
	}
}

function cross(a, b) {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Rodrigues rotation of v around the unit axis k. */
function rotateAround(v, k, angle) {
	const c = Math.cos(angle), s = Math.sin(angle);
	const kv = cross(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
	return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * d * (1 - c));
}

/** Rotates a unit direction by ax / ay radians around two axes perpendicular to it (SpreadAngle). */
function spreadDir(dir, ax, ay) {
	const ref = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = cross(dir, ref);
	const lu = Math.hypot(...u) || 1;
	const un = u.map((x) => x / lu);
	const vn = cross(dir, un);
	return rotateAround(rotateAround(dir, un, ax), vn, ay);
}
