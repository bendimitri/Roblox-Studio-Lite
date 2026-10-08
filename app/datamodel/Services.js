/*
 * DataModel root parity with Roblox Studio: singleton services under `game`, in the order the
 * official Explorer lists them. Instances stay plain-data records ({ ClassName, Name, Children, …})
 * so the renderer, the binary parser output and the exporter all share one shape; `Instance`
 * only gives them a common constructor and prototype.
 */

export class Instance {
	static className = "Instance";

	constructor(props = {}) {
		this.ClassName = this.constructor.className;
		this.Name = this.constructor.className;
		this.Archivable = true;
		this.Children = [];
		Object.assign(this, props);
	}
}

/** A singleton service directly under the DataModel (game:GetService(ClassName)). */
export class Service extends Instance {
	static className = "Service";
	/** false for engine-only services that Roblox never writes into place files. */
	static archivable = true;
}

/** Explorer order of Roblox Studio (Workspace first, TextChatService last). */
export const SERVICE_ORDER = [
	"Workspace",
	"Players",
	"CoreGui",
	"Lighting",
	"MaterialService",
	"PluginGuiService",
	"ReplicatedFirst",
	"ReplicatedStorage",
	"RobloxPluginGuiService",
	"ServerScriptService",
	"ServerStorage",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Teams",
	"SoundService",
	"TextChatService"
];

/** Engine/plugin services: present in the Explorer, never serialized (RobloxScriptSecurity). */
export const NON_ARCHIVABLE_SERVICES = new Set(["CoreGui", "PluginGuiService", "RobloxPluginGuiService"]);

const SERVICE_DEFAULTS = {
	Workspace: { Gravity: 196.2, FallenPartsDestroyHeight: -500, StreamingEnabled: false },
	Lighting: {
		Technology: "Future",
		Ambient: { R: 70 / 255, G: 70 / 255, B: 70 / 255 },
		OutdoorAmbient: { R: 128 / 255, G: 128 / 255, B: 128 / 255 },
		ColorShift_Top: { R: 0, G: 0, B: 0 },
		ColorShift_Bottom: { R: 0, G: 0, B: 0 },
		Brightness: 2,
		ClockTime: 14,
		TimeOfDay: "14:00:00",
		GeographicLatitude: 41.73,
		EnvironmentDiffuseScale: 1,
		EnvironmentSpecularScale: 1,
		ExposureCompensation: 0,
		GlobalShadows: true,
		ShadowSoftness: 0.2,
		FogColor: { R: 192 / 255, G: 192 / 255, B: 192 / 255 },
		FogEnd: 100000,
		FogStart: 0
	},
	StarterGui: { ResetPlayerGuiOnSpawn: true, ShowDevelopmentGui: true },
	StarterPlayer: { CharacterWalkSpeed: 16, CharacterJumpPower: 50, CharacterUseJumpPower: true }
};

/** One class per service, each a real subclass of Service (and therefore of Instance). */
export const SERVICE_CLASSES = Object.fromEntries(SERVICE_ORDER.map((name) => {
	const cls = { [name]: class extends Service {} }[name];
	cls.className = name;
	cls.archivable = !NON_ARCHIVABLE_SERVICES.has(name);
	return [name, cls];
}));

/** StarterPlayer always carries these two containers in Studio. */
const STARTER_PLAYER_CONTAINERS = ["StarterPlayerScripts", "StarterCharacterScripts"];

export class StarterPlayerScripts extends Instance {
	static className = "StarterPlayerScripts";
}

export class StarterCharacterScripts extends Instance {
	static className = "StarterCharacterScripts";
}

export class Folder extends Instance {
	static className = "Folder";
}

export function makeService(name, props = {}) {
	const Cls = SERVICE_CLASSES[name];
	if (!Cls) throw new Error(`Serviço desconhecido: ${name}`);
	const service = new Cls({ ...structuredClone(SERVICE_DEFAULTS[name] || {}), ...props });
	if (name === "StarterPlayer") ensureStarterPlayerContainers(service);
	return service;
}

function ensureStarterPlayerContainers(starterPlayer) {
	if (!Array.isArray(starterPlayer.Children)) starterPlayer.Children = [];
	for (const name of STARTER_PLAYER_CONTAINERS) {
		if (starterPlayer.Children.some((c) => c && c.ClassName === name)) continue;
		starterPlayer.Children.push(name === "StarterPlayerScripts" ? new StarterPlayerScripts() : new StarterCharacterScripts());
	}
}

/**
 * Injects the missing services and orders the DataModel root like Studio's Explorer. Unknown
 * top-level instances (other services from .rbxl files, loose models) keep their relative order
 * after the known services. Returns `{ instances, added }`.
 */
export function normalizeServices(instances) {
	const list = instances.filter(Boolean);
	const added = [];
	for (const name of SERVICE_ORDER) {
		if (list.some((i) => i.ClassName === name)) continue;
		list.push(makeService(name));
		added.push(name);
	}
	const starterPlayer = list.find((i) => i.ClassName === "StarterPlayer");
	if (starterPlayer) ensureStarterPlayerContainers(starterPlayer);
	const rank = (i) => {
		const r = SERVICE_ORDER.indexOf(i.ClassName);
		return r === -1 ? SERVICE_ORDER.length : r;
	};
	const ordered = list.map((inst, index) => ({ inst, index })).sort((a, b) => rank(a.inst) - rank(b.inst) || a.index - b.index).map((e) => e.inst);
	return { instances: ordered, added };
}

export function isService(instance) {
	return !!instance && (instance instanceof Service || SERVICE_ORDER.includes(instance.ClassName));
}

/* ---------- Script classes ---------- */

export const SCRIPT_CLASSES = ["Script", "LocalScript", "ModuleScript"];

const DEFAULT_SOURCE = {
	Script: 'print("Hello world!")\n',
	LocalScript: 'print("Hello world!")\n',
	ModuleScript: "local module = {}\n\nreturn module\n"
};

export class LuaSourceContainer extends Instance {
	static className = "LuaSourceContainer";

	constructor(props = {}) {
		super({ Source: DEFAULT_SOURCE[new.target.className] || "", ...props });
	}
}

/** Server-side code: runs from Workspace or ServerScriptService (RunContext Legacy). */
export class Script extends LuaSourceContainer {
	static className = "Script";

	constructor(props = {}) {
		super({ Disabled: false, RunContext: "Legacy", ...props });
	}
}

/** Client-side code: runs from StarterPlayerScripts, StarterCharacterScripts, StarterGui, StarterPack or ReplicatedFirst. */
export class LocalScript extends LuaSourceContainer {
	static className = "LocalScript";

	constructor(props = {}) {
		super({ Disabled: false, ...props });
	}
}

/** Reusable library: runs only when required and must return exactly one value. */
export class ModuleScript extends LuaSourceContainer {
	static className = "ModuleScript";
}

const SCRIPT_CTORS = { Script, LocalScript, ModuleScript };

export function makeScript(className, props = {}) {
	const Cls = SCRIPT_CTORS[className];
	if (!Cls) throw new Error(`Classe de script desconhecida: ${className}`);
	return new Cls(props);
}

export function isScriptClass(className) {
	return SCRIPT_CLASSES.includes(className);
}

/** Ancestor chain of ClassNames (closest first) for a record, given a parent lookup. */
function ancestorClasses(instance, parentOf) {
	const out = [];
	for (let p = parentOf(instance); p; p = parentOf(p)) out.push(p.ClassName);
	return out;
}

/**
 * Where Roblox actually runs a script. Returns null when it runs, else a short reason (pt-BR)
 * used for placement warnings in the editor and to skip it in Play.
 */
export function scriptPlacementIssue(instance, parentOf) {
	const chain = ancestorClasses(instance, parentOf);
	if (instance.ClassName === "ModuleScript") return null;
	if (instance.ClassName === "Script") {
		const raw = instance.RunContext;
		const ctx = typeof raw === "number" ? ["Legacy", "Server", "Client"][raw] || "Legacy" : (raw && raw.Name) || raw || "Legacy";
		if (ctx === "Client") return chain.some((c) => ["Workspace", "ReplicatedStorage", "ReplicatedFirst", "StarterGui", "StarterPlayerScripts", "StarterCharacterScripts"].includes(c)) ? null : "Script com RunContext Client só roda em Workspace, ReplicatedStorage ou containers do jogador";
		if (ctx === "Server") return chain.some((c) => ["Workspace", "ServerScriptService", "ReplicatedStorage", "ReplicatedFirst"].includes(c)) ? null : "Script com RunContext Server só roda em Workspace, ServerScriptService ou ReplicatedStorage";
		return chain.some((c) => c === "Workspace" || c === "ServerScriptService") ? null : "Script (RunContext Legacy) só roda dentro de Workspace ou ServerScriptService";
	}
	if (instance.ClassName === "LocalScript") {
		return chain.some((c) => ["StarterPlayerScripts", "StarterCharacterScripts", "StarterGui", "StarterPack", "ReplicatedFirst"].includes(c))
			? null
			: "LocalScript só roda em StarterPlayerScripts, StarterCharacterScripts, StarterGui, StarterPack ou ReplicatedFirst";
	}
	return null;
}
