/*
 * Round-trip of the in-memory DataModel to JSON (gzip happens on the server).
 * Instance graphs can have Part0/Part1/PrimaryPart back-references; those become $ref ids.
 */

function cloneValue(value, tag) {
	if (value === null || value === undefined) return value;
	const t = typeof value;
	if (t === "string" || t === "number" || t === "boolean") return value;
	if (t === "function") return undefined;
	if (Array.isArray(value)) return value.map((item) => cloneValue(item, tag));
	if (t !== "object") return undefined;
	if (value.isObject3D || value.isBufferGeometry || value.isMaterial || value.isTexture) return undefined;
	if (value.ClassName && (value.Name !== undefined || value.Children)) return tag(value);
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		if (k === "parent" || k === "userData") continue;
		const copied = cloneValue(v, tag);
		if (copied !== undefined) out[k] = copied;
	}
	return out;
}

export function serializeDataModel(instances) {
	const ids = new Map();
	let next = 1;
	const tag = (inst) => {
		if (!inst || typeof inst !== "object") return inst;
		if (ids.has(inst)) return { $ref: ids.get(inst) };
		const id = next++;
		ids.set(inst, id);
		const out = { $id: id };
		for (const [k, v] of Object.entries(inst)) {
			if (k === "parent" || k === "userData") continue;
			if (k === "Children") {
				out.Children = (v || []).map((child) => tag(child));
				continue;
			}
			const copied = cloneValue(v, tag);
			if (copied !== undefined) out[k] = copied;
		}
		return out;
	};
	return (instances || []).map((inst) => tag(inst));
}

export function deserializeDataModel(nodes) {
	const byId = new Map();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		if (node.$id) byId.set(node.$id, node);
		for (const child of node.Children || []) walk(child);
		for (const value of Object.values(node)) {
			if (value && typeof value === "object" && value.$id && value !== node) walk(value);
		}
	};
	for (const node of nodes || []) walk(node);

	const resolve = (value) => {
		if (!value || typeof value !== "object") return value;
		if (value.$ref) return byId.get(value.$ref) || null;
		if (Array.isArray(value)) return value.map(resolve);
		for (const [k, v] of Object.entries(value)) {
			if (k === "$id" || k === "$ref") continue;
			value[k] = resolve(v);
		}
		delete value.$id;
		return value;
	};
	return (nodes || []).map(resolve);
}

export function slugify(name) {
	const s = String(name || "Place")
		.normalize("NFKD")
		.replace(/[^\w\u00C0-\u024f]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60)
		.toLowerCase();
	return s || "place";
}
