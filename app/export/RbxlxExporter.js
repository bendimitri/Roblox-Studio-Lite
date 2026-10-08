import { Matrix4, Quaternion, Vector3 } from '../thirdparty/three/three.module.js';
import { API_CLASSES, API_ENUMS } from '../datamodel/ApiSchema.js';
import { NON_ARCHIVABLE_SERVICES } from '../datamodel/Services.js';
import { RIG_SPECS } from '../animation/RigSpecs.js';

/*
 * Roblox XML place (.rbxlx, format version 4) writer.
 *
 * Every class and property comes from the Roblox API dump (ApiSchema.js): only properties Roblox
 * itself serializes (Serialization.CanSave) are written, each with the XML element of its value
 * type. A handful are stored under legacy names that the dump hides (size, Color3uint8, shape,
 * Health_XML, WorldPivotData, FontFace); those are mapped by hand below.
 *
 * Animations from the animation editor become KeyframeSequences in
 * ServerStorage.RBX_ANIMSAVES.<Rig>, exactly where Roblox Studio's Animation Editor keeps them.
 */

const lcfirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const ENUM_ALIASES = { Font: "Font" };

/** Legacy Enum.Font -> FontFace family (rbxasset://fonts/families/<file>.json), weight, style. */
const FONT_FACES = {
	Legacy: ["LegacyArial", 400], Arial: ["Arial", 400], ArialBold: ["Arial", 700], SourceSans: ["SourceSansPro", 400],
	SourceSansBold: ["SourceSansPro", 700], SourceSansSemibold: ["SourceSansPro", 600], SourceSansLight: ["SourceSansPro", 300],
	SourceSansItalic: ["SourceSansPro", 400, "Italic"], Bodoni: ["AccanthisADFStd", 400], Garamond: ["Guru", 400],
	Cartoon: ["ComicNeueAngular", 400], Code: ["Inconsolata", 400], Highway: ["HighwayGothic", 400], SciFi: ["Zekton", 400],
	Arcade: ["PressStart2P", 400], Fantasy: ["Balthazar", 400], Antique: ["Kalam", 400], Gotham: ["GothamSSm", 400],
	GothamMedium: ["GothamSSm", 500], GothamBold: ["GothamSSm", 700], GothamBlack: ["GothamSSm", 900], AmaticSC: ["AmaticSC", 400],
	Bangers: ["Bangers", 400], Creepster: ["Creepster", 400], DenkOne: ["DenkOne", 400], Fondamento: ["Fondamento", 400],
	FredokaOne: ["FredokaOne", 400], GrenzeGotisch: ["GrenzeGotisch", 400], IndieFlower: ["IndieFlower", 400],
	JosefinSans: ["JosefinSans", 400], Jura: ["Jura", 400], Kalam: ["Kalam", 400], LuckiestGuy: ["LuckiestGuy", 400],
	Merriweather: ["Merriweather", 400], Michroma: ["Michroma", 400], Nunito: ["Nunito", 400], Oswald: ["Oswald", 400],
	PatrickHand: ["PatrickHand", 400], PermanentMarker: ["PermanentMarker", 400], Roboto: ["Roboto", 400],
	RobotoCondensed: ["RobotoCondensed", 400], RobotoMono: ["RobotoMono", 400], Sarpanch: ["Sarpanch", 400],
	SpecialElite: ["SpecialElite", 400], TitilliumWeb: ["TitilliumWeb", 400], Ubuntu: ["Ubuntu", 400],
	BuilderSans: ["BuilderSans", 400], BuilderSansMedium: ["BuilderSans", 500], BuilderSansBold: ["BuilderSans", 700],
	BuilderSansExtraBold: ["BuilderSans", 800]
};

function xmlText(s) {
	return String(s)
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function num(n) {
	const v = Number(n);
	if (Number.isNaN(v)) return "NAN";
	if (v === Infinity) return "INF";
	if (v === -Infinity) return "-INF";
	if (Object.is(v, -0)) return "0";
	return String(Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(9));
}

function cdata(s) {
	return `<![CDATA[${String(s).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function base64(bytes) {
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(out);
}

function enumToken(enumType, value) {
	const items = API_ENUMS[ENUM_ALIASES[enumType] || enumType];
	if (!items || value === undefined || value === null) return null;
	if (typeof value === "string") return Object.hasOwn(items, value) ? items[value] : null;
	if (typeof value === "number" || typeof value === "bigint") return Object.values(items).includes(Number(value)) ? Number(value) : null;
	if (typeof value === "object") return enumToken(enumType, value.Name ?? value.Value);
	return null;
}

function components(cf) {
	if (!cf || typeof cf !== "object") return null;
	if (Array.isArray(cf)) return cf.length >= 12 ? cf : null;
	if (Array.isArray(cf.Components) && cf.Components.length >= 12) return cf.Components;
	if (cf.Position) return [cf.Position.X, cf.Position.Y, cf.Position.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1];
	return null;
}

const CF_TAGS = ["X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"];
const cfBody = (c) => c.slice(0, 12).map((v, i) => `<${CF_TAGS[i]}>${num(v)}</${CF_TAGS[i]}>`).join("");

function color3uint8(c) {
	const b = (v) => Math.max(0, Math.min(255, Math.round(Number(v) * (Number(v) > 1 ? 1 : 255))));
	return ((0xff000000 | (b(c.R) << 16) | (b(c.G) << 8) | b(c.B)) >>> 0).toString();
}

function contentUrl(value) {
	if (value === undefined || value === null) return "";
	if (typeof value === "object") return String(value.url ?? value.Url ?? value.Uri ?? "");
	return String(value);
}

/** Serializes one property value; returns null when the value can't be represented (property is skipped). */
function writeValue(type, name, value, refOf) {
	const n = xmlText(name);
	if (type.startsWith("Enum:")) {
		const token = enumToken(type.slice(5), value);
		return token === null ? null : `<token name="${n}">${token}</token>`;
	}
	switch (type) {
		case "bool": return `<bool name="${n}">${value ? "true" : "false"}</bool>`;
		case "int": return `<int name="${n}">${Math.trunc(Number(value) || 0)}</int>`;
		case "int64": return `<int64 name="${n}">${typeof value === "bigint" ? value.toString() : Math.trunc(Number(value) || 0)}</int64>`;
		case "float": return `<float name="${n}">${num(value)}</float>`;
		case "double": return `<double name="${n}">${num(value)}</double>`;
		case "string": return `<string name="${n}">${xmlText(value ?? "")}</string>`;
		case "ProtectedString": return `<ProtectedString name="${n}">${cdata(value ?? "")}</ProtectedString>`;
		case "Content":
		case "ContentId": {
			const url = contentUrl(value);
			return `<Content name="${n}">${url ? `<url>${xmlText(url)}</url>` : "<null></null>"}</Content>`;
		}
		case "BinaryString": {
			if (value instanceof Uint8Array) return `<BinaryString name="${n}">${base64(value)}</BinaryString>`;
			if (value instanceof ArrayBuffer) return `<BinaryString name="${n}">${base64(new Uint8Array(value))}</BinaryString>`;
			return typeof value === "string" ? `<BinaryString name="${n}">${xmlText(value)}</BinaryString>` : null;
		}
		case "Vector3":
			return value && "X" in value ? `<Vector3 name="${n}"><X>${num(value.X)}</X><Y>${num(value.Y)}</Y><Z>${num(value.Z)}</Z></Vector3>` : null;
		case "Vector2":
			return value && "X" in value ? `<Vector2 name="${n}"><X>${num(value.X)}</X><Y>${num(value.Y)}</Y></Vector2>` : null;
		case "CFrame": {
			const c = components(value);
			return c ? `<CoordinateFrame name="${n}">${cfBody(c)}</CoordinateFrame>` : null;
		}
		case "OptionalCoordinateFrame": {
			const c = components(value);
			return c ? `<OptionalCoordinateFrame name="${n}"><CFrame>${cfBody(c)}</CFrame></OptionalCoordinateFrame>` : null;
		}
		case "Color3":
			return value && "R" in value ? `<Color3 name="${n}"><R>${num(value.R)}</R><G>${num(value.G)}</G><B>${num(value.B)}</B></Color3>` : null;
		case "Color3uint8":
			return value && "R" in value ? `<Color3uint8 name="${n}">${color3uint8(value)}</Color3uint8>` : null;
		case "UDim2":
			return value && value.X && value.Y
				? `<UDim2 name="${n}"><XS>${num(value.X.Scale)}</XS><XO>${Math.round(Number(value.X.Offset) || 0)}</XO><YS>${num(value.Y.Scale)}</YS><YO>${Math.round(Number(value.Y.Offset) || 0)}</YO></UDim2>`
				: null;
		case "UDim":
			return value && "Scale" in value ? `<UDim name="${n}"><S>${num(value.Scale)}</S><O>${Math.round(Number(value.Offset) || 0)}</O></UDim>` : null;
		case "NumberRange":
			return value && "Min" in value ? `<NumberRange name="${n}">${num(value.Min)} ${num(value.Max)} </NumberRange>` : null;
		case "NumberSequence": {
			if (typeof value === "number") value = [{ Time: 0, Value: value }, { Time: 1, Value: value }];
			const kps = Array.isArray(value) ? value : value && (value.Keypoints || value.keypoints);
			return Array.isArray(kps) ? `<NumberSequence name="${n}">${kps.map((k) => `${num(k.Time)} ${num(k.Value)} ${num(k.Envelope || 0)} `).join("")}</NumberSequence>` : null;
		}
		case "ColorSequence": {
			if (value && "R" in value) value = [{ Time: 0, Color: value }, { Time: 1, Color: value }];
			const kps = Array.isArray(value) ? value : value && (value.Keypoints || value.keypoints);
			if (!Array.isArray(kps)) return null;
			const colorOf = (k) => k.Color || k.Value || { R: 1, G: 1, B: 1 };
			return `<ColorSequence name="${n}">${kps.map((k) => `${num(k.Time)} ${num(colorOf(k).R)} ${num(colorOf(k).G)} ${num(colorOf(k).B)} 0 `).join("")}</ColorSequence>`;
		}
		case "PhysicalProperties":
			return value && typeof value === "object" && "Density" in value
				? `<PhysicalProperties name="${n}"><CustomPhysics>true</CustomPhysics><Density>${num(value.Density)}</Density><Friction>${num(value.Friction)}</Friction><Elasticity>${num(value.Elasticity)}</Elasticity><FrictionWeight>${num(value.FrictionWeight ?? 1)}</FrictionWeight><ElasticityWeight>${num(value.ElasticityWeight ?? 1)}</ElasticityWeight></PhysicalProperties>`
				: `<PhysicalProperties name="${n}"><CustomPhysics>false</CustomPhysics></PhysicalProperties>`;
		case "Font": {
			if (!value) return null;
			return `<Font name="${n}"><Family><url>${xmlText(value.family)}</url></Family><Weight>${value.weight}</Weight><Style>${value.style}</Style></Font>`;
		}
		case "Ref": {
			const ref = refOf(value);
			return `<Ref name="${n}">${ref || "null"}</Ref>`;
		}
	}
	return null;
}

function fontFaceOf(rec) {
	const face = rec.FontFace;
	if (face && typeof face === "object" && (face.Family || face.family)) {
		const family = contentUrl(face.Family || face.family);
		const weight = enumToken("FontWeight", face.Weight) ?? (Number(face.Weight) || 400);
		return { family, weight, style: typeof face.Style === "string" ? face.Style : "Normal" };
	}
	const legacy = typeof rec.Font === "string" ? rec.Font : Object.keys(API_ENUMS.Font).find((k) => API_ENUMS.Font[k] === Number(rec.Font));
	if (!legacy) return null;
	const [family, weight, style = "Normal"] = FONT_FACES[legacy] || FONT_FACES.SourceSans;
	return { family: `rbxasset://fonts/families/${family}.json`, weight, style };
}

/** Plain attribute values (as decoded by the patched rbx parser / set by scripts) -> Roblox binary attribute blob. */
function encodeAttributes(attrs) {
	const bytes = [];
	const enc = new TextEncoder();
	const scratch = new DataView(new ArrayBuffer(8));
	const u8 = (v) => bytes.push(v & 255);
	const push = (len) => { for (let i = 0; i < len; i++) bytes.push(scratch.getUint8(i)); };
	const u32 = (v) => { scratch.setUint32(0, v >>> 0, true); push(4); };
	const i32 = (v) => { scratch.setInt32(0, Math.round(Number(v) || 0), true); push(4); };
	const u16 = (v) => { scratch.setUint16(0, v & 0xffff, true); push(2); };
	const f32 = (v) => { scratch.setFloat32(0, Number(v) || 0, true); push(4); };
	const f64 = (v) => { scratch.setFloat64(0, Number(v) || 0, true); push(8); };
	const str = (s) => { const b = enc.encode(String(s ?? "")); u32(b.length); for (const x of b) bytes.push(x); };
	const entries = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null);
	const body = [];
	for (const [key, v] of entries) {
		const start = bytes.length;
		str(key);
		if (typeof v === "string") { u8(0x02); str(v); }
		else if (typeof v === "boolean") { u8(0x03); u8(v ? 1 : 0); }
		else if (typeof v === "number") { u8(0x06); f64(v); }
		else if (Array.isArray(v) && v.length && (v[0].Color || (v[0].Value && typeof v[0].Value === "object"))) {
			u8(0x19); u32(v.length);
			for (const k of v) { const c = k.Color || k.Value; f32(0); f32(k.Time); f32(c.R); f32(c.G); f32(c.B); }
		} else if (Array.isArray(v)) {
			u8(0x17); u32(v.length);
			for (const k of v) { f32(k.Envelope || 0); f32(k.Time); f32(k.Value); }
		} else if (typeof v === "object") {
			if (Array.isArray(v.Components)) {
				const c = v.Components;
				u8(0x14); f32(c[0]); f32(c[1]); f32(c[2]); u8(0); for (let i = 3; i < 12; i++) f32(c[i]);
			} else if ("EnumType" in v) {
				const items = API_ENUMS[v.EnumType] || {};
				u8(0x15); str(v.EnumType); u32(typeof v.Value === "number" ? v.Value : items[v.Value] ?? 0);
			} else if ("Number" in v && "Color" in v) { u8(0x0e); u32(v.Number); }
			else if ("R" in v) { u8(0x0f); f32(v.R); f32(v.G); f32(v.B); }
			else if (v.X && typeof v.X === "object" && "Scale" in v.X) { u8(0x0a); f32(v.X.Scale); i32(v.X.Offset); f32(v.Y.Scale); i32(v.Y.Offset); }
			else if ("Scale" in v) { u8(0x09); f32(v.Scale); i32(v.Offset); }
			else if ("Min" in v && typeof v.Min === "object") { u8(0x1c); f32(v.Min.X); f32(v.Min.Y); f32(v.Max.X); f32(v.Max.Y); }
			else if ("Min" in v) { u8(0x1b); f32(v.Min); f32(v.Max); }
			else if ("Family" in v) { u8(0x21); u16(Number(v.Weight) || 400); u8(v.Style === "Italic" ? 1 : 0); str(contentUrl(v.Family)); str(""); }
			else if ("Z" in v) { u8(0x11); f32(v.X); f32(v.Y); f32(v.Z); }
			else if ("X" in v) { u8(0x10); f32(v.X); f32(v.Y); }
			else { bytes.length = start; continue; }
		} else { bytes.length = start; continue; }
		body.push(bytes.splice(start));
	}
	u32(body.length);
	for (const chunk of body) for (const x of chunk) bytes.push(x);
	return new Uint8Array(bytes);
}

/** Properties the API dump hides behind legacy serialized names. */
const LEGACY_PROPS = [
	{
		isA: "Instance", name: "AttributesSerialize", type: "BinaryString",
		get: (r) => (r.AttributesSerialize && typeof r.AttributesSerialize === "object" && !(r.AttributesSerialize instanceof Uint8Array) && Object.keys(r.AttributesSerialize).length ? encodeAttributes(r.AttributesSerialize) : null)
	},
	{
		isA: "Instance", name: "Tags", type: "BinaryString",
		get: (r) => (Array.isArray(r.Tags) && r.Tags.length ? new TextEncoder().encode(r.Tags.join("\u0000")) : null)
	},
	{ isA: "BasePart", name: "size", type: "Vector3", get: (r) => r.Size },
	{ isA: "BasePart", name: "Color3uint8", type: "Color3uint8", get: (r) => r.Color3 || (r.BrickColor && r.BrickColor.Color ? { R: r.BrickColor.Color.R, G: r.BrickColor.Color.G, B: r.BrickColor.Color.B } : null) },
	{ isA: "Part", name: "shape", type: "Enum:PartType", get: (r) => r.Shape ?? r.shape },
	{ isA: "Humanoid", name: "Health_XML", type: "float", get: (r) => r.Health ?? 100 },
	{ isA: "Model", name: "WorldPivotData", type: "OptionalCoordinateFrame", get: (r) => r.WorldPivot || r.WorldPivotData },
	{ isA: "GuiObject", name: "FontFace", type: "Font", get: (r) => ("Font" in r || "FontFace" in r ? fontFaceOf(r) : null) }
];

function chainOf(className) {
	const out = [];
	for (let c = className; c && API_CLASSES[c]; c = API_CLASSES[c].s) out.push(c);
	return out;
}

/** Savable properties of a class: own class first, superclasses after (name -> type). */
function savableProps(className) {
	const props = new Map();
	for (const c of chainOf(className)) {
		for (const [k, t] of Object.entries(API_CLASSES[c].p)) if (!props.has(k)) props.set(k, t);
	}
	return props;
}

const SKIP_INFERRED = new Set(["ClassName", "Name", "Children", "Parent", "AttributesSerialize", "Tags", "referent"]);

/**
 * Classes newer than the bundled API dump (they came from a real place, so Roblox knows them):
 * property types are inferred from the decoded values.
 */
function inferredProps(rec) {
	const props = new Map();
	for (const [key, v] of Object.entries(rec)) {
		if (SKIP_INFERRED.has(key) || key.startsWith("_") || v === undefined || v === null) continue;
		let type = null;
		if (typeof v === "boolean") type = "bool";
		else if (typeof v === "string") type = "string";
		else if (typeof v === "number") type = Number.isInteger(v) ? "int" : "float";
		else if (typeof v === "bigint") type = "int64";
		else if (typeof v === "object") {
			if (Array.isArray(v.Components)) type = "CFrame";
			else if ("ClassName" in v) type = "Ref";
			else if ("R" in v && "G" in v) type = "Color3";
			else if (v.X && typeof v.X === "object" && "Scale" in v.X) type = "UDim2";
			else if ("Scale" in v && "Offset" in v) type = "UDim";
			else if ("Min" in v && typeof v.Min === "number") type = "NumberRange";
			else if ("X" in v && "Y" in v && "Z" in v) type = "Vector3";
			else if ("X" in v && "Y" in v) type = "Vector2";
		}
		if (type) props.set(key, type);
	}
	return props;
}

/* ---------- Animations -> KeyframeSequence records ---------- */

const NATIVE_EASE = { linear: ["Linear", "In"], constant: ["Constant", "In"], cubic: ["Cubic", "InOut"] };

function poseCFrame(rest, rot, pos, studs) {
	const restQ = rest ? rest.quaternion.clone() : new Quaternion();
	const restP = rest ? rest.position : new Vector3();
	const invRest = restQ.clone().invert();
	const q = invRest.clone().multiply(new Quaternion(...rot));
	const p = new Vector3(...pos).sub(restP).applyQuaternion(invRest).divideScalar(studs || 1);
	const m = new Matrix4().makeRotationFromQuaternion(q).elements;
	return [p.x, p.y, p.z, m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

/**
 * Builds a Roblox KeyframeSequence (records) from an AnimationDocument. Each bone gets poses
 * only at its own key times (Roblox interpolates every joint between its own poses); eases with
 * no Roblox PoseEasingStyle (spline, sine, quad/cubic one-sided) are baked at the document fps.
 */
export function keyframeSequenceFromDocument(doc, root, { hipHeight = 2 } = {}) {
	const rigType = root.userData.rigType || doc.rigType || "R15";
	const spec = RIG_SPECS[rigType];
	const rest = root.userData.rest || {};
	const studs = root.userData.studs || 1;
	const parentOf = new Map(spec.joints.map((j) => [j.part, j.parent]));
	const byTime = new Map();
	const cache = new Map();
	const at = (t) => {
		const key = Math.round(t * 1e4) / 1e4;
		if (!byTime.has(key)) byTime.set(key, new Map());
		return byTime.get(key);
	};

	for (const [bone, entry] of doc.tracks) {
		if (!spec.bones.includes(bone)) continue;
		const keyTimes = new Map();
		for (const channel of ["rotation", "position"]) {
			for (const k of entry[channel]) if (!keyTimes.has(k.time) || channel === "rotation") keyTimes.set(k.time, k.ease);
		}
		const times = [...keyTimes.keys()].sort((a, b) => a - b);
		const samples = [];
		for (let i = 0; i < times.length; i++) {
			const t = times[i];
			const nextEase = i + 1 < times.length ? keyTimes.get(times[i + 1]) : "linear";
			const native = NATIVE_EASE[nextEase];
			samples.push({ t, ease: native || NATIVE_EASE.linear });
			if (!native && i + 1 < times.length) {
				const step = 1 / (doc.fps || 30);
				for (let s = t + step; s < times[i + 1] - 1e-4; s += step) samples.push({ t: s, ease: NATIVE_EASE.linear });
			}
		}
		for (const { t, ease } of samples) {
			const r = rest[bone];
			const rot = doc.sample(bone, "rotation", t, cache) || (r ? r.quaternion.toArray() : [0, 0, 0, 1]);
			const pos = doc.sample(bone, "position", t, cache) || (r ? r.position.toArray() : [0, 0, 0]);
			at(t).set(bone, { cf: poseCFrame(r, rot, pos, studs), ease });
		}
	}

	const keyframes = [];
	const times = [...byTime.keys()].sort((a, b) => a - b);
	const duration = Math.max(doc.duration || 0, times.length ? times[times.length - 1] : 0);
	if (!times.includes(duration) && duration > 0) times.push(duration);
	for (const t of times) {
		const poses = byTime.get(t) || new Map();
		const nodes = new Map();
		const node = (bone) => {
			if (nodes.has(bone)) return nodes.get(bone);
			const p = poses.get(bone);
			const rec = {
				ClassName: "Pose",
				Name: bone,
				Children: [],
				CFrame: p ? p.cf : [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
				Weight: p ? 1 : 0,
				EasingStyle: p ? p.ease[0] : "Linear",
				EasingDirection: p ? p.ease[1] : "In"
			};
			nodes.set(bone, rec);
			const parent = parentOf.get(bone);
			if (parent) node(parent).Children.push(rec);
			return rec;
		};
		for (const bone of poses.keys()) node(bone);
		const top = [...nodes.values()].filter((n) => !parentOf.get(n.Name));
		keyframes.push({ ClassName: "Keyframe", Name: "Keyframe", Time: t, Children: top });
	}
	return {
		ClassName: "KeyframeSequence",
		Name: doc.name || "Animation",
		Loop: doc.loop !== false,
		Priority: "Action",
		AuthoredHipHeight: hipHeight,
		Children: keyframes
	};
}

/* ---------- Place writer ---------- */

/**
 * @param {{ instances: object[], animations?: { model: object, root: object, docs: object[] }[], warn?: Function }} options
 * @returns {{ xml: string, stats: { items: number, scripts: number, keyframeSequences: number, guis: number, parts: number, skipped: string[] } }}
 */
export function buildRbxlx({ instances, animations = [], warn = () => {} }) {
	const stats = { items: 0, scripts: 0, keyframeSequences: 0, guis: 0, parts: 0, skipped: [] };
	const roots = instances.filter((r) => r && !NON_ARCHIVABLE_SERVICES.has(r.ClassName));

	const extras = new Map();
	const serverStorage = roots.find((r) => r.ClassName === "ServerStorage");
	if (serverStorage && animations.length) {
		const saves = { ClassName: "Model", Name: "RBX_ANIMSAVES", Children: [] };
		for (const { model, root, docs } of animations) {
			if (!docs.length) continue;
			const humanoid = (model.Children || []).find((c) => c.ClassName === "Humanoid");
			const holder = { ClassName: "ObjectValue", Name: model.Name, Value: model, Children: [] };
			for (const doc of docs) {
				holder.Children.push(keyframeSequenceFromDocument(doc, root, { hipHeight: humanoid ? Number(humanoid.HipHeight) || 2 : 2 }));
				stats.keyframeSequences++;
			}
			saves.Children.push(holder);
		}
		if (saves.Children.length) extras.set(serverStorage, [saves]);
	}
	const childrenOf = (rec) => [...(Array.isArray(rec.Children) ? rec.Children : []), ...(extras.get(rec) || [])].filter((c) => c && typeof c === "object" && c.ClassName && c.Archivable !== false);

	// Pass 1 (iterative): referents and parents, so Ref properties can point forward.
	const referent = new Map();
	const parent = new Map();
	const stack = roots.map((r) => [r, null]).reverse();
	while (stack.length) {
		const [rec, p] = stack.pop();
		if (referent.has(rec)) continue;
		referent.set(rec, `RBX${(referent.size + 1).toString(16).toUpperCase().padStart(8, "0")}`);
		if (p) parent.set(rec, p);
		const kids = childrenOf(rec);
		for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], rec]);
	}

	const refFrom = (owner) => (value) => {
		if (value && typeof value === "object") return referent.get(value) || null;
		if (typeof value === "string" && value) {
			// Rig records reference parts by name (Motor6D.Part0, Model.PrimaryPart): resolve inside the closest Model.
			let scope = owner;
			while (scope && scope.ClassName !== "Model" && parent.get(scope)) scope = parent.get(scope);
			const search = [scope || owner];
			while (search.length) {
				const r = search.pop();
				if (r !== owner && r.Name === value && referent.has(r)) return referent.get(r);
				search.push(...childrenOf(r));
			}
		}
		return null;
	};

	const out = [
		'<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
		'\t<Meta name="ExplicitAutoJoints">true</Meta>',
		"\t<External>null</External>",
		"\t<External>nil</External>"
	];

	// Pass 2 (iterative): open tag + properties, children, close tag.
	const work = roots.map((r) => ({ rec: r, depth: 1, close: false })).reverse();
	while (work.length) {
		const item = work.pop();
		const pad = "\t".repeat(item.depth);
		if (item.close) {
			out.push(`${pad}</Item>`);
			continue;
		}
		const rec = item.rec;
		const className = rec.ClassName;
		const known = !!API_CLASSES[className];
		if (!known) stats.skipped.push(className);
		stats.items++;
		if (className === "Script" || className === "LocalScript" || className === "ModuleScript") stats.scripts++;
		if (rec.__gui) stats.guis++;
		if (chainOf(className).includes("BasePart")) stats.parts++;

		out.push(`${pad}<Item class="${className}" referent="${referent.get(rec)}">`);
		out.push(`${pad}\t<Properties>`);
		const written = new Set();
		const props = known ? savableProps(className) : inferredProps(rec);
		const refOf = refFrom(rec);
		const write = (name, type, value) => {
			if (written.has(name) || value === undefined) return;
			const xml = writeValue(type, name, value, refOf);
			if (xml === null) return;
			written.add(name);
			out.push(`${pad}\t\t${xml}`);
		};
		write("Name", "string", rec.Name ?? className);
		const chain = known ? chainOf(className) : ["Instance"];
		for (const legacy of LEGACY_PROPS) {
			if (!chain.includes(legacy.isA)) continue;
			const value = legacy.get(rec);
			if (value !== null && value !== undefined) write(legacy.name, legacy.type, value);
		}
		for (const [name, type] of props) {
			if (name === "Name" || written.has(name)) continue;
			let value;
			for (const key of [name, lcfirst(name)]) {
				if (key in rec && rec[key] !== undefined) {
					value = rec[key];
					break;
				}
			}
			if (value === undefined && type === "PhysicalProperties" && chainOf(className).includes("BasePart")) value = null;
			if (value === undefined) continue;
			if (value === null && type !== "Ref" && type !== "PhysicalProperties") continue;
			write(name, type, value);
		}
		out.push(`${pad}\t</Properties>`);
		work.push({ rec, depth: item.depth, close: true });
		const kids = childrenOf(rec);
		for (let i = kids.length - 1; i >= 0; i--) work.push({ rec: kids[i], depth: item.depth + 1, close: false });
	}
	out.push("</roblox>");
	return { xml: out.join("\n"), stats };
}

/** Triggers a browser download of the generated place. */
export function downloadRbxlx(xml, fileName) {
	const blob = new Blob([xml], { type: "application/xml" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName.endsWith(".rbxlx") ? fileName : `${fileName}.rbxlx`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
