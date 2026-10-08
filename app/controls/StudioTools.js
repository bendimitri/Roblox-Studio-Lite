import {
	Raycaster,
	Vector2,
	Vector3,
	Quaternion,
	Euler,
	Box3,
	Group,
	BoxGeometry,
	EdgesGeometry,
	LineSegments,
	LineBasicMaterial,
	Color,
	Matrix4,
	MathUtils
} from '../thirdparty/three/three.core.js';
import { TransformControls } from './TransformControls.js';
import { isTypingTarget, isDialogOpen, viewportHasFocus } from './InputFocus.js';

const SELECTION_COLOR = new Color(0x1aa3ff);
const CLICK_TOLERANCE_PX = 5;
const NUDGE_STEP = 1;
const NUDGE_STEP_FINE = 0.1;
const ROTATE_STEP = MathUtils.degToRad(15);
const ROTATE_STEP_FINE = MathUtils.degToRad(1);
const ROTATION_SNAP = MathUtils.degToRad(15);
const MOVE_SNAP = 1;
const OUTLINE_PADDING = 0.06;
const HISTORY_LIMIT = 100;
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const WORLD_Z = new Vector3(0, 0, 1);
const DRAG_AXES = { x: WORLD_X, y: WORLD_UP, z: WORLD_Z };

const MODE_LABELS = {
	translate: "Move Mode - 1",
	rotate: "Rotate Mode - 2",
	scale: "Scale Mode - 3"
};

/** Bones and animation rigs keep their hierarchy, so they are edited and restored in local space. */
const isLocalKind = (kind) => kind === "bone" || kind === "rig";

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Euler(0, 0, 0, "YXZ");
const fmt = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Roblox Studio style editing: LMB raycast selection (parts or whole models), oriented blue
 * selection box, Move [1] / Rotate [2] / Scale [3] gizmos, arrow-key nudging, ESC to cancel.
 *
 * A selection target is either a single part mesh or a model: { treeId, name, meshes }.
 * Models are edited through a temporary pivot Group the meshes are re-parented into.
 *
 * Emits: "selectionchange" { target, source }, "statechange", "transformend" { target },
 *        "deleterequest" { target }, "grouprequest" { target }
 */
export default class StudioTools extends EventTarget {
	constructor({ scene, camera, domElement, flyCamera, isPickable, resolveTarget, onPartSizeChanged, isActive, print }) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.domElement = domElement;
		this.flyCamera = flyCamera;
		this.isPickable = isPickable;
		this.resolveTarget = resolveTarget || ((mesh) => mesh);
		/** Called after Size is written from mesh.scale (gizmo / nudge / undo) so UV tiling can refresh. */
		this.onPartSizeChanged = onPartSizeChanged || null;
		this.isActive = isActive || (() => true);
		this.print = print || (() => {});

		this.target = null;
		this.outline = null;
		this.showSelectionBox = true;
		this.helpersVisible = true;
		this.mode = null;
		this.snap = { rotate: true, move: false };
		this.raycaster = new Raycaster();
		this._ndc = new Vector2();
		this._down = null;
		this._cancelled = false;
		/** Surface-drag (Select tool): click-hold a part and slide it across world surfaces. */
		this._surfaceDrag = null;
		this._surfaceActive = false;
		this._dragIgnore = null;
		this._dragNet = new Vector3();
		/** Transform history entries: { label, selection, meshes, before: Matrix4[], after: Matrix4[] } */
		this.undoStack = [];
		this.redoStack = [];
		this._dragBefore = null;

		// Must be created before our own pointer listeners so the gizmo
		// resolves its hovered axis first on pointerdown.
		this.transform = new TransformControls(camera, domElement);
		this.transform.setSpace("world");
		this._applySnap();
		const helper = this.transform.getHelper();
		helper.name = "TransformGizmo";
		helper.userData.hideInExplorer = true;
		scene.add(helper);

		this.transform.addEventListener("dragging-changed", (e) => this._onDraggingChanged(e.value));
		this.transform.addEventListener("objectChange", () => this._syncTarget());

		domElement.tabIndex = 0;
		domElement.addEventListener("pointerdown", (e) => this._onPointerDown(e));
		domElement.addEventListener("pointermove", (e) => this._onPointerMove(e));
		domElement.addEventListener("pointerup", (e) => this._onPointerUp(e));
		window.addEventListener("keydown", (e) => this._onKeyDown(e));
		window.addEventListener("keyup", (e) => {
			if (e.key === "Shift") this._applySnap();
		});

		flyCamera.addEventListener("modechange", () => {
			this.transform.enabled = flyCamera.mode === "idle";
			this.setHelpersVisible(flyCamera.mode !== "play");
			this._emitState();
		});
	}

	/** The selected Object3D (a part mesh, a model pivot, a bone or a rig root). */
	get selected() {
		return this.target ? this.target.object : null;
	}

	get selectedName() {
		return this.target ? this.target.name : null;
	}

	get dragging() {
		return this.transform.dragging || this._surfaceActive;
	}

	get space() {
		return this.transform.space;
	}

	/** Meshes of the current selection (one for a part, many for a model). */
	get selectedMeshes() {
		return this.target ? this.target.meshes : [];
	}

	pick(clientX, clientY) {
		const rect = this.domElement.getBoundingClientRect();
		this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		return this.pickNdc(this._ndc);
	}

	pickNdc(ndc, { includeLocked = false } = {}) {
		this.raycaster.setFromCamera(ndc, this.camera);
		const candidates = this.scene.children.filter((o) => this.isPickable(o, includeLocked));
		if (this.target && this.target.kind === "model") {
			for (const child of this.target.object.children) if (this.isPickable(child, includeLocked)) candidates.push(child);
		}
		if (this.extraPickables) candidates.push(...this.extraPickables());
		const hits = this.raycaster.intersectObjects(candidates, false);
		return hits.length > 0 ? hits[0] : null;
	}

	/**
	 * @param {*} target null | Mesh | { treeId, name, meshes }
	 * @param {"viewport" | "explorer" | "insert" | "delete"} source
	 */
	select(target, source = "viewport") {
		const next = this._normalize(target);
		if (this._sameTarget(this.target, next)) return;
		this._release();

		if (next) {
			if (next.kind === "model") next.object = this._buildPivot(next);
			if (next.kind === "rig") next.handle = this._buildRigHandle(next.object);
			this.target = next;
			this._addOutline();
			if (this.mode) this.transform.attach(this._gizmoObject());
			if (source !== "history") {
				const rigOf = (o) => { for (; o; o = o.parent) if (o.userData.isAnimRig) return o.userData.rigType || "R15"; return "R15"; };
				const suffix = next.kind === "model" ? ` (Model, ${next.meshes.length} parts)`
					: next.kind === "bone" ? ` (Bone ${rigOf(next.object)})`
					: next.kind === "rig" ? ` (Model · Humanoid ${rigOf(next.object)})` : "";
				this.print(`Selection changed: ${next.name}${suffix}${source === "explorer" ? " (from Explorer)" : ""}`);
				if (!this.mode && source !== "insert" && source !== "animation") this.print("Press [1] Move, [2] Rotate, [3] Scale, hold Right Click to look around");
			}
		} else if (source !== "delete" && source !== "history") {
			this.print("Selection cleared");
		}

		this.dispatchEvent(new CustomEvent("selectionchange", { detail: { target: this.target, source } }));
		this._emitState();
	}

	setShowSelectionBox(show) {
		this.showSelectionBox = show;
		if (this.outline) this.outline.visible = show && this.helpersVisible;
	}

	/** @param {"translate" | "rotate" | "scale" | null} mode */
	setMode(mode) {
		if (mode === this.mode) return;
		if (!mode) {
			this.mode = null;
			this.transform.detach();
			this.print("Select tool active - transform gizmo released");
			this._emitState();
			return;
		}
		this.mode = mode;
		this.transform.setMode(mode);
		if (this.target) {
			this.transform.attach(this._gizmoObject());
			const others = ["[1] Select", "[2] Move", "[3] Scale", "[4] Rotate"].filter((s) => !s.includes(MODE_LABELS[mode].split(" ")[0]));
			this.print(`Transform gizmo active (${MODE_LABELS[mode]}) - ${others.join(", ")}, hold Right Click to look around`);
		} else {
			this.print(`${MODE_LABELS[mode]} armed - click a part to show the gizmo`);
		}
		this._emitState();
	}

	clearMode() {
		this.setMode(null);
	}

	toggleSpace() {
		const space = this.transform.space === "world" ? "local" : "world";
		this.transform.setSpace(space);
		this.print(`Transform space: ${space === "world" ? "World" : "Local"}`);
		this._emitState();
	}

	setSnap(kind, enabled) {
		this.snap[kind] = enabled;
		this._applySnap();
		this.print(kind === "rotate" ? `Rotate snap ${enabled ? "15°" : "off"}` : `Move snap ${enabled ? "1 stud" : "off"}`);
		this._emitState();
	}

	/** Hides editor-only helpers, e.g. while rendering an image or playing. */
	setHelpersVisible(visible) {
		this.helpersVisible = visible;
		this.transform.getHelper().visible = visible && this.transform.object !== undefined;
		if (this.outline) this.outline.visible = visible && this.showSelectionBox;
		this.dispatchEvent(new CustomEvent("helpersvisibility", { detail: { visible } }));
	}

	/** Called after external edits (material, color, size) so the outline matches again. */
	refreshOutline() {
		if (!this.target) return;
		this._removeOutline();
		this._addOutline();
	}

	_applySnap() {
		this.transform.setRotationSnap(this.snap.rotate ? ROTATION_SNAP : null);
		this.transform.setTranslationSnap(this.snap.move ? MOVE_SNAP : null);
	}

	_normalize(target) {
		if (!target) return null;
		if (target.userData?.isAnimRig) {
			return { kind: "rig", object: target, meshes: [], treeId: target.userData.treeId, name: target.name };
		}
		if (target.isBone) {
			return { kind: "bone", object: target, meshes: [], treeId: target.userData.treeId, name: target.name };
		}
		if (target.isMesh) {
			return { kind: "part", object: target, meshes: [target], treeId: target.userData.treeId, name: target.name || target.type };
		}
		const meshes = (target.meshes || []).filter(Boolean);
		if (meshes.length === 0) return null;
		return { kind: "model", object: null, meshes, treeId: target.treeId, name: target.name || "Model" };
	}

	_sameTarget(a, b) {
		if (!a || !b) return a === b;
		if (a.kind !== b.kind) return false;
		if (a.kind === "part" || isLocalKind(a.kind)) return a.object === b.object;
		return a.treeId !== undefined && a.treeId === b.treeId;
	}

	_buildPivot(target) {
		const box = new Box3();
		for (const mesh of target.meshes) box.expandByObject(mesh);
		const pivot = new Group();
		pivot.name = target.name;
		pivot.userData.isPivot = true;
		box.getCenter(pivot.position);
		pivot.userData.baseSize = box.getSize(new Vector3());
		this.scene.add(pivot);
		pivot.updateMatrixWorld(true);
		for (const mesh of target.meshes) pivot.attach(mesh);
		return pivot;
	}

	/** Rigs pivot around the HumanoidRootPart (Roblox PrimaryPart), not the root at the feet. */
	_buildRigHandle(root) {
		const handle = new Group();
		handle.name = `${root.name} Pivot`;
		handle.userData.isPivot = true;
		handle.userData.hideInExplorer = true;
		this.scene.add(handle);
		this._placeRigHandle(root, handle);
		return handle;
	}

	_placeRigHandle(root, handle) {
		root.updateMatrixWorld(true);
		const hrp = root.getObjectByName("HumanoidRootPart");
		if (hrp) hrp.getWorldPosition(handle.position);
		else new Box3().setFromObject(root).getCenter(handle.position);
		root.matrixWorld.decompose(_p, handle.quaternion, _s);
		handle.scale.set(1, 1, 1);
		handle.updateMatrixWorld(true);
		handle.userData.offset = new Matrix4().copy(handle.matrixWorld).invert().multiply(root.matrixWorld);
	}

	_gizmoObject() {
		return this.target ? (this.target.handle || this.target.object) : null;
	}

	/** Re-anchors the rig handle after the rig moved by other means (undo, Explorer edits). */
	refreshPivot() {
		const t = this.target;
		if (!t || !t.handle) return;
		this._placeRigHandle(t.object, t.handle);
	}

	_release() {
		if (!this.target) return;
		this._removeOutline();
		this.transform.detach();
		if (this.target.handle) this.scene.remove(this.target.handle);
		if (this.target.kind === "model") {
			const pivot = this.target.object;
			for (const child of [...pivot.children]) {
				if (child.isMesh) this.scene.attach(child);
			}
			this.scene.remove(pivot);
		}
		this.target = null;
	}

	_addOutline() {
		let object = this.target.object;
		const box = new Box3();
		if (this.target.kind === "bone") {
			object = object.userData.partMesh;
			if (!object) return;
			if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
			box.copy(object.geometry.boundingBox);
		} else if (this.target.kind === "rig") {
			object.updateMatrixWorld(true);
			const toRoot = new Matrix4().copy(object.matrixWorld).invert();
			const local = new Box3();
			for (const mesh of object.userData.partMeshes || []) {
				if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
				local.copy(mesh.geometry.boundingBox).applyMatrix4(new Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
				box.union(local);
			}
			if (box.isEmpty()) return;
		} else if (this.target.kind === "part") {
			if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
			box.copy(object.geometry.boundingBox);
		} else {
			for (const mesh of this.target.meshes) box.expandByObject(mesh);
			box.translate(_p.copy(object.position).negate());
		}
		const size = box.getSize(new Vector3()).addScalar(OUTLINE_PADDING);
		const geometry = new EdgesGeometry(new BoxGeometry(size.x, size.y, size.z));
		geometry.translate(...box.getCenter(new Vector3()).toArray());
		const outline = new LineSegments(geometry, new LineBasicMaterial({ color: SELECTION_COLOR, depthTest: false, transparent: true, opacity: .95 }));
		outline.name = "SelectionBox";
		outline.renderOrder = 999;
		outline.raycast = () => {};
		outline.visible = this.showSelectionBox && this.helpersVisible;
		object.add(outline);
		this.outline = outline;
	}

	_removeOutline() {
		if (!this.outline) return;
		this.outline.removeFromParent();
		this.outline.geometry.dispose();
		this.outline.material.dispose();
		this.outline = null;
	}

	/** Rebuilds the selection outline (after a part's size/transform changes from the Properties panel). */
	refreshOutline() {
		if (!this.target) return;
		this._removeOutline();
		this._addOutline();
	}

	_onPointerDown(e) {
		this.domElement.focus({ preventScroll: true });
		if (e.button !== 0) return;
		this._down = null;
		this._surfaceDrag = null;
		if (!this.isActive() || this.flyCamera.mode !== "idle" || this.flyCamera.playArmed) return;
		if (this.transform.dragging) return;
		this._down = { x: e.clientX, y: e.clientY };
		// Select tool only (no gizmo): arm a potential surface-drag on the part under the cursor.
		if (this.mode) return;
		const hit = this.pick(e.clientX, e.clientY);
		if (!hit) return;
		const spec = this.resolveTarget(hit.object, { alt: e.altKey });
		if (!spec) return;
		this._surfaceDrag = { spec, x: e.clientX, y: e.clientY, started: false };
		try { this.domElement.setPointerCapture(e.pointerId); } catch (ignored) {}
	}

	_onPointerMove(e) {
		const sd = this._surfaceDrag;
		if (!sd) return;
		if (!sd.started) {
			if (Math.hypot(e.clientX - sd.x, e.clientY - sd.y) <= CLICK_TOLERANCE_PX) return;
			this._beginSurfaceDrag(sd.spec);
			if (!this._surfaceActive) { this._surfaceDrag = null; return; }
		}
		this._updateSurfaceDrag(e.clientX, e.clientY);
	}

	_onPointerUp(e) {
		if (e.button !== 0) return;
		if (this._surfaceDrag) {
			const started = this._surfaceActive;
			try { this.domElement.releasePointerCapture(e.pointerId); } catch (ignored) {}
			this._surfaceDrag = null;
			if (started) { this._endSurfaceDrag(true); this._down = null; return; }
		}
		if (!this._down) return;
		const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
		this._down = null;
		if (moved > CLICK_TOLERANCE_PX) return;
		const hit = this.pick(e.clientX, e.clientY);
		this.select(hit ? this.resolveTarget(hit.object, { alt: e.altKey }) : null, "viewport");
	}

	/** Selects the part/model and starts a surface-drag (translation only). */
	_beginSurfaceDrag(spec) {
		this.select(spec, "viewport");
		if (!this.target || (this.target.kind !== "part" && this.target.kind !== "model")) return;
		this._surfaceActive = true;
		this._cancelled = false;
		this._dragBefore = this._capture(this.target);
		this._dragIgnore = new Set(this.target.meshes);
		this._dragNet.set(0, 0, 0);
		this._dragRotated = false;
		const object = this.target.object;
		this._dragStartPose = { position: object.position.clone(), quaternion: object.quaternion.clone() };
		this._emitState();
	}

	/** R / Ctrl+R / Alt+R while surface-dragging: turn the selection 90° on world Y / X / Z, then re-rest it. */
	_rotateSurfaceDrag(axis) {
		if (!this._surfaceActive || !this.target) return;
		const object = this.target.object;
		object.rotateOnWorldAxis(DRAG_AXES[axis], Math.PI / 2);
		object.updateMatrixWorld(true);
		this._dragRotated = true;
		if (this._lastPointer) this._updateSurfaceDrag(this._lastPointer.x, this._lastPointer.y);
		else this._syncTarget();
	}

	/** Raycasts the cursor onto world surfaces and rests the selection on the hit face. */
	_updateSurfaceDrag(clientX, clientY) {
		if (!this._surfaceActive || !this.target) return;
		this._lastPointer = { x: clientX, y: clientY };
		const hit = this._pickSurface(clientX, clientY, this._dragIgnore);
		if (!hit) return; // Over the void or sky: keep the last valid position.
		const normal = hit.face
			? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
			: new Vector3(0, 1, 0);
		const box = this._selectionBounds();
		const half = box.getSize(new Vector3()).multiplyScalar(0.5);
		const center = box.getCenter(new Vector3());
		// Offset from the hit point so the selection's bounding box rests against the surface.
		const offset = Math.abs(normal.x) * half.x + Math.abs(normal.y) * half.y + Math.abs(normal.z) * half.z;
		const delta = hit.point.clone().addScaledVector(normal, offset).sub(center);
		this._translateSelection(delta);
		this._dragNet.add(delta);
		this._syncTarget();
	}

	_endSurfaceDrag(commit) {
		if (!this._surfaceActive) return;
		this._surfaceActive = false;
		this._dragIgnore = null;
		this._dragStartPose = null;
		this._lastPointer = null;
		if (commit && this.target && this._dragBefore && (this._dragNet.lengthSq() > 1e-10 || this._dragRotated)) {
			this._syncTarget();
			this._pushHistory(`Move ${this.target.name}`, this._dragBefore);
			const p = this._selectionBounds().getCenter(new Vector3());
			this.print(`Dragged ${this.target.name} onto surface (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`);
			this.dispatchEvent(new CustomEvent("transformend", { detail: { target: this.target } }));
		}
		this._dragBefore = null;
		this._emitState();
	}

	/** Moves the whole selection (part mesh or model pivot) by a world-space delta. */
	_translateSelection(delta) {
		const object = this.target.object;
		object.position.add(delta);
		object.updateMatrixWorld(true);
	}

	_selectionBounds() {
		const box = new Box3();
		for (const mesh of this.target.meshes) box.expandByObject(mesh);
		return box;
	}

	/** Like pick(), but excludes the dragged meshes so the ray lands on the surface beneath them. */
	_pickSurface(clientX, clientY, ignore) {
		const rect = this.domElement.getBoundingClientRect();
		this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
		this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
		this.raycaster.setFromCamera(this._ndc, this.camera);
		const candidates = this.scene.children.filter((o) => this.isPickable(o, true) && !(ignore && ignore.has(o)));
		if (this.extraPickables) for (const o of this.extraPickables()) if (!(ignore && ignore.has(o))) candidates.push(o);
		const hits = this.raycaster.intersectObjects(candidates, false);
		return hits.length > 0 ? hits[0] : null;
	}

	_onDraggingChanged(dragging) {
		const target = this.target;
		if (dragging) {
			this._cancelled = false;
			this._dragBefore = target ? this._capture(target) : null;
		} else if (target && !this._cancelled) {
			if (this._dragBefore) this._pushHistory(this._historyLabel(), this._dragBefore);
			this._dragBefore = null;
			this._logTransform();
			this.dispatchEvent(new CustomEvent("transformend", { detail: { target } }));
		}
		this._emitState();
	}

	_logTransform() {
		const object = this.target.object;
		const mode = this.transform.mode;
		if (mode === "rotate") {
			_e.setFromQuaternion(object.quaternion, "YXZ");
			this.print(`Rotated ${this.target.name}: (${fmt(MathUtils.radToDeg(_e.x))}, ${fmt(MathUtils.radToDeg(_e.y))}, ${fmt(MathUtils.radToDeg(_e.z))})`);
		} else if (mode === "scale") {
			const size = this._currentSize();
			this.print(`Resized ${this.target.name} to (${fmt(size.x)}, ${fmt(size.y)}, ${fmt(size.z)})`);
		} else {
			const p = object.position;
			this.print(`Moved ${this.target.name} to (${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`);
		}
	}

	_baseSize() {
		const object = this.target.object;
		if (this.target.kind === "model") return object.userData.baseSize;
		if (isLocalKind(this.target.kind)) return new Vector3(1, 1, 1);
		if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
		return object.geometry.boundingBox.getSize(new Vector3());
	}

	_currentSize() {
		return this._baseSize().clone().multiply(this.target.object.scale);
	}

	_onKeyDown(e) {
		if (e.key === "Shift") this.transform.setRotationSnap(null);
		if (isTypingTarget(e.target) || isDialogOpen() || !this.isActive()) return;

		// Shift+R is left alone; Ctrl+R must be swallowed here or the browser reloads the page.
		if (this._surfaceActive && e.code === "KeyR" && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			if (e.repeat) return;
			this._rotateSurfaceDrag(e.ctrlKey || e.metaKey ? "x" : e.altKey ? "z" : "y");
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.code === "KeyG") {
			if (!this.target) return;
			e.preventDefault();
			this.dispatchEvent(new CustomEvent("grouprequest", { detail: { target: this.target } }));
			return;
		}
		if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
			e.preventDefault();
			if (this.transform.dragging || this.flyCamera.mode !== "idle") return;
			if (e.code === "KeyY" || e.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		switch (e.code) {
			case "Digit1":
			case "Numpad1":
				this.setMode(null);
				return;
			case "Digit2":
			case "Numpad2":
				this.setMode("translate");
				return;
			case "Digit3":
			case "Numpad3":
				this.setMode("scale");
				return;
			case "Digit4":
			case "Numpad4":
				this.setMode("rotate");
				return;
			case "KeyL":
				this.toggleSpace();
				return;
			case "Escape":
				this._onEscape();
				return;
			case "Delete":
				if (this.target && this.target.kind !== "bone" && viewportHasFocus(this.domElement)) {
					e.preventDefault();
					this.deleteSelected();
				}
				return;
		}

		if (e.code.startsWith("Arrow") || e.code === "PageUp" || e.code === "PageDown") {
			if (!this.target || !this.mode || this.flyCamera.mode !== "idle") return;
			if (!viewportHasFocus(this.domElement)) return;
			e.preventDefault();
			this._nudge(e);
		}
	}

	deleteSelected() {
		const target = this.target;
		if (!target || target.kind === "bone") return;
		this.select(null, "delete");
		this.print(`Deleted ${target.name}`);
		this.dispatchEvent(new CustomEvent("deleterequest", { detail: { target } }));
	}

	_onEscape() {
		if (this._surfaceActive) {
			this._cancelled = true;
			const object = this.target.object;
			if (this._dragStartPose) {
				object.position.copy(this._dragStartPose.position);
				object.quaternion.copy(this._dragStartPose.quaternion);
				object.updateMatrixWorld(true);
			} else {
				this._translateSelection(this._dragNet.clone().negate());
			}
			this._dragNet.set(0, 0, 0);
			this._dragStartPose = null;
			this._lastPointer = null;
			this._dragRotated = false;
			this._syncTarget();
			this._surfaceActive = false;
			this._surfaceDrag = null;
			this._dragIgnore = null;
			this._dragBefore = null;
			this.print("Drag cancelled (ESC)");
			this._emitState();
			return;
		}
		if (this.transform.dragging) {
			this._cancelled = true;
			this.transform.reset();
			this.transform.dragging = false;
			this.transform.axis = null;
			this._syncTarget();
			this.print("Transform cancelled (ESC)");
			return;
		}
		if (this.flyCamera.playArmed) {
			this.flyCamera.cancelPlayArm();
			this.print("First-person mode cancelled");
			return;
		}
		if (this.mode) {
			this.clearMode();
			return;
		}
		this.flyCamera.requestPlay();
	}

	/** Camera-relative world axes, snapped to the dominant horizontal axis like Studio. */
	_cameraAxes() {
		const forward = new Vector3();
		this.camera.getWorldDirection(forward);
		forward.y = 0;
		if (Math.abs(forward.x) > Math.abs(forward.z)) forward.set(Math.sign(forward.x), 0, 0);
		else forward.set(0, 0, Math.sign(forward.z) || -1);
		const right = new Vector3().crossVectors(forward, WORLD_UP);
		return { forward, right };
	}

	_nudge(e) {
		this.refreshPivot();
		const object = this._gizmoObject();
		object.updateMatrixWorld(true);
		const before = this._capture(this.target);
		const { forward, right } = this._cameraAxes();
		const vertical = e.shiftKey && (e.code === "ArrowUp" || e.code === "ArrowDown");

		if (this.mode === "translate") {
			const step = e.ctrlKey ? NUDGE_STEP_FINE : NUDGE_STEP;
			const delta = new Vector3();
			switch (e.code) {
				case "ArrowUp": delta.copy(vertical ? WORLD_UP : forward); break;
				case "ArrowDown": delta.copy(vertical ? WORLD_UP : forward).negate(); break;
				case "ArrowRight": delta.copy(right); break;
				case "ArrowLeft": delta.copy(right).negate(); break;
				case "PageUp": delta.copy(WORLD_UP); break;
				case "PageDown": delta.copy(WORLD_UP).negate(); break;
			}
			object.position.addScaledVector(delta, step);
		} else if (this.mode === "rotate") {
			const step = e.ctrlKey ? ROTATE_STEP_FINE : ROTATE_STEP;
			const roll = e.shiftKey && (e.code === "ArrowLeft" || e.code === "ArrowRight");
			switch (e.code) {
				case "ArrowLeft": object.rotateOnWorldAxis(roll ? forward : WORLD_UP, roll ? step : -step); break;
				case "ArrowRight": object.rotateOnWorldAxis(roll ? forward : WORLD_UP, roll ? -step : step); break;
				case "ArrowUp": object.rotateOnWorldAxis(right, -step); break;
				case "ArrowDown": object.rotateOnWorldAxis(right, step); break;
				default: return;
			}
		} else {
			const step = e.ctrlKey ? NUDGE_STEP_FINE : NUDGE_STEP;
			const base = this._baseSize();
			let axis, dir;
			switch (e.code) {
				case "ArrowUp": axis = vertical ? "z" : "y"; dir = 1; break;
				case "ArrowDown": axis = vertical ? "z" : "y"; dir = -1; break;
				case "ArrowRight": axis = "x"; dir = 1; break;
				case "ArrowLeft": axis = "x"; dir = -1; break;
				default: return;
			}
			const min = 0.05 / Math.max(base[axis], 0.001);
			object.scale[axis] = Math.max(min, object.scale[axis] + dir * step / Math.max(base[axis], 0.001));
		}

		object.updateMatrixWorld(true);
		this._syncTarget();
		// Holding an arrow key produces one undo step, not one per repeat.
		const last = this.undoStack[this.undoStack.length - 1];
		if (e.repeat && last && last.nudge && last.bone && last.bone === this.target.object) {
			last.after = this._capture(this.target);
		} else if (e.repeat && last && last.nudge && !last.bone && !isLocalKind(this.target.kind) && last.meshes.length === this.target.meshes.length && last.meshes.every((m, i) => m === this.target.meshes[i])) {
			last.after = this._snapshot(last.meshes);
		} else {
			this._pushHistory(this._historyLabel(), before).nudge = true;
		}
		if (!e.repeat) this._logTransform();
		this.dispatchEvent(new CustomEvent("transformend", { detail: { target: this.target } }));
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}

	get canRedo() {
		return this.redoStack.length > 0;
	}

	undo() {
		this._stepHistory(this.undoStack, this.redoStack, "before", "Undo");
	}

	redo() {
		this._stepHistory(this.redoStack, this.undoStack, "after", "Redo");
	}

	/** Forgets history, e.g. when another place is opened. */
	clearHistory() {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this._emitState();
	}

	_historyLabel() {
		const verb = { translate: "Move", rotate: "Rotate", scale: "Resize" }[this.transform.mode] || "Transform";
		return `${verb} ${this.target.name}`;
	}

	_snapshot(meshes) {
		return meshes.map((mesh) => mesh.matrixWorld.clone());
	}

	/** Bones are restored in their parent's space; parts and models by world matrices. */
	_capture(target) {
		if (isLocalKind(target.kind)) {
			const o = target.object;
			return { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() };
		}
		return this._snapshot(target.meshes);
	}

	_pushHistory(label, before) {
		const target = this.target;
		if (isLocalKind(target.kind)) {
			const entry = { label, bone: target.object, meshes: [], before, after: this._capture(target) };
			this.undoStack.push(entry);
			if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
			this.redoStack.length = 0;
			this._emitState();
			this.dispatchEvent(new CustomEvent("historychange"));
			return entry;
		}
		const entry = {
			label,
			selection: target.kind === "part" ? target.object : { treeId: target.treeId, name: target.name, meshes: [...target.meshes] },
			meshes: [...target.meshes],
			before,
			after: this._snapshot(target.meshes)
		};
		this.undoStack.push(entry);
		if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
		this.redoStack.length = 0;
		this._emitState();
		this.dispatchEvent(new CustomEvent("historychange"));
		return entry;
	}

	/**
	 * Adds an undo step owned by another editor (e.g. the GUI editor), so Ctrl+Z / Ctrl+Y walk
	 * one shared history. `alive()` lets stale steps (deleted objects) be skipped.
	 * @param {string} label
	 * @param {{ undo: Function, redo: Function, alive?: () => boolean }} custom
	 */
	pushCustomHistory(label, custom) {
		this.undoStack.push({ label, custom, meshes: [] });
		if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
		this.redoStack.length = 0;
		this._emitState();
		this.dispatchEvent(new CustomEvent("historychange"));
	}

	_stepHistory(from, to, which, verb) {
		let entry;
		// Skip entries whose parts were deleted since.
		while ((entry = from.pop())) {
			if (entry.custom ? (entry.custom.alive ? entry.custom.alive() : true) : entry.bone ? entry.bone.parent : entry.meshes.some((m) => m.parent)) break;
		}
		if (!entry) {
			this.print(`Nothing to ${verb.toLowerCase()}`);
			this._emitState();
			return;
		}
		to.push(entry);
		if (entry.custom) {
			entry.custom[which === "before" ? "undo" : "redo"]();
			this.print(`${verb}: ${entry.label}`);
			this._emitState();
			return;
		}
		this._applySnapshot(entry, entry[which]);
		this.print(`${verb}: ${entry.label}`);
	}

	/** Restores world matrices, writes them back to the DataModel and reselects what was edited. */
	_applySnapshot(entry, matrices) {
		if (entry.bone) {
			entry.bone.position.copy(matrices.position);
			entry.bone.quaternion.copy(matrices.quaternion);
			if (matrices.scale) entry.bone.scale.copy(matrices.scale);
			entry.bone.updateMatrixWorld(true);
			this.select(entry.bone, "history");
			this.refreshPivot();
			this.dispatchEvent(new CustomEvent("transformend", { detail: { target: this.target } }));
			return;
		}
		// Model pivots would add their own transform, so put every mesh back under the scene first.
		this._release();
		entry.meshes.forEach((mesh, i) => {
			if (!mesh.parent) return;
			if (mesh.parent !== this.scene) this.scene.attach(mesh);
			matrices[i].decompose(mesh.position, mesh.quaternion, mesh.scale);
			mesh.updateMatrixWorld(true);
			this._syncMesh(mesh);
		});
		const selection = entry.selection.isMesh
			? (entry.selection.parent ? entry.selection : null)
			: { ...entry.selection, meshes: entry.selection.meshes.filter((m) => m.parent) };
		this.select(selection, "history");
		if (this.target) this.dispatchEvent(new CustomEvent("transformend", { detail: { target: this.target } }));
	}

	_syncTarget() {
		if (!this.target) return;
		const handle = this.target.handle;
		if (handle && handle.userData.offset) {
			const root = this.target.object;
			handle.updateMatrixWorld(true);
			const world = new Matrix4().multiplyMatrices(handle.matrixWorld, handle.userData.offset);
			if (root.parent) world.premultiply(new Matrix4().copy(root.parent.matrixWorld).invert());
			world.decompose(root.position, root.quaternion, root.scale);
		}
		this.target.object.updateMatrixWorld(true);
		for (const mesh of this.target.meshes) this._syncMesh(mesh);
	}

	/** Writes the mesh's world transform back into its DataModel instance (CFrame, Orientation, Size). */
	_syncMesh(mesh) {
		const instance = mesh.userData.instance;
		if (!instance) return;
		mesh.matrixWorld.decompose(_p, _q, _s);
		const base = mesh.userData.baseSize;
		let sizeChanged = false;
		if (base && instance.Size) {
			const nx = base.X * _s.x, ny = base.Y * _s.y, nz = base.Z * _s.z;
			sizeChanged = instance.Size.X !== nx || instance.Size.Y !== ny || instance.Size.Z !== nz;
			instance.Size.X = nx;
			instance.Size.Y = ny;
			instance.Size.Z = nz;
		}
		if (sizeChanged && this.onPartSizeChanged) this.onPartSizeChanged(mesh, instance);
		const cf = instance.CFrame || instance.CoordinateFrame;
		if (!cf || !cf.Position) return;
		const offset = mesh.userData.positionOffset || { x: 0, y: 0, z: 0 };
		const x = _p.x - offset.x, y = _p.y - offset.y, z = _p.z - offset.z;
		cf.Position.X = x;
		cf.Position.Y = y;
		cf.Position.Z = z;
		const c = cf.Components;
		if (Array.isArray(c) && c.length >= 12) {
			c[0] = x; c[1] = y; c[2] = z;
		}
		// Cylinders carry an extra render-only Z rotation, so their rotation can't be mapped back 1:1.
		if (mesh.userData.cylinder) return;
		if (Array.isArray(c) && c.length >= 12) {
			const m = new Matrix4().makeRotationFromQuaternion(_q).elements;
			c[3] = m[0]; c[4] = m[4]; c[5] = m[8];
			c[6] = m[1]; c[7] = m[5]; c[8] = m[9];
			c[9] = m[2]; c[10] = m[6]; c[11] = m[10];
		}
		if (cf.Orientation) {
			_e.setFromQuaternion(_q, "YXZ");
			cf.Orientation.X = MathUtils.radToDeg(_e.x);
			cf.Orientation.Y = MathUtils.radToDeg(_e.y);
			cf.Orientation.Z = MathUtils.radToDeg(_e.z);
		}
	}

	_emitState() {
		this.dispatchEvent(new CustomEvent("statechange"));
	}
}
