import { Quaternion, Vector3, VectorKeyframeTrack, QuaternionKeyframeTrack } from "../thirdparty/three/three.module.js";
import { poseKeysToDocument, withPose } from "./AnimationDocument.js";

/*
 * Animation data ported 1:1 from testeR15/animator/src/lib (r15-wand-cast.ts,
 * r15-get-up.ts). Rotations: Euler YXZ in degrees (X flexion, Y yaw, Z side swing).
 * Positions: stud offsets from the rest pose. Ease = segment ending at that key.
 */

/* ---------- Wand Cast (Harry Potter) ---------- */

const HIP_YAW = 75;

const STANCE = {
	LowerTorso: { r: [0, HIP_YAW, 0], p: [0, -0.06, 0] },
	RightUpperLeg: { r: [8, 0, 13] },
	RightLowerLeg: { r: [-14, 0, 0] },
	RightFoot: { r: [6, 0, -13] },
	LeftUpperLeg: { r: [8, 0, -13] },
	LeftLowerLeg: { r: [-14, 0, 0] },
	LeftFoot: { r: [6, 0, 13] }
};

const lookAhead = (chestYaw, pitch = 0) => ({ r: [pitch, -(HIP_YAW + chestYaw), 0] });

const READY = {
	...STANCE,
	UpperTorso: { r: [0, -5, 0] },
	Head: lookAhead(-5),
	RightUpperArm: { r: [10, 0, 35] },
	RightLowerArm: { r: [0, 0, 20] },
	LeftUpperArm: { r: [5, 0, -12] },
	LeftLowerArm: { r: [15, 0, 0] }
};

const WIND_UP = {
	...STANCE,
	UpperTorso: { r: [0, -20, 7] },
	Head: lookAhead(-20, -3),
	RightUpperArm: { r: [15, 0, 165] },
	RightLowerArm: { r: [0, 0, 65] },
	RightHand: { r: [0, 0, 15] },
	LeftUpperArm: { r: [10, 0, -35] },
	LeftLowerArm: { r: [20, 0, 0] }
};

const STRIKE = {
	...STANCE,
	UpperTorso: { r: [0, 12, -9] },
	Head: lookAhead(12, 4),
	RightUpperArm: { r: [0, 0, 93] },
	RightLowerArm: { r: [0, 0, 3] },
	RightHand: { r: [0, 0, 2] },
	LeftUpperArm: { r: [-10, 0, -50] },
	LeftLowerArm: { r: [25, 0, 0] }
};

const RECOIL = {
	...STRIKE,
	UpperTorso: { r: [0, 8, -5] },
	Head: lookAhead(8, 2),
	RightUpperArm: { r: [0, 0, 102] },
	RightLowerArm: { r: [0, 0, 10] },
	RightHand: { r: [0, 0, 14] }
};

const WAND_CAST_KEYS = [
	[0, READY, "cubic"],
	[0.5, WIND_UP, "cubicOut"],
	[0.7, STRIKE, "quadIn"],
	[25 / 30, RECOIL, "cubicOut"],
	[1.0, STRIKE, "cubic"],
	[1.55, STRIKE, "cubic"],
	[2.2, READY, "cubic"]
];
const STRIKE_TIME = 0.7;

/* ---------- Get Up From Ground ---------- */

const PRONE = {
	LowerTorso: { r: [-90, 0, 0] },
	UpperTorso: { r: [0, 0, 0] },
	Head: { r: [0, 72, 0] },
	RightUpperArm: { r: [0, 0, 145] },
	RightLowerArm: { r: [0, 0, 0] },
	LeftUpperArm: { r: [0, 0, -14] },
	LeftLowerArm: { r: [0, 0, 0] },
	RightUpperLeg: { r: [0, 0, 7] },
	LeftUpperLeg: { r: [0, 0, -9] },
	LeftLowerLeg: { r: [0, 0, 0] },
	RightFoot: { r: [-80, 0, 0] },
	LeftFoot: { r: [-75, 0, 0] }
};
const PRONE_BREATH = { ...PRONE, UpperTorso: { r: [2, 0, 0] }, Head: { r: [0, 70, 0] } };
const STIR = {
	...PRONE,
	Head: { r: [0, 35, 0] },
	RightUpperArm: { r: [0, 0, 30] },
	RightLowerArm: { r: [0, 0, 0] },
	LeftUpperArm: { r: [0, 0, -28] },
	LeftLowerArm: { r: [0, 0, 0] }
};
const ELBOWS_UP = {
	...PRONE,
	Head: { r: [0, 18, 0] },
	RightUpperArm: { r: [-55, 0, 28] },
	RightLowerArm: { r: [0, 0, 0] },
	LeftUpperArm: { r: [-55, 0, -28] },
	LeftLowerArm: { r: [0, 0, 0] }
};
const HANDS_PLANTED = {
	...PRONE,
	Head: { r: [8, 0, 0] },
	RightUpperArm: { r: [-55, 0, 28] },
	RightLowerArm: { r: [140, 0, 0] },
	RightHand: { r: [5, 0, 0] },
	LeftUpperArm: { r: [-55, 0, -28] },
	LeftLowerArm: { r: [140, 0, 0] },
	LeftHand: { r: [5, 0, 0] }
};
const HALF_PUSH = {
	LowerTorso: { r: [-82, 0, 0], p: [0, 0, -0.15] },
	UpperTorso: { r: [8, 0, 0] },
	Head: { r: [12, 0, 0] },
	RightUpperArm: { r: [20, 0, 14] },
	RightLowerArm: { r: [55, 0, 0] },
	RightHand: { r: [7, 0, 0] },
	LeftUpperArm: { r: [20, 0, -14] },
	LeftLowerArm: { r: [55, 0, 0] },
	LeftHand: { r: [7, 0, 0] },
	RightUpperLeg: { r: [35, 0, 6] },
	RightLowerLeg: { r: [-55, 0, 0] },
	RightFoot: { r: [-60, 0, 0] },
	LeftUpperLeg: { r: [35, 0, -6] },
	LeftLowerLeg: { r: [-55, 0, 0] },
	LeftFoot: { r: [-60, 0, 0] }
};
const ALL_FOURS = {
	LowerTorso: { r: [-76, 0, 0], p: [0, 0, 0.34] },
	UpperTorso: { r: [-4, 0, 0] },
	Head: { r: [18, 0, 0] },
	RightUpperArm: { r: [80, 0, 8] },
	RightLowerArm: { r: [0, 0, 0] },
	RightHand: { r: [0, 0, 0] },
	LeftUpperArm: { r: [80, 0, -8] },
	LeftLowerArm: { r: [0, 0, 0] },
	LeftHand: { r: [0, 0, 0] },
	RightUpperLeg: { r: [76, 0, 5] },
	RightLowerLeg: { r: [-90, 0, 0] },
	RightFoot: { r: [-62, 0, 0] },
	LeftUpperLeg: { r: [76, 0, -5] },
	LeftLowerLeg: { r: [-90, 0, 0] },
	LeftFoot: { r: [-62, 0, 0] }
};
const head = (pitch, yaw, roll = 0) => ({ ...ALL_FOURS, Head: { r: [pitch, yaw, roll] } });
const STEP_THROUGH = {
	...ALL_FOURS,
	Head: { r: [16, 0, 0] },
	RightUpperLeg: { r: [128, 0, 18] },
	RightLowerLeg: { r: [-128, 0, 0] },
	RightFoot: { r: [-25, 0, 0] }
};
const KNEEL = {
	LowerTorso: { r: [-60, 0, 0], p: [0, 0, 0.3] },
	UpperTorso: { r: [-20, 0, 0] },
	Head: { r: [45, 0, 0] },
	RightUpperArm: { r: [-15, -60, 0] },
	RightLowerArm: { r: [10, 0, 0] },
	RightHand: { r: [0, 0, 0] },
	LeftUpperArm: { r: [55, 0, -4] },
	LeftLowerArm: { r: [0, 0, 0] },
	LeftHand: { r: [0, 0, 0] },
	RightUpperLeg: { r: [140, 0, 25] },
	RightLowerLeg: { r: [-85, 0, 0] },
	RightFoot: { r: [5, 0, 0] },
	LeftUpperLeg: { r: [60, 0, -4] },
	LeftLowerLeg: { r: [-90, 0, 0] },
	LeftFoot: { r: [0, 0, 0] }
};
const KNEEL_BREATH = { ...KNEEL, UpperTorso: { r: [-17, 0, 0] }, Head: { r: [40, 0, 0] } };
const KNEEL_TALL = {
	...KNEEL,
	LowerTorso: { r: [-30, 0, 0], p: [0, 0, 0.3] },
	UpperTorso: { r: [-15, 0, 0] },
	Head: { r: [25, 0, 0] },
	RightUpperArm: { r: [-50, 60, 0] },
	RightLowerArm: { r: [110, 0, 0] },
	LeftUpperArm: { r: [30, 0, -8] },
	LeftLowerArm: { r: [30, 0, 0] },
	RightUpperLeg: { r: [110, 0, 25] },
	LeftUpperLeg: { r: [30, 0, -4] }
};
const HANDS_LIFT = {
	...KNEEL,
	LowerTorso: { r: [-66, 0, 0], p: [0, 0, 0.3] },
	RightUpperArm: { r: [30, -30, 10] },
	RightLowerArm: { r: [45, 0, 0] },
	LeftUpperArm: { r: [50, 0, -6] },
	LeftLowerArm: { r: [40, 0, 0] },
	RightUpperLeg: { r: [138, 0, 22] },
	RightLowerLeg: { r: [-100, 0, 0] },
	RightFoot: { r: [-10, 0, 0] }
};
const RISING = {
	LowerTorso: { r: [-24, 0, 0], p: [0, 0, -0.08] },
	UpperTorso: { r: [-6, -4, 0] },
	Head: { r: [14, 0, 0] },
	RightUpperArm: { r: [40, 0, 6] },
	RightLowerArm: { r: [20, 0, 0] },
	RightHand: { r: [-10, 0, 0] },
	LeftUpperArm: { r: [20, 0, -10] },
	LeftLowerArm: { r: [25, 0, 0] },
	RightUpperLeg: { r: [62, 0, 10] },
	RightLowerLeg: { r: [-50, 0, 0] },
	RightFoot: { r: [10, 0, 0] },
	LeftUpperLeg: { r: [8, 0, -3] },
	LeftLowerLeg: { r: [-55, 0, 0] },
	LeftFoot: { r: [20, 0, 0] }
};
const STAND = {
	LowerTorso: { p: [0, 0, -0.42] },
	UpperTorso: { r: [-3, 0, 0] },
	Head: { r: [-2, 0, 0] },
	RightUpperArm: { r: [4, 0, 4] },
	RightLowerArm: { r: [8, 0, 0] },
	LeftUpperArm: { r: [4, 0, -4] },
	LeftLowerArm: { r: [8, 0, 0] }
};
const STAND_SETTLE = { ...STAND, UpperTorso: { r: [1, 0, 0] }, Head: { r: [2, 0, 0] } };

const GET_UP_KEYS = [
	[0, PRONE, "sine"],
	[1.4, PRONE_BREATH, "sine"],
	[2.6, PRONE, "sine"],
	[3.6, STIR, "sine"],
	[4.2, ELBOWS_UP, "sine"],
	[4.8, HANDS_PLANTED, "sine"],
	[5.1, HANDS_PLANTED, "sine"],
	[6.3, HALF_PUSH, "cubic"],
	[7.6, ALL_FOURS, "sine"],
	[8.1, ALL_FOURS, "sine"],
	[8.4, head(14, 20, 4), "sine"],
	[8.7, head(14, -18, -4), "sine"],
	[9.0, head(15, 15, 3), "sine"],
	[9.3, head(16, -11, -2), "sine"],
	[9.6, head(17, 5, 0), "sine"],
	[9.9, head(18, 0, 0), "sine"],
	[10.4, head(18, 0, 0), "sine"],
	[11.2, head(24, 62, 0), "sine"],
	[11.9, head(24, 64, 0), "sine"],
	[13.0, head(24, -62, 0), "sine"],
	[13.7, head(24, -64, 0), "sine"],
	[14.4, head(18, 0, 0), "sine"],
	[15.6, STEP_THROUGH, "sine"],
	[16.2, HANDS_LIFT, "sine"],
	[17.0, KNEEL, "cubicOut"],
	[17.5, KNEEL_BREATH, "sine"],
	[18.0, KNEEL, "sine"],
	[18.7, KNEEL_TALL, "sine"],
	[19.9, RISING, "cubic"],
	[21.1, STAND, "cubicOut"],
	[22.1, STAND_SETTLE, "sine"],
	[22.9, STAND, "sine"]
];

/** Baked spell bolt / tip flash tracks (props, not editable bones). */
function wandCastEffects(root, studs, duration, fps = 30) {
	const tip = root.getObjectByName("WandTip");
	const wand = root.getObjectByName("Wand");
	if (!tip || !wand) return [];
	const rootInv = root.matrixWorld.clone().invert();
	const savedScale = wand.scale.clone();
	wand.scale.setScalar(1);
	const [tipPos, basePos] = withPose(root, STRIKE, studs, () => [
		tip.getWorldPosition(new Vector3()).applyMatrix4(rootInv),
		wand.getWorldPosition(new Vector3()).applyMatrix4(rootInv)
	]);
	wand.scale.copy(savedScale);
	root.updateMatrixWorld(true);
	const dir = tipPos.clone().sub(basePos).normalize();
	const travel = 14 * studs;
	const flightTime = 0.38;
	const boltQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
	const frames = Math.round(duration * fps);
	const times = Array.from({ length: frames + 1 }, (_, i) => (i / frames) * duration);
	const boltPos = [], boltScale = [], flashPos = [], flashScale = [];
	for (const t of times) {
		const k = (t - STRIKE_TIME) / flightTime;
		const p = tipPos.clone().addScaledVector(dir, travel * Math.max(0, Math.min(k, 1)) + 0.9 * studs);
		boltPos.push(p.x, p.y, p.z);
		const s = k >= 0 && k <= 1 ? Math.min(1, k * 6) : 0.0001;
		boltScale.push(s, s, s);
		flashPos.push(tipPos.x, tipPos.y, tipPos.z);
		const f = (t - STRIKE_TIME) / 0.3;
		const fs = f >= 0 && f <= 1 ? Math.sin(f * Math.PI) * 1.2 + 0.0001 : 0.0001;
		flashScale.push(fs, fs, fs);
	}
	return [
		new VectorKeyframeTrack("SpellBolt.position", times, boltPos),
		new VectorKeyframeTrack("SpellBolt.scale", times, boltScale),
		new QuaternionKeyframeTrack("SpellBolt.quaternion", [0, duration], [...boltQuat.toArray(), ...boltQuat.toArray()]),
		new VectorKeyframeTrack("SpellFlash.position", [0, duration], [...tipPos.toArray(), ...tipPos.toArray()]),
		new VectorKeyframeTrack("SpellFlash.scale", times, flashScale),
		new VectorKeyframeTrack("Wand.scale", [0, duration], [1, 1, 1, 1, 1, 1])
	];
}

/** Raw testeR15 pose keys, kept for re-conversion and verification. */
export const RAW_POSE_KEYS = { "wand-cast": WAND_CAST_KEYS, "get-up": GET_UP_KEYS };

export const SPELLS = [
	{
		id: "wand-cast",
		name: "Wand Cast (Harry Potter)",
		description: "Feitiço: prepara sobre o ombro, avança e dispara o raio vermelho pela varinha.",
		build(root, studs) {
			const doc = poseKeysToDocument(WAND_CAST_KEYS, root, { name: this.name, studs, loop: true, rigType: "R15" });
			doc.fxTracks = wandCastEffects(root, studs, doc.duration, doc.fps);
			return doc;
		}
	},
	{
		id: "get-up",
		name: "Get Up From Ground",
		description: "Caído de bruços, apoia as mãos, fica de joelhos, olha em volta e levanta.",
		build(root, studs) {
			const doc = poseKeysToDocument(GET_UP_KEYS, root, {
				name: this.name,
				studs,
				ground: true,
				groundIgnore: ["RightUpperArm", "LeftUpperArm"],
				loop: false,
				rigType: "R15"
			});
			if (root.getObjectByName("Wand")) {
				doc.fxTracks = [new VectorKeyframeTrack("Wand.scale", [0, doc.duration], [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4])];
			}
			return doc;
		}
	}
];

/**
 * Injects the spell animations from testeR15 into a rig: converts each one into an
 * editable AnimationDocument and returns them. Track names use the exact R15 bone
 * names of buildR15Rig, so AnimationMixer bindings resolve without remapping.
 */
export function injectSpellAnimations(root, studs = root.userData.studs || 1) {
	root.updateMatrixWorld(true);
	return SPELLS.map((spell) => spell.build(root, studs));
}

/* ---------- Classic R6 clips (Torso pivots: shoulders, hips, neck, RootJoint) ---------- */

const WAVE_POSE = (armZ, armX) => ({
	"Right Arm": { r: [armX, 0, armZ] },
	Head: { r: [0, -10, 6] },
	Torso: { r: [0, -8, 0] }
});

const R6_WAVE_KEYS = [
	[0, {}, "linear"],
	[0.35, WAVE_POSE(135, 0), "cubicOut"],
	[0.6, WAVE_POSE(152, -12), "sine"],
	[0.85, WAVE_POSE(116, 10), "sine"],
	[1.1, WAVE_POSE(152, -12), "sine"],
	[1.35, WAVE_POSE(116, 10), "sine"],
	[1.6, WAVE_POSE(140, 0), "sine"],
	[2.0, {}, "cubic"]
];

const JACK = (arms, legs, lift) => ({
	"Right Arm": { r: [0, 0, arms] },
	"Left Arm": { r: [0, 0, -arms] },
	"Right Leg": { r: [0, 0, legs] },
	"Left Leg": { r: [0, 0, -legs] },
	HumanoidRootPart: { p: [0, lift, 0] }
});

const R6_JACKS_KEYS = [
	[0, JACK(0, 0, 0), "linear"],
	[0.18, JACK(80, 9, 0.9), "cubicOut"],
	[0.36, JACK(150, 18, -0.08), "quadIn"],
	[0.54, JACK(80, 9, 0.9), "cubicOut"],
	[0.72, JACK(0, 0, 0), "quadIn"]
];

const R6_IDLE_KEYS = [
	[0, {}, "linear"],
	[1.2, { "Right Arm": { r: [-3, 0, 5] }, "Left Arm": { r: [-3, 0, -5] }, Head: { r: [-4, 0, 0] }, Torso: { r: [2, 0, 0] } }, "sine"],
	[2.4, {}, "sine"]
];

function r6Clip(id, name, description, keys) {
	return {
		id,
		name,
		description,
		rigType: "R6",
		category: "Clássicos R6",
		build(root, studs) {
			return poseKeysToDocument(keys, root, { name: this.name, studs, loop: true, rigType: "R6" });
		}
	};
}

/**
 * Everything the Animation Library tab offers. `rigType` is the Humanoid.RigType the clip
 * was authored for; `build(root)` must only run on a rig of that type (it measures the rig).
 */
export const ANIMATION_LIBRARY = [
	...SPELLS.map((spell) => ({ ...spell, rigType: "R15", category: "Feitiços · testeR15" })),
	r6Clip("r6-wave", "Wave (R6)", "Acena com o braço direito girando o Right Shoulder.", R6_WAVE_KEYS),
	r6Clip("r6-jacks", "Jumping Jacks (R6)", "Polichinelo: ombros, quadris e o RootJoint sobem juntos.", R6_JACKS_KEYS),
	r6Clip("r6-idle", "Idle Breath (R6)", "Respiração parada, braços e cabeça balançando de leve.", R6_IDLE_KEYS)
];
