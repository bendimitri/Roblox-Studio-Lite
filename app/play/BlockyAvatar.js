import {
	Bone,
	CatmullRomCurve3,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	SphereGeometry,
	TubeGeometry,
	Vector3
} from "../thirdparty/three/three.module.js";
import { OBJLoader } from "../thirdparty/three/addons/loaders/OBJLoader.js";
import { JOINTS, partColor } from "../animation/R15Rig.js";

/*
 * Default Play character: Roblox's Blocky R15 body (app/assets/characters/blocky-r15.obj, exported
 * from Studio with the HumanoidRootPart at the origin). Bones sit on the Blocky Motor6D pivots with
 * identity rest rotations, so the Animate-script KeyframeSequences drive them directly.
 */

const MODEL_URL = new URL("../assets/characters/blocky-r15.obj", import.meta.url);

/** HumanoidRootPart above the feet: HipHeight 2 + half of the 2-stud root part. */
export const BLOCKY_FEET_TO_ROOT = 3;

/** Motor6D pivots in HumanoidRootPart space (Part0 attachment of each joint). */
const PIVOTS = {
	HumanoidRootPart: [0, 0, 0],
	LowerTorso: [0, -1, 0],
	UpperTorso: [0, -0.6, 0],
	Head: [0, 1, 0],
	RightUpperArm: [1, 0.763, 0],
	RightLowerArm: [1.5, 0.035, 0],
	RightHand: [1.5, -0.725, 0],
	LeftUpperArm: [-1, 0.763, 0],
	LeftLowerArm: [-1.5, 0.035, 0],
	LeftHand: [-1.5, -0.725, 0],
	RightUpperLeg: [0.5, -1, 0],
	RightLowerLeg: [0.5, -1.822, 0],
	RightFoot: [0.5, -2.748, 0],
	LeftUpperLeg: [-0.5, -1, 0],
	LeftLowerLeg: [-0.5, -1.822, 0],
	LeftFoot: [-0.5, -2.748, 0]
};

/** Part centers in HumanoidRootPart space, used to recognise the OBJ groups (Dummy1..15). */
const CENTERS = {
	Head: [0, 1.5, 0],
	UpperTorso: [0, 0.2, 0],
	LowerTorso: [0, -0.8, 0],
	RightUpperArm: [1.5, 0.369, 0],
	RightLowerArm: [1.5, -0.224, 0],
	RightHand: [1.5, -0.85, 0],
	LeftUpperArm: [-1.5, 0.369, 0],
	LeftLowerArm: [-1.5, -0.224, 0],
	LeftHand: [-1.5, -0.85, 0],
	RightUpperLeg: [0.5, -1.421, 0],
	RightLowerLeg: [0.5, -2.201, 0],
	RightFoot: [0.5, -2.85, 0],
	LeftUpperLeg: [-0.5, -1.421, 0],
	LeftLowerLeg: [-0.5, -2.201, 0],
	LeftFoot: [-0.5, -2.85, 0]
};

let objText = null;

function loadObjText() {
	objText ||= fetch(MODEL_URL).then((r) => {
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.text();
	});
	return objText.catch((err) => {
		objText = null;
		throw err;
	});
}

function nearestPart(center) {
	let best = null;
	let bestDistance = Infinity;
	for (const [part, c] of Object.entries(CENTERS)) {
		const d = center.distanceToSquared(new Vector3(...c));
		if (d < bestDistance) {
			bestDistance = d;
			best = part;
		}
	}
	return best;
}

/** Flat decal-style face on the cube head's front (-Z). */
function addFlatFace(head) {
	const ink = new MeshBasicMaterial({ color: 0x111111 });
	const front = -0.6 - 0.006;
	const cy = CENTERS.Head[1] - PIVOTS.Head[1];
	const parts = [];
	for (const x of [-0.17, 0.17]) {
		const eye = new Mesh(new SphereGeometry(0.06, 14, 14), ink);
		eye.scale.set(1, 1.9, 0.12);
		eye.position.set(x, cy + 0.13, front);
		parts.push(eye);
	}
	const curve = [];
	for (let i = 0; i <= 20; i++) {
		const a = Math.PI * (1.18 + (0.64 * i) / 20);
		curve.push(new Vector3(Math.cos(a) * 0.28, cy + 0.02 + Math.sin(a) * 0.28, front));
	}
	const smile = new Mesh(new TubeGeometry(new CatmullRomCurve3(curve), 32, 0.028, 8, false), ink);
	smile.scale.z = 0.3;
	smile.position.z = front * 0.7;
	parts.push(smile);
	for (const p of parts) {
		p.name = "Face";
		p.userData.boneTarget = head;
		head.add(p);
	}
}

/**
 * @returns {Promise<{ root: Group, bones: Record<string, Bone>, rest: Record<string, { position: Vector3, quaternion: import("three").Quaternion }> }>}
 *          root sits at the feet, like the Rig Builder rigs.
 */
export async function buildBlockyAvatar({ name = "Blocky" } = {}) {
	const model = new OBJLoader().parse(await loadObjText());

	const root = new Group();
	root.name = name;
	const hrp = new Bone();
	hrp.name = "HumanoidRootPart";
	hrp.position.set(0, BLOCKY_FEET_TO_ROOT, 0);
	root.add(hrp);
	const bones = { HumanoidRootPart: hrp };
	for (const { part, parent } of JOINTS) {
		const bone = new Bone();
		bone.name = part;
		const p = PIVOTS[part];
		const q = PIVOTS[parent];
		bone.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
		bones[parent].add(bone);
		bones[part] = bone;
	}

	const meshes = [];
	model.traverse((o) => {
		if (o.isMesh) meshes.push(o);
	});
	const partMeshes = [];
	for (const source of meshes) {
		const geometry = source.geometry;
		geometry.computeBoundingBox();
		const part = nearestPart(geometry.boundingBox.getCenter(new Vector3()));
		const pivot = PIVOTS[part];
		geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
		if (!geometry.attributes.normal) geometry.computeVertexNormals();
		const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: partColor(part), roughness: 0.6, metalness: 0 }));
		mesh.name = `${part}_Mesh`;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.userData.boneTarget = bones[part];
		bones[part].userData.partMesh = mesh;
		bones[part].add(mesh);
		partMeshes.push(mesh);
	}
	for (const m of meshes) {
		const materials = Array.isArray(m.material) ? m.material : [m.material];
		for (const mat of materials) mat?.dispose?.();
	}
	addFlatFace(bones.Head);

	const rest = {};
	for (const [boneName, bone] of Object.entries(bones)) {
		rest[boneName] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
	}
	root.userData.rest = rest;
	root.userData.studs = 1;
	root.userData.rigType = "R15";
	root.userData.partMeshes = partMeshes;
	return { root, bones, rest };
}
