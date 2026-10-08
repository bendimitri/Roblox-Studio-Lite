import {
	AnimationClip,
	Box3,
	CubicInterpolant,
	Euler,
	InterpolateLinear,
	InterpolateSmooth,
	MathUtils,
	PropertyBinding,
	Quaternion,
	QuaternionKeyframeTrack,
	Vector3,
	VectorKeyframeTrack
} from "../thirdparty/three/three.module.js";
import { ALL_BONES, inferRigType } from "./RigSpecs.js";

/*
 * Editable keyframe model for the Studio Lite animation editor.
 *
 * Source format (testeR15/animator r15-pose-clip.ts): PoseKey = [time, pose, ease]
 * where pose[bone] = { r: [x, y, z] Euler YXZ in degrees, p: [x, y, z] stud offset
 * from the rest position } and `ease` shapes the segment that ENDS at that key.
 *
 * Here every bone owns two channels (position, rotation) holding absolute local
 * values: position = rest + offset * studs, rotation = quaternion. A key's `ease`
 * keeps the source semantics (segment that ends at the key).
 */

export const EASINGS = {
	linear: { label: "Linear", fn: (t) => t },
	spline: { label: "Spline (Catmull-Rom)", fn: null },
	cubic: { label: "Cubic In-Out", fn: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) },
	sine: { label: "Sine In-Out", fn: (t) => -(Math.cos(Math.PI * t) - 1) / 2 },
	quadIn: { label: "Quad In", fn: (t) => t * t },
	cubicOut: { label: "Cubic Out", fn: (t) => 1 - Math.pow(1 - t, 3) },
	constant: { label: "Constant", fn: (t) => (t >= 1 ? 1 : 0) }
};

export const CHANNELS = ["rotation", "position"];
const PROPERTY = { rotation: "quaternion", position: "position" };
const TIME_EPS = 1e-4;
const DEG = Math.PI / 180;

export function eulerQuat([x, y, z]) {
	return new Quaternion().setFromEuler(new Euler(x * DEG, y * DEG, z * DEG, "YXZ"));
}

export function quatEulerDeg(q) {
	const e = new Euler().setFromQuaternion(new Quaternion(...q), "YXZ");
	return [e.x / DEG, e.y / DEG, e.z / DEG];
}

/** Maps loosely written names ("right upper arm", "right_arm") onto the exact R15 / R6 bone names. */
export function normalizeBoneName(name) {
	const key = String(name).replace(/[\s_\-:.]/g, "").toLowerCase();
	return ALL_BONES.find((b) => b.replace(/\s/g, "").toLowerCase() === key) || name;
}

let keyIds = 0;

export class AnimationDocument {
	constructor({ name = "Nova animação", duration = 2, fps = 30, loop = true, rigType = null } = {}) {
		this.name = name;
		/** Humanoid.RigType this animation was authored for ("R15" | "R6"); null = inferred from tracks. */
		this.rigType = rigType;
		this.duration = duration;
		this.fps = fps;
		this.loop = loop;
		/** @type {Map<string, { position: Key[], rotation: Key[] }>} */
		this.tracks = new Map();
		/** Baked read-only tracks for props/effects (spell bolt, flash, wand). */
		this.fxTracks = [];
		this.version = 0;
	}

	channel(bone, channel, create = false) {
		let entry = this.tracks.get(bone);
		if (!entry) {
			if (!create) return null;
			entry = { position: [], rotation: [] };
			this.tracks.set(bone, entry);
		}
		return entry[channel];
	}

	/**
	 * Inserts or replaces the key at `time`. Returns the key.
	 * `euler` (degrees, YXZ) is kept for keys imported from the source pose format: segments
	 * between two such keys interpolate the Euler angles exactly like testeR15 does.
	 */
	setKey(bone, channel, time, value, ease = "linear", { euler, snap = true } = {}) {
		const keys = this.channel(bone, channel, true);
		time = snap ? this.snapTime(time) : Math.max(0, time);
		let key = keys.find((k) => Math.abs(k.time - time) < TIME_EPS);
		if (key) {
			key.value = [...value];
			if (ease) key.ease = ease;
		} else {
			key = { id: ++keyIds, time, value: [...value], ease };
			keys.push(key);
			keys.sort((a, b) => a.time - b.time);
		}
		if (euler) key.euler = [...euler];
		else delete key.euler;
		if (time > this.duration) this.duration = time;
		this.touch();
		return key;
	}

	removeKeys(refs) {
		for (const { bone, channel, key } of refs) {
			const keys = this.channel(bone, channel);
			if (!keys) continue;
			const i = keys.indexOf(key);
			if (i >= 0) keys.splice(i, 1);
		}
		this._prune();
		this.touch();
	}

	/** Moves keys by `dt`; colliding keys at the destination are overwritten. */
	moveKeys(refs, dt) {
		const moving = new Set(refs.map((r) => r.key));
		for (const { bone, channel, key } of refs) {
			const keys = this.channel(bone, channel);
			const time = this.snapTime(MathUtils.clamp(key.origin + dt, 0, 600));
			for (let i = keys.length - 1; i >= 0; i--) {
				if (!moving.has(keys[i]) && Math.abs(keys[i].time - time) < TIME_EPS) keys.splice(i, 1);
			}
			key.time = time;
		}
		for (const entry of this.tracks.values()) for (const c of CHANNELS) entry[c].sort((a, b) => a.time - b.time);
		const last = this.lastKeyTime();
		if (last > this.duration) this.duration = last;
		this.touch();
	}

	setEase(refs, ease) {
		for (const { key } of refs) key.ease = ease;
		this.touch();
	}

	snapTime(t) {
		return Math.round(Math.max(0, t) * this.fps) / this.fps;
	}

	lastKeyTime() {
		let last = 0;
		for (const entry of this.tracks.values()) for (const c of CHANNELS) for (const k of entry[c]) last = Math.max(last, k.time);
		return last;
	}

	keyCount() {
		let n = 0;
		for (const entry of this.tracks.values()) n += entry.position.length + entry.rotation.length;
		return n;
	}

	touch() {
		this.version++;
	}

	_prune() {
		for (const [bone, entry] of this.tracks) if (!entry.position.length && !entry.rotation.length) this.tracks.delete(bone);
	}

	/** Value of one channel at time t, honouring each segment's easing. */
	sample(bone, channel, t, cache = new Map()) {
		const keys = this.channel(bone, channel);
		if (!keys || !keys.length) return null;
		const size = channel === "rotation" ? 4 : 3;
		if (t <= keys[0].time || keys.length === 1) return [...keys[0].value];
		const last = keys[keys.length - 1];
		if (t >= last.time) return [...last.value];
		let i = 1;
		while (i < keys.length - 1 && keys[i].time < t) i++;
		const a = keys[i - 1], b = keys[i];
		const u = (t - a.time) / (b.time - a.time);
		if (b.ease === "spline") {
			const spline = this._spline(bone, channel, keys, size, cache);
			const out = Array.from(spline.evaluate(t));
			if (size === 4) return normalize4(out);
			return out;
		}
		const k = (EASINGS[b.ease] || EASINGS.linear).fn(u);
		if (size === 4 && a.euler && b.euler) {
			return eulerQuat(a.euler.map((v, j) => v + (b.euler[j] - v) * k)).toArray();
		}
		if (size === 4) {
			const qa = new Quaternion(...a.value), qb = new Quaternion(...b.value);
			if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
			return qa.slerp(qb, k).toArray();
		}
		return a.value.map((v, j) => v + (b.value[j] - v) * k);
	}

	_spline(bone, channel, keys, size, cache) {
		const id = `${bone}.${channel}`;
		if (cache.has(id)) return cache.get(id);
		const times = new Float32Array(keys.map((k) => k.time));
		const values = new Float32Array(hemisphere(keys.map((k) => k.value), size).flat());
		const interp = new CubicInterpolant(times, values, size, new Float32Array(size));
		cache.set(id, interp);
		return interp;
	}

	/**
	 * Compiles to a THREE.AnimationClip. Channels made only of Linear keys become sparse
	 * tracks with InterpolateLinear (slerp for quaternions); position channels made only of
	 * Spline keys become sparse tracks with InterpolateSmooth (CubicInterpolant). Anything
	 * else (eased, constant or spline rotations) is baked at `fps` with the exact key
	 * times included, so the AnimationMixer reproduces the easing curves.
	 */
	toClip() {
		const tracks = [];
		const cache = new Map();
		for (const [bone, entry] of this.tracks) {
			for (const channel of CHANNELS) {
				const keys = entry[channel];
				if (!keys.length) continue;
				const size = channel === "rotation" ? 4 : 3;
				const Track = channel === "rotation" ? QuaternionKeyframeTrack : VectorKeyframeTrack;
				const name = `${bone}.${PROPERTY[channel]}`;
				const eases = keys.slice(1).map((k) => k.ease);
				let track;
				const eulerSegments = keys.some((k, i) => i > 0 && k.euler && keys[i - 1].euler);
				if (!eulerSegments && eases.every((e) => e === "linear")) {
					track = new Track(name, keys.map((k) => k.time), hemisphere(keys.map((k) => k.value), size).flat(), InterpolateLinear);
				} else if (size === 3 && eases.every((e) => e === "spline")) {
					track = new Track(name, keys.map((k) => k.time), keys.flatMap((k) => k.value), InterpolateSmooth);
				} else {
					const times = this._bakeTimes(keys);
					const values = hemisphere(times.map((t) => this.sample(bone, channel, t, cache)), size).flat();
					track = new Track(name, times, values, InterpolateLinear);
				}
				tracks.push(track);
			}
		}
		for (const fx of this.fxTracks) tracks.push(fx.clone());
		const duration = Math.max(this.duration, this.lastKeyTime(), 1 / this.fps);
		return new AnimationClip(this.name, duration, tracks);
	}

	_bakeTimes(keys) {
		const start = keys[0].time, end = keys[keys.length - 1].time;
		const set = new Set();
		const step = 1 / this.fps;
		for (let t = start; t < end - TIME_EPS; t += step) set.add(Math.round(t * 1e5) / 1e5);
		for (const k of keys) set.add(k.time);
		return [...set].sort((a, b) => a - b);
	}

	toJSON() {
		const tracks = {};
		for (const [bone, entry] of this.tracks) {
			tracks[bone] = {};
			for (const c of CHANNELS) {
				if (entry[c].length) {
					tracks[bone][c] = entry[c].map((k) => ({ t: k.time, v: k.value.map((n) => +n.toFixed(6)), e: k.ease, ...(k.euler ? { r: k.euler } : {}) }));
				}
			}
		}
		const rigType = this.rigType || inferRigType([...this.tracks.keys()]);
		return { format: "studiolite-anim", version: 1, name: this.name, rigType, duration: this.duration, fps: this.fps, loop: this.loop, tracks };
	}

	static fromJSON(json) {
		if (!json || json.format !== "studiolite-anim") throw new Error("Arquivo de animação inválido (esperado format: studiolite-anim)");
		const doc = new AnimationDocument({ name: json.name, duration: json.duration, fps: json.fps || 30, loop: json.loop !== false });
		for (const [rawBone, channels] of Object.entries(json.tracks || {})) {
			const bone = normalizeBoneName(rawBone);
			for (const c of CHANNELS) for (const k of channels[c] || []) doc.setKey(bone, c, k.t, k.v, k.e || "linear", { euler: k.r, snap: false });
		}
		doc.duration = json.duration;
		const inferred = inferRigType([...doc.tracks.keys()]);
		doc.rigType = json.rigType || (inferred === "mixed" ? null : inferred);
		return doc;
	}
}

function normalize4(v) {
	const l = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l, v[3] / l];
}

/** Flips quaternions onto the same hemisphere as their predecessor so interpolation takes the short arc. */
function hemisphere(values, size) {
	if (size !== 4) return values.map((v) => [...v]);
	const out = [];
	let prev = null;
	for (const v of values) {
		let q = [...v];
		if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((n) => -n);
		out.push(q);
		prev = q;
	}
	return out;
}

/* ---------- Adapter: testeR15 PoseKey[] -> AnimationDocument ---------- */

function snapshot(root) {
	const saved = [];
	root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone()]));
	return () => {
		for (const [o, p, q] of saved) {
			o.position.copy(p);
			o.quaternion.copy(q);
		}
		root.updateMatrixWorld(true);
	};
}

/** Temporarily poses the rig (source pose format), runs fn, restores. */
export function withPose(root, pose, studs, fn) {
	const restore = snapshot(root);
	const rest = root.userData.rest || {};
	for (const [bone, r] of Object.entries(rest)) {
		const obj = root.getObjectByName(bone);
		if (!obj) continue;
		obj.position.copy(r.position);
		obj.quaternion.copy(r.quaternion);
	}
	for (const [bone, v] of Object.entries(pose)) {
		const obj = root.getObjectByName(bone);
		if (!obj) continue;
		if (v.r) obj.quaternion.copy(eulerQuat(v.r));
		if (v.p) obj.position.add(new Vector3(...v.p).multiplyScalar(studs));
	}
	root.updateMatrixWorld(true);
	try {
		return fn();
	} finally {
		restore();
	}
}

const _box = new Box3();
/** Lowest point of the body part meshes relative to the rig root (studs). */
function lowestBodyPoint(root, ignore) {
	let min = Infinity;
	root.traverse((o) => {
		if (o.isMesh && o.name.endsWith("_Mesh") && !ignore.includes(o.name.slice(0, -5))) {
			_box.setFromObject(o, true);
			min = Math.min(min, _box.min.y);
		}
	});
	return min - root.getWorldPosition(new Vector3()).y;
}

/**
 * Converts the testeR15 keyed-pose format into editable keyframes.
 * @param {Array<[number, Record<string, {r?: number[], p?: number[]}>, string]>} poseKeys  [time, pose, easeName]
 * @param {import("three").Object3D} root  rig built by buildR15Rig (provides rest pose + measuring)
 * @param {{ name: string, studs?: number, ground?: boolean, groundIgnore?: string[], fps?: number, loop?: boolean }} options
 */
export function poseKeysToDocument(poseKeys, root, { name, studs = 1, ground = false, groundIgnore = [], fps = 30, loop = true, rigType = root.userData.rigType || null }) {
	const duration = poseKeys[poseKeys.length - 1][0];
	const doc = new AnimationDocument({ name, duration, fps, loop, rigType });
	const rest = root.userData.rest || {};
	const animated = { r: new Set(), p: new Set() };
	for (const [, pose] of poseKeys) {
		for (const [rawBone, v] of Object.entries(pose)) {
			const bone = normalizeBoneName(rawBone);
			if (v.r) animated.r.add(bone);
			if (v.p) animated.p.add(bone);
		}
	}
	if (ground) animated.p.add("LowerTorso");
	const keys = poseKeys.map(([t, pose, ease]) => [t, Object.fromEntries(Object.entries(pose).map(([b, v]) => [normalizeBoneName(b), v])), ease]);

	for (const [time, pose, ease] of keys) {
		for (const bone of animated.r) {
			const euler = pose[bone]?.r ?? [0, 0, 0];
			doc.setKey(bone, "rotation", time, eulerQuat(euler).toArray(), ease, { euler, snap: false });
		}
		for (const bone of animated.p) {
			if (ground && bone === "LowerTorso") continue;
			const base = rest[bone] ? rest[bone].position.clone() : new Vector3();
			const p = base.add(new Vector3(...(pose[bone]?.p ?? [0, 0, 0])).multiplyScalar(studs));
			doc.setKey(bone, "position", time, p.toArray(), ease, { snap: false });
		}
	}
	if (ground) groundRootTrack(doc, keys, root, studs, groundIgnore, fps);
	doc.duration = duration;
	return doc;
}

/** Source sampling (r15-pose-clip.ts samplePose): eased lerp of Euler angles / stud offsets. */
function samplePoseKeys(keys, bone, kind, t) {
	let i = 1;
	while (i < keys.length - 1 && keys[i][0] < t) i++;
	const [t0, p0] = keys[i - 1];
	const [t1, p1, ease] = keys[i];
	const k = (EASINGS[ease] || EASINGS.linear).fn(MathUtils.clamp((t - t0) / (t1 - t0 || 1), 0, 1));
	const a = p0[bone]?.[kind] ?? [0, 0, 0];
	const b = p1[bone]?.[kind] ?? [0, 0, 0];
	return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * The source re-plants the body on the floor every frame. This samples that exact
 * LowerTorso position at every frame, then keeps only the keys needed to stay within
 * 0.02 studs with linear interpolation (Douglas-Peucker over time), always keeping
 * the original pose times so the dope sheet still lines up.
 */
function groundRootTrack(doc, keys, root, studs, groundIgnore, fps) {
	const duration = keys[keys.length - 1][0];
	const frames = Math.round(duration * fps);
	const round = (t) => Math.round(t * 1e6) / 1e6;
	const times = [...new Set([...Array.from({ length: frames + 1 }, (_, i) => round((i / frames) * duration)), ...keys.map((k) => round(k[0]))])].sort((a, b) => a - b);
	const bones = new Set();
	for (const [, pose] of keys) for (const b of Object.keys(pose)) bones.add(b);
	const rest = root.userData.rest?.LowerTorso?.position ?? new Vector3();

	const exact = times.map((t) => {
		const pose = {};
		for (const b of bones) pose[b] = { r: samplePoseKeys(keys, b, "r", t), p: samplePoseKeys(keys, b, "p", t) };
		const lift = withPose(root, pose, studs, () => lowestBodyPoint(root, groundIgnore));
		return rest.clone().add(new Vector3(...pose.LowerTorso.p).multiplyScalar(studs)).setY(rest.y + pose.LowerTorso.p[1] * studs - lift);
	});

	const keyTimes = new Set(keys.map((k) => round(k[0])));
	const forced = times.map((t, i) => (keyTimes.has(t) ? i : -1)).filter((i) => i >= 0);
	const keep = new Set(forced);
	const TOL = 0.02 * studs;
	const split = (i, j) => {
		let worst = -1, err = TOL;
		for (let k = i + 1; k < j; k++) {
			const u = (times[k] - times[i]) / (times[j] - times[i]);
			const d = exact[i].clone().lerp(exact[j], u).distanceTo(exact[k]);
			if (d > err) {
				err = d;
				worst = k;
			}
		}
		if (worst < 0) return;
		keep.add(worst);
		split(i, worst);
		split(worst, j);
	};
	for (let n = 1; n < forced.length; n++) split(forced[n - 1], forced[n]);
	for (const i of [...keep].sort((a, b) => a - b)) doc.setKey("LowerTorso", "position", times[i], exact[i].toArray(), "linear", { snap: false });
}

/**
 * Checks that every track of a clip resolves to a node under `root` the way the
 * AnimationMixer's PropertyBinding will, so binding failures surface up front.
 */
export function validateBindings(root, clip) {
	const missing = [];
	const bound = [];
	for (const track of clip.tracks) {
		const parsed = PropertyBinding.parseTrackName(track.name);
		const node = PropertyBinding.findNode(root, parsed.nodeName);
		if (!node || node[parsed.propertyName] === undefined) missing.push(track.name);
		else bound.push(track.name);
	}
	const names = new Map();
	root.traverse((o) => {
		if (!o.name) return;
		names.set(o.name, (names.get(o.name) || 0) + 1);
	});
	const duplicates = [...names].filter(([, n]) => n > 1).map(([n]) => n).filter((n) => ALL_BONES.includes(n));
	return { ok: missing.length === 0 && duplicates.length === 0, missing, bound, duplicates };
}
