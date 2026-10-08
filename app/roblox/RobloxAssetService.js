/*
 * RobloxAssetService — the frontend's single entry point to the Roblox integration. Talks only to
 * our internal proxy (never to Roblox directly), caches per Asset ID, de-dupes in-flight requests,
 * supports AbortController + timeout, and surfaces friendly (pt-BR) error messages.
 */
import { normalizeAssetId, classifyQuery } from "./AssetId.js";
import { robloxConfig } from "./config.js";

const DEFAULT_TIMEOUT_MS = 20000;
const META_TTL = 5 * 60 * 1000;
const THUMB_TTL = 30 * 60 * 1000;
const CONTENT_TTL = 10 * 60 * 1000;

/** Error whose `.message` is safe to show to the user. */
export class RobloxServiceError extends Error {
	constructor(message, code) { super(message); this.code = code || "error"; }
}

const FALLBACK_MESSAGE = "Não foi possível consultar o Roblox.";

/** Small TTL map used for metadata / thumbnail / content caches. */
class Cache {
	constructor(ttl) { this.ttl = ttl; this.map = new Map(); }
	get(key) {
		const hit = this.map.get(key);
		if (!hit) return undefined;
		if (Date.now() > hit.expires) { this.map.delete(key); return undefined; }
		return hit.value;
	}
	set(key, value) { this.map.set(key, { value, expires: Date.now() + this.ttl }); }
	async wrap(key, fn) {
		const cached = this.get(key);
		if (cached !== undefined) return cached;
		const promise = Promise.resolve().then(fn);
		this.set(key, promise);
		try { const v = await promise; this.set(key, v); return v; }
		catch (e) { this.map.delete(key); throw e; }
	}
	clear() { this.map.clear(); }
}

export class RobloxAssetService {
	constructor() {
		this.meta = new Cache(META_TTL);
		this.thumbs = new Cache(THUMB_TTL);
		this.content = new Cache(CONTENT_TTL);
		this._searchController = null;
	}

	/** @returns {number|null} */
	normalizeAssetId(input) { return normalizeAssetId(input); }
	classifyQuery(input) { return classifyQuery(input); }

	/** GET with timeout; parses JSON; throws RobloxServiceError on failure. */
	async _getJson(path, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, method = "GET", body } = {}) {
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener("abort", onAbort); }
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res;
		try {
			res = await fetch(robloxConfig.endpoint(path), {
				method,
				signal: controller.signal,
				headers: body ? { "Content-Type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
		} catch (err) {
			if (controller.signal.aborted && !(signal && signal.aborted)) throw new RobloxServiceError("Tempo limite ao consultar o Roblox.", "timeout");
			if (signal && signal.aborted) throw new RobloxServiceError("Requisição cancelada.", "aborted");
			throw new RobloxServiceError("Não foi possível conectar ao servidor do Studio Lite (proxy do Roblox). Ele está rodando?", "offline");
		} finally {
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
		}
		let json;
		try { json = await res.json(); } catch { json = null; }
		if (!res.ok || (json && json.success === false)) {
			const err = json && json.error;
			throw new RobloxServiceError((err && err.message) || FALLBACK_MESSAGE, (err && err.code) || `http_${res.status}`);
		}
		return json;
	}

	/**
	 * Direct-by-id metadata lookup (metadata + thumbnail + contentAvailable).
	 * @param {number} assetId @returns {Promise<RobloxAsset>}
	 */
	async getAssetDetails(assetId, { signal } = {}) {
		const id = normalizeAssetId(assetId);
		if (id === null) throw new RobloxServiceError("Asset ID inválido.", "invalid_id");
		return this.meta.wrap(`meta:${id}`, async () => {
			const json = await this._getJson(`/assets/${id}`, { signal });
			return json.asset;
		});
	}

	/**
	 * Public thumbnail URL for an asset (or null when none is available).
	 * @param {number} assetId @returns {Promise<string|null>}
	 */
	async getAssetThumbnail(assetId, { size = "420x420", signal } = {}) {
		const id = normalizeAssetId(assetId);
		if (id === null) return null;
		return this.thumbs.wrap(`thumb:${id}:${size}`, async () => {
			try {
				const json = await this._getJson(`/assets/${id}/thumbnail?size=${encodeURIComponent(size)}`, { signal });
				return json.url || null;
			} catch { return null; }
		});
	}

	/**
	 * Downloads the real asset bytes through the proxy and returns an object URL usable by the engine.
	 * Never throws for "unsupported"; it throws RobloxServiceError only on real failures.
	 * @param {number} assetId @returns {Promise<RobloxContent>}
	 */
	async getAssetContent(assetId, { signal } = {}) {
		const id = normalizeAssetId(assetId);
		if (id === null) throw new RobloxServiceError("Asset ID inválido.", "invalid_id");
		return this.content.wrap(`content:${id}`, async () => {
			const controller = new AbortController();
			const onAbort = () => controller.abort();
			if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener("abort", onAbort); }
			const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
			let res;
			try {
				res = await fetch(robloxConfig.endpoint(`/assets/${id}/content`), { signal: controller.signal });
			} catch {
				throw new RobloxServiceError("Não foi possível baixar o conteúdo do asset.", "offline");
			} finally {
				clearTimeout(timer);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
			if (!res.ok) {
				let json = null; try { json = await res.json(); } catch { /* bytes or empty */ }
				const err = json && json.error;
				throw new RobloxServiceError((err && err.message) || "Conteúdo indisponível.", (err && err.code) || `http_${res.status}`);
			}
			const contentType = res.headers.get("Content-Type") || "application/octet-stream";
			const data = await res.arrayBuffer();
			const blobUrl = URL.createObjectURL(new Blob([data], { type: contentType }));
			return { success: true, assetId: id, contentType, data, blobUrl };
		});
	}

	/**
	 * Creator Store text search. Cancels the previous search automatically (debounce-friendly).
	 * @param {string} query
	 * @param {{ assetType?: string, limit?: number, cursor?: string, sortCategory?: string, sortDirection?: string }} [options]
	 * @returns {Promise<RobloxSearchResult>}
	 */
	async searchCreatorStore(query, options = {}) {
		if (this._searchController) this._searchController.abort();
		const controller = new AbortController();
		this._searchController = controller;
		try {
			const json = await this._getJson("/store/search", {
				method: "POST",
				signal: controller.signal,
				body: {
					query,
					searchCategoryType: options.assetType || "Model",
					limit: options.limit || 30,
					cursor: options.cursor,
					sortCategory: options.sortCategory,
					sortDirection: options.sortDirection
				}
			});
			return { items: json.items || [], nextCursor: json.nextCursor, totalResults: json.totalResults, filteredKeyword: json.filteredKeyword };
		} finally {
			if (this._searchController === controller) this._searchController = null;
		}
	}

	/** True if the proxy is reachable (used to show a helpful hint in the UI). */
	async health() {
		try { return await this._getJson("/health", { timeoutMs: 4000 }); }
		catch { return { success: false, ok: false }; }
	}
}

export const robloxAssetService = new RobloxAssetService();
