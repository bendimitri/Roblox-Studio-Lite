/*
 * RobloxClient — the ONLY place that talks to official Roblox APIs. Credentials come from env and
 * never leave the server. Uses the documented domains:
 *   - Asset Delivery:  https://assetdelivery.roblox.com/v2/assetId/{id}         (cookie / public)
 *                      https://apis.roblox.com/asset-delivery-api/v1/assetId/{id} (x-api-key)
 *   - Thumbnails:      https://thumbnails.roblox.com/v1/assets                   (public)
 *   - Creator Store:   https://apis.roblox.com/toolbox-service/v2/assets:search  (x-api-key)
 *   - Legacy details:  https://economy.roblox.com/v2/assets/{id}/details         (best-effort)
 *
 * Every request has a timeout + AbortController. Upstream failures are translated to ApiError.
 */
import { gunzipSync } from "node:zlib";
import { config } from "./env.mjs";
import { ApiError, fromStatus, timeoutError, noContentError } from "./errors.mjs";

const ID_PATTERN = /(?:rbxassetid:\/\/|roblox\.com\/asset\/?\?id=|[?&]id=)(\d{3,})/gi;

/** fetch() with an AbortController-based timeout; maps aborts to a friendly timeout error. */
async function fetchWithTimeout(url, options = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (err) {
		if (err && err.name === "AbortError") throw timeoutError();
		throw new ApiError(502, "network", "Roblox está temporariamente indisponível.", err && err.message);
	} finally {
		clearTimeout(timer);
	}
}

function cookieHeader() {
	if (!config.cookie) return {};
	return { Cookie: `.ROBLOSECURITY=${config.cookie.replace(/^\.ROBLOSECURITY=/, "")}` };
}

export class RobloxClient {
	/**
	 * Low-level asset-delivery metadata lookup. Returns the raw JSON (locations, assetTypeId, errors).
	 * Prefers the Open Cloud endpoint when an API key is set; otherwise the public/cookie endpoint.
	 * @param {number} id
	 */
	async getAssetDelivery(id) {
		const url = config.apiKey
			? `https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`
			: `https://assetdelivery.roblox.com/v2/assetId/${id}`;
		const headers = config.apiKey ? { "x-api-key": config.apiKey } : cookieHeader();
		const res = await fetchWithTimeout(url, { headers });
		if (!res.ok) throw fromStatus(res.status, `asset-delivery ${id}`);
		return res.json();
	}

	/**
	 * Best-effort legacy metadata (Name, Description, Creator, AssetTypeId). Public assets usually
	 * work without auth; on any failure we resolve to null so callers can degrade gracefully.
	 * @param {number} id
	 */
	async getLegacyDetails(id) {
		try {
			const res = await fetchWithTimeout(`https://economy.roblox.com/v2/assets/${id}/details`, { headers: cookieHeader() });
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	}

	/**
	 * Public thumbnail rendition for one or more asset ids.
	 * @param {number[]} ids
	 * @param {string} size e.g. "420x420"
	 * @returns {Promise<Map<number, string>>} id -> imageUrl (only Completed renditions)
	 */
	async getThumbnails(ids, size = "420x420") {
		if (!ids.length) return new Map();
		const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${ids.join(",")}&size=${encodeURIComponent(size)}&format=Png&isCircular=false`;
		const res = await fetchWithTimeout(url);
		if (!res.ok) throw fromStatus(res.status, "thumbnails");
		const json = await res.json();
		const map = new Map();
		for (const t of json.data || []) {
			if (t && t.state === "Completed" && t.imageUrl) map.set(Number(t.targetId), t.imageUrl);
		}
		return map;
	}

	/**
	 * Downloads the real asset bytes (follows the delivery `location`, gunzips if needed).
	 * Unwraps Decal/Image wrapper XML (assetTypeId 13) to the inner image once.
	 * @param {number} id
	 * @returns {Promise<{ bytes: Buffer, assetTypeId: number|undefined }>}
	 */
	async getAssetContent(id, depth = 0) {
		const meta = await this.getAssetDelivery(id);
		const location = meta && meta.locations && meta.locations[0] && meta.locations[0].location;
		if (!location) {
			const msg = meta && meta.errors && meta.errors[0] && meta.errors[0].message;
			throw noContentError(msg);
		}
		const res = await fetchWithTimeout(location);
		if (!res.ok) throw fromStatus(res.status, `content ${id}`);
		let bytes = Buffer.from(await res.arrayBuffer());
		if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
		// Decal/Image wrapper: the XML references the real underlying image asset.
		if (meta.assetTypeId === 13 && depth < 2 && bytes.toString("latin1", 0, 16).startsWith("<roblox")) {
			const inner = [...bytes.toString("latin1").matchAll(ID_PATTERN)].map((m) => m[1]).find((x) => String(x) !== String(id));
			if (inner) return this.getAssetContent(Number(inner), depth + 1);
		}
		return { bytes, assetTypeId: meta.assetTypeId };
	}

	/**
	 * Creator Store search (official Open Cloud, BETA). Requires an API key.
	 * POST https://apis.roblox.com/toolbox-service/v2/assets:search with a JSON body
	 * (SearchCreatorStoreAssetsRequest) — the recommended variant per the current docs.
	 * @param {Record<string, string|number|boolean|undefined>} params request fields per the docs
	 * @returns {Promise<any>} raw SearchCreatorStoreAssetsResponse
	 */
	async searchCreatorStore(params) {
		if (!config.apiKey) throw new ApiError(501, "no_api_key", "Busca na Creator Store requer uma API key configurada no servidor (ROBLOX_API_KEY).");
		const body = {};
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null && value !== "") body[key] = value;
		}
		const url = "https://apis.roblox.com/toolbox-service/v2/assets:search";
		const res = await fetchWithTimeout(url, {
			method: "POST",
			headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw fromStatus(res.status, `search ${JSON.stringify(body)}`);
		return res.json();
	}
}

export const robloxClient = new RobloxClient();
