import { AnimationMixer, Clock, LoopOnce, LoopRepeat } from "../thirdparty/three/three.module.js";
import { AnimationDocument, EASINGS, quatEulerDeg, validateBindings } from "./AnimationDocument.js";
import { disposeRig, resetRigPose, rigPickables } from "./R15Rig.js";
import { RIG_SPECS, validateAnimationCompatibility } from "./RigSpecs.js";
import { findHumanoid } from "./RigBuilder.js";
import { ANIMATION_LIBRARY, injectSpellAnimations } from "./SpellLibrary.js";
import { Timeline } from "./Timeline.js";
import { isTypingTarget, isDialogOpen } from "../controls/InputFocus.js";

const SVG = {
	start: `<path d="M6 5v14M19 5L9 12l10 7z"/>`,
	prev: `<path d="M5 5v14M13 12l7-6v12z"/><path d="M5 12l7-6v12z" opacity=".55"/>`,
	play: `<path d="M7 4.5l13 7.5-13 7.5z"/>`,
	pause: `<path d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/>`,
	stop: `<path d="M5.5 5.5h13v13h-13z"/>`,
	next: `<path d="M19 5v14M11 12L4 6v12z"/><path d="M19 12l-7-6v12z" opacity=".55"/>`,
	rec: `<circle cx="12" cy="12" r="6.5"/>`,
	key: `<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>`,
	pose: `<path d="M12 2.5l4 4-4 4-4-4zM5 9.5l4 4-4 4-4-4zM19 9.5l4 4-4 4-4-4zM12 13.5l4 4-4 4-4-4z"/>`,
	fit: `<path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2"/>`,
	spell: `<path d="M3 21l11-11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M17 2l1.2 3.3L21.5 6.5l-3.3 1.2L17 11l-1.2-3.3L12.5 6.5l3.3-1.2z"/>`,
	close: `<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
	trash: `<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`
};
const svg = (name, size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${SVG[name]}</svg>`;
const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const SAVED_KEY = "studiolite.animationLibrary.v1";

function rigRootOf(object) {
	for (let o = object; o; o = o.parent) if (o.userData && o.userData.isAnimRig) return o;
	return null;
}

/**
 * Moon-Animator-style keyframe editor for the Humanoid dummies spawned by the Rig Builder.
 * Every dummy owns an AnimationMixer; the editor drives the active one. The editable data
 * is an AnimationDocument compiled to an AnimationClip whenever it changes, and nothing
 * reaches a mixer before validateAnimationCompatibility() accepts its Humanoid.RigType.
 *
 * Emits "change" { open } when the panel opens/closes, "posechange" when bones move,
 * "rigchange" { root } when the active dummy changes.
 */
export class AnimationEditor extends EventTarget {
	constructor({ renderer, panel, center, print, toast, openMenu, spawnRig, deleteRig }) {
		super();
		this.renderer = renderer;
		this.tools = renderer.tools;
		this.panel = panel;
		this.center = center;
		this.print = print;
		this.toast = toast;
		this.openMenu = openMenu;
		this.spawnRig = spawnRig;
		this.deleteRig = deleteRig;

		this.isOpen = false;
		/** @type {Map<import("three").Object3D, { mixer: AnimationMixer, lastDoc: AnimationDocument|null }>} */
		this.rigs = new Map();
		this.rig = null;
		this.mixer = null;
		this.action = null;
		this.clip = null;
		this.docs = [];
		this.doc = null;
		this.time = 0;
		this.speed = 1;
		this.playing = false;
		this.recording = false;
		this.keyEase = "linear";
		this.tab = "timeline";
		this.clock = new Clock();

		this._buildPanel();
		this.timeline = new Timeline({
			container: this.panel.querySelector(".anim-timeline"),
			onScrub: (t) => {
				this.pause();
				this.setTime(t);
			},
			onSelectBone: (name) => this.selectBone(name),
			onChange: (reason) => this._onTimelineChange(reason),
			onContextMenu: (anchor, refs, time) => this._openKeyMenu(anchor, refs, time)
		});

		this.tools.extraPickables = () => {
			const out = [];
			for (const root of this.rigs.keys()) if (root.visible) out.push(...rigPickables(root));
			return out;
		};
		this.renderer.rigResolver = (mesh, alt) => this._resolveRigHit(mesh, alt);
		this.tools.addEventListener("selectionchange", (e) => this._onSelectionChange(e.detail));
		this.tools.addEventListener("transformend", (e) => this._onTransformEnd(e.detail.target));
		this.tools.transform.addEventListener("dragging-changed", (e) => {
			if (e.value && this.playing) this.pause();
		});
		window.addEventListener("keydown", (e) => this._onKeyDown(e));
	}

	get rigType() {
		return this.rig ? this.rig.userData.rigType || "R15" : null;
	}

	/* ---------- Panel ---------- */

	_buildPanel() {
		const p = this.panel;
		p.innerHTML = `
			<header class="panel-header anim-header">
				<span class="panel-title"><b>Animation Editor</b></span>
				<div class="anim-tabs" role="tablist">
					<button type="button" role="tab" class="anim-tab active" data-anim="tab-timeline" aria-selected="true">Timeline</button>
					<button type="button" role="tab" class="anim-tab" data-anim="tab-library" aria-selected="false">Animation Library</button>
				</div>
				<label class="anim-rigpick" title="Dummy ativo (Model com Humanoid)">
					<span class="anim-rigtype" data-anim="rigtype">—</span>
					<select data-anim="rig" aria-label="Rig ativo"></select>
				</label>
				<div class="panel-actions">
					<button type="button" class="panel-btn" data-anim="remove-rig" title="Apagar o dummy ativo (Model inteiro)">Apagar dummy</button>
					<button type="button" class="panel-btn anim-close" data-anim="close" title="Fechar">${svg("close")}</button>
				</div>
			</header>
			<div class="anim-toolbar" role="toolbar" aria-label="Animation">
				<div class="anim-group">
					<select class="anim-clip" data-anim="clip" aria-label="Animação"></select>
					<button type="button" class="anim-btn" data-anim="new" title="Nova animação vazia para o RigType ativo">Nova</button>
					<button type="button" class="anim-btn anim-spell" data-anim="inject" title="Injetar as animações de feitiço (R15) do testeR15">${svg("spell")}<span>Feitiços</span></button>
					<button type="button" class="anim-btn" data-anim="import" title="Importar .anim.json">Importar</button>
					<button type="button" class="anim-btn" data-anim="export" title="Exportar .anim.json">Exportar</button>
					<input type="file" accept=".json,application/json" hidden data-anim="file">
				</div>
				<div class="anim-group anim-transport">
					<button type="button" class="anim-icon" data-anim="start" title="Início (Home)">${svg("start")}</button>
					<button type="button" class="anim-icon" data-anim="prev-key" title="Keyframe anterior (,)">${svg("prev")}</button>
					<button type="button" class="anim-icon anim-play" data-anim="play" title="Play (Espaço na timeline alterna)">${svg("play")}</button>
					<button type="button" class="anim-icon" data-anim="pause" title="Pause">${svg("pause")}</button>
					<button type="button" class="anim-icon anim-stop" data-anim="stop" title="Stop: para e volta ao frame 0">${svg("stop")}</button>
					<button type="button" class="anim-icon" data-anim="next-key" title="Próximo keyframe (.)">${svg("next")}</button>
					<span class="anim-time"><b data-anim="time">0.00</b><i>/</i><span data-anim="dur">0.00</span>s <em data-anim="frame">f0</em></span>
					<label class="anim-speed" title="Playback Speed (duplo clique no valor volta a 1×)">
						<span>Vel.</span>
						<input type="range" min="0.1" max="3" step="0.05" value="1" data-anim="speed" aria-label="Playback Speed">
						<output data-anim="speed-out">1.00×</output>
					</label>
				</div>
				<div class="anim-group">
					<button type="button" class="anim-btn anim-rec" data-anim="record" aria-pressed="false" title="Auto-key: cada transformação no gizmo grava um keyframe no playhead">${svg("rec")}<span>Rec</span></button>
					<button type="button" class="anim-btn anim-key" data-anim="key" title="Adicionar keyframe do osso selecionado (K)">${svg("key")}<span>Keyframe</span></button>
					<button type="button" class="anim-btn" data-anim="pose" title="Keyframe de todos os ossos (Shift+K)">${svg("pose")}<span>Pose</span></button>
					<label class="anim-field" title="Interpolação dos novos keyframes (segmento que termina no keyframe)">
						<span>Interp.</span>
						<select data-anim="ease"></select>
					</label>
				</div>
				<div class="anim-group anim-right">
					<label class="anim-field"><input type="checkbox" data-anim="loop"> <span>Loop</span></label>
					<label class="anim-field" title="Duração (s)"><span>Dur.</span><input type="number" min="0.1" step="0.1" data-anim="duration"></label>
					<label class="anim-field"><span>FPS</span><select data-anim="fps"><option>24</option><option>30</option><option>60</option></select></label>
					<button type="button" class="anim-icon" data-anim="fit" title="Ajustar zoom (Ctrl+roda faz zoom)">${svg("fit")}</button>
					<span class="anim-status" data-anim="status"></span>
				</div>
			</div>
			<div class="anim-timeline"></div>
			<div class="anim-library" data-anim="library" hidden></div>`;

		this.ui = {};
		for (const node of p.querySelectorAll("[data-anim]")) this.ui[node.dataset.anim] = node;
		this.ui.ease.innerHTML = Object.entries(EASINGS).map(([id, e]) => `<option value="${id}">${e.label}</option>`).join("");
		this.ui.ease.value = this.keyEase;

		p.addEventListener("click", (e) => {
			const btn = e.target.closest("button[data-anim]");
			if (btn) this._onToolbarAction(btn.dataset.anim, btn);
		});
		this.ui.library.addEventListener("click", (e) => this._onLibraryClick(e));
		this.ui.rig.addEventListener("change", () => {
			const root = [...this.rigs.keys()][Number(this.ui.rig.value)];
			if (root) this.tools.select(root, "animation");
		});
		this.ui.clip.addEventListener("change", () => {
			if (!this.setDocument(this.docs[Number(this.ui.clip.value)])) this._updateToolbar();
		});
		this.ui.speed.addEventListener("input", () => this.setSpeed(Number(this.ui.speed.value)));
		this.ui["speed-out"].addEventListener("dblclick", () => this.setSpeed(1));
		this.ui.ease.addEventListener("change", () => {
			this.keyEase = this.ui.ease.value;
			const refs = this.timeline.getSelectedRefs();
			if (refs.length) this._setEase(refs, this.keyEase);
		});
		this.ui.loop.addEventListener("change", () => {
			if (!this.doc) return;
			this.doc.loop = this.ui.loop.checked;
			this._applyLoop();
		});
		this.ui.duration.addEventListener("change", () => {
			if (!this.doc) return;
			const v = Math.max(0.1, Number(this.ui.duration.value) || this.doc.duration);
			this.doc.duration = Math.max(v, this.doc.lastKeyTime());
			this.doc.touch();
			this._docChanged();
		});
		this.ui.fps.addEventListener("change", () => {
			if (!this.doc) return;
			this.doc.fps = Number(this.ui.fps.value);
			this.doc.touch();
			this._docChanged();
		});
		this.ui.file.addEventListener("change", () => this._importFile(this.ui.file.files[0]));
	}

	_onToolbarAction(action) {
		switch (action) {
			case "close": return this.close();
			case "remove-rig": return this.rig && this.deleteRig && this.deleteRig(this.rig);
			case "tab-timeline": return this.setTab("timeline");
			case "tab-library": return this.setTab("library");
			case "new": return this.newDocument();
			case "inject": return this.injectSpells();
			case "import": return this.ui.file.click();
			case "export": return this.exportDocument();
			case "start": this.pause(); return this.setTime(0);
			case "prev-key": return this.stepKey(-1);
			case "next-key": return this.stepKey(1);
			case "play": return this.play();
			case "pause": return this.pause();
			case "stop": return this.stop();
			case "record": return this.setRecording(!this.recording);
			case "key": return this.addKeyframe();
			case "pose": return this.keyPose();
			case "fit": return this.timeline.zoomToFit();
		}
	}

	setTab(tab) {
		this.tab = tab;
		for (const [id, name] of [["tab-timeline", "timeline"], ["tab-library", "library"]]) {
			this.ui[id].classList.toggle("active", tab === name);
			this.ui[id].setAttribute("aria-selected", String(tab === name));
		}
		this.panel.querySelector(".anim-timeline").hidden = tab !== "timeline";
		this.ui.library.hidden = tab !== "library";
		if (tab === "library") this._renderLibrary();
		else requestAnimationFrame(() => this.timeline.render());
	}

	_updateToolbar() {
		const doc = this.doc;
		this.ui.play.classList.toggle("active", this.playing);
		this.ui.pause.classList.toggle("active", !this.playing && !!doc && this.time > 0);
		this.ui.record.setAttribute("aria-pressed", String(this.recording));
		this.panel.classList.toggle("recording", this.recording);
		const bone = this.selectedBone();
		this.ui.key.disabled = !bone;
		this.ui.key.title = bone ? `Adicionar keyframe em ${bone.name} (K)` : "Alt+clique numa parte do dummy ativo (ou clique num osso da timeline) para criar keyframe (K)";
		this._updateRigPicker();
		if (this.tab === "library") this._renderLibrary();
		if (!doc) return;
		this.ui.clip.innerHTML = this.docs.map((d, i) => `<option value="${i}"${d === doc ? " selected" : ""}></option>`).join("");
		[...this.ui.clip.options].forEach((o, i) => {
			const d = this.docs[i];
			o.textContent = `[${d.rigType || "?"}] ${d.name}`;
		});
		this.ui.loop.checked = doc.loop;
		if (document.activeElement !== this.ui.duration) this.ui.duration.value = doc.duration.toFixed(2);
		this.ui.fps.value = String(doc.fps);
		this.ui.dur.textContent = doc.duration.toFixed(2);
		this._syncEaseSelect();
		this._updateStatus();
	}

	_updateRigPicker() {
		const roots = [...this.rigs.keys()];
		this.ui.rig.innerHTML = roots.map((r, i) => `<option value="${i}"${r === this.rig ? " selected" : ""}>${esc(r.name)}</option>`).join("") || `<option>Nenhum dummy</option>`;
		this.ui.rig.disabled = roots.length === 0;
		const type = this.rigType;
		this.ui.rigtype.textContent = type || "—";
		this.ui.rigtype.className = `anim-rigtype${type ? ` is-${type.toLowerCase()}` : ""}`;
		this.ui["remove-rig"].disabled = !this.rig;
	}

	_updateStatus() {
		if (!this.doc) return;
		const sel = this.timeline.selection.size;
		const b = this._binding;
		const bind = b ? (b.ok ? `<span class="ok">✓ ${b.bound.length} tracks ligados</span>` : `<span class="bad">⚠ ${b.missing.length} sem ligação</span>`) : "";
		this.ui.status.innerHTML = `${this.doc.keyCount()} keys${sel ? ` · ${sel} sel.` : ""} · ${bind}`;
	}

	_updateTimeLabel() {
		const fps = this.doc ? this.doc.fps : 30;
		this.ui.time.textContent = this.time.toFixed(2);
		this.ui.frame.textContent = `f${Math.round(this.time * fps)}`;
	}

	/* ---------- Open / close ---------- */

	open() {
		if (this.isOpen) return;
		const root = this.ensureRig();
		// Spawning a dummy selects it, and that selection may already have opened the editor.
		if (!root || this.isOpen) return;
		this.isOpen = true;
		this.center.classList.add("anim-open");
		this._ensureDocsFor(this.rigType);
		if (!this.tools.mode) this.tools.setMode("rotate");
		this.print(`Animation Editor aberto para "${root.name}" (Humanoid.RigType = ${this.rigType}). Clique seleciona o Model inteiro; Alt+clique seleciona uma parte para posar com o gizmo e K (ou Rec) grava keyframes.`);
		requestAnimationFrame(() => this.timeline.zoomToFit());
		this._updateToolbar();
		this.dispatchEvent(new CustomEvent("change", { detail: { open: true } }));
	}

	close() {
		if (!this.isOpen) return;
		this.pause();
		this.isOpen = false;
		this.center.classList.remove("anim-open");
		if (this.tools.target && this.tools.target.kind === "bone") this.tools.select(null, "delete");
		this.dispatchEvent(new CustomEvent("change", { detail: { open: false } }));
	}

	toggle() {
		this.isOpen ? this.close() : this.open();
	}

	/** Opens (or draws attention to) the editor for a dummy. */
	focusRig(root, { flash = true } = {}) {
		const changed = root !== this.rig;
		this.setActiveRig(root);
		if (!this.isOpen) {
			this.open();
			return;
		}
		if (!flash && !changed) return;
		this.panel.classList.remove("anim-focus");
		void this.panel.offsetWidth;
		this.panel.classList.add("anim-focus");
	}

	/* ---------- Rigs ---------- */

	/** Active rig, spawning an R15 dummy through the Rig Builder when there is none. */
	ensureRig() {
		if (this.rig && this.rig.parent) return this.rig;
		const first = [...this.rigs.keys()][0];
		if (first) {
			this.setActiveRig(first);
			return first;
		}
		const root = this.spawnRig ? this.spawnRig("R15") : null;
		if (root && this.rig !== root) this.setActiveRig(root);
		return root;
	}

	/** Registers a dummy spawned by the Rig Builder (gets its own AnimationMixer). */
	addRig(root) {
		if (this.rigs.has(root)) return;
		this.rigs.set(root, { mixer: new AnimationMixer(root), lastDoc: null });
		this._updateRigPicker();
	}

	setActiveRig(root) {
		if (!root || root === this.rig || !this.rigs.has(root)) return;
		this.pause();
		this._stopAction();
		if (this.rig && this.rig.parent) resetRigPose(this.rig);
		const entry = this.rigs.get(root);
		this.rig = root;
		this.mixer = entry.mixer;
		this.timeline.setRigType(this.rigType);
		this.dispatchEvent(new CustomEvent("rigchange", { detail: { root } }));

		const docOk = this.doc && validateAnimationCompatibility(this.doc, this.rigType).ok;
		if (docOk) {
			entry.lastDoc = this.doc;
			this._recompile(true);
			this.setTime(this.time);
		} else {
			const previous = this.doc;
			this._ensureDocsFor(this.rigType, { load: false });
			const fallback = (entry.lastDoc && this.docs.includes(entry.lastDoc) ? entry.lastDoc : null)
				|| this.docs.find((d) => validateAnimationCompatibility(d, this.rigType).ok);
			if (previous) this.print(`"${previous.name}" é uma animação ${previous.rigType || "?"}; o rig ${root.name} é ${this.rigType}, então o editor abriu "${fallback.name}".`, "info");
			this.setDocument(fallback);
		}
		this._updateToolbar();
	}

	/** Called after the dummy's Model was deleted from the DataModel. */
	removeRig(root) {
		const entry = this.rigs.get(root);
		if (!entry) return;
		if (root === this.rig) {
			this.pause();
			this._stopAction();
			this.rig = null;
			this.mixer = null;
		}
		entry.mixer.stopAllAction();
		entry.mixer.uncacheRoot(root);
		this.rigs.delete(root);
		disposeRig(root);
		const next = [...this.rigs.keys()][0];
		if (!this.rig && next) this.setActiveRig(next);
		else if (!this.rig) this.close();
		this._updateToolbar();
	}

	removeAllRigs() {
		for (const root of [...this.rigs.keys()]) this.removeRig(root);
	}

	/**
	 * Roblox Studio click rule: a click walks up `parent` to the dummy's Model (rig root),
	 * Alt+click selects the hit part on its own. The part is edited through its bone, so
	 * the gizmo pivots on the Motor6D joint and keyframes capture the pose.
	 */
	_resolveRigHit(mesh, alt) {
		const bone = mesh.userData.boneTarget;
		const root = rigRootOf(mesh);
		if (!root) return bone;
		return alt ? bone : root;
	}

	_onSelectionChange({ target, source }) {
		const root = target ? (target.kind === "rig" ? target.object : target.kind === "bone" ? rigRootOf(target.object) : null) : null;
		if (root && this.rigs.has(root) && source !== "history" && findHumanoid(root.userData.rbx)) this.focusRig(root, { flash: target.kind === "rig" });
		this.timeline.setSelectedBone(target && target.kind === "bone" && root === this.rig ? target.name : null);
		this._updateToolbar();
	}

	selectedBone() {
		const t = this.tools.target;
		return t && t.kind === "bone" && this.rig && t.object.parent && rigRootOf(t.object) === this.rig ? t.object : null;
	}

	selectBone(name) {
		if (!this.rig) return;
		const bone = this.rig.getObjectByName(name);
		if (bone && bone.isBone) this.tools.select(bone, "animation");
		this.renderer.domElement.focus({ preventScroll: true });
	}

	/** Property rows for the Properties panel when a bone is selected. */
	boneProperties(bone) {
		const root = rigRootOf(bone);
		const rest = root?.userData.rest?.[bone.name];
		const off = rest ? bone.position.clone().sub(rest.position) : bone.position;
		const [rx, ry, rz] = quatEulerDeg(bone.quaternion.toArray());
		const keys = root === this.rig ? this.doc?.tracks.get(bone.name) : null;
		const spec = RIG_SPECS[root?.userData.rigType] || RIG_SPECS.R15;
		const joint = spec.joints.find((j) => j.part === bone.name);
		return {
			RigType: root?.userData.rigType || "R15",
			Motor6D: joint ? `${joint.motor} (${joint.parent} → ${joint.part})` : "—",
			JointOffset: `${fmt(off.x)}, ${fmt(off.y)}, ${fmt(off.z)}`,
			JointRotation: `${fmt(rx)}°, ${fmt(ry)}°, ${fmt(rz)}°`,
			Keyframes: keys ? `${keys.rotation.length} rot · ${keys.position.length} pos` : "0"
		};
	}

	/* ---------- Compatibility ---------- */

	/**
	 * Gate in front of every AnimationMixer load: compares the animation's RigType with the
	 * active Humanoid.RigType and reports a red error in the Output when they differ.
	 */
	_checkCompatibility(animationData, { report = true } = {}) {
		if (!this.rig) return true;
		const humanoid = findHumanoid(this.rig.userData.rbx);
		const rigType = humanoid ? humanoid.RigType : this.rigType;
		const result = validateAnimationCompatibility(animationData, rigType);
		if (!result.ok && report) {
			this.print(result.message, "error");
			this.toast && this.toast(result.message);
			this.panel.classList.remove("anim-denied");
			void this.panel.offsetWidth;
			this.panel.classList.add("anim-denied");
		}
		return result.ok;
	}

	/* ---------- Documents ---------- */

	/** Makes sure at least one animation for this RigType exists (library clips + a blank one). */
	_ensureDocsFor(rigType, { load = true } = {}) {
		if (!rigType || !this.rig) return;
		if (this.docs.some((d) => d.rigType === rigType)) {
			if (load && !this.doc) this.setDocument(this.docs.find((d) => d.rigType === rigType));
			return;
		}
		const built = [];
		for (const entry of ANIMATION_LIBRARY) {
			if (entry.rigType !== rigType) continue;
			const doc = this._buildLibraryDoc(entry);
			built.push(doc);
		}
		const blank = new AnimationDocument({ name: `Minha animação ${rigType}`, rigType });
		this.docs.push(blank);
		this.print(`Biblioteca ${rigType}: ${built.map((d) => `"${d.name}"`).join(", ")} prontas para o rig.`, "info");
		if (load && (!this.doc || !validateAnimationCompatibility(this.doc, rigType).ok)) this.setDocument(built[0] || blank);
	}

	_buildLibraryDoc(entry) {
		const doc = entry.build(this.rig, this.rig.userData.studs || 1);
		doc.libraryId = entry.id;
		const report = validateBindings(this.rig, doc.toClip());
		const i = this.docs.findIndex((d) => d.libraryId === entry.id);
		if (i >= 0) this.docs[i] = doc;
		else this.docs.push(doc);
		if (!report.ok) this.print(`"${doc.name}": tracks sem ligação: ${report.missing.join(", ")}`, "warn");
		return doc;
	}

	/** @returns {boolean} false when the animation was refused (RigType mismatch) */
	setDocument(doc) {
		if (!doc) return false;
		if (!this._checkCompatibility(doc)) return false;
		this.pause();
		this.doc = doc;
		if (this.rig) {
			resetRigPose(this.rig);
			this.rigs.get(this.rig).lastDoc = doc;
		}
		this.timeline.setDocument(doc);
		this._recompile(true);
		this.setTime(Math.min(this.time, doc.duration));
		this._updateToolbar();
		requestAnimationFrame(() => this.timeline.zoomToFit());
		return true;
	}

	newDocument() {
		const rigType = this.rigType || "R15";
		const doc = new AnimationDocument({ name: `Animação ${this.docs.length + 1} (${rigType})`, rigType });
		this.docs.push(doc);
		this.setDocument(doc);
		this.setTime(0);
		this.print(`Nova animação "${doc.name}" criada para Rig ${rigType}`);
	}

	/**
	 * Injects the testeR15 spell animations (Wand Cast / Get Up) as editable documents.
	 * They are R15 clips, so an R6 dummy refuses them.
	 */
	injectSpells({ quiet = false } = {}) {
		const rig = this.ensureRig();
		if (!rig) return;
		if (!this._checkCompatibility({ rigType: "R15", tracks: [] })) return;
		const injected = injectSpellAnimations(rig);
		injected.forEach((doc, index) => {
			doc.libraryId = ANIMATION_LIBRARY.find((e) => e.name === doc.name)?.id;
			const report = validateBindings(rig, doc.toClip());
			const i = this.docs.findIndex((d) => d.name === doc.name);
			if (i >= 0) this.docs[i] = doc;
			else this.docs.splice(index, 0, doc);
			const line = `Feitiço injetado: "${doc.name}" — ${doc.keyCount()} keyframes, ${report.bound.length}/${report.bound.length + report.missing.length} tracks ligados ao rig`;
			this.print(report.ok ? line : `${line}. Sem ligação: ${report.missing.join(", ")}`, report.ok ? "info" : "warn");
		});
		if (!quiet || !this.doc) this.setDocument(injected[0]);
		else this._updateToolbar();
		if (!quiet) this.toast && this.toast(`${injected.length} animações de feitiço injetadas`);
	}

	exportDocument() {
		if (!this.doc) return;
		const blob = new Blob([JSON.stringify(this.doc.toJSON(), null, 1)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${this.doc.name.replace(/[^\w\-]+/g, "_")}.anim.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		this.print(`Animação exportada: ${a.download} (${this.doc.keyCount()} keyframes, RigType ${this.doc.rigType || "?"}; efeitos de partículas não são exportados)`);
	}

	async _importFile(file) {
		this.ui.file.value = "";
		if (!file) return;
		try {
			const doc = AnimationDocument.fromJSON(JSON.parse(await file.text()));
			this.docs.push(doc);
			this.print(`Animação importada: "${doc.name}" (${doc.keyCount()} keyframes, RigType ${doc.rigType || "indefinido"})`);
			if (!this.setDocument(doc)) {
				this.print(`"${doc.name}" ficou na biblioteca da sessão, mas não foi carregada no AnimationMixer.`, "warn");
				this._updateToolbar();
			}
		} catch (err) {
			this.print(`Falha ao importar animação: ${err.message}`, "error");
		}
	}

	/* ---------- Animation Library ---------- */

	_savedEntries() {
		try {
			const list = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
			return Array.isArray(list) ? list : [];
		} catch (ignored) {
			return [];
		}
	}

	_writeSaved(list) {
		try {
			localStorage.setItem(SAVED_KEY, JSON.stringify(list));
			return true;
		} catch (err) {
			this.print(`Não foi possível salvar no navegador: ${err.message}`, "error");
			return false;
		}
	}

	saveCurrentToLibrary() {
		if (!this.doc) return;
		const json = this.doc.toJSON();
		const list = this._savedEntries().filter((s) => s.name !== json.name);
		list.unshift({ ...json, savedAt: Date.now() });
		if (this._writeSaved(list)) {
			this.print(`"${json.name}" salva na Animation Library (RigType ${json.rigType || "?"}, ${this.doc.keyCount()} keyframes)`);
			this._renderLibrary();
		}
	}

	_renderLibrary() {
		const rigType = this.rigType;
		const badge = (type) => `<span class="lib-badge ${type ? `is-${type.toLowerCase()}` : ""}">${type || "?"}</span>`;
		const item = (key, { name, type, desc, meta, loaded, removable }) => {
			const ok = !rigType || !type || type === rigType;
			return `<li class="lib-item${ok ? "" : " incompatible"}${loaded ? " loaded" : ""}" data-lib="${key}">
				${badge(type)}
				<div class="lib-text"><b>${esc(name)}</b><small>${esc(desc || "")}${meta ? ` · ${esc(meta)}` : ""}</small>
				${ok ? "" : `<em class="lib-warn">Rig ativo é ${rigType}: será bloqueada</em>`}</div>
				<div class="lib-actions">
					<button type="button" class="lib-btn" data-lib-act="load">Carregar</button>
					<button type="button" class="lib-btn lib-play" data-lib-act="play" title="Carregar e tocar">${svg("play", 12)}</button>
					${removable ? `<button type="button" class="lib-btn lib-del" data-lib-act="remove" title="Remover da biblioteca">${svg("trash", 12)}</button>` : ""}
				</div>
			</li>`;
		};

		const groups = new Map();
		for (const entry of ANIMATION_LIBRARY) {
			if (!groups.has(entry.category)) groups.set(entry.category, []);
			const loaded = this.doc && this.doc.libraryId === entry.id;
			groups.get(entry.category).push(item(`builtin:${entry.id}`, { name: entry.name, type: entry.rigType, desc: entry.description, loaded }));
		}
		const session = this.docs
			.map((d, i) => (d.libraryId ? "" : item(`doc:${i}`, { name: d.name, type: d.rigType, desc: "Nesta sessão", meta: `${d.keyCount()} keys · ${d.duration.toFixed(2)}s`, loaded: d === this.doc })))
			.filter(Boolean);
		const saved = this._savedEntries().map((s, i) => item(`saved:${i}`, {
			name: s.name,
			type: s.rigType,
			desc: "Salva no navegador",
			meta: `${Number(s.duration || 0).toFixed(2)}s`,
			removable: true
		}));

		const section = (title, items, empty) => `<section class="lib-group"><h4>${esc(title)}</h4>${items.length ? `<ul>${items.join("")}</ul>` : `<p class="lib-empty">${empty}</p>`}</section>`;
		this.ui.library.innerHTML = `
			<div class="lib-bar">
				<span>Rig ativo: <b>${esc(this.rig ? this.rig.name : "nenhum")}</b> · Humanoid.RigType = ${badge(rigType)}</span>
				<button type="button" class="anim-btn" data-lib-act="save" ${this.doc ? "" : "disabled"}>Salvar animação atual</button>
			</div>
			<div class="lib-columns">
				${[...groups].map(([title, items]) => section(title, items, "")).join("")}
				${section("Nesta sessão", session, "Crie com “Nova” ou importe um .anim.json.")}
				${section("Salvas no navegador", saved, "Use “Salvar animação atual” para guardar aqui.")}
			</div>`;
	}

	_onLibraryClick(e) {
		const btn = e.target.closest("[data-lib-act]");
		if (!btn) return;
		const act = btn.dataset.libAct;
		if (act === "save") return this.saveCurrentToLibrary();
		const key = btn.closest("[data-lib]")?.dataset.lib;
		if (!key) return;
		const [kind, id] = key.split(":");
		if (act === "remove" && kind === "saved") {
			const list = this._savedEntries();
			const [removed] = list.splice(Number(id), 1);
			this._writeSaved(list);
			if (removed) this.print(`"${removed.name}" removida da Animation Library`);
			return this._renderLibrary();
		}
		const play = act === "play";
		if (kind === "builtin") return this.loadLibraryAnimation(ANIMATION_LIBRARY.find((entry) => entry.id === id), { play });
		if (kind === "doc") return this._loadAndMaybePlay(this.docs[Number(id)], play);
		if (kind === "saved") {
			const json = this._savedEntries()[Number(id)];
			if (!json) return;
			if (!this._checkCompatibility(json)) return;
			let doc = this.docs.find((d) => d.savedName === json.name);
			if (!doc) {
				doc = AnimationDocument.fromJSON(json);
				doc.savedName = json.name;
				this.docs.push(doc);
			}
			return this._loadAndMaybePlay(doc, play);
		}
	}

	/** Loads a built-in library clip into the active dummy's AnimationMixer (after the RigType check). */
	loadLibraryAnimation(entry, { play = false } = {}) {
		if (!entry || !this.ensureRig()) return false;
		if (!this._checkCompatibility(entry)) return false;
		const doc = this.docs.find((d) => d.libraryId === entry.id) || this._buildLibraryDoc(entry);
		return this._loadAndMaybePlay(doc, play);
	}

	_loadAndMaybePlay(doc, play) {
		if (!doc) return false;
		if (doc !== this.doc && !this.setDocument(doc)) return false;
		if (doc === this.doc && !this._checkCompatibility(doc)) return false;
		if (play) {
			this.setTime(0);
			this.play();
		}
		this.print(`${play ? "Tocando" : "Carregada"}: "${doc.name}" no Animator de ${this.rig.name}`);
		this._updateToolbar();
		return true;
	}

	/* ---------- Mixer ---------- */

	_stopAction() {
		if (!this.action || !this.mixer) return;
		this.action.stop();
		this.mixer.uncacheAction(this.clip);
		this.mixer.uncacheClip(this.clip);
		this.action = null;
		this.clip = null;
	}

	_recompile(report = false) {
		if (!this.rig || !this.doc || !this.mixer) return;
		this._stopAction();
		if (!this._checkCompatibility(this.doc, { report })) return;
		this.clip = this.doc.toClip();
		this.clip.userData = { rigType: this.doc.rigType };
		this._binding = validateBindings(this.rig, this.clip);
		if (report && !this._binding.ok) {
			if (this._binding.missing.length) this.print(`AnimationMixer: tracks sem osso correspondente: ${this._binding.missing.join(", ")}`, "warn");
			if (this._binding.duplicates.length) this.print(`AnimationMixer: nomes de osso duplicados: ${this._binding.duplicates.join(", ")}`, "warn");
		}
		this.action = this.mixer.clipAction(this.clip);
		this.action.timeScale = this.speed;
		this._applyLoop();
		this.action.play();
		this.action.paused = !this.playing;
		this.action.time = Math.min(this.time, this.clip.duration);
		this.mixer.update(0);
		this._updateStatus();
	}

	_applyLoop() {
		if (!this.action) return;
		this.action.setLoop(this.doc.loop ? LoopRepeat : LoopOnce, Infinity);
		this.action.clampWhenFinished = true;
	}

	_docChanged({ render = true } = {}) {
		this._recompile();
		if (render) this.timeline.render();
		this._updateToolbar();
		this.setTime(Math.min(this.time, this.doc.duration));
	}

	setTime(t) {
		if (!this.doc) return;
		this.time = Math.max(0, Math.min(t, this.doc.duration));
		if (this.action) {
			this.action.time = Math.min(this.time, this.clip.duration);
			this.action.enabled = true;
			this.mixer.update(0);
		}
		this.timeline.setTime(this.time);
		this._updateTimeLabel();
		this.dispatchEvent(new CustomEvent("posechange"));
	}

	setSpeed(value) {
		this.speed = Math.max(0.1, Math.min(3, value || 1));
		if (this.action) this.action.timeScale = this.speed;
		this.ui.speed.value = String(this.speed);
		this.ui["speed-out"].textContent = `${this.speed.toFixed(2)}×`;
	}

	play() {
		if (!this.doc || !this.action || this.playing) return;
		if (!this.doc.loop && this.time >= this.doc.duration - 1e-3) this.setTime(0);
		this.playing = true;
		this.action.paused = false;
		this.action.enabled = true;
		this.clock.getDelta();
		this._updateToolbar();
	}

	pause() {
		if (!this.playing) return;
		this.playing = false;
		if (this.action) this.action.paused = true;
		this._updateToolbar();
	}

	stop() {
		const wasPlaying = this.playing;
		this.pause();
		this.setTime(0);
		this._updateToolbar();
		if (wasPlaying) this.print("Stop: animação parada no frame 0");
	}

	togglePlay() {
		this.playing ? this.pause() : this.play();
	}

	/** Called every frame by the app loop. */
	update() {
		const dt = Math.min(this.clock.getDelta(), 0.1);
		if (!this.playing || !this.action || !this.isOpen) return;
		this.mixer.update(dt);
		let t = this.action.time;
		if (!this.doc.loop && t >= this.clip.duration - 1e-4) {
			t = this.clip.duration;
			this.pause();
		}
		this.time = Math.min(t, this.doc.duration);
		this.timeline.setTime(this.time);
		this._updateTimeLabel();
	}

	stepKey(dir) {
		if (!this.doc) return;
		const times = new Set();
		for (const entry of this.doc.tracks.values()) for (const k of [...entry.rotation, ...entry.position]) times.add(k.time);
		const sorted = [...times].sort((a, b) => a - b);
		const next = dir > 0 ? sorted.find((t) => t > this.time + 1e-4) : sorted.reverse().find((t) => t < this.time - 1e-4);
		this.pause();
		this.setTime(next ?? (dir > 0 ? this.doc.duration : 0));
	}

	stepFrame(dir) {
		if (!this.doc) return;
		this.pause();
		this.setTime(this.doc.snapTime(this.time + dir / this.doc.fps));
	}

	/* ---------- Recording ---------- */

	setRecording(on) {
		this.recording = on;
		this._updateToolbar();
		this.print(on ? "Rec ligado: cada transformação de osso grava um keyframe no playhead" : "Rec desligado");
	}

	/**
	 * Captures the selected bone's exact local .position / .quaternion at the playhead.
	 * @param {{ channels?: ("rotation"|"position")[] }} [options]
	 */
	addKeyframe({ channels } = {}) {
		const bone = this.selectedBone();
		if (!bone) {
			this.toast && this.toast("Alt+clique numa parte do dummy (ou clique num osso da timeline) para criar keyframe.");
			return;
		}
		if (!this.doc || !this._checkCompatibility(this.doc)) return;
		this.pause();
		const keyed = this._keyBone(bone, channels);
		this._docChanged();
		this.print(`Keyframe ${bone.name} [${keyed.join(" + ")}] @ ${this.time.toFixed(2)}s (${EASINGS[this.keyEase].label})`);
	}

	/** Keys every bone of the active rig at the playhead (full pose). */
	keyPose() {
		if (!this.rig || !this.doc || !this._checkCompatibility(this.doc)) return;
		this.pause();
		let n = 0;
		for (const name of RIG_SPECS[this.rigType].bones) {
			const bone = this.rig.getObjectByName(name);
			if (bone) n += this._keyBone(bone).length;
		}
		this._docChanged();
		this.print(`Pose completa gravada @ ${this.time.toFixed(2)}s (${n} keyframes)`);
	}

	_keyBone(bone, channels) {
		const doc = this.doc;
		if (!doc.rigType) doc.rigType = this.rigType;
		const rest = this.rig.userData.rest[bone.name];
		const keyed = [];
		const wantRot = !channels || channels.includes("rotation");
		const posTrack = doc.channel(bone.name, "position");
		const moved = rest && bone.position.distanceToSquared(rest.position) > 1e-8;
		const wantPos = channels ? channels.includes("position") : (moved || (posTrack && posTrack.length > 0));
		if (wantRot) {
			doc.setKey(bone.name, "rotation", this.time, bone.quaternion.toArray(), this.keyEase);
			keyed.push("rotation");
		}
		if (wantPos) {
			doc.setKey(bone.name, "position", this.time, bone.position.toArray(), this.keyEase);
			keyed.push("position");
		}
		return keyed;
	}

	_onTransformEnd(target) {
		if (!this.isOpen || !target || target.kind !== "bone" || rigRootOf(target.object) !== this.rig) return;
		this.dispatchEvent(new CustomEvent("posechange"));
		if (!this.recording || !this.doc) return;
		const mode = this.tools.transform.mode;
		if (mode === "scale") return;
		this._keyBone(target.object, [mode === "translate" ? "position" : "rotation"]);
		this._docChanged();
		this.print(`Rec: ${target.name} ${mode === "translate" ? "position" : "rotation"} @ ${this.time.toFixed(2)}s`);
	}

	/* ---------- Timeline callbacks ---------- */

	_onTimelineChange(reason) {
		if (reason === "selection") {
			this._updateStatus();
			this._syncEaseSelect();
			return;
		}
		if (reason === "drag") {
			this._recompile();
			this.setTime(this.time);
			return;
		}
		this._docChanged({ render: false });
		if (reason === "delete") this.print("Keyframes excluídos");
	}

	/** With keys selected the dropdown shows (and edits) their easing; otherwise the easing for new keys. */
	_syncEaseSelect() {
		const refs = this.timeline.getSelectedRefs();
		const shared = refs.length && refs.every((r) => r.key.ease === refs[0].key.ease) ? refs[0].key.ease : null;
		this.ui.ease.value = refs.length ? (shared || this.keyEase) : this.keyEase;
	}

	_setEase(refs, ease) {
		this.doc.setEase(refs, ease);
		this._docChanged();
		this.print(`Interpolação "${EASINGS[ease].label}" aplicada a ${refs.length} keyframe(s)`);
	}

	_openKeyMenu(anchor, refs, time) {
		const current = refs.every((r) => r.key.ease === refs[0].key.ease) ? refs[0].key.ease : null;
		this.openMenu(anchor, [
			{ title: `${refs.length} keyframe(s) @ ${time.toFixed(2)}s` },
			...Object.entries(EASINGS).map(([id, e]) => ({ label: e.label, checked: id === current, onClick: () => this._setEase(refs, id) })),
			"sep",
			{ label: "Ir para este frame", onClick: () => { this.pause(); this.setTime(time); } },
			{ label: "Excluir", hint: "Del", onClick: () => this.timeline.deleteSelected() }
		]);
	}

	_onKeyDown(e) {
		if (!this.isOpen || isTypingTarget(e.target) || isDialogOpen() || document.body.classList.contains("play-mode")) return;
		if (e.ctrlKey || e.metaKey || e.altKey) {
			if ((e.ctrlKey || e.metaKey) && e.code === "KeyA" && this.panel.contains(document.activeElement)) {
				e.preventDefault();
				this.timeline.selectAll();
			}
			return;
		}
		const inPanel = this.panel.contains(document.activeElement);
		switch (e.code) {
			case "KeyK":
				e.preventDefault();
				if (e.shiftKey) this.keyPose();
				else this.addKeyframe();
				return;
			case "Comma":
				e.preventDefault();
				return e.shiftKey ? this.stepKey(-1) : this.stepFrame(-1);
			case "Period":
				e.preventDefault();
				return e.shiftKey ? this.stepKey(1) : this.stepFrame(1);
			case "Space":
				if (!inPanel) return;
				e.preventDefault();
				return this.togglePlay();
			case "Home":
				if (!inPanel) return;
				e.preventDefault();
				this.pause();
				return this.setTime(0);
			case "ArrowLeft":
			case "ArrowRight":
				if (!inPanel) return;
				e.preventDefault();
				return this.stepFrame(e.code === "ArrowLeft" ? -1 : 1);
		}
	}
}
