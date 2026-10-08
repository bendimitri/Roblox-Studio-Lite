/*
 * Studio Lite Roblox proxy. The browser talks ONLY to this server; this server talks to Roblox.
 * Credentials (ROBLOX_API_KEY / ROBLOX_COOKIE) stay here and are never returned to the client.
 *
 * Routes (all under /api/roblox):
 *   GET  /health
 *   GET  /assets/:id                 -> details (metadata + thumbnail + contentAvailable)
 *   GET  /assets/:id/thumbnail       -> { url } (public thumbnail rendition)
 *   GET  /assets/:id/content         -> raw asset bytes (Content-Type sniffed)
 *   GET|POST /store/search           -> Creator Store search (mapped + paginated)
 * Any other GET is served as a static file from the Studio Lite root (optional single-origin mode).
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { ensureSavesDir, listSaves, readSave, writeSave, deleteSave, readJsonBody } from "./saves.mjs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, hasCredential } from "./env.mjs";
import { robloxClient } from "./RobloxClient.mjs";
import { mapAssetDetails, mapSearchResponse } from "./mappers.mjs";
import { TtlCache } from "./cache.mjs";
import { ApiError, badIdError } from "./errors.mjs";
import { normalizeAssetId } from "../app/roblox/AssetId.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAVES_DIR = join(ROOT, "saves");
const DEV = process.env.NODE_ENV !== "production";
ensureSavesDir(SAVES_DIR);

const metaCache = new TtlCache(5 * 60 * 1000);
const thumbCache = new TtlCache(30 * 60 * 1000);
const contentCache = new TtlCache(10 * 60 * 1000, 120);

const log = (...args) => { if (DEV) console.log("[RobloxAPI]", ...args); };

const STATIC_MIME = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
	".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
	".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".glb": "model/gltf-binary", ".mesh": "application/octet-stream", ".map": "application/json"
};

/** Content-Type for downloaded asset bytes (best-effort sniff). */
function sniffContentType(bytes) {
	const a = Buffer.from(bytes.subarray(0, 16)).toString("latin1");
	if (bytes[0] === 0x89 && a.startsWith("\x89PNG")) return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (a.startsWith("GIF8")) return "image/gif";
	if (a.startsWith("OggS")) return "audio/ogg";
	if (a.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
	if (a.startsWith("RIFF")) return "audio/wav";
	if (a.startsWith("version ")) return "model/x-roblox-mesh";
	if (a.startsWith("<roblox") || a.startsWith("\x89\x9b")) return "model/x-roblox";
	return "application/octet-stream";
}

function corsHeaders(origin) {
	const allow = config.allowedOrigins.includes("*") ? "*"
		: (origin && config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0] || "*");
	return {
		"Access-Control-Allow-Origin": allow,
		"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Vary": "Origin"
	};
}

function sendJson(res, status, body, origin) {
	const data = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) });
	res.end(data);
}

function sendError(res, err, origin) {
	const status = err instanceof ApiError ? err.status : 500;
	const code = err instanceof ApiError ? err.code : "internal";
	const message = err instanceof ApiError ? err.message : "Erro interno.";
	if (DEV) console.error("[RobloxAPI] error", status, code, err && (err.detail || err.message));
	sendJson(res, status, { success: false, error: { code, message } }, origin);
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
		req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
		req.on("error", () => resolve({}));
	});
}

/* -------- Route handlers -------- */

async function handleDetails(id, origin, res) {
	const asset = await metaCache.wrap(`meta:${id}`, async () => {
		log(`GET asset ${id}`);
		const [delivery, legacy] = await Promise.all([
			robloxClient.getAssetDelivery(id).catch((e) => { log("delivery failed", id, e.code || e.message); return null; }),
			robloxClient.getLegacyDetails(id)
		]);
		if (!delivery && !legacy) throw badIdError();
		const mapped = mapAssetDetails(id, delivery, legacy);
		const thumbs = await robloxClient.getThumbnails([id]).catch(() => new Map());
		mapped.thumbnailUrl = thumbs.get(id);
		log(`asset ${id} type=${mapped.assetType} content=${mapped.contentAvailable}`);
		return mapped;
	});
	sendJson(res, 200, { success: true, asset }, origin);
}

async function handleThumbnail(id, url, origin, res) {
	const size = url.searchParams.get("size") || "420x420";
	const thumbUrl = await thumbCache.wrap(`thumb:${id}:${size}`, async () => {
		const map = await robloxClient.getThumbnails([id], size);
		return map.get(id) || null;
	});
	sendJson(res, 200, { success: Boolean(thumbUrl), assetId: id, url: thumbUrl || null }, origin);
}

async function handleContent(id, origin, res) {
	const { buffer, contentType } = await contentCache.wrap(`content:${id}`, async () => {
		log(`GET content ${id}`);
		const { bytes } = await robloxClient.getAssetContent(id);
		return { buffer: bytes, contentType: sniffContentType(bytes) };
	});
	res.writeHead(200, {
		"Content-Type": contentType,
		"Content-Length": buffer.length,
		"Cache-Control": "public, max-age=600",
		...corsHeaders(origin)
	});
	res.end(buffer);
}

async function handleSearch(params, origin, res) {
	const searchCategoryType = params.searchCategoryType || params.assetType || "Model";
	const query = params.query ?? params.q;
	log(`search "${query}" type=${searchCategoryType}`);
	const json = await robloxClient.searchCreatorStore({
		searchCategoryType,
		query,
		maxPageSize: params.limit || params.maxPageSize,
		pageToken: params.cursor || params.pageToken,
		sortCategory: params.sortCategory,
		sortDirection: params.sortDirection,
		userId: params.userId,
		groupId: params.groupId
	});
	const mapped = mapSearchResponse(json);
	sendJson(res, 200, { success: true, ...mapped }, origin);
}

/** Serves a static file from the Studio Lite root (optional single-origin mode). */
function serveStatic(pathname, res, origin) {
	let rel = decodeURIComponent(pathname);
	if (rel === "/" || rel === "") rel = "/index.html";
	const full = normalize(join(ROOT, rel));
	if (!full.startsWith(ROOT) || !existsSync(full) || !statSync(full).isFile()) {
		sendJson(res, 404, { success: false, error: { code: "not_found", message: "Not found." } }, origin);
		return;
	}
	const mime = STATIC_MIME[extname(full).toLowerCase()] || "application/octet-stream";
	res.writeHead(200, { "Content-Type": mime, ...corsHeaders(origin) });
	createReadStream(full).pipe(res);
}

const server = createServer(async (req, res) => {
	const origin = req.headers.origin;
	try {
		if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(origin)); res.end(); return; }
		const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
		const path = url.pathname;

		if (path === "/api/roblox/health") {
			return sendJson(res, 200, { success: true, ok: true, hasCredential: hasCredential(), apiKey: Boolean(config.apiKey) }, origin);
		}

		const assetMatch = path.match(/^\/api\/roblox\/assets\/([^/]+)(\/thumbnail|\/content)?$/);
		if (assetMatch) {
			const id = normalizeAssetId(assetMatch[1]);
			if (id === null) return sendError(res, badIdError(), origin);
			if (assetMatch[2] === "/thumbnail") return await handleThumbnail(id, url, origin, res);
			if (assetMatch[2] === "/content") return await handleContent(id, origin, res);
			return await handleDetails(id, origin, res);
		}

		if (path === "/api/roblox/store/search") {
			const params = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams);
			return await handleSearch(params, origin, res);
		}

		if (path === "/api/saves" && req.method === "GET") {
			return sendJson(res, 200, { success: true, saves: listSaves(SAVES_DIR) }, origin);
		}
		if (path === "/api/saves" && req.method === "POST") {
			const body = await readJsonBody(req);
			if (!body || !Array.isArray(body.instances)) {
				return sendJson(res, 400, { success: false, error: { code: "bad_request", message: "instances[] obrigatório." } }, origin);
			}
			const saved = writeSave(SAVES_DIR, { id: body.id, name: body.name, instances: body.instances });
			return sendJson(res, 200, { success: true, save: saved }, origin);
		}
		const saveMatch = path.match(/^\/api\/saves\/([^/]+)$/);
		if (saveMatch) {
			const id = decodeURIComponent(saveMatch[1]);
			if (req.method === "GET") {
				const save = readSave(SAVES_DIR, id);
				if (!save) return sendJson(res, 404, { success: false, error: { code: "not_found", message: "Save não encontrado." } }, origin);
				return sendJson(res, 200, { success: true, save }, origin);
			}
			if (req.method === "DELETE") {
				const ok = deleteSave(SAVES_DIR, id);
				return sendJson(res, ok ? 200 : 404, { success: ok }, origin);
			}
		}

		if (req.method === "GET") return serveStatic(path, res, origin);
		sendJson(res, 404, { success: false, error: { code: "not_found", message: "Not found." } }, origin);
	} catch (err) {
		sendError(res, err, origin);
	}
});

server.listen(config.port, () => {
	console.log(`Studio Lite Roblox proxy on http://localhost:${config.port}`);
	console.log(`  credentials: ${hasCredential() ? (config.apiKey ? "API key" : "cookie") : "NONE (thumbnails + public content only)"}`);
	console.log(`  static root: ${ROOT}`);
	console.log(`  saves: ${SAVES_DIR}`);
});
