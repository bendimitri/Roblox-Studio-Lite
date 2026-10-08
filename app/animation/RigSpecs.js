import { JOINTS, PART_SIZES, R15_BONES, FEET_TO_ROOT } from "./R15Rig.js";

/*
 * Roblox rig definitions (Humanoid.RigType). Joint anchors follow the default
 * Motor6D C0 (a0, in Part0 space) / C1 (a1, in Part1 space) of each body, in studs.
 */

/** Classic R6: Motor6Ds live in the Torso (RootJoint lives in HumanoidRootPart). */
export const R6_JOINTS = [
	{ part: "Torso", parent: "HumanoidRootPart", motor: "RootJoint", a0: [0, 0, 0], a1: [0, 0, 0] },
	{ part: "Head", parent: "Torso", motor: "Neck", a0: [0, 1, 0], a1: [0, -0.5, 0] },
	{ part: "Right Arm", parent: "Torso", motor: "Right Shoulder", a0: [1, 0.5, 0], a1: [-0.5, 0.5, 0] },
	{ part: "Left Arm", parent: "Torso", motor: "Left Shoulder", a0: [-1, 0.5, 0], a1: [0.5, 0.5, 0] },
	{ part: "Right Leg", parent: "Torso", motor: "Right Hip", a0: [1, -1, 0], a1: [0.5, 1, 0] },
	{ part: "Left Leg", parent: "Torso", motor: "Left Hip", a0: [-1, -1, 0], a1: [-0.5, 1, 0] }
];

export const R6_SIZES = {
	HumanoidRootPart: [2, 2, 1],
	Torso: [2, 2, 1],
	Head: [2, 1, 1],
	"Right Arm": [1, 2, 1],
	"Left Arm": [1, 2, 1],
	"Right Leg": [1, 2, 1],
	"Left Leg": [1, 2, 1]
};

/** R15 Motor6Ds live in Part1 and are named after the joint. */
const R15_MOTORS = {
	LowerTorso: "Root", UpperTorso: "Waist", Head: "Neck",
	LeftUpperArm: "LeftShoulder", LeftLowerArm: "LeftElbow", LeftHand: "LeftWrist",
	RightUpperArm: "RightShoulder", RightLowerArm: "RightElbow", RightHand: "RightWrist",
	LeftUpperLeg: "LeftHip", LeftLowerLeg: "LeftKnee", LeftFoot: "LeftAnkle",
	RightUpperLeg: "RightHip", RightLowerLeg: "RightKnee", RightFoot: "RightAnkle"
};

export const R6_BONES = ["HumanoidRootPart", ...R6_JOINTS.map((j) => j.part)];

export const RIG_SPECS = {
	R15: {
		type: "R15",
		bones: R15_BONES,
		joints: JOINTS.map((j) => ({ ...j, motor: R15_MOTORS[j.part] })),
		sizes: { HumanoidRootPart: [2, 2, 1], ...PART_SIZES },
		parent: Object.fromEntries(JOINTS.map((j) => [j.part, j.parent])),
		feetToRoot: FEET_TO_ROOT,
		motorIn: "Part1",
		hipHeight: 2
	},
	R6: {
		type: "R6",
		bones: R6_BONES,
		joints: R6_JOINTS,
		sizes: R6_SIZES,
		parent: Object.fromEntries(R6_JOINTS.map((j) => [j.part, j.parent])),
		feetToRoot: 3,
		motorIn: "Part0",
		hipHeight: 0
	}
};

export const RIG_TYPES = Object.keys(RIG_SPECS);
export const ALL_BONES = [...new Set([...R15_BONES, ...R6_BONES])];

const SHARED = new Set(["HumanoidRootPart", "Head"]);
const ONLY = {
	R15: new Set(R15_BONES.filter((b) => !SHARED.has(b))),
	R6: new Set(R6_BONES.filter((b) => !SHARED.has(b)))
};

/** Bone names targeted by an AnimationDocument, its JSON, an AnimationClip or a plain name list. */
export function animationBoneNames(animationData) {
	if (!animationData) return [];
	if (Array.isArray(animationData)) return animationData.map(String);
	const tracks = animationData.tracks;
	if (tracks instanceof Map) return [...tracks.keys()];
	if (Array.isArray(tracks)) {
		return [...new Set(tracks.map((t) => {
			const name = String(t.name);
			const dot = name.lastIndexOf(".");
			return dot > 0 ? name.slice(0, dot) : name;
		}))];
	}
	if (tracks && typeof tracks === "object") return Object.keys(tracks);
	return [];
}

/**
 * Infers the rig an animation was authored for from the bones it drives.
 * @returns {"R15"|"R6"|"mixed"|null} null when only shared bones (or nothing) are keyed
 */
export function inferRigType(boneNames) {
	let r15 = 0, r6 = 0;
	for (const name of boneNames) {
		if (ONLY.R15.has(name)) r15++;
		else if (ONLY.R6.has(name)) r6++;
	}
	if (r15 && r6) return "mixed";
	if (r15) return "R15";
	if (r6) return "R6";
	return null;
}

/**
 * Checks whether an animation may be loaded into the AnimationMixer of a rig with
 * the given Humanoid.RigType. The declared rigType wins; otherwise it is inferred from
 * the track names. Animations that only touch shared bones fit both rigs.
 *
 * @param {object} animationData AnimationDocument | its JSON | AnimationClip
 * @param {"R15"|"R6"} rigType Humanoid.RigType of the target rig
 * @returns {{ ok: boolean, animationRigType: string|null, rigType: string, unknownBones: string[], message: string }}
 */
export function validateAnimationCompatibility(animationData, rigType) {
	const spec = RIG_SPECS[rigType];
	const names = animationBoneNames(animationData);
	const inferred = inferRigType(names);
	const declared = animationData?.rigType || animationData?.userData?.rigType || null;
	const animationRigType = declared || inferred;
	const unknownBones = spec ? names.filter((n) => ALL_BONES.includes(n) && !spec.bones.includes(n)) : names;

	const fail = (message) => ({ ok: false, animationRigType, rigType, unknownBones, message });
	if (!spec) return fail(`Erro de Compatibilidade: RigType desconhecido [${rigType}]`);
	if (inferred === "mixed") return fail(`Erro de Compatibilidade: a animação mistura ossos R15 e R6 e não pode ser aplicada em um Rig [${rigType}]`);
	if (animationRigType && animationRigType !== rigType) {
		return fail(`Erro de Compatibilidade: Impossível aplicar uma animação [${animationRigType}] em um Rig [${rigType}]`);
	}
	if (inferred && inferred !== rigType) {
		return fail(`Erro de Compatibilidade: Impossível aplicar uma animação [${inferred}] em um Rig [${rigType}]`);
	}
	return { ok: true, animationRigType, rigType, unknownBones, message: "" };
}
