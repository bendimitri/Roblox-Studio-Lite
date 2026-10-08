import { Box3, Matrix4, Raycaster, Vector2 as TVector2, Vector3 as TVector3 } from '../thirdparty/three/three.module.js';
import { API_CLASSES, API_ENUMS } from '../datamodel/ApiSchema.js';
import { isService, scriptPlacementIssue } from '../datamodel/Services.js';
import { Signal as GuiSignal, createGuiInstance, guiClassOf, guiSchemaOf } from '../gui/GuiClasses.js';
import { Color3 as GuiColor3, UDim as GuiUDim, UDim2 as GuiUDim2, Vector2 as GuiVector2 } from '../gui/UDim2.js';
import { applyMaterialLook } from '../rendering/Materials.js';
import { partClasses } from '../rendering/StudioLiteRenderer.js';
import { isTypingTarget } from '../controls/InputFocus.js';
import { SoundEngine } from '../audio/SoundEngine.js';

/** Sound fields the SoundEngine writes during Play, restored on Stop. */
const SOUND_STATE = ["Playing", "IsPlaying", "IsPaused", "TimePosition", "TimeLength", "IsLoaded"];
/** Seconds an AnimationTrack runs when its KeyframeSequence is not available. */
const TRACK_LENGTH = 1;

/*
 * The DataModel side of the Luau runtime. Script-visible instances are the very records the
 * Explorer, the renderer and the exporter use; every change made from Luau goes through here,
 * is journaled, mirrored onto THREE meshes / GUI elements / the character, and rolled back on Stop.
 *
 * Values cross the VM boundary as flat tagged lists (see runtime.luau decode/encode):
 *   ["v", x] ["i", id] ["V3", x, y, z] ["CF", x, y, z, r00 … r22] ["C3", r, g, b] ["BC", r, g, b]
 *   ["U2", xs, xo, ys, yo] ["UD", s, o] ["V2", x, y] ["E", enumType, item] ["n"]
 *   ["NR", min, max] ["NS", n, (time, value, envelope)×n] ["CS", n, (time, r, g, b)×n]
 *   ["FT", family, weightName, styleName] ["RC", minX, minY, maxX, maxY]
 */

const RAD = Math.PI / 180;
const ABSENT = Symbol("absent");
const IDENTITY = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const NUMERIC = new Set(["int", "int64", "float", "double"]);
const STRINGY = new Set(["string", "ProtectedString", "Content", "BinaryString", "ContentId"]);
const VIRTUAL_SERVICES = new Set([
	"RunService", "UserInputService", "TweenService", "Debris", "ContextActionService", "HttpService", "CollectionService",
	"MarketplaceService", "PathfindingService", "PhysicsService", "BadgeService", "GuiService", "Chat", "TeleportService",
	"DataStoreService", "MessagingService", "LocalizationService", "GroupService", "SocialService", "VRService",
	"HapticService", "ProximityPromptService", "AnimationClipProvider", "KeyframeSequenceProvider", "ContentProvider",
	"InsertService", "AssetService", "TextService", "PolicyService", "StarterPlayer", "VoiceChatService"
]);
const BOOL_DEFAULTS = { CanCollide: true, CanTouch: true, CanQuery: true, CastShadow: true, Enabled: true, Visible: true, Archivable: true, ResetOnSpawn: true, AutoRotate: true, Locked: false, Interactable: true };

/** Properties and enums newer than the bundled API dump, merged into the schema once. */
const NEWER_PROPS = {
	GuiObject: { Interactable: "bool" },
	UIListLayout: { HorizontalFlex: "Enum:UIFlexAlignment", VerticalFlex: "Enum:UIFlexAlignment", ItemLineAlignment: "Enum:ItemLineAlignment", Wraps: "bool" }
};
const NEWER_CLASSES = {
	UIFlexItem: { s: API_CLASSES.UIComponent ? "UIComponent" : "Instance", p: {}, r: { FlexMode: "Enum:UIFlexMode", GrowRatio: "float", ShrinkRatio: "float", ItemLineAlignment: "Enum:ItemLineAlignment" }, e: [], f: [] }
};
for (const [cls, def] of Object.entries(NEWER_CLASSES)) API_CLASSES[cls] ??= def;
const NEWER_ENUMS = {
	PreferredInput: { KeyboardAndMouse: 0, Gamepad: 1, Touch: 2 },
	PreferredTextSize: { Medium: 1, Large: 2, Larger: 3, Largest: 4 },
	DisplaySize: { Small: 0, Medium: 1, Large: 2 },
	PlayerCharacterDestroyBehavior: { Default: 0, Disabled: 1, Enabled: 2 },
	ScreenInsets: { None: 0, DeviceSafeInsets: 1, CoreUISafeInsets: 2, TopbarSafeInsets: 3 },
	UIFlexAlignment: { None: 0, Fill: 1, SpaceAround: 2, SpaceBetween: 3, SpaceEvenly: 4 },
	ItemLineAlignment: { Automatic: 0, Start: 1, Center: 2, End: 3, Stretch: 4 },
	UIFlexMode: { None: 0, Grow: 1, Shrink: 2, Fill: 3, Custom: 4 }
};
for (const [cls, props] of Object.entries(NEWER_PROPS)) {
	if (API_CLASSES[cls]) for (const [k, t] of Object.entries(props)) API_CLASSES[cls].r[k] ??= t;
}
for (const [name, items] of Object.entries(NEWER_ENUMS)) API_ENUMS[name] = { ...items, ...API_ENUMS[name] };
const NUMBER_DEFAULTS = { Health: 100, MaxHealth: 100, WalkSpeed: 16, JumpPower: 50, JumpHeight: 7.2, Gravity: 196.2, RespawnTime: 5, MaxPlayers: 1, FieldOfView: 70, MaxActivationDistance: 32 };
const PART_DEFAULTS = () => ({
	Size: { X: 4, Y: 1, Z: 2 },
	CFrame: { Position: { X: 0, Y: 0, Z: 0 }, Orientation: { X: 0, Y: 0, Z: 0 }, Components: IDENTITY.slice() },
	Color3: { R: 163 / 255, G: 162 / 255, B: 165 / 255 },
	Material: "Plastic",
	Transparency: 0,
	Reflectance: 0,
	Anchored: false,
	CanCollide: true,
	CanTouch: true,
	Locked: false,
	TopSurface: "Smooth",
	BottomSurface: "Smooth"
});

/** Members newer than the bundled API dump: fixed values (["ev"] = event, ["fn"] = host method). */
const NEWER_MEMBERS = {
	GuiService: {
		PreferredTransparency: ["v", 1], PreferredTransparencyChanged: ["ev"], ReducedMotionEnabled: ["v", false],
		PreferredTextSize: ["E", "PreferredTextSize", "Medium"], TopbarInset: ["RC", 0, 0, 1920, 58], ViewportDisplaySize: ["E", "DisplaySize", "Medium"]
	},
	UserInputService: { PreferredInput: ["E", "PreferredInput", "KeyboardAndMouse"], GetImageForKeyCode: ["fn"] },
	ContentProvider: { GetAssetFetchStatus: ["fn"] },
	Players: { BanningEnabled: ["v", false], UseStrafingAnimations: ["v", false] },
	Player: { LocaleId: ["v", "en-us"], PlatformName: ["v", ""], OsPlatform: ["v", ""] },
	LocalizationService: { RobloxLocaleId: ["v", "en-us"], SystemLocaleId: ["v", "en-us"] },
	TextChatService: { ChatVersion: ["E", "ChatVersion", "TextChatService"] },
	Workspace: { PlayerCharacterDestroyBehavior: ["E", "PlayerCharacterDestroyBehavior", "Default"] }
};

const KIND_NAMES = {
	i: "Instance", n: "nil", V3: "Vector3", V2: "Vector2", CF: "CFrame", C3: "Color3", BC: "BrickColor", U2: "UDim2", UD: "UDim",
	E: "EnumItem", NR: "NumberRange", NS: "NumberSequence", CS: "ColorSequence", FT: "Font", RC: "Rect"
};
const FONT_WEIGHTS = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 };
const FONT_WEIGHT_NAMES = Object.fromEntries(Object.entries(FONT_WEIGHTS).map(([k, v]) => [v, k]));

function encodeNumberSequence(value) {
	const kps = Array.isArray(value) && value.length >= 2 ? value : [{ Time: 0, Value: 0 }, { Time: 1, Value: 0 }];
	return ["NS", kps.length, ...kps.flatMap((k) => [+k.Time, +k.Value, +(k.Envelope || 0)])];
}

function encodeColorSequence(value) {
	const kps = Array.isArray(value) && value.length >= 2 ? value : [{ Time: 0, Color: { R: 1, G: 1, B: 1 } }, { Time: 1, Color: { R: 1, G: 1, B: 1 } }];
	return ["CS", kps.length, ...kps.flatMap((k) => {
		const c = k.Color || k.Value || { R: 1, G: 1, B: 1 };
		return [+k.Time, +c.R, +c.G, +c.B];
	})];
}

function encodeFont(value) {
	const family = value && typeof value.Family === "string" ? value.Family : "rbxasset://fonts/families/SourceSansPro.json";
	const weight = value && (FONT_WEIGHT_NAMES[Math.round(Number(value.Weight) / 100) * 100] || (FONT_WEIGHTS[value.Weight] ? value.Weight : null));
	const style = value && (value.Style === "Italic" || value.Style === 1) ? "Italic" : "Normal";
	return ["FT", family, weight || "Regular", style];
}

/** Attribute value in the parser's plain shape -> tagged value (type inferred from the shape). */
function attributeTag(v) {
	if (v === undefined || v === null) return ["n"];
	if (typeof v !== "object") return ["v", v];
	if (Array.isArray(v)) return v.length && (v[0].Color || v[0].Value && typeof v[0].Value === "object") ? encodeColorSequence(v) : encodeNumberSequence(v);
	if ("Family" in v) return encodeFont(v);
	if ("EnumType" in v) return ["E", v.EnumType, enumName(v.EnumType, v.Value) || firstEnumItem(v.EnumType)];
	if ("Number" in v && v.Color) return ["BC", +v.Color.R, +v.Color.G, +v.Color.B];
	if ("R" in v) return ["C3", +v.R, +v.G, +v.B];
	if ("Components" in v) return ["CF", ...v.Components.map(Number)];
	if (v.X && typeof v.X === "object") return ["U2", +v.X.Scale, +v.X.Offset, +v.Y.Scale, +v.Y.Offset];
	if ("Scale" in v) return ["UD", +v.Scale, +v.Offset];
	if (v.Min && typeof v.Min === "object") return ["RC", +v.Min.X, +v.Min.Y, +v.Max.X, +v.Max.Y];
	if ("Min" in v) return ["NR", +v.Min, +v.Max];
	if ("Z" in v) return ["V3", +v.X, +v.Y, +v.Z];
	if ("X" in v) return ["V2", +v.X, +v.Y];
	return ["n"];
}

/** Decoded tagged value -> plain shape stored in AttributesSerialize. */
function attributeValue(val) {
	switch (val.kind) {
		case "CF": return { Position: { X: val.value[0], Y: val.value[1], Z: val.value[2] }, Components: val.value };
		case "E": return { EnumType: val.value.enumType, Value: val.value.name };
		case "BC": return { Number: 0, Color: val.value };
		default: return val.value;
	}
}

/* ---------- API schema helpers ---------- */

const chainCache = new Map();
function classChain(className) {
	let chain = chainCache.get(className);
	if (!chain) {
		chain = [];
		for (let c = className; c && API_CLASSES[c]; c = API_CLASSES[c].s) chain.push(c);
		chainCache.set(className, chain);
	}
	return chain;
}

function propType(className, key) {
	for (const c of classChain(className)) {
		const cls = API_CLASSES[c];
		if (Object.hasOwn(cls.r, key)) return cls.r[key];
		if (Object.hasOwn(cls.p, key)) return cls.p[key];
	}
	return null;
}

function hasMember(className, key, kind) {
	return classChain(className).some((c) => API_CLASSES[c][kind].includes(key));
}

function enumName(enumType, value) {
	const items = API_ENUMS[enumType];
	if (!items) return null;
	if (typeof value === "string") return Object.hasOwn(items, value) ? value : null;
	if (value && typeof value === "object") return enumName(enumType, value.Name ?? value.name ?? value.Value);
	if (typeof value === "number" || typeof value === "bigint") {
		const n = Number(value);
		for (const [name, v] of Object.entries(items)) if (v === n) return name;
	}
	return null;
}

function firstEnumItem(enumType) {
	const items = API_ENUMS[enumType];
	return items ? Object.keys(items)[0] : null;
}

/* ---------- CFrame math on [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] ---------- */

function cfMul(a, b) {
	return [
		a[0] + a[3] * b[0] + a[4] * b[1] + a[5] * b[2],
		a[1] + a[6] * b[0] + a[7] * b[1] + a[8] * b[2],
		a[2] + a[9] * b[0] + a[10] * b[1] + a[11] * b[2],
		a[3] * b[3] + a[4] * b[6] + a[5] * b[9], a[3] * b[4] + a[4] * b[7] + a[5] * b[10], a[3] * b[5] + a[4] * b[8] + a[5] * b[11],
		a[6] * b[3] + a[7] * b[6] + a[8] * b[9], a[6] * b[4] + a[7] * b[7] + a[8] * b[10], a[6] * b[5] + a[7] * b[8] + a[8] * b[11],
		a[9] * b[3] + a[10] * b[6] + a[11] * b[9], a[9] * b[4] + a[10] * b[7] + a[11] * b[10], a[9] * b[5] + a[10] * b[8] + a[11] * b[11]
	];
}

function cfInv(a) {
	const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = a;
	return [
		-(r00 * x + r10 * y + r20 * z), -(r01 * x + r11 * y + r21 * z), -(r02 * x + r12 * y + r22 * z),
		r00, r10, r20, r01, r11, r21, r02, r12, r22
	];
}

function orientationOf(c) {
	const x = Math.asin(Math.max(-1, Math.min(1, -c[8])));
	return { X: x / RAD, Y: Math.atan2(c[5], c[11]) / RAD, Z: Math.atan2(c[6], c[7]) / RAD };
}

/** Roblox Orientation (degrees, applied Y then X then Z) -> rotation part. */
function rotationFromOrientation(o) {
	const [x, y, z] = [o.X * RAD, o.Y * RAD, o.Z * RAD];
	const ry = [0, 0, 0, Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
	const rx = [0, 0, 0, 1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)];
	const rz = [0, 0, 0, Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1];
	return cfMul(cfMul(ry, rx), rz).slice(3);
}

function cfOf(rec) {
	const cf = rec.CFrame || rec.CoordinateFrame;
	if (cf && Array.isArray(cf.Components) && cf.Components.length >= 12) return cf.Components.slice(0, 12).map(Number);
	if (cf && cf.Position) return [cf.Position.X, cf.Position.Y, cf.Position.Z, ...IDENTITY.slice(3)];
	return IDENTITY.slice();
}

function writeCF(rec, c) {
	if (!rec.CFrame || typeof rec.CFrame !== "object") rec.CFrame = {};
	const cf = rec.CFrame;
	cf.Position = { X: c[0], Y: c[1], Z: c[2] };
	cf.Components = c.slice(0, 12);
	cf.Orientation = orientationOf(c);
}

const KEY_NAMES = {
	Space: "Space", Enter: "Return", NumpadEnter: "KeypadEnter", Escape: "Escape", Tab: "Tab", Backspace: "Backspace",
	ShiftLeft: "LeftShift", ShiftRight: "RightShift", ControlLeft: "LeftControl", ControlRight: "RightControl",
	AltLeft: "LeftAlt", AltRight: "RightAlt", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
	CapsLock: "CapsLock", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
	Minus: "Minus", Equal: "Equals", BracketLeft: "LeftBracket", BracketRight: "RightBracket", Semicolon: "Semicolon",
	Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash", Backslash: "BackSlash", Backquote: "Backquote"
};
const DIGITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function keyCodeName(e) {
	const c = e.code || "";
	let name = KEY_NAMES[c];
	if (!name && /^Key[A-Z]$/.test(c)) name = c.slice(3);
	else if (!name && /^Digit\d$/.test(c)) name = DIGITS[+c[5]];
	else if (!name && /^Numpad\d$/.test(c)) name = `Keypad${DIGITS[+c[6]]}`;
	else if (!name && /^F\d{1,2}$/.test(c)) name = c;
	return name && Object.hasOwn(API_ENUMS.KeyCode, name) ? name : "Unknown";
}

export class RobloxBridge {
	/**
	 * @param {{ renderer, gui, print: Function, viewport: HTMLElement, hooks?: { onScriptsAdded?(records): void, onKick?(msg): void } }} options
	 */
	constructor({ renderer, gui, print, viewport, hooks = {} }) {
		this.renderer = renderer;
		this.gui = gui;
		this.print = print;
		this.viewport = viewport;
		this.hooks = hooks;
		this.running = false;
	}

	/* ---------- Session ---------- */

	/** @param {{ player: import('../play/PlayerController.js').PlayerController, placeName: string }} session */
	start({ player, placeName }) {
		this.running = true;
		this.player = player;
		this.ids = new Map();
		this.records = [null];
		this.parents = new Map();
		this.parentOverride = new Map();
		this.originals = new WeakSet();
		this.childSnapshot = new Map();
		this.journal = new Map();
		this.locked = new WeakSet();
		this.deadNpcs = new WeakSet();
		this.virtual = new Map();
		this.virtualServices = new Map();
		this.listens = new Map();
		this.touchWatch = new Set();
		this.touching = new Set();
		this.boxCache = new Map();
		this.meshes = new Map();
		this.originalVisible = new Map();
		this.createdMeshes = new Set();
		this.pendingMeshes = new Set();
		this.dirtyColliders = new Set();
		this.guiConnections = [];
		this.queue = [];
		this.warned = new Set();
		this.moveTarget = null;
		this.mouse = { x: 0, y: 0, moved: false, dx: 0, dy: 0 };
		this._leaderText = "";
		this._leaderTimer = 0;
		this._characterAddedIn = 0;

		const data = this.renderer.data || [];
		this.dataModel = { ClassName: "DataModel", Name: placeName || "Place", Children: data };
		this.workspace = data.find((r) => r && r.ClassName === "Workspace") || null;
		this.starterGui = data.find((r) => r && r.ClassName === "StarterGui") || null;
		this.playersService = data.find((r) => r && r.ClassName === "Players") || null;

		const walk = (rec, parent) => {
			if (!rec || typeof rec !== "object") return;
			this.originals.add(rec);
			if (parent) this.parents.set(rec, parent);
			if (!Array.isArray(rec.Children)) rec.Children = [];
			this.childSnapshot.set(rec, rec.Children.slice());
			for (const child of rec.Children) walk(child, rec);
		};
		this.childSnapshot.set(this.dataModel, data.slice());
		for (const rec of data) walk(rec, this.dataModel);

		this.renderer.scene.traverse((o) => {
			const inst = o.isMesh && o.userData.instance;
			if (!inst || this.meshes.has(inst)) return;
			this.meshes.set(inst, o);
			this.originalVisible.set(o, o.visible);
		});

		this._buildPlayer();
		this._attachInput();
		this._buildLeaderboard();

		this.sounds = new SoundEngine({
			emit: (rec, name, ...tags) => this.emit(rec, name, false, ...tags),
			warn: (key, message) => this._warnOnce(key, message),
			touch: (rec) => {
				for (const key of SOUND_STATE) this._remember(rec, key);
			},
			positionOf: (rec) => {
				let p = this.parentOf(rec);
				if (p && p.ClassName === "Attachment") p = this.parentOf(p);
				return p && this._isPart(p) ? cfOf(p).slice(0, 3) : null;
			},
			listener: () => {
				const c = this.renderer.camera.position;
				return [c.x, c.y, c.z];
			},
			groupVolume: (rec) => (rec.SoundGroup && typeof rec.SoundGroup === "object" ? Number(rec.SoundGroup.Volume ?? 0.5) / 0.5 : 1)
		});
		const autoplay = (rec) => {
			if (!rec || typeof rec !== "object") return;
			if (rec.ClassName === "Sound" && rec.Playing === true) this.sounds.play(rec);
			for (const child of rec.Children || []) autoplay(child);
		};
		for (const rec of data) if (rec && (rec.ClassName === "Workspace" || rec.ClassName === "SoundService")) autoplay(rec);
	}

	stop() {
		if (!this.running) return;
		this.running = false;
		this.sounds?.stopAll();
		this._detachInput();
		for (const off of this.guiConnections) off();
		this.leaderboard?.remove();
		this.leaderboard = null;

		for (const mesh of this.createdMeshes) {
			mesh.removeFromParent();
			mesh.geometry?.dispose();
		}
		for (const [rec, list] of this.childSnapshot) {
			if (rec === this.dataModel) continue;
			const current = rec.Children;
			for (const child of current) if (child && child.__gui && !list.includes(child)) child.__gui.parent = null;
			if (current.length !== list.length || current.some((c, i) => c !== list[i])) current.splice(0, current.length, ...list);
		}
		const touched = new Set();
		for (const [rec, saved] of this.journal) {
			for (const [key, value] of saved) {
				if (value === ABSENT) delete rec[key];
				else rec[key] = value;
			}
			touched.add(rec);
		}
		for (const [mesh, visible] of this.originalVisible) mesh.visible = visible;
		for (const rec of touched) this._syncMesh(rec, { restoring: true });
		this.player = null;
		this.records = [null];
		this.ids.clear();
		this.journal.clear();
		this.childSnapshot.clear();
	}

	/* ---------- Ids & tree ---------- */

	idOf(rec) {
		if (!rec) return null;
		let id = this.ids.get(rec);
		if (id === undefined) {
			id = this.records.push(rec) - 1;
			this.ids.set(rec, id);
		}
		return id;
	}

	rec(id) {
		return this.records[id] || null;
	}

	parentOf(rec) {
		if (this.parentOverride.has(rec)) return this.parentOverride.get(rec);
		const p = this.parents.get(rec) ?? null;
		if (p && p === this.starterGui && this.playerGui) return this.playerGui;
		return p;
	}

	childrenOf(rec) {
		if (rec === this.playerGui) return this.starterGui ? this.starterGui.Children : [];
		return Array.isArray(rec.Children) ? rec.Children : [];
	}

	isA(rec, className) {
		if (!rec) return false;
		if (rec.ClassName === className) return true;
		return classChain(rec.ClassName).includes(className);
	}

	fullName(rec) {
		const names = [];
		for (let r = rec; r && r !== this.dataModel; r = this.parentOf(r)) names.unshift(r.Name ?? r.ClassName);
		return names.join(".");
	}

	_isPart(rec) {
		return !!rec && rec.Size && typeof rec.Size === "object" && !!(rec.CFrame || rec.CoordinateFrame || this.isA(rec, "BasePart"));
	}

	_inWorkspace(rec) {
		for (let r = rec; r; r = this.parents.get(r)) if (r === this.workspace) return true;
		return false;
	}

	_subtree(rec, out = []) {
		out.push(rec);
		for (const c of this.childrenOf(rec)) if (c) this._subtree(c, out);
		return out;
	}

	tagRec(rec) {
		return rec ? ["i", this.idOf(rec)] : ["n"];
	}

	/* ---------- Event queue (drained by the runtime every frame) ---------- */

	listen(id, name) {
		const rec = this.rec(id);
		if (!rec) return;
		let set = this.listens.get(rec);
		if (!set) this.listens.set(rec, (set = new Set()));
		if (set.has(name)) return;
		set.add(name);
		if (name === "Touched" || name === "TouchEnded") this.touchWatch.add(rec);
		const signal = rec.__gui ? rec[name] : null;
		if (signal instanceof GuiSignal) {
			const conn = signal.Connect((arg) => {
				const primitive = typeof arg === "boolean" || typeof arg === "number" || typeof arg === "string";
				this.emit(rec, name, true, ...(primitive ? [["v", arg]] : []));
			});
			this.guiConnections.push(() => conn.Disconnect());
		}
	}

	emit(rec, name, force, ...tags) {
		if (!force) {
			const set = this.listens.get(rec);
			if (!set || !set.has(name)) return;
		}
		this.queue.push(this.idOf(rec), name, tags.length, ...tags.flat());
	}

	/** Raw control event for the runtime (e.g. "__run", "__player"). */
	control(rec, name) {
		this.queue.push(this.idOf(rec), name, 0);
	}

	takeQueue() {
		const q = this.queue;
		this.queue = [];
		return q;
	}

	/* ---------- Property access ---------- */

	get(id, key) {
		const rec = this.rec(id);
		if (!rec) return ["x", "A instância não existe mais"];
		if (typeof key !== "string") return ["x", `${String(key)} is not a valid member of ${rec.ClassName}`];
		const hook = this.virtual.get(rec);
		if (hook && hook.get) {
			const r = hook.get(key);
			if (r) return r;
		}
		switch (key) {
			case "Parent": return this.tagRec(this.parentOf(rec));
			case "Name": return ["v", String(rec.Name ?? rec.ClassName)];
			case "ClassName": return ["v", rec.ClassName];
			case "Archivable": return ["v", rec.Archivable !== false];
		}
		if (rec.__gui) {
			const r = this._getGui(rec, key);
			if (r) return r;
		}
		if (this._isPart(rec)) {
			const r = this._getPart(rec, key);
			if (r) return r;
		}
		if (rec.ClassName === "Sound") {
			const r = this.sounds.read(rec, key);
			if (r) return r;
		}
		const type = propType(rec.ClassName, key);
		if (type) return this._tag(rec, key, type);
		const extra = NEWER_MEMBERS[rec.ClassName]?.[key];
		if (extra) return typeof extra === "function" ? extra(this, rec) : extra;
		if (hasMember(rec.ClassName, key, "e")) return ["ev"];
		if (hasMember(rec.ClassName, key, "f")) return ["fn"];
		const child = this.childrenOf(rec).find((c) => c && c.Name === key);
		if (child) return ["i", this.idOf(child)];
		if (!API_CLASSES[rec.ClassName] && Object.hasOwn(rec, key) && rec[key] !== null && typeof rec[key] !== "object") return ["v", rec[key]];
		return ["x", `${key} is not a valid member of ${rec.ClassName} "${this.fullName(rec)}"`];
	}

	_tag(rec, key, type) {
		const value = rec[key];
		if (type === "bool") return ["v", value === undefined ? (BOOL_DEFAULTS[key] ?? false) : !!value];
		if (NUMERIC.has(type)) return ["v", value === undefined || value === null ? (NUMBER_DEFAULTS[key] ?? 0) : Number(value)];
		if (STRINGY.has(type)) return ["v", value === undefined || value === null ? "" : typeof value === "object" ? String(value.url ?? value.Url ?? "") : String(value)];
		if (type === "Vector3") return value && "X" in value ? ["V3", +value.X, +value.Y, +value.Z] : ["V3", 0, 0, 0];
		if (type === "Vector2") return value && "X" in value ? ["V2", +value.X, +value.Y] : ["V2", 0, 0];
		if (type === "CFrame") return ["CF", ...(value ? cfOf({ CFrame: value }) : IDENTITY)];
		if (type === "Color3") return value && "R" in value ? ["C3", +value.R, +value.G, +value.B] : ["C3", 1, 1, 1];
		if (type === "UDim2") return value && value.X ? ["U2", +value.X.Scale, +value.X.Offset, +value.Y.Scale, +value.Y.Offset] : ["U2", 0, 0, 0, 0];
		if (type === "UDim") return value ? ["UD", +value.Scale, +value.Offset] : ["UD", 0, 0];
		if (type === "BrickColor") {
			const c = rec.Color3 || (rec.BrickColor && rec.BrickColor.Color ? { R: rec.BrickColor.Color.R / 255, G: rec.BrickColor.Color.G / 255, B: rec.BrickColor.Color.B / 255 } : { R: 0.64, G: 0.64, B: 0.65 });
			return ["BC", c.R, c.G, c.B];
		}
		if (type.startsWith("Enum:")) {
			const enumType = type.slice(5);
			return ["E", enumType, enumName(enumType, value) || firstEnumItem(enumType)];
		}
		if (type === "Ref") return value && typeof value === "object" && value.ClassName ? ["i", this.idOf(value)] : ["n"];
		if (type === "NumberSequence") return encodeNumberSequence(value);
		if (type === "ColorSequence") return encodeColorSequence(value);
		if (type === "NumberRange") return value && "Min" in value ? ["NR", +value.Min, +value.Max] : ["NR", 0, 0];
		if (type === "Rect") return value && value.Min ? ["RC", +value.Min.X, +value.Min.Y, +value.Max.X, +value.Max.Y] : ["RC", 0, 0, 0, 0];
		if (type === "Font") return encodeFont(value);
		return ["n"];
	}

	_getPart(rec, key) {
		switch (key) {
			case "Position": {
				const c = cfOf(rec);
				return ["V3", c[0], c[1], c[2]];
			}
			case "CFrame": return ["CF", ...cfOf(rec)];
			case "Orientation":
			case "Rotation": {
				const o = orientationOf(cfOf(rec));
				return ["V3", o.X, o.Y, o.Z];
			}
			case "Size": return ["V3", +rec.Size.X, +rec.Size.Y, +rec.Size.Z];
			case "Color": {
				const c = rec.Color3 || { R: 0.64, G: 0.64, B: 0.65 };
				return ["C3", c.R, c.G, c.B];
			}
			case "BrickColor": return this._tag(rec, key, "BrickColor");
			case "Material": return ["E", "Material", enumName("Material", rec.Material) || "Plastic"];
			case "Shape": return ["E", "PartType", enumName("PartType", rec.Shape) || "Block"];
			case "AssemblyLinearVelocity":
			case "AssemblyAngularVelocity":
			case "Velocity":
			case "RotVelocity": return ["V3", 0, 0, 0];
			case "Mass":
			case "AssemblyMass": return ["v", rec.Size.X * rec.Size.Y * rec.Size.Z * 0.7];
		}
		return null;
	}

	_getGui(rec, key) {
		const spec = guiSchemaOf(rec)[key];
		if (spec && spec.type !== "raw") {
			const v = rec[key];
			switch (spec.type) {
				case "UDim": return ["UD", v.Scale, v.Offset];
				case "UDim2": return ["U2", v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset];
				case "Vector2": return ["V2", v.X, v.Y];
				case "Color3": return ["C3", v.R, v.G, v.B];
				case "enum": return ["E", spec.enum, v];
				default: return ["v", v];
			}
		}
		if (key === "AbsolutePosition" || key === "AbsoluteSize") {
			const el = this.gui.elementOf(rec);
			const root = this.gui.overlay.getBoundingClientRect();
			const r = el ? el.getBoundingClientRect() : { left: root.left, top: root.top, width: 0, height: 0 };
			return key === "AbsolutePosition" ? ["V2", r.left - root.left, r.top - root.top] : ["V2", r.width, r.height];
		}
		if (rec[key] instanceof GuiSignal) return ["ev"];
		return null;
	}

	/** Decodes one tagged value from a flat argument list starting at `i`. */
	decodeArg(args, i) {
		const k = args[i];
		switch (k) {
			case "n": return { kind: k, value: null, next: i + 1 };
			case "v": return { kind: k, value: args[i + 1], next: i + 2 };
			case "i": return { kind: k, value: this.rec(args[i + 1]), next: i + 2 };
			case "V3": return { kind: k, value: { X: args[i + 1], Y: args[i + 2], Z: args[i + 3] }, next: i + 4 };
			case "V2": return { kind: k, value: { X: args[i + 1], Y: args[i + 2] }, next: i + 3 };
			case "CF": return { kind: k, value: args.slice(i + 1, i + 13).map(Number), next: i + 13 };
			case "C3":
			case "BC": return { kind: k, value: { R: args[i + 1], G: args[i + 2], B: args[i + 3] }, next: i + 4 };
			case "U2": return { kind: k, value: { X: { Scale: args[i + 1], Offset: args[i + 2] }, Y: { Scale: args[i + 3], Offset: args[i + 4] } }, next: i + 5 };
			case "UD": return { kind: k, value: { Scale: args[i + 1], Offset: args[i + 2] }, next: i + 3 };
			case "E": return { kind: k, value: { enumType: args[i + 1], name: args[i + 2] }, next: i + 3 };
			case "NR": return { kind: k, value: { Min: args[i + 1], Max: args[i + 2] }, next: i + 3 };
			case "NS": {
				const n = args[i + 1], value = [];
				for (let j = 0; j < n; j++) value.push({ Time: args[i + 2 + j * 3], Value: args[i + 3 + j * 3], Envelope: args[i + 4 + j * 3] });
				return { kind: k, value, next: i + 2 + n * 3 };
			}
			case "CS": {
				const n = args[i + 1], value = [];
				for (let j = 0; j < n; j++) {
					const b = i + 2 + j * 4;
					value.push({ Time: args[b], Color: { R: args[b + 1], G: args[b + 2], B: args[b + 3] } });
				}
				return { kind: k, value, next: i + 2 + n * 4 };
			}
			case "FT": return { kind: k, value: { Family: args[i + 1], Weight: FONT_WEIGHTS[args[i + 2]] || 400, Style: args[i + 3] || "Normal" }, next: i + 4 };
			case "RC": return { kind: k, value: { Min: { X: args[i + 1], Y: args[i + 2] }, Max: { X: args[i + 3], Y: args[i + 4] } }, next: i + 5 };
		}
		return { kind: "n", value: null, next: args.length };
	}

	decodeArgs(args) {
		const out = [];
		for (let i = 0; i < args.length;) {
			const d = this.decodeArg(args, i);
			out.push(d);
			i = d.next;
		}
		return out;
	}

	_remember(rec, key) {
		if (!this.originals.has(rec)) return;
		let saved = this.journal.get(rec);
		if (!saved) this.journal.set(rec, (saved = new Map()));
		if (saved.has(key)) return;
		if (!Object.hasOwn(rec, key) && !(rec.__gui && key in rec)) {
			saved.set(key, ABSENT);
			return;
		}
		const value = rec[key];
		let copy = value;
		if (value && typeof value === "object" && !value.ClassName && !rec.__gui) {
			try {
				copy = structuredClone(value);
			} catch {
				copy = value;
			}
		}
		saved.set(key, copy);
	}

	set(id, key, ...args) {
		const rec = this.rec(id);
		if (!rec) return "A instância não existe mais";
		const val = this.decodeArg(args, 0);
		const hook = this.virtual.get(rec);
		if (hook && hook.set) {
			const r = hook.set(key, val);
			if (r !== undefined) return r || undefined;
		}
		if (key === "Parent") {
			if (val.kind !== "i" && val.kind !== "n") return `Unable to assign property Parent. Object expected, got ${val.kind === "v" ? typeof val.value : val.kind}`;
			return this.setParent(rec, val.value);
		}
		if (key === "Name") {
			if (val.kind !== "v" || (typeof val.value !== "string" && typeof val.value !== "number")) return "Unable to assign property Name. string expected";
			this._remember(rec, "Name");
			rec.Name = String(val.value);
			return;
		}
		if (key === "ClassName") return "Unable to assign property ClassName. Property is read only";
		if (rec.__gui) {
			const r = this._setGui(rec, key, val);
			if (r !== undefined) return r || undefined;
		}
		if (this._isPart(rec)) {
			const r = this._setPart(rec, key, val);
			if (r !== undefined) return r || undefined;
		}
		const type = propType(rec.ClassName, key);
		if (!type) {
			if (hasMember(rec.ClassName, key, "e") || hasMember(rec.ClassName, key, "f")) return `Unable to assign property ${key}. Property is read only`;
			return `${key} is not a valid member of ${rec.ClassName} "${this.fullName(rec)}"`;
		}
		const converted = this._convert(type, val, key);
		if (converted.error) return converted.error;
		this._remember(rec, key);
		rec[key] = converted.value;
		if (rec.ClassName === "Sound") this.sounds.sync(rec, key);
		if (rec.ClassName === "Humanoid" && key === "Health") {
			this.emit(rec, "HealthChanged", false, ["v", converted.value]);
			if (converted.value <= 0 && !this.deadNpcs.has(rec)) {
				this.deadNpcs.add(rec);
				this.emit(rec, "Died", false);
			}
		}
		if ((key === "Disabled" && converted.value === false) || (key === "Enabled" && converted.value === true && rec.ClassName.endsWith("Script"))) {
			this.hooks.onScriptsAdded?.([rec]);
		}
	}

	_convert(type, val, key) {
		const got = val.kind === "v" ? typeof val.value : KIND_NAMES[val.kind];
		const fail = (expected) => ({ error: `Unable to assign property ${key}. ${expected} expected, got ${got}` });
		if (type === "bool") return val.kind === "v" && typeof val.value === "boolean" ? { value: val.value } : fail("bool");
		if (NUMERIC.has(type)) return val.kind === "v" && typeof val.value === "number" ? { value: type.startsWith("int") ? Math.trunc(val.value) : val.value } : fail("number");
		if (STRINGY.has(type)) return val.kind === "v" && (typeof val.value === "string" || typeof val.value === "number") ? { value: String(val.value) } : fail("string");
		if (type === "Vector3") return val.kind === "V3" ? { value: val.value } : fail("Vector3");
		if (type === "Vector2") return val.kind === "V2" ? { value: val.value } : fail("Vector2");
		if (type === "Color3") return val.kind === "C3" ? { value: val.value } : fail("Color3");
		if (type === "UDim2") return val.kind === "U2" ? { value: val.value } : fail("UDim2");
		if (type === "UDim") return val.kind === "UD" ? { value: val.value } : fail("UDim");
		if (type === "CFrame") {
			if (val.kind !== "CF") return fail("CFrame");
			const c = val.value;
			return { value: { Position: { X: c[0], Y: c[1], Z: c[2] }, Components: c, Orientation: orientationOf(c) } };
		}
		if (type.startsWith("Enum:")) {
			const enumType = type.slice(5);
			let name = null;
			if (val.kind === "E" && val.value.enumType === enumType) name = val.value.name;
			else if (val.kind === "v") name = enumName(enumType, val.value);
			return name ? { value: name } : { error: `Unable to assign property ${key}. EnumItem of type ${enumType} expected` };
		}
		if (type === "Ref") return val.kind === "i" || val.kind === "n" ? { value: val.value } : fail("Instance");
		if (type === "NumberSequence") {
			if (val.kind === "NS") return { value: val.value };
			if (val.kind === "v" && typeof val.value === "number") return { value: [{ Time: 0, Value: val.value, Envelope: 0 }, { Time: 1, Value: val.value, Envelope: 0 }] };
			return fail("NumberSequence");
		}
		if (type === "ColorSequence") {
			if (val.kind === "CS") return { value: val.value };
			if (val.kind === "C3") return { value: [{ Time: 0, Color: val.value }, { Time: 1, Color: val.value }] };
			return fail("ColorSequence");
		}
		if (type === "NumberRange") {
			if (val.kind === "NR") return { value: val.value };
			if (val.kind === "v" && typeof val.value === "number") return { value: { Min: val.value, Max: val.value } };
			return fail("NumberRange");
		}
		if (type === "Rect") return val.kind === "RC" ? { value: val.value } : fail("Rect");
		if (type === "Font") return val.kind === "FT" ? { value: val.value } : fail("Font");
		return { error: `Unable to assign property ${key}. Tipo ${type} ainda não é suportado no Studio Lite` };
	}

	_setPart(rec, key, val) {
		const need = (kind, label) => (val.kind === kind ? null : `Unable to assign property ${key}. ${label} expected`);
		switch (key) {
			case "Position": {
				const err = need("V3", "Vector3");
				if (err) return err;
				this._remember(rec, "CFrame");
				const c = cfOf(rec);
				c[0] = val.value.X; c[1] = val.value.Y; c[2] = val.value.Z;
				writeCF(rec, c);
				break;
			}
			case "CFrame": {
				const err = need("CF", "CFrame");
				if (err) return err;
				this._remember(rec, "CFrame");
				writeCF(rec, val.value);
				break;
			}
			case "Orientation":
			case "Rotation": {
				const err = need("V3", "Vector3");
				if (err) return err;
				this._remember(rec, "CFrame");
				const c = cfOf(rec);
				writeCF(rec, [c[0], c[1], c[2], ...rotationFromOrientation(val.value)]);
				break;
			}
			case "Size": {
				const err = need("V3", "Vector3");
				if (err) return err;
				this._remember(rec, "Size");
				rec.Size = { X: Math.max(0.001, val.value.X), Y: Math.max(0.001, val.value.Y), Z: Math.max(0.001, val.value.Z) };
				break;
			}
			case "Color":
			case "BrickColor": {
				if (val.kind !== "C3" && val.kind !== "BC") return `Unable to assign property ${key}. ${key === "Color" ? "Color3" : "BrickColor"} expected`;
				this._remember(rec, "Color3");
				rec.Color3 = { ...val.value };
				break;
			}
			case "Material":
			case "Shape": {
				const enumType = key === "Material" ? "Material" : "PartType";
				const name = val.kind === "E" && val.value.enumType === enumType ? val.value.name : val.kind === "v" ? enumName(enumType, val.value) : null;
				if (!name) return `Unable to assign property ${key}. EnumItem of type ${enumType} expected`;
				this._remember(rec, key);
				rec[key] = name;
				if (key === "Shape") this._warnOnce("shape", "Mudar Shape em tempo de execução não troca a malha no Studio Lite (o export mantém o valor)");
				break;
			}
			case "Transparency":
			case "Reflectance": {
				if (val.kind !== "v" || typeof val.value !== "number") return `Unable to assign property ${key}. number expected`;
				this._remember(rec, key);
				rec[key] = val.value;
				break;
			}
			case "CanCollide":
			case "Anchored":
			case "CanTouch":
			case "CastShadow":
			case "Locked":
			case "Massless": {
				if (val.kind !== "v" || typeof val.value !== "boolean") return `Unable to assign property ${key}. bool expected`;
				this._remember(rec, key);
				rec[key] = val.value;
				break;
			}
			case "AssemblyLinearVelocity":
			case "AssemblyAngularVelocity":
			case "Velocity":
				return null;
			default:
				return undefined;
		}
		this._syncMesh(rec);
		return null;
	}

	_setGui(rec, key, val) {
		const spec = guiSchemaOf(rec)[key];
		if (!spec || spec.type === "raw") return undefined;
		const v = val.value;
		let next;
		switch (spec.type) {
			case "UDim":
				if (val.kind !== "UD") return `Unable to assign property ${key}. UDim expected`;
				next = new GuiUDim(v.Scale, v.Offset);
				break;
			case "UDim2":
				if (val.kind !== "U2") return `Unable to assign property ${key}. UDim2 expected`;
				next = new GuiUDim2(v.X.Scale, v.X.Offset, v.Y.Scale, v.Y.Offset);
				break;
			case "Vector2":
				if (val.kind !== "V2") return `Unable to assign property ${key}. Vector2 expected`;
				next = new GuiVector2(v.X, v.Y);
				break;
			case "Color3":
				if (val.kind !== "C3") return `Unable to assign property ${key}. Color3 expected`;
				next = new GuiColor3(v.R, v.G, v.B);
				break;
			case "enum":
				if (val.kind === "E") next = v.name;
				else if (val.kind === "v") next = v;
				else return `Unable to assign property ${key}. EnumItem expected`;
				break;
			case "bool":
				if (typeof v !== "boolean") return `Unable to assign property ${key}. bool expected`;
				next = v;
				break;
			case "string":
				if (typeof v !== "string" && typeof v !== "number") return `Unable to assign property ${key}. string expected`;
				next = String(v);
				break;
			default:
				if (typeof v !== "number") return `Unable to assign property ${key}. number expected`;
				next = v;
		}
		this._remember(rec, key);
		rec[key] = next;
		return null;
	}

	/* ---------- Meshes ---------- */

	_syncMesh(rec, { restoring = false } = {}) {
		const mesh = this.meshes.get(rec);
		if (!mesh || !this._isPart(rec)) return;
		const c = cfOf(rec);
		const off = mesh.userData.positionOffset || { x: 0, y: 0, z: 0 };
		mesh.position.set(c[0] + off.x, c[1] + off.y, c[2] + off.z);
		mesh.setRotationFromMatrix(new Matrix4().set(c[3], c[4], c[5], 0, c[6], c[7], c[8], 0, c[9], c[10], c[11], 0, 0, 0, 0, 1));
		if (mesh.userData.cylinder) mesh.rotation.z += Math.PI / 2;
		const base = mesh.userData.baseSize;
		if (base) mesh.scale.set(rec.Size.X / base.X, rec.Size.Y / base.Y, rec.Size.Z / base.Z);
		const color = rec.Color3;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const m of mats) {
			if (color && m && m.color && !m.map) m.color.setRGB(color.R, color.G, color.B);
		}
		applyMaterialLook(mesh.material, enumName("Material", rec.Material) || "Plastic", Number(rec.Transparency) || 0);
		if (typeof this.renderer.applyMaterialTexture === "function") this.renderer.applyMaterialTexture(mesh, rec);
		else if (typeof this.renderer.updateMaterialUV === "function") this.renderer.updateMaterialUV(mesh, rec);
		mesh.updateMatrixWorld(true);
		this.boxCache.delete(rec);
		if (!restoring) this.dirtyColliders.add(mesh);
	}

	_refreshSubtree(rec) {
		const inWs = this._inWorkspace(rec);
		for (const r of this._subtree(rec)) {
			if (!this._isPart(r)) continue;
			const mesh = this.meshes.get(r);
			if (mesh) {
				if (mesh.visible !== inWs) {
					mesh.visible = inWs;
					this.dirtyColliders.add(mesh);
				}
			} else if (inWs && partClasses.includes(r.ClassName)) {
				this._createMesh(r);
			}
		}
	}

	_createMesh(rec) {
		if (this.pendingMeshes.has(rec)) return;
		this.pendingMeshes.add(rec);
		const scene = this.renderer.scene;
		const before = new Set(scene.children);
		Promise.resolve(this.renderer.renderPart(rec, false, undefined)).then(() => {
			this.pendingMeshes.delete(rec);
			const mesh = scene.children.find((o) => !before.has(o) && o.isMesh && o.userData.instance === rec);
			if (!mesh) return;
			if (!this.running) {
				mesh.removeFromParent();
				mesh.geometry?.dispose();
				return;
			}
			this.meshes.set(rec, mesh);
			this.createdMeshes.add(mesh);
			mesh.visible = this._inWorkspace(rec);
			this._syncMesh(rec);
		}).catch((err) => this.print(`Falha ao renderizar ${rec.Name}: ${err && err.message}`, "warn"));
	}

	/* ---------- Hierarchy ---------- */

	setParent(rec, newParent) {
		if (this.locked.has(rec)) return `The Parent property of ${rec.Name} is locked, current parent: NULL, new parent ${newParent ? newParent.Name : "NULL"}`;
		if (rec === this.dataModel || isService(rec) || this.virtualServices.has(rec.ClassName) && this.virtualServices.get(rec.ClassName) === rec) return `Unable to change ${rec.Name}'s Parent`;
		if (rec === this.character && newParent !== this.workspace) return null;
		if (newParent === this.playerGui) newParent = this.starterGui;
		if (newParent === this.dataModel) return `Unable to set ${rec.Name}.Parent to the DataModel`;
		for (let p = newParent; p; p = this.parents.get(p)) {
			if (p === rec) return `Attempt to set parent of ${this.fullName(rec)} to ${this.fullName(newParent)} would result in circular reference`;
		}
		const old = this.parents.get(rec) ?? null;
		if (old === newParent) return;
		if (old) {
			const list = this.childrenOf(old);
			const i = list.indexOf(rec);
			if (i !== -1) list.splice(i, 1);
			this.emit(old, "ChildRemoved", false, this.tagRec(rec));
		}
		this.parentOverride.delete(rec);
		if (newParent) {
			this.parents.set(rec, newParent);
			if (!Array.isArray(newParent.Children)) newParent.Children = [];
			newParent.Children.push(rec);
		} else {
			this.parents.delete(rec);
			if (rec.__gui) rec.__gui.parent = null;
		}
		if (newParent) {
			this.emit(newParent, "ChildAdded", false, this.tagRec(rec));
			for (let a = newParent; a; a = this.parents.get(a)) this.emit(a, "DescendantAdded", false, this.tagRec(rec));
		}
		this.emit(rec, "AncestryChanged", false, this.tagRec(rec), this.tagRec(newParent));
		this._refreshSubtree(rec);
		const moved = this._subtree(rec);
		if (moved.some((r) => r.ClassName === "BillboardGui" || r.ClassName === "SurfaceGui")) this.gui.requestWorldScan?.();
		if (moved.some((r) => r.ClassName === "ParticleEmitter" || r.ClassName === "Beam" || r.ClassName === "Attachment")) this.renderer.effects?.requestScan();
		if (newParent) {
			const scripts = this._subtree(rec).filter((r) => (r.ClassName === "Script" || r.ClassName === "LocalScript") && !r.Disabled && !this.originals.has(r));
			if (scripts.length) this.hooks.onScriptsAdded?.(scripts);
		}
	}

	destroy(id) {
		const rec = this.rec(id);
		if (!rec || this.locked.has(rec)) return;
		if (rec === this.dataModel || isService(rec)) return;
		if (rec === this.character) {
			this.humanoidState.health = 0;
			this._died();
			return;
		}
		this.setParent(rec, null);
		for (const r of this._subtree(rec)) {
			if (r.ClassName === "Sound") {
				if (r.PlayOnRemove) this.sounds.play(r);
				else this.sounds.stop(r, true);
			}
			this.locked.add(r);
			this.touchWatch.delete(r);
			this.touching.delete(r);
		}
	}

	clone(id) {
		const rec = this.rec(id);
		if (!rec || rec.Archivable === false || isService(rec)) return null;
		const map = new Map();
		const copy = this._cloneRecord(rec, map);
		for (const r of map.values()) {
			for (const [k, v] of Object.entries(r)) {
				if (k !== "Children" && v && typeof v === "object" && v.ClassName && map.has(v)) r[k] = map.get(v);
			}
		}
		const scripts = [...map.values()].filter((r) => r.ClassName === "ModuleScript");
		if (scripts.length) this.hooks.onScriptsAdded?.(scripts, { compileOnly: true });
		return this.idOf(copy);
	}

	_cloneRecord(rec, map) {
		let copy;
		if (rec.__gui) {
			const props = {};
			for (const key of Object.keys(guiSchemaOf(rec))) props[key] = rec[key];
			copy = createGuiInstance(rec.ClassName, props);
			if (rec.AttributesSerialize) copy.AttributesSerialize = rec.AttributesSerialize;
			if (Array.isArray(rec.Tags)) copy.Tags = rec.Tags.slice();
		} else {
			copy = {};
			for (const [k, v] of Object.entries(rec)) {
				if (k === "Children") continue;
				if (v && typeof v === "object" && !v.ClassName) {
					try {
						copy[k] = structuredClone(v);
					} catch {
						copy[k] = v;
					}
				} else {
					copy[k] = v;
				}
			}
			copy.Children = [];
		}
		map.set(rec, copy);
		for (const child of this.childrenOf(rec)) {
			if (!child || child.Archivable === false) continue;
			const c = this._cloneRecord(child, map);
			copy.Children.push(c);
			this.parents.set(c, copy);
		}
		return copy;
	}

	create(className) {
		const cls = API_CLASSES[className];
		if (guiClassOf(className)) return this.idOf(createGuiInstance(className));
		if (!cls || cls.nc || cls.svc || VIRTUAL_SERVICES.has(className) || className === "DataModel") return `Unable to create an Instance of type "${className}"`;
		const rec = { ClassName: className, Name: className, Children: [] };
		if (classChain(className).includes("BasePart")) Object.assign(rec, PART_DEFAULTS(), className === "Part" ? { Shape: "Block" } : {});
		if (className === "Script" || className === "LocalScript" || className === "ModuleScript") rec.Source = "";
		if (className === "Folder" || className === "Model") rec.Archivable = true;
		return this.idOf(rec);
	}

	children(id) {
		const rec = this.rec(id);
		return rec ? this.childrenOf(rec).filter(Boolean).map((c) => this.idOf(c)) : [];
	}

	descendants(id) {
		const rec = this.rec(id);
		if (!rec) return [];
		return this._subtree(rec).slice(1).map((r) => this.idOf(r));
	}

	find(id, value, recursive, mode) {
		const rec = this.rec(id);
		if (!rec) return null;
		const match = (c) => (mode === "name" ? c.Name === value : mode === "class" ? c.ClassName === value : this.isA(c, value));
		if (!recursive) {
			const c = this.childrenOf(rec).find((x) => x && match(x));
			return c ? this.idOf(c) : null;
		}
		const stack = [...this.childrenOf(rec)].reverse();
		while (stack.length) {
			const c = stack.pop();
			if (!c) continue;
			if (match(c)) return this.idOf(c);
			stack.push(...[...this.childrenOf(c)].reverse());
		}
		return null;
	}

	ancestor(id, value, mode) {
		const rec = this.rec(id);
		for (let p = rec ? this.parentOf(rec) : null; p; p = this.parentOf(p)) {
			if (mode === "name" ? p.Name === value : mode === "class" ? p.ClassName === value : this.isA(p, value)) return this.idOf(p);
		}
		return null;
	}

	parentId(id) {
		const rec = this.rec(id);
		const p = rec ? this.parentOf(rec) : null;
		return p ? this.idOf(p) : null;
	}

	service(name) {
		if (name === "Workspace" && this.workspace) return this.idOf(this.workspace);
		const real = this.dataModel.Children.find((r) => r && r.ClassName === name);
		if (real) return this.idOf(real);
		const cls = API_CLASSES[name];
		if (!VIRTUAL_SERVICES.has(name) && !(cls && cls.svc)) return null;
		let rec = this.virtualServices.get(name);
		if (!rec) {
			rec = { ClassName: name, Name: name, Children: [] };
			this.virtualServices.set(name, rec);
			this.parents.set(rec, this.dataModel);
		}
		return this.idOf(rec);
	}

	enumValue(type, item) {
		const items = API_ENUMS[type];
		if (!items) return null;
		if (item === undefined || item === null) return 1;
		return Object.hasOwn(items, item) ? items[item] : null;
	}

	enumItems(type) {
		const items = API_ENUMS[type] || {};
		return Object.entries(items).flat();
	}

	_warnOnce(key, message) {
		if (this.warned.has(key)) return;
		this.warned.add(key);
		this.print(message, "warn");
	}

	/* ---------- Methods implemented by the host ---------- */

	call(id, method, ...raw) {
		const rec = this.rec(id);
		if (!rec) return ["x", "A instância não existe mais"];
		const args = this.decodeArgs(raw);
		const hook = this.virtual.get(rec);
		if (hook && hook.call) {
			const r = hook.call(method, args);
			if (r) return r;
		}
		switch (method) {
			case "GetPivot": return ["CF", ...this._pivot(rec)];
			case "PivotTo":
				if (!args[0] || args[0].kind !== "CF") return ["x", "Unable to cast value to CFrame"];
				this._pivotTo(rec, args[0].value);
				return [];
			case "SetPrimaryPartCFrame": {
				if (!rec.PrimaryPart) return ["x", "Model:SetPrimaryPartCFrame() failed because no PrimaryPart has been set"];
				this._pivotTo(rec, args[0].value, cfOf(rec.PrimaryPart));
				return [];
			}
			case "GetPrimaryPartCFrame": return rec.PrimaryPart ? ["CF", ...cfOf(rec.PrimaryPart)] : ["n"];
			case "MoveTo": {
				if (!args[0] || args[0].kind !== "V3") return ["x", "Unable to cast value to Vector3"];
				const pivot = this._pivot(rec);
				const p = args[0].value;
				this._pivotTo(rec, [p.X, p.Y, p.Z, ...pivot.slice(3)]);
				return [];
			}
			case "TranslateBy": {
				const pivot = this._pivot(rec);
				const v = args[0].value;
				this._pivotTo(rec, [pivot[0] + v.X, pivot[1] + v.Y, pivot[2] + v.Z, ...pivot.slice(3)]);
				return [];
			}
			case "GetBoundingBox":
			case "GetExtentsSize": {
				const box = this._boundsOf(rec);
				const size = box.isEmpty() ? new TVector3() : box.getSize(new TVector3());
				const center = box.isEmpty() ? new TVector3() : box.getCenter(new TVector3());
				if (method === "GetExtentsSize") return ["V3", size.x, size.y, size.z];
				return ["CF", center.x, center.y, center.z, ...IDENTITY.slice(3), "V3", size.x, size.y, size.z];
			}
			case "__GetAttribute": {
				const attrs = rec.AttributesSerialize;
				const name = args[0] && args[0].value;
				return attrs && typeof attrs === "object" && Object.hasOwn(attrs, name) ? attributeTag(attrs[name]) : ["n"];
			}
			case "__GetAttributes": {
				const attrs = rec.AttributesSerialize && typeof rec.AttributesSerialize === "object" ? rec.AttributesSerialize : {};
				return Object.entries(attrs).flatMap(([name, value]) => ["v", name, ...attributeTag(value)]);
			}
			case "__SetAttribute": {
				const name = args[0] && args[0].value;
				if (typeof name !== "string" || !name) return ["x", "Attribute name must be a non-empty string"];
				if (name.length > 100 || !/^[A-Za-z0-9_]+$/.test(name)) return ["x", `Attribute name '${name}' is invalid`];
				const val = args[1] || { kind: "n", value: null };
				if (val.kind === "i") return ["x", `${KIND_NAMES.i} is not a supported attribute type`];
				this._remember(rec, "AttributesSerialize");
				const next = { ...(rec.AttributesSerialize && typeof rec.AttributesSerialize === "object" ? rec.AttributesSerialize : {}) };
				if (val.kind === "n") delete next[name];
				else next[name] = attributeValue(val);
				rec.AttributesSerialize = next;
				return ["n"];
			}
			case "__AddTag":
			case "__RemoveTag": {
				const tag = args[0] && args[0].value;
				if (typeof tag !== "string") return ["x", "Tag must be a string"];
				const tags = Array.isArray(rec.Tags) ? rec.Tags : [];
				const has = tags.includes(tag);
				const adding = method === "__AddTag";
				if (has === adding) return ["v", false];
				this._remember(rec, "Tags");
				rec.Tags = adding ? [...tags, tag] : tags.filter((t) => t !== tag);
				return ["v", true];
			}
			case "__HasTag": return ["v", Array.isArray(rec.Tags) && rec.Tags.includes(args[0] && args[0].value)];
			case "__GetTags": return (Array.isArray(rec.Tags) ? rec.Tags : []).flatMap((t) => ["v", t]);
			case "__GetTagged":
			case "__GetAllTags": {
				const tag = args[0] && args[0].value;
				const out = [];
				const all = new Set();
				const walk = (r) => {
					for (const c of this.childrenOf(r)) {
						if (!c) continue;
						if (Array.isArray(c.Tags)) {
							if (method === "__GetTagged" && c.Tags.includes(tag)) out.push("i", this.idOf(c));
							for (const t of c.Tags) all.add(t);
						}
						walk(c);
					}
				};
				walk(this.dataModel);
				return method === "__GetTagged" ? out : [...all].flatMap((t) => ["v", t]);
			}
			case "GetServerTimeNow": return ["v", Date.now() / 1000];
			case "PromptPurchaseDialog": {
				const kind = args[0] ? args[0].value : "Product";
				const assetId = args[1] ? args[1].value : 0;
				return ["v", window.confirm(`Compra de teste (Studio Lite) — ${kind} ${assetId}\nNada é cobrado. Simular compra bem-sucedida?`)];
			}
			case "GetGuiInset": return ["V2", 0, 58, "V2", 0, 0];
			case "IsTenFootInterface":
			case "GetEmotesMenuOpen":
			case "GetInspectMenuEnabled":
			case "GamepadSupported":
				return ["v", false];
			case "GetFocusedTextBox": return ["n"];
			case "GetImageForKeyCode":
			case "GetStringForKeyCode":
				return ["v", ""];
			case "GetAssetFetchStatus": return ["E", "AssetFetchStatus", "Success"];
			case "SetCore":
			case "SetCoreGuiEnabled":
			case "SetEmotesMenuOpen":
			case "SetInspectMenuEnabled":
			case "SetMenuIsOpen":
			case "AddSelectionParent":
			case "RemoveSelectionGroup":
			case "Select":
			case "CloseInspectMenu":
				return [];
			case "GetRealPhysicsFPS": return ["v", 60];
			case "GetNetworkPing": return ["v", 0];
			case "GetMass": return ["v", this._isPart(rec) ? rec.Size.X * rec.Size.Y * rec.Size.Z * 0.7 : 0];
			case "GetScale": return ["v", 1];
			case "ScaleTo":
			case "ApplyImpulse":
				return [];
			case "Play":
			case "Stop":
			case "Pause":
			case "Resume":
				if (rec.ClassName === "Sound") this.sounds[method.toLowerCase()](rec);
				else if (rec.ClassName === "AnimationTrack") this._trackCall(rec, method, args);
				return [];
			case "AdjustSpeed":
				if (rec.ClassName === "AnimationTrack") rec.Speed = args[0] ? Number(args[0].value) || 0 : 1;
				return [];
			case "AdjustWeight":
				if (rec.ClassName === "AnimationTrack") rec.WeightTarget = args[0] ? Number(args[0].value) || 0 : 1;
				return [];
			case "GetTimeOfKeyframe": return ["v", 0];
			case "Emit":
				if (rec.ClassName === "ParticleEmitter") this.renderer.effects?.emit(rec, args[0] ? Number(args[0].value) : 16);
				return [];
			case "Clear":
				if (rec.ClassName === "ParticleEmitter") this.renderer.effects?.clearEmitter(rec);
				return [];
			case "PlayLocalSound": {
				const sound = args[0] && args[0].value;
				if (sound && sound.ClassName === "Sound") this.sounds.play(sound);
				return [];
			}
			case "GetTouchingParts":
				return this.touching.has(rec) && this.characterParts ? ["i", this.idOf(this.characterParts.root)] : [];
			case "LoadAnimation": {
				const anim = args[0] && args[0].value;
				if (!anim || anim.ClassName !== "Animation") return ["x", "Unable to cast value to Object"];
				const track = {
					ClassName: "AnimationTrack", Name: anim.Name || "AnimationTrack", Children: [], Animation: anim,
					IsPlaying: false, Length: TRACK_LENGTH, Speed: 1, Looped: false, TimePosition: 0, WeightCurrent: 0, WeightTarget: 1,
					Priority: "Action"
				};
				return ["i", this.idOf(track)];
			}
			case "Raycast": return this._raycastCall(args);
			case "MouseHit": return this.mouseHit();
			case "Kick": {
				this.print(`${rec.Name} foi expulso: ${args[0] ? args[0].value : ""}`, "warn");
				this.hooks.onKick?.();
				return [];
			}
			case "LoadCharacter":
				this.player?.spawn();
				return [];
		}
		return ["x", `${method} ainda não é suportado no Studio Lite`];
	}

	/** AnimationTrack state and events (Stopped / Ended / DidLoop) on a fixed-length timeline. */
	_trackCall(track, method, args) {
		clearTimeout(track.__timer);
		if (method === "Play") {
			this._warnOnce("anim", "Animações por asset id ainda não movem o rig no Studio Lite (IsPlaying, Stopped e Ended funcionam normalmente)");
			if (args[2] && typeof args[2].value === "number") track.Speed = args[2].value;
			track.IsPlaying = true;
			track.TimePosition = 0;
			track.WeightCurrent = 1;
			const schedule = () => {
				const speed = Math.abs(Number(track.Speed) || 0);
				if (!speed) return;
				track.__timer = setTimeout(() => {
					if (!this.running || !track.IsPlaying) return;
					if (track.Looped) {
						this.emit(track, "DidLoop", false);
						schedule();
						return;
					}
					track.IsPlaying = false;
					track.WeightCurrent = 0;
					this.emit(track, "Stopped", false);
					this.emit(track, "Ended", false);
				}, (track.Length / speed) * 1000);
			};
			schedule();
		} else if (method === "Stop" && track.IsPlaying) {
			track.IsPlaying = false;
			track.WeightCurrent = 0;
			this.emit(track, "Stopped", false);
			const fade = args[0] && typeof args[0].value === "number" ? args[0].value : 0.1;
			track.__timer = setTimeout(() => {
				if (this.running) this.emit(track, "Ended", false);
			}, Math.max(0, fade) * 1000);
		}
	}

	_partsIn(rec) {
		return this._subtree(rec).filter((r) => this._isPart(r) && !this.virtual.has(r));
	}

	_pivot(rec) {
		if (this._isPart(rec) && !this.virtual.has(rec)) return cfOf(rec);
		if (rec === this.character) return this._rootCF();
		if (rec.PrimaryPart && this._isPart(rec.PrimaryPart)) return cfOf(rec.PrimaryPart);
		const box = this._boundsOf(rec);
		if (box.isEmpty()) return IDENTITY.slice();
		const c = box.getCenter(new TVector3());
		return [c.x, c.y, c.z, ...IDENTITY.slice(3)];
	}

	_pivotTo(rec, target, pivot = this._pivot(rec)) {
		if (rec === this.character) {
			this.player?.teleport(target[0], target[1], target[2]);
			return;
		}
		if (this._isPart(rec) && !this.virtual.has(rec)) {
			this._remember(rec, "CFrame");
			writeCF(rec, target);
			this._syncMesh(rec);
			return;
		}
		const delta = cfMul(target, cfInv(pivot));
		for (const part of this._partsIn(rec)) {
			this._remember(part, "CFrame");
			writeCF(part, cfMul(delta, cfOf(part)));
			this._syncMesh(part);
		}
	}

	_boundsOf(rec) {
		const box = new Box3();
		for (const part of this._partsIn(rec)) {
			const mesh = this.meshes.get(part);
			if (mesh) {
				box.union(new Box3().setFromObject(mesh));
			} else {
				const c = cfOf(part);
				const h = new TVector3(part.Size.X / 2, part.Size.Y / 2, part.Size.Z / 2);
				box.union(new Box3(new TVector3(c[0], c[1], c[2]).sub(h), new TVector3(c[0], c[1], c[2]).add(h)));
			}
		}
		return box;
	}

	_raycastMeshes() {
		const out = [];
		for (const [rec, mesh] of this.meshes) if (mesh.visible && mesh.parent && this._inWorkspace(rec)) out.push(mesh);
		return out;
	}

	_raycast(origin, direction, far, accept = () => true) {
		const raycaster = this._raycaster || (this._raycaster = new Raycaster());
		raycaster.set(origin, direction);
		raycaster.far = far;
		const hits = raycaster.intersectObjects(this._raycastMeshes(), false);
		return hits.find((h) => accept(h.object.userData.instance)) || null;
	}

	_raycastCall(args) {
		const [o, d, inc, ...filter] = args;
		if (!o || o.kind !== "V3" || !d || d.kind !== "V3") return ["x", "Raycast espera (Vector3 origin, Vector3 direction)"];
		const dir = new TVector3(d.value.X, d.value.Y, d.value.Z);
		const far = dir.length();
		if (far === 0) return [];
		const include = inc && inc.value === true;
		const roots = filter.map((f) => f.value).filter(Boolean);
		const under = (rec) => roots.some((root) => {
			for (let r = rec; r; r = this.parents.get(r)) if (r === root) return true;
			return false;
		});
		const hit = this._raycast(new TVector3(o.value.X, o.value.Y, o.value.Z), dir.normalize(), far, (rec) => (include ? under(rec) : !under(rec)));
		if (!hit) return [];
		const rec = hit.object.userData.instance;
		const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new TVector3(0, 1, 0);
		return ["i", this.idOf(rec), "V3", hit.point.x, hit.point.y, hit.point.z, "V3", n.x, n.y, n.z, "v", hit.distance, "E", "Material", enumName("Material", rec.Material) || "Plastic"];
	}

	_mouseRay() {
		const r = this.renderer;
		const ndc = document.pointerLockElement ? new TVector2(0, 0) : (() => {
			const rect = r.domElement.getBoundingClientRect();
			return new TVector2((this.mouse.x / rect.width) * 2 - 1, -(this.mouse.y / rect.height) * 2 + 1);
		})();
		const raycaster = this._raycaster || (this._raycaster = new Raycaster());
		raycaster.setFromCamera(ndc, r.camera);
		return { origin: raycaster.ray.origin.clone(), direction: raycaster.ray.direction.clone() };
	}

	/* ---------- Player, character, Humanoid ---------- */

	_buildPlayer() {
		const name = "Player1";
		const state = { health: 100, maxHealth: 100, dead: false };
		this.humanoidState = state;
		const part = (partName, size) => ({ ClassName: "Part", Name: partName, Size: { X: size[0], Y: size[1], Z: size[2] }, Transparency: partName === "HumanoidRootPart" ? 1 : 0, CanCollide: false, Anchored: false, Children: [] });
		const root = part("HumanoidRootPart", [2, 2, 1]);
		const torso = part("Torso", [2, 2, 1]);
		const head = part("Head", [2, 1, 1]);
		const animator = { ClassName: "Animator", Name: "Animator", Children: [] };
		const humanoid = { ClassName: "Humanoid", Name: "Humanoid", Children: [animator] };
		const character = { ClassName: "Model", Name: name, Children: [humanoid, root, torso, head], PrimaryPart: root };
		this.character = character;
		this.humanoid = humanoid;
		this.characterParts = { root, torso, head };

		const playerGui = { ClassName: "PlayerGui", Name: "PlayerGui", Children: [] };
		const backpack = { ClassName: "Backpack", Name: "Backpack", Children: [] };
		const playerScripts = { ClassName: "PlayerScripts", Name: "PlayerScripts", Children: [] };
		const player = { ClassName: "Player", Name: name, DisplayName: name, UserId: 1, AccountAge: 365, Children: [backpack, playerGui, playerScripts] };
		this.playerRecord = player;
		this.playerGui = this.starterGui ? playerGui : null;
		for (const c of player.Children) this.parents.set(c, player);
		for (const c of character.Children) this.parents.set(c, character);
		this.parents.set(animator, humanoid);

		if (this.playersService) {
			this.parents.set(player, this.playersService);
			this.playersService.Children.push(player);
		}
		if (this.workspace) {
			this.parents.set(character, this.workspace);
			this.workspace.Children.push(character);
		}

		const pc = () => this.player;
		const rootOffset = { Torso: 0, HumanoidRootPart: 0, Head: 1.5 };
		for (const p of [root, torso, head]) {
			this.virtual.set(p, {
				get: (key) => {
					if (key === "CFrame") {
						const c = this._rootCF();
						c[1] += rootOffset[p.Name];
						return ["CF", ...c];
					}
					if (key === "Position") {
						const c = this._rootCF();
						return ["V3", c[0], c[1] + rootOffset[p.Name], c[2]];
					}
					if (key === "Orientation") {
						const o = orientationOf(this._rootCF());
						return ["V3", o.X, o.Y, o.Z];
					}
					if (key === "AssemblyLinearVelocity" || key === "Velocity") {
						const v = pc()?.velocity;
						return v ? ["V3", v.x, v.y, v.z] : ["V3", 0, 0, 0];
					}
					return null;
				},
				set: (key, val) => {
					if (key === "CFrame" && val.kind === "CF") {
						pc()?.teleport(val.value[0], val.value[1] - rootOffset[p.Name], val.value[2]);
						return null;
					}
					if (key === "Position" && val.kind === "V3") {
						pc()?.teleport(val.value.X, val.value.Y - rootOffset[p.Name], val.value.Z);
						return null;
					}
					if (key === "AssemblyLinearVelocity" || key === "Velocity") {
						if (val.kind === "V3" && pc()) {
							pc().velocity.set(val.value.X, val.value.Y, val.value.Z);
							pc().grounded = false;
						}
						return null;
					}
					return undefined;
				}
			});
		}

		this.virtual.set(humanoid, {
			get: (key) => {
				const p = pc();
				switch (key) {
					case "Health": return ["v", state.health];
					case "MaxHealth": return ["v", state.maxHealth];
					case "WalkSpeed": return ["v", p ? p.walkSpeed : 16];
					case "JumpPower": return ["v", p ? p.jumpPower : 50];
					case "JumpHeight": return ["v", p ? (p.jumpPower * p.jumpPower) / (2 * 196.2) : 7.2];
					case "UseJumpPower": return ["v", true];
					case "RigType": return ["E", "HumanoidRigType", p && p.rigType === "R15" ? "R15" : "R6"];
					case "RootPart": return ["i", this.idOf(root)];
					case "MoveDirection": {
						if (!p) return ["V3", 0, 0, 0];
						const h = Math.hypot(p.velocity.x, p.velocity.z);
						return h > 0.01 ? ["V3", p.velocity.x / h, 0, p.velocity.z / h] : ["V3", 0, 0, 0];
					}
					case "FloorMaterial": return ["E", "Material", p && p.grounded ? "Plastic" : "Air"];
					case "Jump": return ["v", !!(p && p.keys.jump)];
					case "Sit": return ["v", false];
					case "DisplayName": return ["v", name];
				}
				return null;
			},
			set: (key, val) => {
				const p = pc();
				const num = val.kind === "v" && typeof val.value === "number" ? val.value : null;
				switch (key) {
					case "Health":
						if (num === null) return "Unable to assign property Health. number expected";
						if (state.dead) return null;
						state.health = Math.max(0, Math.min(state.maxHealth, num));
						this.emit(humanoid, "HealthChanged", false, ["v", state.health]);
						if (state.health <= 0) this._died();
						return null;
					case "MaxHealth":
						if (num === null) return "Unable to assign property MaxHealth. number expected";
						state.maxHealth = Math.max(0, num);
						state.health = Math.min(state.health, state.maxHealth);
						return null;
					case "WalkSpeed":
						if (num === null) return "Unable to assign property WalkSpeed. number expected";
						if (p) p.walkSpeed = Math.max(0, num);
						return null;
					case "JumpPower":
						if (num === null) return "Unable to assign property JumpPower. number expected";
						if (p) p.jumpPower = Math.max(0, num);
						return null;
					case "JumpHeight":
						if (num === null) return "Unable to assign property JumpHeight. number expected";
						if (p) p.jumpPower = Math.sqrt(2 * 196.2 * Math.max(0, num));
						return null;
					case "Jump":
						if (val.value === true && p && p.grounded) {
							p.velocity.y = p.jumpPower;
							p.grounded = false;
						}
						return null;
				}
				return undefined;
			},
			call: (method, args) => {
				if (method === "MoveTo") {
					const target = args[0] && args[0].kind === "V3" ? args[0].value : null;
					if (target) this.moveTarget = { x: target.X, z: target.Z, time: 0 };
					return [];
				}
				return null;
			}
		});

		this.virtual.set(player, {
			get: (key) => {
				if (key === "Character") return state.dead && this._respawning ? ["n"] : ["i", this.idOf(character)];
				if (key === "Team") return ["n"];
				if (key === "PlayerGui" && this.playerGui) return ["i", this.idOf(playerGui)];
				return null;
			}
		});

		this.virtual.set(this.dataModel, {
			get: (key) => {
				if (key === "Workspace" && this.workspace) return ["i", this.idOf(this.workspace)];
				if (key === "PlaceId" || key === "GameId" || key === "CreatorId" || key === "PlaceVersion") return ["v", 0];
				if (key === "JobId") return ["v", "studio-lite"];
				return null;
			}
		});

		if (this.playersService) {
			this.virtual.set(this.playersService, {
				get: (key) => (key === "LocalPlayer" ? ["i", this.idOf(player)] : null)
			});
		}

		const camera = { ClassName: "Camera", Name: "Camera", Children: [] };
		this.parents.set(camera, this.workspace);
		this.virtual.set(camera, {
			get: (key) => {
				const cam = this.renderer.camera;
				if (key === "CFrame") {
					cam.updateMatrixWorld();
					const e = cam.matrixWorld.elements;
					return ["CF", e[12], e[13], e[14], e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
				}
				if (key === "FieldOfView") return ["v", cam.fov];
				if (key === "ViewportSize") {
					const rect = this.renderer.domElement.getBoundingClientRect();
					return ["V2", rect.width, rect.height];
				}
				if (key === "CameraType") return ["E", "CameraType", "Custom"];
				if (key === "CameraSubject") return ["i", this.idOf(humanoid)];
				return null;
			},
			call: (method, args) => {
				if (method !== "WorldToViewportPoint" && method !== "WorldToScreenPoint") return null;
				const p = args[0] && args[0].kind === "V3" ? args[0].value : null;
				if (!p) return ["x", "Unable to cast value to Vector3"];
				const cam = this.renderer.camera;
				cam.updateMatrixWorld();
				const rect = this.renderer.domElement.getBoundingClientRect();
				const view = new TVector3(p.X, p.Y, p.Z).applyMatrix4(cam.matrixWorldInverse);
				const ndc = new TVector3(p.X, p.Y, p.Z).project(cam);
				const depth = -view.z;
				const x = (ndc.x + 1) / 2 * rect.width;
				const y = (1 - ndc.y) / 2 * rect.height - (method === "WorldToScreenPoint" ? 58 : 0);
				const onScreen = depth > 0 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
				return ["V3", x, y, depth, "v", onScreen];
			},
			set: (key) => {
				if (key === "CFrame" || key === "CameraType" || key === "CameraSubject" || key === "FieldOfView") {
					this._warnOnce("camera", "Camera scriptada ainda não é suportada no Studio Lite — a câmera segue o personagem");
					return null;
				}
				return undefined;
			}
		});
		if (this.workspace) {
			this.virtual.set(this.workspace, {
				get: (key) => (key === "CurrentCamera" ? ["i", this.idOf(camera)] : key === "Gravity" ? ["v", 196.2] : null)
			});
		}

		this.player.onSpawn = () => {
			state.dead = false;
			this._respawning = false;
			// The character records are reused, so the previous life's connections are dropped by hand.
			this.control(character, "__reset");
			this.emit(player, "CharacterAdded", false, this.tagRec(character));
			this.emit(player, "CharacterAppearanceLoaded", false, this.tagRec(character));
		};
	}

	_rootCF() {
		const p = this.player;
		if (!p) return IDENTITY.slice();
		const pos = p.group.position;
		const yaw = p.group.rotation.y;
		const c = Math.cos(yaw), s = Math.sin(yaw);
		return [pos.x, pos.y, pos.z, c, 0, s, 0, 1, 0, -s, 0, c];
	}

	_died() {
		const state = this.humanoidState;
		if (state.dead) return;
		state.dead = true;
		state.health = 0;
		this.emit(this.humanoid, "HealthChanged", false, ["v", 0]);
		this.emit(this.humanoid, "Died", false);
		this.print(`${this.playerRecord.Name} morreu — respawn em 3 s`);
		this._respawning = true;
		clearTimeout(this._respawnTimer);
		this._respawnTimer = setTimeout(() => {
			if (!this.running || !this.player) return;
			state.health = state.maxHealth;
			this.player.spawn();
		}, 3000);
	}

	/**
	 * Runs once the runtime has loaded its scripts: Roblox order is PlayerAdded, then CharacterAdded a few
	 * steps later (counted in frames, the first dt after loading can be huge), so handlers that connect
	 * CharacterAdded inside PlayerAdded still see the first spawn.
	 */
	announcePlayer() {
		this.control(this.playerRecord, "__player");
		if (this.playersService) this.emit(this.playersService, "PlayerAdded", false, this.tagRec(this.playerRecord));
		this._characterAddedIn = 3;
	}

	/** Where each runnable script lives at Play time; StarterCharacterScripts run inside the character. */
	runnableScripts() {
		const out = [];
		const parentOf = (r) => this.parents.get(r) ?? null;
		// PlayerGui aliases StarterGui, so the same records can show up twice in the walk.
		for (const rec of new Set(this._subtree(this.dataModel).slice(1))) {
			if (rec.ClassName !== "Script" && rec.ClassName !== "LocalScript") continue;
			if (rec.Disabled === true || rec.Enabled === false) continue;
			if (scriptPlacementIssue(rec, parentOf)) continue;
			for (let p = parentOf(rec); p; p = parentOf(p)) {
				if (p.ClassName === "StarterCharacterScripts") {
					this.parentOverride.set(rec, this.character);
					break;
				}
			}
			out.push(rec);
		}
		out.sort((a, b) => (a.ClassName === b.ClassName ? 0 : a.ClassName === "Script" ? -1 : 1));
		return out;
	}

	moduleScripts() {
		return [...new Set(this._subtree(this.dataModel))].filter((r) => r.ClassName === "ModuleScript");
	}

	/* ---------- Per-frame host work ---------- */

	frame(dt) {
		if (!this.running || !this.player) return;
		if (this._characterAddedIn > 0 && --this._characterAddedIn === 0) {
			this.emit(this.playerRecord, "CharacterAdded", false, this.tagRec(this.character));
		}
		this._stepMoveTo(dt);
		this._checkTouches();
		if (this.mouse.moved) {
			this.mouse.moved = false;
			this._input("InputChanged", "Unknown", "MouseMovement", "Change");
			this.mouse.dx = this.mouse.dy = 0;
		}
		if (this.dirtyColliders.size) {
			this.player.updateColliders([...this.dirtyColliders]);
			this.dirtyColliders.clear();
		}
		this._leaderTimer -= dt;
		if (this._leaderTimer <= 0) {
			this._leaderTimer = 0.2;
			this._updateLeaderboard();
		}
	}

	_stepMoveTo(dt) {
		const t = this.moveTarget;
		if (!t) return;
		const pos = this.player.group.position;
		const dx = t.x - pos.x, dz = t.z - pos.z;
		const dist = Math.hypot(dx, dz);
		t.time += dt;
		if (dist < 0.5 || t.time > 8) {
			this.moveTarget = null;
			this.emit(this.humanoid, "MoveToFinished", false, ["v", dist < 0.5]);
			return;
		}
		const step = Math.min(dist, this.player.walkSpeed * dt);
		pos.x += (dx / dist) * step;
		pos.z += (dz / dist) * step;
		this.player.group.rotation.y = Math.atan2(-dx, -dz);
	}

	_checkTouches() {
		if (!this.touchWatch.size) return;
		const p = this.player.group.position;
		const charBox = new Box3(new TVector3(p.x - 1.2, p.y - 2.6, p.z - 1.2), new TVector3(p.x + 1.2, p.y + 2.6, p.z + 1.2));
		const hitPart = this.characterParts.torso;
		for (const rec of this.touchWatch) {
			if (this.virtual.has(rec)) continue;
			const mesh = this.meshes.get(rec);
			const active = mesh && mesh.visible && mesh.parent && rec.CanTouch !== false;
			let box = this.boxCache.get(rec);
			if (active && !box) {
				box = new Box3().setFromObject(mesh);
				this.boxCache.set(rec, box);
			}
			const touching = !!(active && box.intersectsBox(charBox));
			if (touching && !this.touching.has(rec)) {
				this.touching.add(rec);
				this.emit(rec, "Touched", false, this.tagRec(hitPart));
			} else if (!touching && this.touching.has(rec)) {
				this.touching.delete(rec);
				this.emit(rec, "TouchEnded", false, this.tagRec(hitPart));
			}
		}
	}

	/* ---------- Input → UserInputService / Mouse / ClickDetector ---------- */

	_uis() {
		return this.rec(this.service("UserInputService"));
	}

	_input(name, keyCode, inputType, state, processed = false) {
		const uis = this._uis();
		this.emit(uis, name, true, ["IO", keyCode, inputType, this.mouse.x, this.mouse.y, this.mouse.dx, this.mouse.dy, state], ["v", processed]);
	}

	_attachInput() {
		const canvas = this.renderer.domElement;
		this._onKeyDown = (e) => {
			if (e.repeat || isTypingTarget(e.target)) return;
			this._input("InputBegan", keyCodeName(e), "Keyboard", "Begin");
		};
		this._onKeyUp = (e) => {
			if (isTypingTarget(e.target)) return;
			this._input("InputEnded", keyCodeName(e), "Keyboard", "End");
		};
		const button = (e) => ["MouseButton1", "MouseButton3", "MouseButton2"][e.button] || "MouseButton1";
		this._onMouseDown = (e) => {
			this._trackMouse(e);
			this._input("InputBegan", "Unknown", button(e), "Begin");
			if (e.button === 0) this._clickDetectors();
		};
		this._onMouseUp = (e) => {
			this._trackMouse(e);
			this._input("InputEnded", "Unknown", button(e), "End");
		};
		this._onMouseMove = (e) => {
			this._trackMouse(e);
			this.mouse.dx += e.movementX || 0;
			this.mouse.dy += e.movementY || 0;
			this.mouse.moved = true;
		};
		window.addEventListener("keydown", this._onKeyDown);
		window.addEventListener("keyup", this._onKeyUp);
		canvas.addEventListener("mousedown", this._onMouseDown);
		window.addEventListener("mouseup", this._onMouseUp);
		canvas.addEventListener("mousemove", this._onMouseMove);
	}

	_detachInput() {
		const canvas = this.renderer.domElement;
		window.removeEventListener("keydown", this._onKeyDown);
		window.removeEventListener("keyup", this._onKeyUp);
		canvas.removeEventListener("mousedown", this._onMouseDown);
		window.removeEventListener("mouseup", this._onMouseUp);
		canvas.removeEventListener("mousemove", this._onMouseMove);
	}

	_trackMouse(e) {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.mouse.x = e.clientX - rect.left;
		this.mouse.y = e.clientY - rect.top;
	}

	_clickDetectors() {
		const { origin, direction } = this._mouseRay();
		const hit = this._raycast(origin, direction, 1000);
		if (!hit) return;
		const part = hit.object.userData.instance;
		for (let r = part; r && r !== this.workspace; r = this.parents.get(r)) {
			const cd = this.childrenOf(r).find((c) => c && c.ClassName === "ClickDetector");
			if (!cd) continue;
			const max = Number(cd.MaxActivationDistance ?? 32);
			if (this.player.group.position.distanceTo(hit.point) <= max + 3) this.emit(cd, "MouseClick", false, this.tagRec(this.playerRecord));
			return;
		}
	}

	mouseHit() {
		const { origin, direction } = this._mouseRay();
		const hit = this._raycast(origin, direction, 1000);
		const point = hit ? hit.point : origin.clone().addScaledVector(direction, 1000);
		return ["CF", point.x, point.y, point.z, ...IDENTITY.slice(3), ...(hit ? ["i", this.idOf(hit.object.userData.instance)] : ["n"])];
	}

	/* ---------- leaderstats ---------- */

	_buildLeaderboard() {
		const el = document.createElement("div");
		el.className = "play-leaderboard";
		el.hidden = true;
		this.viewport.appendChild(el);
		this.leaderboard = el;
	}

	_updateLeaderboard() {
		const el = this.leaderboard;
		if (!el) return;
		const stats = this.playerRecord.Children.find((c) => c.Name === "leaderstats");
		const values = stats ? stats.Children.filter((c) => c && this.isA(c, "ValueBase")) : [];
		const text = values.map((v) => `${v.Name}=${v.Value}`).join("|");
		if (text === this._leaderText) return;
		this._leaderText = text;
		el.hidden = values.length === 0;
		el.textContent = "";
		if (!values.length) return;
		const table = document.createElement("table");
		const head = table.insertRow();
		for (const label of [this.playerRecord.Name ? "Jogador" : "", ...values.map((v) => v.Name)]) {
			const th = document.createElement("th");
			th.textContent = label;
			head.appendChild(th);
		}
		const row = table.insertRow();
		row.insertCell().textContent = this.playerRecord.Name;
		for (const v of values) {
			const val = v.Value;
			row.insertCell().textContent = val && typeof val === "object" ? val.Name ?? "" : String(val ?? (v.ClassName === "StringValue" ? "" : 0));
		}
		el.appendChild(table);
	}
}
