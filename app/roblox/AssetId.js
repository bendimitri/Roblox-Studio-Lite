/*
 * Shared, dependency-free Roblox Asset ID helpers. Pure functions only (no DOM, no network),
 * so the same module is imported by the browser frontend and by the Node backend/tests.
 */

// Roblox asset IDs are positive integers. Real IDs are well under this bound; anything larger is
// almost certainly a typo/garbage and is rejected to avoid absurd values.
const MAX_ASSET_ID = 1e15;

/** Patterns that carry an asset id, most specific first. */
const PATTERNS = [
	/^\s*(\d{1,16})\s*$/i,                                   // "123456789"
	/rbxassetid:\/\/(\d{1,16})/i,                            // rbxassetid://123456789
	/rbxthumb:\/\/[^&]*?[?&]?id=(\d{1,16})/i,                // rbxthumb://type=Asset&id=123...
	/roblox\.com\/library\/(\d{1,16})/i,                     // .../library/123/Name
	/roblox\.com\/catalog\/(\d{1,16})/i,                     // .../catalog/123
	/create\.roblox\.com\/(?:store|marketplace)\/asset\/(\d{1,16})/i, // create.roblox.com/store/asset/123
	/roblox\.com\/asset\/?\?[^#]*\bid=(\d{1,16})/i,          // .../asset/?id=123
	/[?&]id=(\d{1,16})(?:\b|&|$)/i                           // generic ?id=123 fallback
];

/**
 * Resolve a Roblox Asset ID supplied by the user.
 * Accepts a bare numeric id, `rbxassetid://`, `rbxthumb://`, and roblox.com / create.roblox.com URLs.
 * @param {string|number} input
 * @returns {number|null} the numeric asset id, or null when nothing valid is found
 */
export function normalizeAssetId(input) {
	if (input === null || input === undefined) return null;
	if (typeof input === "number") return isValidId(input) ? input : null;
	if (typeof input !== "string") return null;
	const text = input.trim();
	if (!text) return null;
	for (const pattern of PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			const id = Number(match[1]);
			if (isValidId(id)) return id;
		}
	}
	return null;
}

/** True when `value` is a positive, in-range integer asset id. */
export function isValidId(value) {
	return Number.isInteger(value) && value > 0 && value < MAX_ASSET_ID;
}

/**
 * Decide whether a toolbox query should be treated as a direct asset lookup or a text search.
 * @param {string} input
 * @returns {{ kind: "id", assetId: number } | { kind: "query", query: string }}
 */
export function classifyQuery(input) {
	const assetId = normalizeAssetId(input);
	if (assetId !== null) return { kind: "id", assetId };
	return { kind: "query", query: String(input || "").trim() };
}
