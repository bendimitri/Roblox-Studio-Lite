/*
 * Local copies of Roblox assets downloaded by tools/fetch-assets.mjs into asset/.
 * asset/index.json: { "<assetid>": { kind: "image"|"mesh"|"sound"|"animation", file, thumbnail? } }
 */

const ID_PATTERN = /(?:rbxassetid:\/\/|roblox\.com\/asset\/?\?id=|[?&]id=)(\d+)/i;

let entries = {};
const listeners = new Set();

export const assetIndexReady = fetch("asset/index.json", { cache: "no-cache" })
	.then((r) => (r.ok ? r.json() : {}))
	.catch(() => ({}))
	.then((map) => {
		entries = map || {};
		for (const fn of listeners) fn();
		return entries;
	});

/** Calls fn once the index has loaded (immediately re-runs are the caller's concern). */
export function onAssetIndex(fn) {
	listeners.add(fn);
}

/** "rbxassetid://123", "http://www.roblox.com/asset/?id=123", 123 -> "123" (or null). */
export function assetIdOf(content) {
	if (typeof content === "number") return String(content);
	const m = String(content || "").match(ID_PATTERN);
	return m ? m[1] : null;
}

/** Index entry for a content id, or null when it was never downloaded. */
export function localAsset(content, kind) {
	const id = assetIdOf(content);
	const entry = id && entries[id];
	if (!entry || (kind && entry.kind !== kind)) return null;
	return { id, url: `asset/${entry.file}`, ...entry };
}
