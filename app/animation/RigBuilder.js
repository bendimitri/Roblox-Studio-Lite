import { Bone, Euler, Group, Mesh, MeshStandardMaterial, Vector3 } from "../thirdparty/three/three.module.js";
import { RoundedBoxGeometry } from "../thirdparty/three/addons/geometries/RoundedBoxGeometry.js";
import { addFace, buildHeadGeometry, buildR15Rig, partColor, resetRigPose } from "./R15Rig.js";
import { RIG_SPECS } from "./RigSpecs.js";
import { hexToColor3 } from "../rendering/Materials.js";

/*
 * Rig Builder: spawns Roblox-style dummies. Each dummy exists twice, kept in sync:
 *  - THREE side: Group (userData.isAnimRig) > Bone hierarchy on the Motor6D pivots,
 *    part meshes under their bone. This is what the AnimationMixer drives.
 *  - DataModel side: Model > Humanoid > Animator, Parts and Motor6D instances, shown
 *    in the Explorer. Every instance carries a non-enumerable `__three` link back to
 *    the object it stands for (rig root or bone), so Explorer selection resolves.
 */

/** Classic R6 body: 6 parts, pivots only at the neck, shoulders and hips. */
export function buildR6Rig({ name = "R6 Rig" } = {}) {
	const spec = RIG_SPECS.R6;
	const root = new Group();
	root.name = name;
	root.userData.isAnimRig = true;

	const hrp = new Bone();
	hrp.name = "HumanoidRootPart";
	hrp.position.set(0, spec.feetToRoot, 0);
	root.add(hrp);

	const bones = { HumanoidRootPart: hrp };
	const pivotToCenter = { HumanoidRootPart: [0, 0, 0] };
	for (const { part, parent, a0, a1 } of spec.joints) {
		const offset = pivotToCenter[parent];
		const bone = new Bone();
		bone.name = part;
		bone.position.set(offset[0] + a0[0], offset[1] + a0[1], offset[2] + a0[2]);
		bones[parent].add(bone);
		bones[part] = bone;
		pivotToCenter[part] = [-a1[0], -a1[1], -a1[2]];

		const [w, h, d] = spec.sizes[part];
		const center = new Vector3(-a1[0], -a1[1], -a1[2]);
		const isHead = part === "Head";
		// The R6 head is a 2x1x1 part rendered with the classic 1.25x head mesh.
		const headRadius = 0.6;
		const geometry = isHead
			? buildHeadGeometry(headRadius, 1.2, headRadius * 0.42)
			: new RoundedBoxGeometry(w * 0.995, h * 0.995, d * 0.995, 2, Math.min(w, h, d) * 0.05);
		const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: partColor(part), roughness: 0.65, metalness: 0 }));
		mesh.name = `${part}_Mesh`;
		mesh.position.copy(center);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.userData.boneTarget = bone;
		bone.userData.partMesh = mesh;
		bone.add(mesh);
		if (isHead) addFace(bone, center, headRadius, 1);
	}

	const rest = {};
	for (const [boneName, bone] of Object.entries(bones)) rest[boneName] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
	root.userData.rest = rest;
	root.userData.studs = 1;
	root.userData.rigType = "R6";
	root.userData.partMeshes = Object.values(bones).map((b) => b.userData.partMesh).filter(Boolean);
	resetRigPose(root);
	return { root, bones, rest, studs: 1 };
}

const link = (instance, object) => Object.defineProperty(instance, "__three", { value: object, enumerable: false, configurable: true });

const _e = new Euler();
/** Roblox CFrame record (row-major rotation) from a THREE world matrix. */
function cframeFromMatrix(m) {
	const e = m.elements;
	_e.setFromRotationMatrix(m, "YXZ");
	const deg = (r) => Math.round((r * 180 / Math.PI) * 1000) / 1000;
	return {
		Position: { X: e[12], Y: e[13], Z: e[14] },
		Orientation: { X: deg(_e.x), Y: deg(_e.y), Z: deg(_e.z) },
		Components: [e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
	};
}

const localCFrame = ([x, y, z]) => ({ Position: { X: x, Y: y, Z: z }, Components: [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1] });

function makeBodyPart(name, size, color, transparent) {
	return {
		ClassName: "Part",
		Name: name,
		Children: [],
		Anchored: name === "HumanoidRootPart",
		Archivable: true,
		CanCollide: name === "HumanoidRootPart" || name.includes("Torso"),
		CanQuery: true,
		CanTouch: true,
		CastShadow: !transparent,
		Locked: false,
		Massless: false,
		CFrame: localCFrame([0, 0, 0]),
		Color3: hexToColor3(`#${color.toString(16).padStart(6, "0")}`),
		Material: "SmoothPlastic",
		Reflectance: 0,
		Transparency: transparent ? 1 : 0,
		Shape: "Block",
		Size: { X: size[0], Y: size[1], Z: size[2] },
		TopSurface: "Smooth",
		BottomSurface: "Smooth"
	};
}

/**
 * Builds a complete dummy (THREE rig + DataModel tree).
 * @param {"R6"|"R15"} rigType
 * @returns {{ root: Group, instance: object, humanoid: object, rigType: string, partInstances: Record<string, object> }}
 */
export function buildDummy(rigType, { name } = {}) {
	const spec = RIG_SPECS[rigType];
	if (!spec) throw new Error(`RigType desconhecido: ${rigType}`);
	const displayName = name || (rigType === "R6" ? "Dummy R6" : "Dummy R15");
	const { root, bones } = rigType === "R6" ? buildR6Rig({ name: displayName }) : buildR15Rig({ name: displayName, studs: 1 });

	const humanoid = {
		ClassName: "Humanoid",
		Name: "Humanoid",
		Children: [],
		Archivable: true,
		RigType: rigType,
		DisplayName: displayName,
		Health: 100,
		MaxHealth: 100,
		WalkSpeed: 16,
		JumpPower: 50,
		JumpHeight: 7.2,
		UseJumpPower: true,
		HipHeight: spec.hipHeight,
		AutoRotate: true,
		RequiresNeck: true,
		BreakJointsOnDeath: true,
		DisplayDistanceType: "Viewer",
		HealthDisplayType: "DisplayWhenDamaged"
	};
	const animator = { ClassName: "Animator", Name: "Animator", Children: [], Archivable: true, PreferLodEnabled: true };
	humanoid.Children.push(animator);

	const partInstances = {};
	for (const boneName of spec.bones) {
		const mesh = bones[boneName].userData.partMesh;
		const color = mesh ? mesh.material.color.getHex() : 0xa3a2a5;
		const part = makeBodyPart(boneName, spec.sizes[boneName], color, boneName === "HumanoidRootPart");
		partInstances[boneName] = part;
		link(part, bones[boneName]);
		bones[boneName].userData.rbx = part;
	}
	const face = { ClassName: "Decal", Name: "face", Children: [], Archivable: true, Face: "Front", Texture: "rbxasset://textures/face.png", Transparency: 0 };
	partInstances.Head.Children.push(face);
	link(face, bones.Head);

	for (const joint of spec.joints) {
		const motor = {
			ClassName: "Motor6D",
			Name: joint.motor,
			Children: [],
			Archivable: true,
			Enabled: true,
			Part0: joint.parent,
			Part1: joint.part,
			C0: localCFrame(joint.a0),
			C1: localCFrame(joint.a1),
			MaxVelocity: 0.1,
			CurrentAngle: 0,
			DesiredAngle: 0
		};
		link(motor, bones[joint.part]);
		partInstances[spec.motorIn === "Part0" ? joint.parent : joint.part].Children.push(motor);
	}

	const model = {
		ClassName: "Model",
		Name: displayName,
		Children: [humanoid, ...spec.bones.map((b) => partInstances[b])],
		Archivable: true,
		PrimaryPart: "HumanoidRootPart",
		ModelStreamingMode: "Default"
	};
	link(model, root);
	link(humanoid, root);
	link(animator, root);

	root.userData.rbx = model;
	root.userData.humanoid = humanoid;
	return { root, instance: model, humanoid, rigType, partInstances };
}

/** Writes the current world transforms of the rig's parts back into their CFrame properties. */
export function syncRigInstances(root) {
	root.updateMatrixWorld(true);
	root.traverse((o) => {
		const part = o.isBone ? o.userData.rbx : null;
		if (!part) return;
		part.CFrame = cframeFromMatrix((o.userData.partMesh || o).matrixWorld);
	});
	const model = root.userData.rbx;
	if (model) model.WorldPivot = cframeFromMatrix(root.matrixWorld);
}

/** Humanoid of a Model instance, if any (Roblox: Model:FindFirstChildOfClass("Humanoid")). */
export function findHumanoid(instance) {
	return instance && instance.Children ? instance.Children.find((c) => c.ClassName === "Humanoid") || null : null;
}
