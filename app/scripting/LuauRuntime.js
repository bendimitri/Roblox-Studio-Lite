import { scriptPlacementIssue } from '../datamodel/Services.js';

const PRELUDE_URL = new URL('./runtime.luau', import.meta.url);

/*
 * luau-web pushes each element of a returned JS array (and each call argument) onto the Lua
 * stack without lua_checkstack: past ~20 values it writes beyond the stack and corrupts the WASM
 * heap ("memory access out of bounds", abort). Longer lists cross as one packed string instead,
 * decoded by unpackList in runtime.luau.
 */
const MAX_SPREAD = 12;
const escapeItem = (s) => s.replace(/[\x1e\x1f]/g, (c) => (c === "\x1e" ? "\x1f\x1d" : "\x1f\x1f"));

function packList(list) {
	let out = "\x01";
	for (let i = 0; i < list.length; i++) {
		const v = list[i];
		if (i) out += "\x1e";
		if (v === null || v === undefined) out += "n";
		else if (v === true) out += "t";
		else if (v === false) out += "f";
		else if (typeof v === "number") out += "d" + String(v);
		else out += "s" + escapeItem(String(v));
	}
	return out;
}

/** Arguments for a Luau call: spread when short, packed otherwise. */
const luaArgs = (list) => (list.length > MAX_SPREAD ? [packList(list)] : list.map((v) => (v === null ? undefined : v)));

/**
 * Luau VM for Play sessions (luau-web, WebAssembly). Compiles every Script / LocalScript /
 * ModuleScript `Source`, boots the runnable ones like Roblox does (server Scripts first, then
 * LocalScripts), and advances the Luau scheduler once per rendered frame.
 *
 * A single LuauState lives for the whole page: luau-web breaks every state created after a
 * LuauState.destroy() (calls fail with "attempt to call a nil value" or abort()). Each session
 * runs a fresh copy of the prelude instead, so the previous session's scheduler becomes garbage.
 *
 * luau-web serializes calls into the VM, so a frame never starts while the previous step is
 * still running; the skipped time is folded into the next step's dt.
 */
export class LuauRuntime {
	constructor({ print }) {
		this.print = print;
		this.state = null;
		this.statePromise = null;
		this.step = null;
		this.bridge = null;
		this.session = 0;
		this.busy = false;
		this.pending = Promise.resolve();
		this.pendingDt = 0;
		this.chunks = new Map();
		this.toCompile = [];
		this.prelude = null;
	}

	get running() {
		return !!this.step;
	}

	/** Host functions resolve the bridge at call time; with no session they fail softly. */
	_hostEnv() {
		const bridge = () => {
			if (!this.bridge) throw new Error("sessão encerrada");
			return this.bridge;
		};
		// luau-web turns a JS null into a sentinel table, only undefined arrives as nil.
		const toLua = (value) => {
			if (value === null) return undefined;
			if (Array.isArray(value)) {
				if (value.length > MAX_SPREAD) return packList(value);
				if (value.includes(null)) return value.map((v) => (v === null ? undefined : v));
			}
			return value;
		};
		const guard = (fn, fallback) => (...args) => {
			try {
				return toLua(fn(bridge(), ...args));
			} catch (err) {
				if (this.bridge) console.error(err);
				return toLua(fallback(err));
			}
		};
		const internal = (err) => ["x", `Erro interno do Studio Lite: ${err && err.message}`];
		return {
			__h_get: guard((b, id, key) => b.get(id, key), internal),
			__h_set: guard((b, id, key, ...args) => b.set(id, key, ...args), (err) => `Erro interno do Studio Lite: ${err && err.message}`),
			__h_call: guard((b, id, method, ...args) => b.call(id, method, ...args), internal),
			__h_children: guard((b, id) => b.children(id), () => []),
			__h_descendants: guard((b, id) => b.descendants(id), () => []),
			__h_find: guard((b, id, value, recursive, mode) => b.find(id, value, recursive, mode), () => null),
			__h_ancestor: guard((b, id, value, mode) => b.ancestor(id, value, mode), () => null),
			__h_parent: guard((b, id) => b.parentId(id), () => null),
			__h_new: guard((b, className) => b.create(className), internal),
			__h_clone: guard((b, id) => b.clone(id), () => null),
			__h_destroy: guard((b, id) => {
				b.destroy(id);
			}, () => null),
			__h_service: guard((b, name) => b.service(name), () => null),
			__h_isa: guard((b, id, className) => b.isA(b.rec(id), className), () => false),
			__h_fullname: guard((b, id) => b.fullName(b.rec(id)), () => ""),
			__h_listen: guard((b, id, name) => {
				b.listen(id, name);
			}, () => null),
			__h_print: (kind, message) => {
				if (this.bridge) this.print(String(message), kind === "print" ? "log" : kind);
			},
			__h_enum: guard((b, type, item) => b.enumValue(type, item), () => null),
			__h_enumitems: guard((b, type) => b.enumItems(type), () => []),
			__h_chunk: guard((b, id) => {
				const entry = this.chunks.get(b.rec(id));
				if (entry && entry.fn) return entry.fn;
				return [false, entry ? entry.error : `${b.fullName(b.rec(id))}: script ainda não compilado`];
			}, (err) => [false, String(err && err.message)]),
			__h_game: guard((b) => b.idOf(b.dataModel), () => null)
		};
	}

	_ensureState() {
		if (!this.statePromise) {
			this.statePromise = import('../thirdparty/luau-web/index.js').then(async ({ LuauState }) => {
				this.state = await LuauState.createAsync(this._hostEnv());
				return this.state;
			});
		}
		return this.statePromise;
	}

	/** @param {import('./RobloxBridge.js').RobloxBridge} bridge */
	async start(bridge) {
		const session = ++this.session;
		this.chunks = new Map();
		this.toCompile = [];
		const [state, prelude] = await Promise.all([
			this._ensureState(),
			fetch(PRELUDE_URL, { cache: "no-cache" }).then((r) => r.text())
		]);
		// A step from the previous session may still be inside the VM.
		await this.pending;
		if (session !== this.session) return false;
		this.bridge = bridge;
		const b = bridge;

		const main = state.loadstring(prelude, "=runtime", true);
		this.busy = true;
		let step, boot;
		try {
			[step, boot] = await main();
		} finally {
			this.busy = false;
		}
		if (session !== this.session) return false;

		for (const module of b.moduleScripts()) this._compile(module);
		const scripts = b.runnableScripts();
		for (const script of scripts) this._compile(script);
		this.step = step;
		this.print(`Luau: ${scripts.length} script(s) em execução (${scripts.filter((s) => s.ClassName === "Script").length} Script, ${scripts.filter((s) => s.ClassName === "LocalScript").length} LocalScript)`, "info");

		this.busy = true;
		const booting = boot(...luaArgs(scripts.map((s) => b.idOf(s))));
		this.pending = booting.catch(() => {});
		try {
			await booting;
		} catch (err) {
			this.print(`Luau: ${err && err.message ? err.message : err}`, "error");
		} finally {
			this.busy = false;
		}
		if (session !== this.session) return false;
		b.announcePlayer();
		return true;
	}

	_compile(rec) {
		const source = typeof rec.Source === "string" ? rec.Source : String(rec.Source ?? "");
		const result = this.state.loadstring(source, `=${this.bridge.fullName(rec)}`, false);
		const entry = typeof result === "function" ? { fn: result } : { error: String(result) };
		this.chunks.set(rec, entry);
		return entry;
	}

	/** Called by the bridge (from inside a host call) when scripts appear at runtime: compiled between steps. */
	scriptsAdded(records, { compileOnly = false } = {}) {
		for (const rec of records) this.toCompile.push({ rec, run: !compileOnly && rec.ClassName !== "ModuleScript" });
	}

	frame(dt) {
		if (!this.step || this.busy) {
			this.pendingDt += dt;
			return;
		}
		const b = this.bridge;
		b.frame(dt);
		if (this.toCompile.length) {
			const list = this.toCompile;
			this.toCompile = [];
			for (const { rec, run } of list) {
				const entry = this._compile(rec);
				if (!run) continue;
				if (scriptPlacementIssue(rec, (r) => b.parents.get(r) ?? null)) continue;
				if (entry.error) this.print(entry.error, "error");
				else b.control(rec, "__run");
			}
		}
		const queue = b.takeQueue();
		const total = Math.min(dt + this.pendingDt, 0.25);
		this.pendingDt = 0;
		this.busy = true;
		const session = this.session;
		this.pending = this.step(total, ...luaArgs(queue))
			.catch((err) => {
				if (session === this.session) this.print(`Luau: ${err && err.message ? err.message : err}`, "error");
			})
			.finally(() => {
				this.busy = false;
			});
	}

	stop() {
		this.session++;
		this.step = null;
		this.toCompile = [];
		this.chunks = new Map();
		this.pendingDt = 0;
		this.bridge?.stop();
		this.bridge = null;
	}
}
