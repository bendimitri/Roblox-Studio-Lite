/*
 * Central, API-faithful property schema for the Properties panel. Each ClassName lists only its own
 * properties; inheritance is resolved through the real Roblox class chain (ApiSchema), so a Part
 * shows Part + BasePart + Instance properties grouped exactly as Roblox Studio does.
 *
 * The schema is pure metadata (name, group, type, options, bounds). app.js binds each entry to the
 * selected instance and its THREE mesh to build the live editors.
 */
import { API_CLASSES } from "./ApiSchema.js";

/** Enum.Material browsable values (Studio 0.742+). Air/Water are NotBrowsable and excluded. */
export const MATERIAL_ENUM = [
	"Plastic", "SmoothPlastic", "Neon", "Wood", "WoodPlanks", "Marble", "Slate",
	"Concrete", "Granite", "Brick", "Pebble", "Cobblestone", "Metal", "CorrodedMetal",
	"DiamondPlate", "Foil", "Grass", "LeafyGrass", "Ice", "Glacier", "Sand", "Sandstone",
	"Rock", "Salt", "Snow", "Mud", "Ground", "Limestone", "Basalt", "Asphalt", "CrackedLava",
	"Pavement", "Fabric", "Glass", "ForceField",
	"Cardboard", "Carpet", "CeramicTiles", "ClayRoofTiles", "Leather", "Plaster", "RoofShingles", "Rubber"
];

export const RIG_TYPE_ENUM = ["R6", "R15"];
export const SHAPE_ENUM = ["Ball", "Block", "Cylinder", "Wedge", "CornerWedge"];
export const NORMAL_ID_ENUM = ["Top", "Bottom", "Back", "Front", "Left", "Right"];
export const TECHNOLOGY_ENUM = ["Legacy", "Compatibility", "Voxel", "ShadowMap", "Future"];

/** Group order in the panel. Only the groups a class actually fills are shown. */
export const GROUP_ORDER = ["Appearance", "Data", "Transform", "Pivot", "Collision", "Part", "Game", "Behavior"];

/**
 * Per-class own properties.
 * type: string | number | int | float01 | bool | enum | Color3 | BrickColor | path | primarypart | Vector3 | CFrame
 * field: record key when it differs from the displayed Roblox name (e.g. Color -> Color3).
 */
const OWN = {
	Instance: [
		{ name: "Archivable", group: "Data", type: "bool", default: true },
		{ name: "ClassName", group: "Data", type: "string", readOnly: true },
		{ name: "Name", group: "Data", type: "string" },
		{ name: "Parent", group: "Data", type: "path", readOnly: true }
	],
	BasePart: [
		{ name: "BrickColor", group: "Appearance", type: "BrickColor", readOnly: true },
		{ name: "CastShadow", group: "Appearance", type: "bool", default: true },
		{ name: "Color", group: "Appearance", type: "Color3", field: "Color3" },
		{ name: "Material", group: "Appearance", type: "enum", options: MATERIAL_ENUM, default: "Plastic" },
		{ name: "MaterialVariant", group: "Appearance", type: "string", default: "" },
		{ name: "Reflectance", group: "Appearance", type: "float01", default: 0 },
		{ name: "Transparency", group: "Appearance", type: "float01", default: 0 },
		{ name: "Locked", group: "Data", type: "bool", default: false },
		{ name: "Size", group: "Transform", type: "Vector3" },
		{ name: "CFrame", group: "Transform", type: "CFrame" },
		{ name: "Anchored", group: "Collision", type: "bool", default: false },
		{ name: "CanCollide", group: "Collision", type: "bool", default: true },
		{ name: "Massless", group: "Collision", type: "bool", default: false }
	],
	Part: [
		{ name: "Shape", group: "Part", type: "enum", options: SHAPE_ENUM, default: "Block" }
	],
	Model: [
		{ name: "PrimaryPart", group: "Data", type: "primarypart" },
		{ name: "WorldPivot", group: "Pivot", type: "CFrame" }
	],
	Humanoid: [
		{ name: "DisplayName", group: "Data", type: "string", default: "" },
		{ name: "RigType", group: "Game", type: "enum", options: RIG_TYPE_ENUM, default: "R15" },
		{ name: "Health", group: "Game", type: "number", default: 100, min: 0 },
		{ name: "MaxHealth", group: "Game", type: "number", default: 100, min: 0 },
		{ name: "WalkSpeed", group: "Game", type: "number", default: 16, min: 0 },
		{ name: "JumpPower", group: "Game", type: "number", default: 50, min: 0 },
		{ name: "AutoRotate", group: "Game", type: "bool", default: true },
		{ name: "PlatformStand", group: "Behavior", type: "bool", default: false }
	],
	Light: [
		{ name: "Brightness", group: "Appearance", type: "number", default: 1, min: 0, max: 20 },
		{ name: "Color", group: "Appearance", type: "Color3", field: "Color" },
		{ name: "Enabled", group: "Appearance", type: "bool", default: true },
		{ name: "Shadows", group: "Appearance", type: "bool", default: true }
	],
	PointLight: [
		{ name: "Range", group: "Appearance", type: "number", default: 32, min: 0, max: 60 }
	],
	SpotLight: [
		{ name: "Range", group: "Appearance", type: "number", default: 40, min: 0, max: 60 },
		{ name: "Angle", group: "Appearance", type: "number", default: 90, min: 0, max: 180 },
		{ name: "Face", group: "Appearance", type: "enum", options: NORMAL_ID_ENUM, default: "Bottom" }
	],
	SurfaceLight: [
		{ name: "Range", group: "Appearance", type: "number", default: 32, min: 0, max: 60 },
		{ name: "Angle", group: "Appearance", type: "number", default: 90, min: 0, max: 180 },
		{ name: "Face", group: "Appearance", type: "enum", options: NORMAL_ID_ENUM, default: "Bottom" }
	],
	Lighting: [
		{ name: "Technology", group: "Appearance", type: "enum", options: TECHNOLOGY_ENUM, default: "Future" },
		{ name: "Ambient", group: "Appearance", type: "Color3", field: "Ambient" },
		{ name: "OutdoorAmbient", group: "Appearance", type: "Color3", field: "OutdoorAmbient" },
		{ name: "ColorShift_Top", group: "Appearance", type: "Color3", field: "ColorShift_Top" },
		{ name: "ColorShift_Bottom", group: "Appearance", type: "Color3", field: "ColorShift_Bottom" },
		{ name: "Brightness", group: "Appearance", type: "number", default: 2, min: 0, max: 10 },
		{ name: "EnvironmentDiffuseScale", group: "Appearance", type: "number", default: 1, min: 0, max: 1 },
		{ name: "EnvironmentSpecularScale", group: "Appearance", type: "number", default: 1, min: 0, max: 1 },
		{ name: "GlobalShadows", group: "Appearance", type: "bool", default: true },
		{ name: "ShadowSoftness", group: "Appearance", type: "number", default: 0.2, min: 0, max: 1 },
		{ name: "ClockTime", group: "Data", type: "number", default: 14, min: 0, max: 24 },
		{ name: "TimeOfDay", group: "Data", type: "string", default: "14:00:00" },
		{ name: "GeographicLatitude", group: "Data", type: "number", default: 41.73, min: -90, max: 90 },
		{ name: "ExposureCompensation", group: "Exposure", type: "number", default: 0, min: -5, max: 5 },
		{ name: "FogColor", group: "Fog", type: "Color3", field: "FogColor" },
		{ name: "FogStart", group: "Fog", type: "number", default: 0, min: 0, max: 100000 },
		{ name: "FogEnd", group: "Fog", type: "number", default: 100000, min: 0, max: 100000 }
	]
};

/** Superclass chain (self first), via the real API dump. */
function chainOf(className) {
	const chain = [];
	for (let c = className; c && API_CLASSES[c]; c = API_CLASSES[c].s) chain.push(c);
	if (!chain.length) chain.push(className, "Instance");
	else if (chain[chain.length - 1] !== "Instance") chain.push("Instance");
	return chain;
}

/** True when `className` is, or inherits from, `base`. */
export function isA(className, base) {
	return chainOf(className).includes(base);
}

/** The panel knows a curated schema for parts, models, lights and humanoids. Others fall back to the raw view. */
export function hasSchema(className) {
	return isA(className, "BasePart") || isA(className, "Model") || isA(className, "Humanoid")
		|| isA(className, "Light") || className === "Lighting";
}

/**
 * Ordered, de-duplicated property groups for a class.
 * @returns {{ name: string, props: Array<object> }[]}
 */
export function propertyGroupsFor(className) {
	const chain = chainOf(className).reverse(); // Instance first, most-derived last
	const seen = new Set();
	const byGroup = new Map();
	for (const cls of chain) {
		const own = OWN[cls];
		if (!own) continue;
		for (const prop of own) {
			if (seen.has(prop.name)) continue;
			seen.add(prop.name);
			if (!byGroup.has(prop.group)) byGroup.set(prop.group, []);
			byGroup.get(prop.group).push(prop);
		}
	}
	const groups = [];
	for (const name of GROUP_ORDER) {
		const props = byGroup.get(name);
		if (props && props.length) groups.push({ name, props });
	}
	return groups;
}
