import { Matrix4, Quaternion, Vector3 } from "../thirdparty/three/three.module.js";

/*
 * Roblox KeyframeSequence (decoded rbxm) -> compact per-bone tracks.
 * A Pose CFrame is the Motor6D.Transform of the joint named after the pose, so on a rig whose
 * bones sit on the Motor6D pivots with identity rest rotations it maps 1:1 onto the bone's
 * local rotation / offset. Poses for parts the rig does not have (face bones, attachments) are dropped.
 */

const SAMPLE_RATE = 30;
const ROT_TOLERANCE = 0.0015;
const POS_TOLERANCE = 0.002;

function outBounce(t) {
	if (t < 1 / 2.75) return 7.5625 * t * t;
	if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
	if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
	return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

const EASE_IN = {
	Cubic: (t) => t * t * t,
	CubicV2: (t) => t * t * t,
	Bounce: (t) => 1 - outBounce(1 - t),
	Elastic: (t) => (t <= 0 || t >= 1 ? t : -Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1.075) * 2 * Math.PI) / 0.3))
};

/** Pose easing: legacy styles (Cubic, Bounce, Elastic) have In and Out swapped compared to tweens; CubicV2 fixed it. */
function ease(style, direction, t) {
	const easeIn = EASE_IN[style];
	if (!easeIn) return t;
	let dir = direction || "In";
	if (style !== "CubicV2" && dir !== "InOut") dir = dir === "In" ? "Out" : "In";
	if (dir === "In") return easeIn(t);
	if (dir === "Out") return 1 - easeIn(1 - t);
	return t < 0.5 ? easeIn(t * 2) / 2 : 1 - easeIn((1 - t) * 2) / 2;
}

function readCFrame(cf) {
	const c = cf && cf.Components;
	const position = new Vector3();
	const quaternion = new Quaternion();
	if (!c || c.length < 12) return { position, quaternion };
	position.set(c[0], c[1], c[2]);
	// Components are row-major (R00 R01 R02 R10 ...); Matrix4.set takes rows too.
	const m = new Matrix4().set(c[3], c[4], c[5], 0, c[6], c[7], c[8], 0, c[9], c[10], c[11], 0, 0, 0, 0, 1);
	quaternion.setFromRotationMatrix(m).normalize();
	return { position, quaternion };
}

function collectPoses(pose, time, bones, out) {
	for (const child of pose.Children || []) {
		if (child.ClassName !== "Pose") continue;
		if (bones.has(child.Name)) {
			const { position, quaternion } = readCFrame(child.CFrame);
			(out[child.Name] ||= []).push({ time, position, quaternion, style: child.EasingStyle, direction: child.EasingDirection });
		}
		collectPoses(child, time, bones, out);
	}
}

function sampleTrack(keys, length) {
	const samples = [];
	const push = (time, position, quaternion) => samples.push({ time, position: position.clone(), quaternion: quaternion.clone() });
	for (let i = 0; i < keys.length; i++) {
		const a = keys[i];
		push(a.time, a.position, a.quaternion);
		const b = keys[i + 1];
		if (!b) break;
		const span = b.time - a.time;
		if (span <= 1e-6) continue;
		if (a.style === "Constant") {
			push(Math.max(a.time, b.time - 1e-4), a.position, a.quaternion);
			continue;
		}
		if (!EASE_IN[a.style]) continue;
		const steps = Math.ceil(span * SAMPLE_RATE);
		const p = new Vector3();
		const q = new Quaternion();
		for (let s = 1; s < steps; s++) {
			const u = s / steps;
			const k = ease(a.style, a.direction, u);
			p.lerpVectors(a.position, b.position, k);
			q.slerpQuaternions(a.quaternion, b.quaternion, k);
			push(a.time + span * u, p, q);
		}
	}
	const last = samples[samples.length - 1];
	if (last && last.time < length - 1e-4) push(length, last.position, last.quaternion);
	return samples;
}

/** Drops samples that linear interpolation between their kept neighbours already reproduces. */
function reduce(samples) {
	if (samples.length <= 2) return samples;
	const kept = [samples[0]];
	const p = new Vector3();
	const q = new Quaternion();
	for (let i = 1; i < samples.length - 1; i++) {
		const prev = kept[kept.length - 1];
		const next = samples[i + 1];
		const cur = samples[i];
		const u = (cur.time - prev.time) / Math.max(1e-6, next.time - prev.time);
		p.lerpVectors(prev.position, next.position, u);
		q.slerpQuaternions(prev.quaternion, next.quaternion, u);
		if (p.distanceTo(cur.position) > POS_TOLERANCE || q.angleTo(cur.quaternion) > ROT_TOLERANCE) kept.push(cur);
	}
	kept.push(samples[samples.length - 1]);
	return kept;
}

const round = (v) => Math.round(v * 1e5) / 1e5;

/**
 * @param {object} sequence decoded KeyframeSequence instance
 * @param {Iterable<string>} boneNames joints of the target rig
 * @returns {{ name: string, loop: boolean, priority: string, length: number, tracks: Record<string, { times: number[], quaternions: number[], positions?: number[] }> }}
 */
export function convertKeyframeSequence(sequence, boneNames) {
	const bones = new Set(boneNames);
	const keyframes = (sequence.Children || []).filter((c) => c.ClassName === "Keyframe").sort((a, b) => a.Time - b.Time);
	const perBone = {};
	for (const keyframe of keyframes) collectPoses(keyframe, keyframe.Time || 0, bones, perBone);
	const length = keyframes.length ? keyframes[keyframes.length - 1].Time || 0 : 0;

	const tracks = {};
	for (const [bone, keys] of Object.entries(perBone)) {
		const samples = reduce(sampleTrack(keys, length));
		const moves = samples.some((s) => s.position.lengthSq() > 1e-6);
		const track = { times: samples.map((s) => round(s.time)), quaternions: samples.flatMap((s) => s.quaternion.toArray().map(round)) };
		if (moves) track.positions = samples.flatMap((s) => s.position.toArray().map(round));
		tracks[bone] = track;
	}
	return {
		name: sequence.Name || "Animation",
		loop: sequence.Loop !== false,
		priority: sequence.Priority || "Core",
		length,
		tracks
	};
}
