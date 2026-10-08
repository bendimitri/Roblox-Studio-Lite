// Downloads every Roblox asset a place references (images, meshes, sounds, animations) into
// asset/ so Studio Lite can render and play them offline. Usage:
//   node tools/fetch-assets.mjs test-places/SpinACard.rbxl [more places...]
// Files are named [assetid].[ext]; asset/index.json maps ids to kind and file for the app.
//
// Most assets uploaded after 2024 require authentication. Set one of:
//   ROBLOX_COOKIE=<.ROBLOSECURITY value>      (account that can access the place's assets)
//   ROBLOX_API_KEY=<Open Cloud key with legacy-asset / asset read access>
// Without credentials, images fall back to the public thumbnails API (420x420 renditions);
// meshes and sounds that need auth are reported as failed.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
import { decode } from "../app/thirdparty/rbxBinaryParser.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "asset");
const INDEX = join(OUT, "index.json");
const ID_PATTERN = /(?:rbxassetid:\/\/|roblox\.com\/asset\/?\?id=|[?&]id=)(\d{3,})/gi;
const KIND_BY_PROP = { SoundId: "sound", MeshId: "mesh", MeshID: "mesh", AnimationId: "animation" };
const EXT = { image: "png", mesh: "mesh", sound: "ogg", mp3: "mp3", animation: "rbxm", model: "rbxm" };
const CONCURRENCY = 6;

const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};

function collect(file, wanted) {
	const buf = readFileSync(file);
	const root = decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
	const add = (id, kind) => { if (!wanted.has(id) || wanted.get(id) === "unknown") wanted.set(id, kind); };
	const scan = (text, kind) => { for (const m of String(text).matchAll(ID_PATTERN)) add(m[1], kind); };
	const walk = (list) => {
		for (const inst of list || []) {
			if (!inst) continue;
			for (const [key, value] of Object.entries(inst)) {
				if (key === "Children" || key === "Parent") continue;
				const kind = KIND_BY_PROP[key] || (key === "Source" ? "unknown" : "image");
				if (typeof value === "string") scan(value, kind);
				else if (value && typeof value === "object" && typeof (value.Uri ?? value.uri) === "string") scan(value.Uri ?? value.uri, kind);
			}
			walk(inst.Children);
		}
	};
	walk(Array.isArray(root) ? root : root.Children || [root]);
}

function sniff(bytes) {
	const head = bytes.subarray(0, 16);
	const ascii = Buffer.from(head).toString("latin1");
	if (head[0] === 0x89 && ascii.startsWith("\x89PNG")) return "image";
	if (head[0] === 0xff && head[1] === 0xd8) return "image";
	if (ascii.startsWith("GIF8") || ascii.startsWith("BM")) return "image";
	if (ascii.startsWith("version ")) return "mesh";
	if (ascii.startsWith("OggS")) return "sound";
	if (ascii.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return "mp3";
	if (ascii.startsWith("RIFF")) return "sound";
	if (ascii.startsWith("<roblox")) return "model";
	return "unknown";
}

const COOKIE = process.env.ROBLOX_COOKIE;
const API_KEY = process.env.ROBLOX_API_KEY;

function metaRequest(id) {
	if (API_KEY) return fetch(`https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`, { headers: { "x-api-key": API_KEY } });
	const headers = COOKIE ? { Cookie: `.ROBLOSECURITY=${COOKIE.replace(/^\.ROBLOSECURITY=/, "")}` } : {};
	return fetch(`https://assetdelivery.roblox.com/v2/assetId/${id}`, { headers });
}

async function download(id) {
	const meta = await metaRequest(id).then((r) => r.json());
	const location = meta.locations && meta.locations[0] && meta.locations[0].location;
	if (!location) throw new Error((meta.errors && meta.errors[0] && meta.errors[0].message) || "no location");
	const res = await fetch(location);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	let bytes = Buffer.from(await res.arrayBuffer());
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
	return { bytes, type: meta.assetTypeId };
}

async function fetchAsset(id, hint, depth = 0) {
	if (index[id] && existsSync(join(OUT, index[id].file))) return index[id];
	const { bytes, type } = await download(id);
	let kind = sniff(bytes);
	if (kind === "model" && type === 13 && depth < 2) {
		// Decal / Image wrapper: the XML points at the actual image asset.
		const inner = [...bytes.toString("latin1").matchAll(ID_PATTERN)].map((m) => m[1]).find((x) => x !== id);
		if (inner) {
			const entry = await fetchAsset(inner, "image", depth + 1);
			index[id] = { ...entry, via: inner };
			return index[id];
		}
	}
	if (kind === "model" && (type === 24 || hint === "animation")) kind = "animation";
	if (kind === "unknown") throw new Error(`unrecognized content (type ${type})`);
	const file = `${id}.${EXT[kind]}`;
	writeFileSync(join(OUT, file), bytes);
	index[id] = { kind: kind === "mp3" ? "sound" : kind, file, type };
	return index[id];
}

const places = process.argv.slice(2);
if (!places.length) {
	console.log("usage: node tools/fetch-assets.mjs <place.rbxl> [...]");
	process.exit(1);
}
const wanted = new Map();
for (const place of places) collect(place, wanted);
console.log(`${wanted.size} asset id(s) referenced`);

const queue = [...wanted];
const failed = [];
let done = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
	while (queue.length) {
		const [id, hint] = queue.shift();
		try {
			const entry = await fetchAsset(id, hint);
			done++;
			process.stdout.write(`  ${id} -> ${entry.file}\n`);
		} catch (e) {
			failed.push(`${id} (${hint}): ${e.message}`);
		}
	}
}));

// Images the account can't download: use the public thumbnail rendition instead.
const thumbCandidates = failed.filter((f) => / \((image|unknown)\):/.test(f)).map((f) => f.split(" ")[0]);
const thumbed = new Set();
for (let i = 0; i < thumbCandidates.length; i += 100) {
	const batch = thumbCandidates.slice(i, i + 100);
	try {
		const res = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(",")}&size=420x420&format=Png&isCircular=false`).then((r) => r.json());
		await Promise.all((res.data || []).filter((t) => t.state === "Completed" && t.imageUrl).map(async (t) => {
			const bytes = Buffer.from(await fetch(t.imageUrl).then((r) => r.arrayBuffer()));
			if (sniff(bytes) !== "image") return;
			const id = String(t.targetId);
			writeFileSync(join(OUT, `${id}.png`), bytes);
			index[id] = { kind: "image", file: `${id}.png`, thumbnail: true };
			thumbed.add(id);
		}));
	} catch (e) {
		console.log("  thumbnails batch failed: " + e.message);
	}
}
const stillFailed = failed.filter((f) => !thumbed.has(f.split(" ")[0]));

writeFileSync(INDEX, JSON.stringify(index, null, 1));
console.log(`downloaded/cached ${done}, thumbnails ${thumbed.size}, failed ${stillFailed.length}`);
for (const f of stillFailed) console.log("  failed " + f);
if (stillFailed.length && !COOKIE && !API_KEY) console.log("Set ROBLOX_COOKIE or ROBLOX_API_KEY to download assets that require authentication.");
