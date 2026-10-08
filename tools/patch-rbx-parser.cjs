// Patches the vendored rbxBinaryParser bundle so it reads current Roblox places correctly.
// Idempotent: run `node tools/patch-rbx-parser.cjs` after updating the bundle.
//
//  - ZSTD chunks (newer Studio builds), besides LZ4.
//  - INST chunks only carry the per-instance "is service" bytes when the chunk's format flag is 1.
//  - Strings are UTF-8 (the bundle decoded them as Latin-1, garbling accents in scripts and UI).
//  - Exact Roblox float decoding (the bundle divided the mantissa by 2^23 - 1 and lost denormals),
//    unsigned interleaved u32s (values >= 2^31 came out negative), Vector2 X/Y were swapped.
//  - Enum (Token) lookups are cached: the bundle scanned the whole API dump per instance.
//  - Missing types: Reference, Vector3int16, ColorSequence, PhysicalProperties with acoustic
//    absorption, Int64, SharedString (+ SSTR chunk), OptionalCFrame, UniqueId, Font,
//    SecurityCapabilities, Content, plus AttributesSerialize / Tags decoding.
// Specification: https://dom.rojo.space/binary.html
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "../app/thirdparty/rbxBinaryParser.js");
let src = fs.readFileSync(file, "utf8");

function replaceOnce(from, to, label) {
	if (src.includes(to)) return;
	if (src.split(from).length !== 2) throw new Error(`${label}: call site not found exactly once`);
	src = src.replace(from, to);
	console.log(`patched ${label}`);
}

replaceOnce("s.prototype.decodeBlock(o,0,t).buffer", "__rbxDecompress(o,t)", "zstd call");
replaceOnce(
	"i=(e.uint8(!0),e.uint32(!0)),o=N(e,i),y=[];for(let a=0;a<i;a++)y.push(1==e.uint8());",
	"__svc=e.uint8(!0),i=e.uint32(!0),o=N(e,i),y=[];if(__svc)for(let a=0;a<i;a++)y.push(1==e.uint8());",
	"INST service flags"
);
replaceOnce(
	'function u(e){var a=e.uint32(!0),r="";for(let t=0;t<a;t++)r+=String.fromCharCode(e.uint8());return[r,a]}',
	"function u(e){const a=e.uint32(!0),b=__bytes(e,a);return[__text(b),a]}",
	"utf-8 strings"
);
replaceOnce(
	"interleavedFloat(e){return this.interleavedUint32(e,(e=>{const a=e>>>24;if(0===a)return 0;const r=2**(a-127)*(1+(e>>>1&8388607)/8388607);return 1&e?-r:r}))}",
	"interleavedFloat(e){return this.interleavedUint32(e,__robloxFloat)}",
	"roblox floats"
);
replaceOnce("r[i]=a?a(o):o}return this.move(t),r}", "r[i]=a?a(o>>>0):o>>>0}return this.move(t),r}", "unsigned u32");
replaceOnce("function t(e,a){for(let y=0;y<r.PZ.length;y++)", "function t(e,a){const __k=a+\"\\u0000\"+e;if(__enumTypeCache.has(__k))return __enumTypeCache.get(__k);const __v=__t0(e,a);__enumTypeCache.set(__k,__v);return __v}function __t0(e,a){for(let y=0;y<r.PZ.length;y++)", "enum type cache");
replaceOnce("if(r.PZ[y].Superclass&&\"<<<ROOT>>>\"!=r.PZ[y].Superclass)return t(e,r.PZ[y].Superclass)", "if(r.PZ[y].Superclass&&\"<<<ROOT>>>\"!=r.PZ[y].Superclass)return __t0(e,r.PZ[y].Superclass)", "enum type recursion");
replaceOnce("function i(e,a){for(let i=0;i<r.Yb.length;i++)", "function i(e,a){const __k=e+\"\\u0000\"+a;if(__enumItemCache.has(__k))return __enumItemCache.get(__k);const __v=__i0(e,a);__enumItemCache.set(__k,__v);return __v}function __i0(e,a){for(let i=0;i<r.Yb.length;i++)", "enum item cache");
replaceOnce(
	'case"Vector2":var c=e.interleavedFloat(a),C=e.interleavedFloat(a);for(let e=0;e<a;e++)l[e]={X:C[e],Y:c[e]};',
	'case"Vector2":var c=e.interleavedFloat(a),C=e.interleavedFloat(a);for(let e=0;e<a;e++)l[e]={X:c[e],Y:C[e]};',
	"Vector2 axis order"
);
replaceOnce("function S(e,a,r,N){const S=e.uint8()", "function __S0(e,a,r,N){const S=e.uint8()", "property reader hook");
replaceOnce('else if("SSTR"==l.signature);', 'else if("SSTR"==l.signature)__readSSTR(e);', "SSTR chunk");
replaceOnce("for(var l={},s=[],c=[],C=[];", "for(var l={},s=__instances=[],c=[],C=[];", "instance table");
replaceOnce('return console.log("Finished decoding file.', 'return __resolveRefs(),console.log("Finished decoding file.', "reference resolution");

const HEADER_MARK = "// ---- Studio Lite parser extensions ----";
if (!src.includes(HEADER_MARK)) {
	src = `import { decompress as __zstdDecompress } from "./fzstd.js";
${HEADER_MARK}
const __utf8 = new TextDecoder("utf-8", { fatal: true });
const __latin1 = new TextDecoder("latin1");
const __f32 = new DataView(new ArrayBuffer(4));
const __enumTypeCache = new Map();
const __enumItemCache = new Map();
let __instances = [];
let __sharedStrings = [];
let __svc = 0;
function __rbxDecompress(bytes, size) {
	if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) return new Uint8Array(__zstdDecompress(bytes)).buffer;
	return s.prototype.decodeBlock(bytes, 0, size).buffer;
}
function __bytes(e, n) {
	const b = new Uint8Array(e.data.buffer, e.data.byteOffset + e.byteOffset, n).slice();
	e.move(n);
	return b;
}
function __text(b) {
	try {
		return __utf8.decode(b);
	} catch {
		return __latin1.decode(b);
	}
}
function __robloxFloat(u) {
	u >>>= 0;
	__f32.setUint32(0, ((u >>> 1) | ((u & 1) << 31)) >>> 0);
	return __f32.getFloat32(0);
}
function __untransform64(v) {
	return v & 1n ? -((v + 1n) >> 1n) : v >> 1n;
}
function __interleavedInt64(e, n) {
	const out = [];
	const base = e.byteOffset;
	for (let i = 0; i < n; i++) {
		let v = 0n;
		for (let k = 0; k < 8; k++) v = (v << 8n) | BigInt(e.data.getUint8(base + k * n + i));
		out.push(Number(__untransform64(v)));
	}
	e.move(8 * n);
	return out;
}
function __refs(e, n) {
	const raw = e.interleavedInt32(n);
	const out = [];
	let acc = 0;
	for (let i = 0; i < n; i++) {
		acc += raw[i];
		out.push(acc === -1 ? null : { __ref: acc });
	}
	return out;
}
function __readSSTR(e) {
	e.uint32(!0);
	const count = e.uint32(!0);
	__sharedStrings = [];
	for (let i = 0; i < count; i++) {
		e.move(16);
		const len = e.uint32(!0);
		__sharedStrings.push(__bytes(e, len));
	}
}
function __color3(r, g, b) {
	return { R: r, G: g, B: b };
}
function __readAttributes(b) {
	const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
	let o = 0;
	const u32 = () => ((o += 4), view.getUint32(o - 4, true));
	const f32 = () => ((o += 4), view.getFloat32(o - 4, true));
	const f64 = () => ((o += 8), view.getFloat64(o - 8, true));
	const str = () => {
		const n = u32();
		const s = __text(b.subarray(o, o + n));
		o += n;
		return s;
	};
	const out = {};
	if (b.byteLength < 4) return out;
	const count = u32();
	for (let i = 0; i < count; i++) {
		const key = str();
		const type = b[o++];
		let value;
		switch (type) {
			case 0x02: value = str(); break;
			case 0x03: value = b[o++] !== 0; break;
			case 0x05: value = f32(); break;
			case 0x06: value = f64(); break;
			case 0x09: value = { Scale: f32(), Offset: view.getInt32((o += 4) - 4, true) }; break;
			case 0x0a: value = { X: { Scale: f32(), Offset: view.getInt32((o += 4) - 4, true) }, Y: { Scale: f32(), Offset: view.getInt32((o += 4) - 4, true) } }; break;
			case 0x0e: { const n = u32(); const c = m[n]; value = { Number: n, Name: c ? c[0] : "Medium stone grey", Color: c ? __color3(c[1][0], c[1][1], c[1][2]) : __color3(0.64, 0.64, 0.64) }; break; }
			case 0x0f: value = __color3(f32(), f32(), f32()); break;
			case 0x10: value = { X: f32(), Y: f32() }; break;
			case 0x11: value = { X: f32(), Y: f32(), Z: f32() }; break;
			case 0x14: {
				const p = [f32(), f32(), f32()];
				const id = b[o++];
				const rot = id ? n[id].slice() : Array.from({ length: 9 }, f32);
				const c = [...p, ...rot];
				value = { Position: { X: p[0], Y: p[1], Z: p[2] }, Components: c };
				break;
			}
			case 0x15: value = { EnumType: str(), Value: u32() }; break;
			case 0x17: { const k = u32(); value = []; for (let j = 0; j < k; j++) { const env = f32(), t = f32(), v = f32(); value.push({ Time: t, Value: v, Envelope: env }); } break; }
			case 0x19: { const k = u32(); value = []; for (let j = 0; j < k; j++) { f32(); const t = f32(); value.push({ Time: t, Color: __color3(f32(), f32(), f32()) }); } break; }
			case 0x1b: value = { Min: f32(), Max: f32() }; break;
			case 0x1c: value = { Min: { X: f32(), Y: f32() }, Max: { X: f32(), Y: f32() } }; break;
			case 0x21: { const w = view.getUint16(o, true); o += 2; const st = b[o++]; const fam = str(); str(); value = { Family: fam, Weight: w, Style: st ? "Italic" : "Normal" }; break; }
			default: return out;
		}
		out[key] = value;
	}
	return out;
}
function S(e, a, r, N) {
	const type = e.data.getUint8(e.byteOffset);
	const l = [];
	switch (type) {
		case 0x01:
			if (N === "AttributesSerialize" || N === "Tags" || N === "AttributesReplicate") {
				e.move(1);
				for (let k = 0; k < a; k++) {
					const b = __bytes(e, e.uint32(!0));
					if (N === "Tags") l[k] = __latin1.decode(b).split("\\u0000").filter(Boolean);
					else { try { l[k] = __readAttributes(b); } catch { l[k] = {}; } }
				}
				return { type: "Attributes", values: l };
			}
			return __S0(e, a, r, N);
		case 0x13:
			e.move(1);
			return { type: "Reference", values: __refs(e, a) };
		case 0x14:
			e.move(1);
			for (let k = 0; k < a; k++) l[k] = { X: e.int16(!0), Y: e.int16(!0), Z: e.int16(!0) };
			return { type: "Vector3int16", values: l };
		case 0x16:
			e.move(1);
			for (let k = 0; k < a; k++) {
				const count = e.uint32(!0);
				l[k] = [];
				for (let j = 0; j < count; j++) {
					const time = e.float32(!0);
					const color = __color3(e.float32(!0), e.float32(!0), e.float32(!0));
					e.float32(!0);
					l[k].push({ Time: time, Color: color });
				}
			}
			return { type: "ColorSequence", values: l };
		case 0x19:
			e.move(1);
			for (let k = 0; k < a; k++) {
				const flags = e.uint8();
				if (flags & 1) {
					l[k] = { Density: e.float32(!0), Friction: e.float32(!0), Elasticity: e.float32(!0), FrictionWeight: e.float32(!0), ElasticityWeight: e.float32(!0) };
					if (flags & 2) l[k].AcousticAbsorption = e.float32(!0);
				} else {
					l[k] = null;
				}
			}
			return { type: "PhysicalProperties", values: l };
		case 0x1b:
		case 0x21:
			e.move(1);
			return { type: type === 0x1b ? "Int64" : "SecurityCapabilities", values: __interleavedInt64(e, a) };
		case 0x1c: {
			e.move(1);
			const idx = e.interleavedUint32(a);
			return { type: "SharedString", values: idx.map((k) => __sharedStrings[k] || null) };
		}
		case 0x1d:
			e.move(1);
			for (let k = 0; k < a; k++) __bytes(e, e.uint32(!0));
			return { type: "Bytecode", values: null };
		case 0x1e: {
			e.move(1);
			const cf = __S0(e, a, r, N);
			e.move(1);
			const has = [];
			for (let k = 0; k < a; k++) has.push(e.uint8() === 1);
			return { type: "OptionalCFrame", values: cf.values.map((v, k) => (has[k] ? v : null)) };
		}
		case 0x1f:
			e.move(1 + 16 * a);
			return { type: "UniqueId", values: null };
		case 0x20:
			e.move(1);
			for (let k = 0; k < a; k++) {
				const family = u(e)[0];
				const weight = e.uint16(!0);
				const style = e.uint8();
				u(e);
				l[k] = { Family: family, Weight: weight, Style: style ? "Italic" : "Normal" };
			}
			return { type: "Font", values: l };
		case 0x22: {
			e.move(1);
			const kinds = e.interleavedUint32(a);
			const uris = [];
			for (let k = e.uint32(!0); k > 0; k--) uris.push(u(e)[0]);
			const objectCount = e.uint32(!0);
			if (objectCount) __refs(e, objectCount);
			const externalCount = e.uint32(!0);
			if (externalCount) __refs(e, externalCount);
			let next = 0;
			return { type: "Content", values: kinds.map((kind) => (kind === 1 ? uris[next++] ?? "" : "")) };
		}
		default:
			return __S0(e, a, r, N);
	}
}
function __resolveRefs() {
	for (const inst of __instances) {
		if (!inst) continue;
		if (inst.Tags instanceof Uint8Array) inst.Tags = __text(inst.Tags).split("\\u0000").filter(Boolean);
		if (inst.AttributesSerialize instanceof Uint8Array) {
			try { inst.AttributesSerialize = __readAttributes(inst.AttributesSerialize); } catch { inst.AttributesSerialize = {}; }
		}
		for (const key in inst) {
			const v = inst[key];
			if (v && typeof v === "object" && "__ref" in v) inst[key] = __instances[v.__ref] || null;
		}
	}
	__instances = [];
	__sharedStrings = [];
}
// ---- end of Studio Lite parser extensions ----
` + src.slice(src.indexOf("var e={d:"));
	console.log("patched extensions header");
}
fs.writeFileSync(file, src);
