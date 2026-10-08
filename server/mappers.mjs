/*
 * Adapters between RAW Roblox API responses and the engine's internal RobloxAsset model.
 * Roblox payloads are treated as unknown: every field is read defensively and may be undefined.
 * The original payloads are preserved under `raw` for debugging.
 *
 * @typedef {object} RobloxAsset
 * @property {number} id
 * @property {string} [name]
 * @property {string} [description]
 * @property {number} [assetTypeId]
 * @property {string} [assetType]       resolved Roblox type name (e.g. "Model")
 * @property {string} [importCategory]  engine category: image|mesh|model|audio|animation|unsupported
 * @property {{ id?: number, name?: string, type?: string }} [creator]
 * @property {string} [thumbnailUrl]
 * @property {boolean} [contentAvailable]
 * @property {unknown} [raw]
 */
import { assetTypeName, importCategory } from "./assetTypes.mjs";

const num = (v) => (typeof v === "number" ? v : (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined));
const str = (v) => (typeof v === "string" && v !== "" ? v : undefined);
const pick = (obj, ...keys) => { for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]; return undefined; };

/** Whether asset-delivery metadata indicates downloadable content. */
function hasContent(delivery) {
	return Boolean(delivery && delivery.locations && delivery.locations[0] && delivery.locations[0].location);
}

/** Maps a raw creator object (legacy or search shape) to our internal creator. */
function mapCreator(raw) {
	if (!raw || typeof raw !== "object") return undefined;
	const id = num(pick(raw, "Id", "id", "CreatorTargetId", "creatorTargetId", "targetId"));
	const name = str(pick(raw, "Name", "name", "username"));
	const type = str(pick(raw, "CreatorType", "type", "creatorType"));
	if (id === undefined && name === undefined && type === undefined) return undefined;
	return { id, name, type };
}

/**
 * Builds a RobloxAsset from a direct-by-id lookup (asset-delivery + best-effort legacy details).
 * @param {number} id
 * @param {any} delivery raw asset-delivery metadata (may be null)
 * @param {any} legacy raw economy details (may be null)
 * @returns {RobloxAsset}
 */
export function mapAssetDetails(id, delivery, legacy) {
	const assetTypeId = num(pick(legacy || {}, "AssetTypeId", "assetTypeId")) ?? num(pick(delivery || {}, "assetTypeId"));
	const typeName = assetTypeName(assetTypeId);
	return {
		id,
		name: str(pick(legacy || {}, "Name", "name")),
		description: str(pick(legacy || {}, "Description", "description")),
		assetTypeId,
		assetType: typeName,
		importCategory: importCategory(typeName),
		creator: mapCreator(legacy && (legacy.Creator || legacy.creator)),
		contentAvailable: hasContent(delivery),
		raw: { delivery: delivery ?? null, legacy: legacy ?? null }
	};
}

/**
 * Maps one Creator Store search item (`creatorStoreAssets[i]`) to a RobloxAsset.
 * The item nests `asset`, `creator`, `creatorStoreProduct`, `voting`.
 * @param {any} item
 * @returns {RobloxAsset}
 */
export function mapSearchItem(item) {
	const a = (item && (item.asset || item.Asset)) || item || {};
	const assetTypeId = num(pick(a, "assetTypeId", "AssetTypeId", "typeId"));
	// Search items may carry the type as a numeric id OR as a string enum ("Model", "Decal", …).
	const typeStr = str(pick(a, "assetType", "AssetType", "type"));
	const typeName = assetTypeId !== undefined ? assetTypeName(assetTypeId) : (typeStr || assetTypeName(num(pick(a, "assetType"))));
	return {
		id: num(pick(a, "id", "Id", "assetId", "AssetId")),
		name: str(pick(a, "name", "Name")),
		description: str(pick(a, "description", "Description")),
		assetTypeId,
		assetType: typeName,
		importCategory: importCategory(typeName),
		creator: mapCreator(item && (item.creator || item.Creator)) || mapCreator(a && (a.creator || a.Creator)),
		contentAvailable: undefined,
		raw: item
	};
}

/**
 * Maps the whole SearchCreatorStoreAssetsResponse to the engine's internal paginated shape.
 * @param {any} json raw response
 * @returns {{ items: RobloxAsset[], nextCursor?: string, totalResults?: number, filteredKeyword?: string, raw: unknown }}
 */
export function mapSearchResponse(json) {
	const list = (json && (json.creatorStoreAssets || json.data || json.assets)) || [];
	return {
		items: Array.isArray(list) ? list.map(mapSearchItem).filter((x) => x.id !== undefined) : [],
		nextCursor: str(json && (json.nextPageToken || json.nextCursor)),
		totalResults: num(json && json.totalResults),
		filteredKeyword: str(json && json.filteredKeyword),
		raw: json
	};
}
