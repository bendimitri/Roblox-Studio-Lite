import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const MAX_BODY = 64 * 1024 * 1024;

function safeId(id) {
	const s = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
	return s || null;
}

function fileOf(dir, id) {
	return join(dir, `${id}.json.gz`);
}

export function ensureSavesDir(dir) {
	mkdirSync(dir, { recursive: true });
}

export function listSaves(dir) {
	ensureSavesDir(dir);
	const out = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json.gz")) continue;
		const id = name.slice(0, -".json.gz".length);
		try {
			const buf = gunzipSync(readFileSync(join(dir, name)));
			const data = JSON.parse(buf.toString("utf8"));
			out.push({
				id,
				name: data.name || id,
				savedAt: data.savedAt || null,
				bytes: buf.length
			});
		} catch {
			out.push({ id, name: id, savedAt: null, bytes: 0 });
		}
	}
	out.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
	return out;
}

export function readSave(dir, rawId) {
	const id = safeId(rawId);
	if (!id) return null;
	const path = fileOf(dir, id);
	if (!existsSync(path)) return null;
	const data = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
	return { id, ...data };
}

export function writeSave(dir, { id, name, instances }) {
	ensureSavesDir(dir);
	const slug = safeId(id) || "place";
	const payload = {
		v: 1,
		name: String(name || slug).slice(0, 120),
		savedAt: new Date().toISOString(),
		instances
	};
	const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
	writeFileSync(fileOf(dir, slug), gz);
	return { id: slug, name: payload.name, savedAt: payload.savedAt, bytes: gz.length };
}

export function deleteSave(dir, rawId) {
	const id = safeId(rawId);
	if (!id) return false;
	const path = fileOf(dir, id);
	if (!existsSync(path)) return false;
	unlinkSync(path);
	return true;
}

export function readJsonBody(req, max = MAX_BODY) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (c) => {
			size += c.length;
			if (size > max) {
				req.destroy();
				reject(new Error("payload too large"));
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
			} catch {
				reject(new Error("invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}
