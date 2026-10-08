import { hexToColor3 } from '../rendering/Materials.js';
import { makeService, normalizeServices } from './Services.js';

/**
 * Builds a Roblox-like BasePart instance (same shape as rbxBinaryParser output).
 * @param {{ name: string, cls?: string, shape?: string, size: number[], pos: number[], color: string, material?: string, transparency?: number, rotY?: number, locked?: boolean }} spec
 * @param {{ x: number, y: number, z: number }} origin world point the spec's `pos` is relative to
 */
export function makePart(spec, origin = { x: 0, y: 0, z: 0 }) {
	const [sx, sy, sz] = spec.size;
	const x = origin.x + spec.pos[0];
	const y = origin.y + spec.pos[1];
	const z = origin.z + spec.pos[2];
	const angle = (spec.rotY || 0) * Math.PI / 180;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return {
		ClassName: spec.cls || "Part",
		Name: spec.name,
		Children: [],
		Anchored: true,
		Archivable: true,
		CanCollide: true,
		CanQuery: true,
		CanTouch: true,
		CastShadow: true,
		Locked: !!spec.locked,
		Massless: false,
		CFrame: {
			Position: { X: x, Y: y, Z: z },
			Orientation: { X: 0, Y: spec.rotY || 0, Z: 0 },
			Components: [x, y, z, c, 0, s, 0, 1, 0, -s, 0, c]
		},
		Color3: hexToColor3(spec.color),
		Material: spec.material || "Plastic",
		Reflectance: 0,
		Transparency: spec.transparency || 0,
		Shape: spec.shape || "Block",
		Size: { X: sx, Y: sy, Z: sz },
		TopSurface: "Smooth",
		BottomSurface: "Smooth",
		_baseplateGrid: !!spec.baseplateGrid
	};
}

export function makeModel(name, children = []) {
	return { ClassName: "Model", Name: name, Children: children, Archivable: true, PrimaryPart: null };
}

/** DataModel for File > New Baseplate: the 17 Studio services, in Explorer order. */
export function makeBaseplateDataModel() {
	const workspace = makeService("Workspace");
	workspace.Children.push(
		makePart({ name: "Baseplate", size: [512, 16, 512], pos: [0, -8, 0], color: "#635f62", material: "Plastic", locked: true, baseplateGrid: true }),
		makePart({ name: "SpawnLocation", cls: "SpawnLocation", size: [12, 1, 12], pos: [0, .5, 0], color: "#a3a2a5", material: "Plastic" })
	);
	return normalizeServices([workspace]).instances;
}
