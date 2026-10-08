import {
	Bone,
	CapsuleGeometry,
	CatmullRomCurve3,
	CylinderGeometry,
	Group,
	LatheGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Object3D,
	SphereGeometry,
	TubeGeometry,
	Vector2,
	Vector3
} from "../thirdparty/three/three.module.js";
import { RoundedBoxGeometry } from "../thirdparty/three/addons/geometries/RoundedBoxGeometry.js";

/**
 * Procedural Roblox R15 rig, ported from testeR15/animator/src/lib/r15-rig.ts.
 * Bones sit on the Motor6D pivots of the default R15 body with identity rest
 * rotations, so keyed local rotations map 1:1 onto Motor6D.Transform and the
 * bone names are exactly the R15 part names used by the animation tracks.
 * Studio Lite works in studs, so the default scale is 1 (the source used 0.28 m/stud).
 */

const YELLOW = 0xf5cd30;
const BLUE = 0x0d69ac;
const GREEN = 0xa4bd47;

/** a0 = joint in the parent part's space, a1 = joint in the child part's space (studs). */
export const JOINTS = [
	{ part: "LowerTorso", parent: "HumanoidRootPart", a0: [0, -1, 0], a1: [0, -0.2, 0] },
	{ part: "UpperTorso", parent: "LowerTorso", a0: [0, 0.2, 0], a1: [0, -0.849, 0] },
	{ part: "Head", parent: "UpperTorso", a0: [0, 0.849, 0], a1: [0, -0.5758, 0] },
	{ part: "LeftUpperArm", parent: "UpperTorso", a0: [-0.9716, 0.5975, 0], a1: [0.5005, 0.4189, 0] },
	{ part: "LeftLowerArm", parent: "LeftUpperArm", a0: [0.0005, -0.3549, 0], a1: [0.0005, 0.2748, 0] },
	{ part: "LeftHand", parent: "LeftLowerArm", a0: [0.0005, -0.5322, 0], a1: [0.0005, 0.1316, 0] },
	{ part: "RightUpperArm", parent: "UpperTorso", a0: [0.9716, 0.5975, 0], a1: [-0.5005, 0.4189, 0] },
	{ part: "RightLowerArm", parent: "RightUpperArm", a0: [0, -0.355, 0], a1: [0, 0.2747, 0] },
	{ part: "RightHand", parent: "RightLowerArm", a0: [0, -0.5322, 0], a1: [0, 0.1316, 0] },
	{ part: "LeftUpperLeg", parent: "LowerTorso", a0: [-0.5, -0.2, 0], a1: [0, 0.4714, 0] },
	{ part: "LeftLowerLeg", parent: "LeftUpperLeg", a0: [0, -0.4493, 0], a1: [0, 0.4132, 0] },
	{ part: "LeftFoot", parent: "LeftLowerLeg", a0: [0, -0.5965, 0], a1: [0, 0.106, 0] },
	{ part: "RightUpperLeg", parent: "LowerTorso", a0: [0.5, -0.2, 0], a1: [0, 0.4714, 0] },
	{ part: "RightLowerLeg", parent: "RightUpperLeg", a0: [0, -0.4492, 0], a1: [0, 0.4134, 0] },
	{ part: "RightFoot", parent: "RightLowerLeg", a0: [0, -0.5965, 0], a1: [0, 0.106, 0] }
];

export const PART_SIZES = {
	LowerTorso: [1.9914, 0.4007, 1.004],
	UpperTorso: [1.9432, 1.698, 1.004],
	Head: [1.159, 1.182, 1.1606],
	LeftUpperArm: [1.0011, 1.2416, 1.0019],
	LeftLowerArm: [1.0011, 1.1175, 1.0019],
	LeftHand: [0.9843, 0.3158, 1.0283],
	RightUpperArm: [1.0011, 1.2416, 1.0019],
	RightLowerArm: [1.0011, 1.1175, 1.0019],
	RightHand: [0.9843, 0.3158, 1.0283],
	LeftUpperLeg: [0.9928, 1.3629, 0.9727],
	LeftLowerLeg: [0.9928, 1.3007, 0.9728],
	LeftFoot: [1.0089, 0.312, 1.0011],
	RightUpperLeg: [0.9928, 1.3629, 0.9727],
	RightLowerLeg: [0.9928, 1.3007, 0.9728],
	RightFoot: [1.0089, 0.312, 1.0011]
};

/** Every bone name the R15 animation tracks may target, root first. */
export const R15_BONES = ["HumanoidRootPart", ...JOINTS.map((j) => j.part)];
export const BONE_PARENT = Object.fromEntries(JOINTS.map((j) => [j.part, j.parent]));

/** Distance from the feet to the HumanoidRootPart pivot, in studs. */
export const FEET_TO_ROOT = 3.1924;

export function partColor(part) {
	if (part.includes("Torso")) return BLUE;
	if (part.includes("Leg") || part.includes("Foot")) return GREEN;
	return YELLOW;
}

/** Classic Roblox head: an upright cylinder with heavily filleted rims. */
export function buildHeadGeometry(radius, height, fillet) {
	const pts = [];
	const half = height / 2;
	const arc = (cx, cy, from, to) => {
		for (let i = 0; i <= 10; i++) {
			const a = from + ((to - from) * i) / 10;
			pts.push(new Vector2(cx + Math.cos(a) * fillet, cy + Math.sin(a) * fillet));
		}
	};
	pts.push(new Vector2(0, -half));
	arc(radius - fillet, -half + fillet, -Math.PI / 2, 0);
	arc(radius - fillet, half - fillet, 0, Math.PI / 2);
	pts.push(new Vector2(0, half));
	const geometry = new LatheGeometry(pts, 40);
	geometry.computeVertexNormals();
	return geometry;
}

/** Face decal features projected onto the head's front (-Z, Roblox forward). */
export function addFace(bone, center, radius, S) {
	const ink = new MeshBasicMaterial({ color: 0x111111 });
	const lift = 0.004 * S;
	const onSurface = (x, y) => new Vector3(center.x + x, center.y + y, center.z - Math.sqrt(Math.max(radius * radius - x * x, 0)) - lift);
	const parts = [];
	for (const x of [-0.16 * S, 0.16 * S]) {
		const eye = new Mesh(new SphereGeometry(0.055 * S, 14, 14), ink);
		eye.scale.set(1, 1.9, 0.25);
		eye.position.copy(onSurface(x, 0.13 * S));
		eye.rotation.y = -Math.asin(x / radius);
		parts.push(eye);
	}
	const smileRadius = 0.27 * S;
	const curve = [];
	for (let i = 0; i <= 20; i++) {
		const a = Math.PI * (1.18 + (0.64 * i) / 20);
		curve.push(onSurface(Math.cos(a) * smileRadius, 0.02 * S + Math.sin(a) * smileRadius));
	}
	parts.push(new Mesh(new TubeGeometry(new CatmullRomCurve3(curve), 32, 0.028 * S, 8, false), ink));
	for (const p of parts) {
		p.name = "Face";
		p.userData.boneTarget = bone;
		bone.add(p);
	}
}

/**
 * @param {{ studs?: number, name?: string, wand?: boolean }} [options]
 * @returns {{ root: Group, bones: Record<string, Bone>, rest: Record<string, { position: Vector3, quaternion: import("three").Quaternion }>, studs: number }}
 */
export function buildR15Rig({ studs = 1, name = "R15 Rig", wand = true } = {}) {
	const S = studs;
	const root = new Group();
	root.name = name;
	root.userData.isAnimRig = true;

	const hrp = new Bone();
	hrp.name = "HumanoidRootPart";
	hrp.position.set(0, FEET_TO_ROOT * S, 0);
	root.add(hrp);

	const bones = { HumanoidRootPart: hrp };
	const pivotToCenter = { HumanoidRootPart: [0, 0, 0] };

	for (const { part, parent, a0, a1 } of JOINTS) {
		const parentBone = bones[parent];
		const offset = pivotToCenter[parent];
		const bone = new Bone();
		bone.name = part;
		bone.position.set((offset[0] + a0[0]) * S, (offset[1] + a0[1]) * S, (offset[2] + a0[2]) * S);
		parentBone.add(bone);
		bones[part] = bone;
		pivotToCenter[part] = [-a1[0], -a1[1], -a1[2]];

		const [w, h, d] = PART_SIZES[part].map((v) => v * S);
		const isHead = part === "Head";
		const headRadius = (Math.min(w, d) / 2) * 0.98;
		const geometry = isHead
			? buildHeadGeometry(headRadius, h * 0.94, headRadius * 0.42)
			: new RoundedBoxGeometry(w * 0.995, h * 0.995, d * 0.995, 2, Math.min(w, h, d) * 0.06);
		const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: partColor(part), roughness: 0.65, metalness: 0 }));
		mesh.name = `${part}_Mesh`;
		const center = new Vector3(-a1[0] * S, -a1[1] * S, -a1[2] * S);
		mesh.position.copy(center);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.userData.boneTarget = bone;
		bone.userData.partMesh = mesh;
		bone.add(mesh);
		if (isHead) addFace(bone, center, headRadius, S);
	}

	if (wand) addWandProps(root, S);

	const rest = {};
	for (const [boneName, bone] of Object.entries(bones)) {
		rest[boneName] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
	}
	root.userData.rest = rest;
	root.userData.studs = S;
	root.userData.rigType = "R15";
	root.userData.partMeshes = Object.values(bones).map((b) => b.userData.partMesh).filter(Boolean);
	resetRigPose(root);
	return { root, bones, rest, studs: S };
}

/** Wand in the right fist plus the red spell bolt and tip flash (viewport-only effects). */
export function addWandProps(root, S) {
	const hand = root.getObjectByName("RightHand");
	if (!hand) return;

	const length = 1.15 * S;
	const wand = new Mesh(
		new CylinderGeometry(0.055 * S, 0.022 * S, length, 10),
		new MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.7 })
	);
	wand.name = "Wand";
	wand.position.set(0, -0.1316 * S + 0.12 * S - length / 2, 0);
	wand.castShadow = true;
	wand.userData.boneTarget = hand;
	hand.add(wand);

	const tip = new Object3D();
	tip.name = "WandTip";
	tip.position.set(0, -length / 2, 0);
	wand.add(tip);

	const glow = (color, opacity = 0.9) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });

	const bolt = new Group();
	bolt.name = "SpellBolt";
	const core = new Mesh(new CapsuleGeometry(0.09 * S, 1.6 * S, 6, 12), glow(0xfff1e0));
	const aura = new Mesh(new CapsuleGeometry(0.22 * S, 1.8 * S, 6, 12), glow(0xff2a1a, 0.55));
	core.rotation.x = aura.rotation.x = Math.PI / 2;
	core.raycast = aura.raycast = () => {};
	bolt.add(core, aura);
	bolt.scale.setScalar(0.0001);
	root.add(bolt);

	const flash = new Mesh(new SphereGeometry(0.35 * S, 16, 16), glow(0xff5533));
	flash.name = "SpellFlash";
	flash.raycast = () => {};
	flash.scale.setScalar(0.0001);
	root.add(flash);
}

/** Puts every bone back to its rest transform and hides the props (the Wand Cast clip shows the wand). */
export function resetRigPose(root) {
	const rest = root.userData.rest || {};
	for (const [name, r] of Object.entries(rest)) {
		const bone = root.getObjectByName(name);
		if (!bone) continue;
		bone.position.copy(r.position);
		bone.quaternion.copy(r.quaternion);
	}
	for (const fx of ["SpellBolt", "SpellFlash", "Wand"]) root.getObjectByName(fx)?.scale.setScalar(0.0001);
	root.updateMatrixWorld(true);
}

/** Selectable body meshes of the rig (part meshes, face, wand). */
export function rigPickables(root) {
	const out = [];
	root.traverse((o) => {
		if (o.isMesh && o.userData.boneTarget && o.visible) out.push(o);
	});
	return out;
}

export function disposeRig(root) {
	root.removeFromParent();
	root.traverse((o) => {
		if (o.geometry) o.geometry.dispose();
		if (o.material) for (const m of [].concat(o.material)) m.dispose();
	});
}
