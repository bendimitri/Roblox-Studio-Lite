import {
	AnimationClip,
	Euler,
	MathUtils,
	Quaternion,
	QuaternionKeyframeTrack,
	Vector3,
	VectorKeyframeTrack
} from "../thirdparty/three/three.module.js";

/*
 * Default Humanoid animations (Animate script): idle, walk, jump and fall for R15 and R6.
 * Angles are degrees on the Motor6D pivots, in the part's local space (Roblox forward is -Z):
 *   +X swings a limb forward, -X bends knees backward, -Z/+Z raises the left/right arm outward.
 */

const R15_IDLE = {
	duration: 2.6,
	keys: [
		{ t: 0, pose: { UpperTorso: [0, 0, 0], Head: [0, 0, 0], LeftUpperArm: [2, 0, -4], RightUpperArm: [2, 0, 4], LeftLowerArm: [6], RightLowerArm: [6] }, root: [0, 0, 0] },
		{ t: 1.3, pose: { UpperTorso: [-2.5, 0, 0], Head: [3, 0, 0], LeftUpperArm: [4, 0, -7], RightUpperArm: [4, 0, 7], LeftLowerArm: [10], RightLowerArm: [10] }, root: [0, -0.04, 0] },
		{ t: 2.6, pose: { UpperTorso: [0, 0, 0], Head: [0, 0, 0], LeftUpperArm: [2, 0, -4], RightUpperArm: [2, 0, 4], LeftLowerArm: [6], RightLowerArm: [6] }, root: [0, 0, 0] }
	]
};

function r15Stride(side) {
	const l = side, r = -side;
	return {
		LeftUpperLeg: [32 * l], RightUpperLeg: [32 * r],
		LeftLowerLeg: [l > 0 ? -4 : -22], RightLowerLeg: [r > 0 ? -4 : -22],
		LeftFoot: [l > 0 ? -10 : 18], RightFoot: [r > 0 ? -10 : 18],
		LeftUpperArm: [-30 * l, 0, -5], RightUpperArm: [-30 * r, 0, 5],
		LeftLowerArm: [18], RightLowerArm: [18],
		UpperTorso: [-3, 5 * l, 0]
	};
}

function r15Passing(side) {
	const lift = side > 0 ? "Right" : "Left";
	const plant = side > 0 ? "Left" : "Right";
	return {
		[`${plant}UpperLeg`]: [-4], [`${lift}UpperLeg`]: [8],
		[`${plant}LowerLeg`]: [-6], [`${lift}LowerLeg`]: [-55],
		[`${plant}Foot`]: [4], [`${lift}Foot`]: [10],
		LeftUpperArm: [0, 0, -5], RightUpperArm: [0, 0, 5],
		LeftLowerArm: [14], RightLowerArm: [14],
		UpperTorso: [-3, 0, 0]
	};
}

const R15_WALK = {
	duration: 0.84,
	keys: [
		{ t: 0, pose: r15Stride(1), root: [0, -0.18, 0] },
		{ t: 0.21, pose: r15Passing(1), root: [0, 0.06, 0] },
		{ t: 0.42, pose: r15Stride(-1), root: [0, -0.18, 0] },
		{ t: 0.63, pose: r15Passing(-1), root: [0, 0.06, 0] },
		{ t: 0.84, pose: r15Stride(1), root: [0, -0.18, 0] }
	]
};

const R15_JUMP_POSE = {
	LeftUpperArm: [150, 0, -12], RightUpperArm: [150, 0, 12],
	LeftLowerArm: [12], RightLowerArm: [12],
	LeftUpperLeg: [18], LeftLowerLeg: [-30], LeftFoot: [10],
	RightUpperLeg: [-6], RightLowerLeg: [-14], RightFoot: [6],
	UpperTorso: [4, 0, 0], Head: [-6, 0, 0]
};

const R15_JUMP = {
	duration: 0.28,
	once: true,
	keys: [
		{ t: 0, pose: { UpperTorso: [-6, 0, 0], LeftUpperLeg: [10], RightUpperLeg: [10], LeftLowerLeg: [-20], RightLowerLeg: [-20] } },
		{ t: 0.28, pose: R15_JUMP_POSE }
	]
};

const R15_FALL = {
	duration: 0.9,
	keys: [
		{ t: 0, pose: { ...R15_JUMP_POSE, LeftUpperArm: [125, 0, -28], RightUpperArm: [125, 0, 28] } },
		{ t: 0.45, pose: { ...R15_JUMP_POSE, LeftUpperArm: [112, 0, -36], RightUpperArm: [112, 0, 36], LeftUpperLeg: [8], RightUpperLeg: [4] } },
		{ t: 0.9, pose: { ...R15_JUMP_POSE, LeftUpperArm: [125, 0, -28], RightUpperArm: [125, 0, 28] } }
	]
};

const R6_IDLE = {
	duration: 2.6,
	keys: [
		{ t: 0, pose: { Head: [0, 0, 0], "Left Arm": [0, 0, -2], "Right Arm": [0, 0, 2] } },
		{ t: 1.3, pose: { Head: [4, 0, 0], "Left Arm": [5, 0, -5], "Right Arm": [5, 0, 5] } },
		{ t: 2.6, pose: { Head: [0, 0, 0], "Left Arm": [0, 0, -2], "Right Arm": [0, 0, 2] } }
	]
};

const r6Swing = (s) => ({ "Left Arm": [-40 * s], "Right Arm": [40 * s], "Left Leg": [40 * s], "Right Leg": [-40 * s] });
const R6_WALK = {
	duration: 0.8,
	keys: [
		{ t: 0, pose: r6Swing(1) },
		{ t: 0.2, pose: r6Swing(0) },
		{ t: 0.4, pose: r6Swing(-1) },
		{ t: 0.6, pose: r6Swing(0) },
		{ t: 0.8, pose: r6Swing(1) }
	]
};

const R6_JUMP_POSE = { "Left Arm": [165, 0, -6], "Right Arm": [165, 0, 6], "Left Leg": [0], "Right Leg": [0], Head: [-4, 0, 0] };
const R6_JUMP = {
	duration: 0.2,
	once: true,
	keys: [
		{ t: 0, pose: { "Left Arm": [0], "Right Arm": [0] } },
		{ t: 0.2, pose: R6_JUMP_POSE }
	]
};

const R6_FALL = {
	duration: 0.6,
	keys: [
		{ t: 0, pose: R6_JUMP_POSE },
		{ t: 0.3, pose: { ...R6_JUMP_POSE, "Left Arm": [150, 0, -14], "Right Arm": [150, 0, 14], "Left Leg": [10], "Right Leg": [-10] } },
		{ t: 0.6, pose: R6_JUMP_POSE }
	]
};

export const AVATAR_ANIMATIONS = {
	R15: { idle: R15_IDLE, walk: R15_WALK, jump: R15_JUMP, fall: R15_FALL },
	R6: { idle: R6_IDLE, walk: R6_WALK, jump: R6_JUMP, fall: R6_FALL }
};

/** Walk cycle authored for WalkSpeed 16; timeScale = speed / this. */
export const WALK_CYCLE_SPEED = 16;

const _e = new Euler();
const _q = new Quaternion();
const _v = new Vector3();

/**
 * Bakes one animation definition into an AnimationClip for a rig built by R15Rig/RigBuilder.
 * Every bone keyed anywhere gets a value on every key (unkeyed = rest), so clips blend cleanly.
 */
export function buildAvatarClip(name, def, root) {
	const rest = root.userData.rest || {};
	const bones = new Set();
	for (const key of def.keys) for (const bone of Object.keys(key.pose || {})) bones.add(bone);
	const times = def.keys.map((k) => k.t);
	const tracks = [];

	for (const boneName of bones) {
		const restPose = rest[boneName];
		if (!restPose || !root.getObjectByName(boneName)) continue;
		const values = [];
		for (const key of def.keys) {
			const [x = 0, y = 0, z = 0] = key.pose?.[boneName] || [];
			_e.set(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z), "XYZ");
			_q.setFromEuler(_e).premultiply(restPose.quaternion);
			values.push(_q.x, _q.y, _q.z, _q.w);
		}
		tracks.push(new QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
	}

	const hrp = rest.HumanoidRootPart;
	if (hrp && def.keys.some((k) => k.root)) {
		const values = [];
		for (const key of def.keys) {
			_v.fromArray(key.root || [0, 0, 0]).add(hrp.position);
			values.push(_v.x, _v.y, _v.z);
		}
		tracks.push(new VectorKeyframeTrack("HumanoidRootPart.position", times, values));
	}
	return new AnimationClip(name, def.duration, tracks);
}

/** @returns {Record<"idle"|"walk"|"jump"|"fall", AnimationClip>} */
export function buildAvatarClips(root, rigType) {
	const defs = AVATAR_ANIMATIONS[rigType] || AVATAR_ANIMATIONS.R15;
	const clips = {};
	for (const [state, def] of Object.entries(defs)) {
		const clip = buildAvatarClip(`${rigType} ${state}`, def, root);
		clip.userData = { rigType, once: !!def.once };
		clips[state] = clip;
	}
	return clips;
}
