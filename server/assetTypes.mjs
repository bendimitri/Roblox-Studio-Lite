/*
 * Roblox Enum.AssetType ids we care about, and how each maps to an engine import category.
 * Source: Roblox AssetType enum (create.roblox.com). Only the ids the proxy/importers use are listed;
 * unknown ids fall back to category "other".
 */

/** assetTypeId -> human-readable Roblox asset type name. */
export const ASSET_TYPE_NAMES = {
	1: "Image",
	3: "Audio",
	4: "Mesh",
	8: "Hat",
	10: "Model",
	13: "Decal",
	18: "Face",
	19: "Gear",
	24: "Animation",
	38: "Plugin",
	40: "MeshPart",
	62: "Video"
};

/**
 * Engine import category per Roblox asset type name. "unsupported" assets still show metadata +
 * preview but return a clear "no importer" message instead of being inserted.
 * @type {Record<string, "image"|"mesh"|"model"|"audio"|"animation"|"unsupported">}
 */
export const IMPORT_CATEGORY = {
	Image: "image",
	Decal: "image",
	Mesh: "mesh",
	MeshPart: "mesh",
	Model: "model",
	Hat: "model",
	Gear: "model",
	Audio: "audio",
	Animation: "animation",
	Video: "unsupported",
	Plugin: "unsupported",
	Face: "image"
};

/** Resolve a numeric assetTypeId to its type name (or undefined). */
export function assetTypeName(assetTypeId) {
	return assetTypeId == null ? undefined : ASSET_TYPE_NAMES[assetTypeId];
}

/** Resolve an engine import category from a type name (default "unsupported"). */
export function importCategory(typeName) {
	return (typeName && IMPORT_CATEGORY[typeName]) || "unsupported";
}
