/*
 * MeshImporter — loads external 3D files (FBX, OBJ, GLTF/GLB, STL) and flattens them into the
 * engine's mesh representation: non-indexed { positions, normal, uv } arrays plus the real-world
 * bounding size. The engine renders a MeshPart from a single geometry + material, so all sub-meshes
 * are baked into one geometry (world matrices applied) and textures/per-material data are dropped —
 * the imported part uses a neutral color/material the user can edit afterwards.
 */
import { Box3, Vector3 } from '../thirdparty/three/three.core.js';

/** Extensions we can import, with friendly labels (used for the file picker and messages). */
export const SUPPORTED_3D = [
	{ ext: "fbx", label: "FBX" },
	{ ext: "obj", label: "OBJ" },
	{ ext: "gltf", label: "glTF" },
	{ ext: "glb", label: "glTF binário (GLB)" },
	{ ext: "stl", label: "STL" }
];

export const SUPPORTED_3D_ACCEPT = SUPPORTED_3D.map((f) => `.${f.ext}`).join(",");

/** Lowercased file extension (without the dot). */
export function extensionOf(name) {
	const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
	return m ? m[1] : "";
}

/** True when the file name looks like a 3D model we can import. */
export function is3DModelFile(name) {
	const ext = extensionOf(name);
	return SUPPORTED_3D.some((f) => f.ext === ext);
}

/**
 * Parse a 3D file into a THREE Object3D hierarchy.
 * @param {string} ext @param {ArrayBuffer} buffer @param {string} name
 * @returns {Promise<import('../thirdparty/three/three.core.js').Object3D>}
 */
async function loadObject(ext, buffer, name) {
	switch (ext) {
		case "obj": {
			const { OBJLoader } = await import('../thirdparty/three/addons/loaders/OBJLoader.js');
			return new OBJLoader().parse(new TextDecoder().decode(buffer));
		}
		case "stl": {
			const { STLLoader } = await import('../thirdparty/three/addons/loaders/STLLoader.js');
			const geometry = new STLLoader().parse(buffer);
			// Wrap the bare geometry in a mesh-like holder so the collector can treat it uniformly.
			return { isObject3D: true, children: [{ isMesh: true, geometry, matrixWorld: null }], updateMatrixWorld() {} };
		}
		case "fbx": {
			const { FBXLoader } = await import('../thirdparty/three/addons/loaders/FBXLoader.js');
			return new FBXLoader().parse(buffer, "");
		}
		case "gltf":
		case "glb": {
			const { GLTFLoader } = await import('../thirdparty/three/addons/loaders/GLTFLoader.js');
			return await new Promise((resolve, reject) => {
				new GLTFLoader().parse(ext === "glb" ? buffer : new TextDecoder().decode(buffer), "", (gltf) => resolve(gltf.scene), reject);
			});
		}
		default:
			throw new Error(`Formato não suportado: .${ext}`);
	}
}

/**
 * Walks an Object3D, baking every mesh into one set of non-indexed { positions, normal, uv } arrays
 * (uv is stored with 3 components per vertex to match the engine's MeshPart pipeline), then centers
 * the geometry at the origin and reports its real size.
 * @returns {{ positions: number[], normal: number[], uv: number[], size: {X:number,Y:number,Z:number}, triangles: number }}
 */
function collectGeometry(object) {
	if (object.updateMatrixWorld) object.updateMatrixWorld(true);
	const positions = [];
	const normal = [];
	const uv = [];

	const visit = (node) => {
		if (node.isMesh && node.geometry) bakeMesh(node, positions, normal, uv);
		if (node.children) for (const child of node.children) visit(child);
	};
	visit(object);

	if (positions.length === 0) throw new Error("Nenhuma geometria encontrada no arquivo.");

	const box = new Box3();
	const v = new Vector3();
	for (let i = 0; i < positions.length; i += 3) box.expandByPoint(v.set(positions[i], positions[i + 1], positions[i + 2]));
	const center = box.getCenter(new Vector3());
	const sizeV = box.getSize(new Vector3());
	// Center the geometry so the part's CFrame.Position sits at its middle.
	for (let i = 0; i < positions.length; i += 3) {
		positions[i] -= center.x;
		positions[i + 1] -= center.y;
		positions[i + 2] -= center.z;
	}
	return {
		positions,
		normal,
		uv,
		size: { X: Math.max(sizeV.x, 1e-4), Y: Math.max(sizeV.y, 1e-4), Z: Math.max(sizeV.z, 1e-4) },
		triangles: positions.length / 9
	};
}

/** Append one mesh's world-space triangles to the shared arrays. */
function bakeMesh(mesh, positions, normal, uv) {
	let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
	if (mesh.matrixWorld) geo.applyMatrix4(mesh.matrixWorld);
	if (!geo.attributes.normal) geo.computeVertexNormals();
	const pos = geo.attributes.position;
	const nrm = geo.attributes.normal;
	const tex = geo.attributes.uv;
	for (let i = 0; i < pos.count; i++) {
		positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
		normal.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
		uv.push(tex ? tex.getX(i) : 0, tex ? tex.getY(i) : 0, 0);
	}
	geo.dispose();
}

/**
 * Import a 3D model File into the engine's mesh geometry format.
 * @param {File} file @returns {Promise<{ positions:number[], normal:number[], uv:number[], size:{X:number,Y:number,Z:number}, triangles:number, name:string }>}
 */
export async function importModelFile(file) {
	const ext = extensionOf(file.name);
	if (!SUPPORTED_3D.some((f) => f.ext === ext)) throw new Error(`Formato não suportado: .${ext || "?"}`);
	const buffer = await file.arrayBuffer();
	let object;
	try {
		object = await loadObject(ext, buffer, file.name);
	} catch (err) {
		throw new Error(`Não foi possível ler o arquivo .${ext}: ${err && err.message ? err.message : err}`);
	}
	const geo = collectGeometry(object);
	geo.name = file.name.replace(/\.[^.]+$/, "") || "ImportedMesh";
	return geo;
}
