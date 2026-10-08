import Stats from './thirdparty/three/stats.module.js';
import { Box3, Color, Euler, Matrix4, Raycaster, Vector2, Vector3 } from './thirdparty/three/three.core.js';
import { StudioLiteRenderer } from './rendering/StudioLiteRenderer.js';
import { MATERIALS, applyMaterialLook, applyColor, hexToColor3, materialHasTexture } from './rendering/Materials.js';
import { clockTimeToTimeOfDay, timeOfDayToClockTime } from './rendering/LightingManager.js';
import { makePart, makeModel, makeBaseplateDataModel } from './datamodel/InstanceFactory.js';
import { sleep } from './etc/Helpers.js';
import { icon, hydrateIcons } from './ui/icons.js';
import { openMenu, openPopup, closePopup, toast } from './ui/popup.js';
import { Ribbon } from './ui/ribbon.js';
import { Layout } from './ui/layout.js';
import { Toolbox, RECIPES } from './ui/toolbox.js';
import { PropertiesView } from './ui/properties.js';
import { propertyGroupsFor, hasSchema, isA } from './datamodel/RobloxAPIProperties.js';
import { Output } from './ui/output.js';
import LoadingScreen from './ui/LoadingScreen.js';
import { isTypingTarget, isDialogOpen } from './controls/InputFocus.js';
import { PlayMode } from './play/PlayMode.js';
import { getExperienceSettings, setExperienceSettings } from './play/ExperienceSettings.js';
import { AnimationEditor } from './animation/AnimationEditor.js';
import { buildDummy, findHumanoid, syncRigInstances } from './animation/RigBuilder.js';
import { GuiEngine } from './gui/GuiEngine.js';
import { GuiEditor } from './gui/GuiEditor.js';
import { UDim2, Color3 } from './gui/UDim2.js';
import { CREATABLE_GUI, ENUMS, canParent, createGuiInstance, guiSchemaOf, isGuiInstance, isGuiObject } from './gui/GuiClasses.js';
import { Folder, isScriptClass, makeScript, scriptPlacementIssue } from './datamodel/Services.js';
import { ScriptEditor } from './scripting/ScriptEditor.js';
import { LuauRuntime } from './scripting/LuauRuntime.js';
import { RobloxBridge } from './scripting/RobloxBridge.js';
import { buildRbxlx, downloadRbxlx } from './export/RbxlxExporter.js';
import { robloxAssetImporter } from './roblox/RobloxAssetImporter.js';
import { robloxConfig } from './roblox/config.js';
import { classifyQuery } from './roblox/AssetId.js';
import { importModelFile, is3DModelFile, SUPPORTED_3D_ACCEPT, SUPPORTED_3D } from './import/MeshImporter.js';

const $id = (id) => document.getElementById(id);

const viewport = $id("viewport");
const startPage = $id("start-page");
const msg = viewport.querySelector(".message");
const loadingScreen = new LoadingScreen(viewport);
const editor = viewport.querySelector(".editor");
const hud = viewport.querySelector(".tool-hud");
const hudHint = hud.querySelector(".tool-hud-hint");
const bar = document.querySelector(".statusbar [role=progressbar]");
const statusEl = $id("status");
const docTabs = $id("doc-tabs");

const VIEW_KEY = "studiolite.view.v1";
const EXAMPLES = [
	"examples/Classic-Crossroads.rbxl",
	"examples/City.rbxl",
	"examples/Suburban.rbxl",
	"examples/Western-Lounge.rbxm",
	"examples/Dilapidated-House.rbxm"
];
const TEMPLATES = [
	{ name: "Baseplate", sub: "Empty place with a baseplate", template: true },
	{ name: "Classic Crossroads", sub: "Example place", url: EXAMPLES[0], img: "images/crossroads8k.png" },
	{ name: "City", sub: "Example place", url: EXAMPLES[1], img: "images/car.png" },
	{ name: "Suburban", sub: "Example place", url: EXAMPLES[2], img: "images/suburban8k.png" },
	{ name: "Western Lounge", sub: "Example model", url: EXAMPLES[3], img: "images/lounge.png" },
	{ name: "Dilapidated House", sub: "Example model", url: EXAMPLES[4], img: "images/house.png" }
];
const PALETTE = [
	["White", "#f2f3f3"], ["Institutional white", "#f8f8f8"], ["Light stone grey", "#e5e4df"], ["Medium stone grey", "#a3a2a5"],
	["Dark stone grey", "#635f62"], ["Black", "#1b2a35"], ["Really black", "#111111"], ["Pearl", "#e7e7ec"],
	["Bright red", "#c4281c"], ["Really red", "#ff0000"], ["Crimson", "#970000"], ["Bright orange", "#da8541"],
	["Deep orange", "#ffaf00"], ["Bright yellow", "#f5cd30"], ["New Yeller", "#ffff00"], ["Cool yellow", "#fdea8d"],
	["Lime green", "#00ff00"], ["Bright green", "#4b974b"], ["Dark green", "#287f47"], ["Earth green", "#27462d"],
	["Sea green", "#3ba27e"], ["Teal", "#12eed4"], ["Toothpaste", "#00ffff"], ["Pastel blue-green", "#9ff3e9"],
	["Bright blue", "#0d69ac"], ["Really blue", "#0000ff"], ["Deep blue", "#2154b9"], ["Navy blue", "#002060"],
	["Pastel Blue", "#80bbdb"], ["Bright violet", "#6b327c"], ["Magenta", "#aa00aa"], ["Hot pink", "#ff00bf"],
	["Pink", "#ff66cc"], ["Nougat", "#cc8e69"], ["Brick yellow", "#d7c59a"], ["Reddish brown", "#694028"],
	["Brown", "#7c5c46"], ["Sand red", "#957977"], ["Sand blue", "#74869d"], ["Sand green", "#789082"]
];

/* ---------- Output ---------- */

const output = new Output({ log: $id("log"), panel: $id("panel-output"), errorBadge: $id("error-count") });
output.captureConsole();
const print = (s, level) => output.print(s, level);

/* ---------- Layout ---------- */

hydrateIcons();
const layout = new Layout({ workspace: $id("workspace"), center: document.querySelector(".center"), right: $id("right-column") });
for (const btn of document.querySelectorAll("[data-panel-close]")) {
	btn.addEventListener("click", () => layout.setVisible(btn.dataset.panelClose, false));
}

/* ---------- Renderer ---------- */

let rendering = true;
let placeLoaded = false;
/** EditMode (false) vs PlayMode (true); mirrors playMode.isPlayMode. */
let isPlayMode = false;
let busy = false;
let activeDoc = "place";
let placeName = "Start Page";
const jsTreeData = [];
let treeRefresh2 = () => {};

const renderer = new StudioLiteRenderer({
	get width() { return Math.max(1, viewport.clientWidth); },
	get height() { return Math.max(1, viewport.clientHeight); },
	sharedFunctions: {
		print,
		treeRefresh2: () => treeRefresh2(),
		isViewportActive: () => rendering && placeLoaded && activeDoc === "place" && !isPlayMode
	},
	sharedObjects: { jsTreeData }
});
viewport.prepend(renderer.domElement);
new ResizeObserver(() => renderer.resize()).observe(viewport);
const tools = renderer.tools;

const stats = Stats();
stats.dom.id = "stats";
viewport.appendChild(stats.dom);

/** StarterGui: DOM layer (#ui-overlay) over the WebGL canvas, edited WYSIWYG in Edit mode. */
const gui = new GuiEngine({ canvas: renderer.domElement, print });
const guiEditor = new GuiEditor({
	engine: gui,
	viewport,
	canvas: renderer.domElement,
	isActive: () => placeLoaded && !busy && activeDoc === "place" && !isPlayMode
});

const playMode = new PlayMode({ renderer, viewport, print });
const luau = new LuauRuntime({ print });
const bridge = new RobloxBridge({
	renderer,
	gui,
	print,
	viewport,
	hooks: {
		onScriptsAdded: (records, options) => luau.scriptsAdded(records, options),
		onKick: () => setTimeout(stop, 0)
	}
});
playMode.addEventListener("change", (e) => {
	isPlayMode = e.detail.isPlayMode;
	if (!isPlayMode) stopScripts();
	gui.setPlaying(isPlayMode);
	if (isPlayMode) animEditor.pause();
	closePopup();
	updateRibbon();
	updateHud();
	if (!isPlayMode) renderer.resize();
});

const animEditor = new AnimationEditor({
	renderer,
	panel: $id("panel-anim"),
	center: document.querySelector(".center"),
	print,
	toast,
	openMenu,
	spawnRig: (rigType) => spawnDummy(rigType),
	deleteRig: (root) => {
		tools.select(root, "animation");
		tools.deleteSelected();
	}
});
animEditor.addEventListener("change", () => {
	updateRibbon();
	renderer.resize();
});
animEditor.addEventListener("rigchange", () => updateRibbon());
animEditor.addEventListener("posechange", () => {
	if (tools.target && tools.target.kind === "bone") showBoneProperties(tools.target.object);
});

let lastFrameAt = performance.now();
renderer.setAnimationLoop(() => {
	const dt = playMode.update();
	if (isPlayMode && luau.running) luau.frame(dt);
	animEditor.update();
	const now = performance.now();
	const frameDt = (now - lastFrameAt) / 1000;
	lastFrameAt = now;
	if (rendering) {
		renderer.effects.update(frameDt, renderer.camera, renderer.domElement.clientHeight || 600);
		renderer.render();
		gui.updateWorld(renderer.camera);
	}
	if (tools.dragging) propsView.refreshValues();
	stats.update();
});

/* ---------- View state (View tab toggles) ---------- */

const viewState = Object.assign({ skybox: true, stats: false, axes: false, hover: true, outline: true, gui: true, dark: true }, JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"));

function applyViewState() {
	if (renderer.skybox) renderer.showSkybox(viewState.skybox);
	gui.setEditVisible(viewState.gui);
	stats.dom.style.display = viewState.stats ? "block" : "none";
	renderer.toggleAxes(viewState.axes);
	renderer.useSelectionBox2 = viewState.hover;
	renderer.useSelectionBox = viewState.outline;
	document.body.classList.toggle("theme-dark", !!viewState.dark);
	for (const key of Object.keys(viewState)) ribbon.setState(`toggle-${key}`, { active: viewState[key] });
	localStorage.setItem(VIEW_KEY, JSON.stringify(viewState));
}

/* ---------- Status & title ---------- */

function setStatus(text) {
	statusEl.textContent = text;
}

function setTitle(name) {
	placeName = name;
	document.title = `${name} - Studio Lite`;
	$id("place-name").textContent = name;
	$id("doc-place-label").textContent = name;
}

function showMessage(text) {
	msg.querySelector("span").textContent = text;
	msg.hidden = !text;
}

/* ---------- Ribbon ---------- */

const TOOL_ITEMS = [
	{ type: "large", action: "tool-select", label: "Select", icon: "select", title: "Select (1)" },
	{ type: "large", action: "tool-move", label: "Move", icon: "move", title: "Move (2)" },
	{ type: "large", action: "tool-scale", label: "Scale", icon: "scale", title: "Scale (3)" },
	{ type: "large", action: "tool-rotate", label: "Rotate", icon: "rotate", title: "Rotate (4)" }
];
const TEST_ITEMS = [
	{ type: "large", action: "play", label: "Play", icon: "play", title: "Play: fly in first person (ESC to stop)" },
	{ type: "large", action: "resume", label: "Resume", icon: "resume", title: "Resume", disabled: true },
	{ type: "large", action: "stop", label: "Stop", icon: "stop", title: "Stop" }
];

const ribbon = new Ribbon({
	tabsEl: $id("ribbon-tabs"),
	bodyEl: $id("ribbon-body"),
	onAction: handleAction,
	tabs: [
		{
			id: "home", label: "Home", groups: [
				{ label: "Tools", items: TOOL_ITEMS },
				{ label: "Terrain", items: [{ type: "large", action: "terrain", label: "Editor", icon: "terrain", title: "Terrain Editor" }] },
				{
					label: "Insert", items: [
						{ type: "large", action: "view-toolbox", label: "Toolbox", icon: "toolbox", title: "Show / hide Toolbox" },
						{ type: "large", action: "insert-part", label: "Part", icon: "part", menu: true, title: "Insert a part" },
						{ type: "large", action: "rig-builder", label: "Rig Builder", icon: "rig", menu: true, title: "Rig Builder: insere um Dummy R6 ou R15 (Model > Humanoid > Parts > Motor6D)" },
						{ type: "large", action: "insert-ui", label: "UI", icon: "ui", title: "Insert UI" }
					]
				},
				{
					label: "Edit", items: [
						{ type: "large", action: "material", label: "Material", icon: "material", menu: true },
						{ type: "large", action: "color", label: "Color", icon: "color", menu: true },
						{
							type: "stack", items: [
								{ action: "group", label: "Group", icon: "group", title: "Group (Ctrl+G)" },
								{ action: "lock", label: "Lock", icon: "lock", title: "Lock: locked parts can't be clicked in the viewport" },
								{ action: "anchor", label: "Anchor", icon: "anchor" }
							]
						}
					]
				},
				{ label: "Test", items: TEST_ITEMS }
			]
		},
		{
			id: "model", label: "Model", groups: [
				{ label: "Tools", items: TOOL_ITEMS },
				{
					label: "Snap to Grid", items: [
						{ type: "stack", items: [
							{ action: "snap-rotate", label: "Rotate 15°", toggle: true, icon: "rotate" },
							{ action: "snap-move", label: "Move 1 stud", toggle: true, icon: "move" }
						] },
						{ type: "large", action: "space", label: "World", icon: "space", title: "Toggle World / Local space (L)" }
					]
				},
				{
					label: "Parts", items: [
						{ type: "large", action: "insert-part", label: "Part", icon: "part", menu: true },
						{ type: "large", action: "rig-builder", label: "Rig Builder", icon: "rig", menu: true, title: "Rig Builder: Spawn R6 / Spawn R15" },
						{ type: "large", action: "group", label: "Group", icon: "group", title: "Group (Ctrl+G)" },
						{ type: "large", action: "delete", label: "Delete", icon: "trash", title: "Delete (Del)" }
					]
				},
				{ label: "Navigate", items: [{ type: "large", action: "zoom", label: "Zoom To", icon: "zoom", title: "Zoom to selection (F)" }] }
			]
		},
		{
			id: "test", label: "Test", groups: [
				{ label: "Simulation", items: TEST_ITEMS },
				{ label: "Capture", items: [{ type: "large", action: "render", label: "Render", icon: "camera", title: "Render image" }] }
			]
		},
		{
			id: "view", label: "View", groups: [
				{
					label: "Show", items: [
						{ type: "large", action: "view-toolbox", label: "Toolbox", icon: "toolbox" },
						{ type: "large", action: "view-explorer", label: "Explorer", icon: "explorer" },
						{ type: "large", action: "view-properties", label: "Properties", icon: "properties" },
						{ type: "large", action: "view-output", label: "Output", icon: "output" }
					]
				},
				{
					label: "Viewport", items: [
						{ type: "stack", items: [
							{ action: "toggle-skybox", label: "Skybox", toggle: true, icon: "sky" },
							{ action: "toggle-stats", label: "Stats", toggle: true, icon: "stats" },
							{ action: "toggle-axes", label: "Axes", toggle: true, icon: "axes" }
						] },
						{ type: "stack", items: [
							{ action: "toggle-hover", label: "Hover outline", toggle: true, icon: "hover" },
							{ action: "toggle-outline", label: "Selection box", toggle: true, icon: "selection" },
							{ action: "toggle-gui", label: "UI (StarterGui)", toggle: true, icon: "ui" }
						] }
					]
				},
				{
					label: "Aparência", items: [
						{ type: "stack", items: [
							{ action: "toggle-dark", label: "Tema escuro", toggle: true, icon: "theme" }
						] }
					]
				},
				{
					label: "Place", items: [
						{ type: "large", action: "render", label: "Render", icon: "camera", title: "Render image" },
						{ type: "large", action: "missing-assets", label: "Assets", icon: "warning", title: "Missing assets" }
					]
				}
			]
		},
		{
			id: "plugins", label: "Plugins", groups: [
				{
					label: "Animation", items: [
						{ type: "large", action: "rig-builder", label: "Rig Builder", icon: "rig", menu: true, title: "Rig Builder: Spawn R6 / Spawn R15" },
						{ type: "large", action: "anim-editor", label: "Animation Editor", icon: "animation", title: "Editor de animação por keyframes (estilo Moon Animator) para dummies R6 / R15" },
						{ type: "large", action: "anim-spells", label: "Feitiços", icon: "spell", title: "Injetar as animações de feitiço (Harry Potter, R15) do testeR15 no dummy ativo" }
					]
				}
			]
		}
	]
});

const MODE_ACTIONS = { "tool-move": "translate", "tool-rotate": "rotate", "tool-scale": "scale", "tool-select": null };
const NOT_AVAILABLE = {
	terrain: "Terrain Editor isn't available in Studio Lite (smooth terrain can't be read yet)."
};

function handleAction(action, el) {
	if (action in MODE_ACTIONS) {
		tools.setMode(MODE_ACTIONS[action]);
		renderer.domElement.focus({ preventScroll: true });
		return;
	}
	if (action.startsWith("view-")) {
		layout.toggle(action.slice(5));
		return;
	}
	if (action.startsWith("toggle-")) {
		const key = action.slice(7);
		viewState[key] = !viewState[key];
		applyViewState();
		return;
	}
	if (NOT_AVAILABLE[action]) {
		toast(NOT_AVAILABLE[action]);
		return;
	}
	switch (action) {
		case "insert-part": return openPartMenu(el);
		case "insert-ui": return openGuiMenu(el);
		case "material": return openMaterialMenu(el);
		case "color": return openColorPalette(el);
		case "group": return groupSelection();
		case "lock": return toggleFlag("Locked");
		case "anchor": return toggleFlag("Anchored");
		case "delete": return guiEditor.selected ? deleteGui(guiEditor.selected) : tools.deleteSelected();
		case "play": return play();
		case "stop": return stop();
		case "zoom": return zoomToSelection();
		case "space": return tools.toggleSpace();
		case "snap-rotate": return tools.setSnap("rotate", !tools.snap.rotate);
		case "snap-move": return tools.setSnap("move", !tools.snap.move);
		case "render": return openRenderDialog();
		case "missing-assets": return openNotepad("missing_assets.txt", renderer.mAssetManager.missingAssets || "No missing assets.");
		case "anim-editor": return openAnimationEditor();
		case "anim-spells": return openAnimationEditor({ spells: true });
		case "rig-builder": return openRigBuilderMenu(el);
	}
}

/* ---------- Rig Builder ---------- */

function openRigBuilderMenu(anchor) {
	openMenu(anchor, [
		{ title: "Rig Builder" },
		{ label: "Spawn R6", icon: "rig", hint: "6 partes", onClick: () => rigBuilderSpawn("R6") },
		{ label: "Spawn R15", icon: "rig", hint: "15 partes", onClick: () => rigBuilderSpawn("R15") }
	]);
}

async function rigBuilderSpawn(rigType) {
	if (busy || isPlayMode) return;
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	if (activeDoc !== "place") activateDoc("place");
	spawnDummy(rigType);
}

/**
 * Adds a registered node under its parent in the Explorer and expands the parent. If jsTree
 * is still (re)building, the node would be wiped, so it is added again once the refresh ends.
 */
function insertExplorerNode(parentId, item) {
	const add = () => {
		if (renderer.getNode(item.id)?.instance !== item.instance) return true;
		if (treeRef.get_node(String(item.id))) return true;
		if (!treeRef.get_node(String(parentId))) return false;
		treeRef.create_node(String(parentId), item, "last");
		treeRef.open_node(String(parentId));
		return !!treeRef.get_node(String(item.id));
	};
	if (!add()) $(".tree").one("refresh.jstree", add);
}

/** Floor point in front of the camera, nudged sideways so dummies don't overlap. */
function dummySpawnPoint() {
	const scene = renderer.scene;
	scene.updateMatrixWorld(true);
	const point = new Vector3().copy(renderer.getInsertPoint());
	const floor = new Raycaster(new Vector3(point.x, point.y + 200, point.z), new Vector3(0, -1, 0));
	const ground = floor.intersectObjects(scene.children.filter((o) => o.isMesh && o.userData.instance && o.visible), false)[0];
	if (ground) point.y = ground.point.y;
	const others = [...animEditor.rigs.keys()].map((r) => r.position);
	for (let i = 0; i < 12 && others.some((p) => Math.hypot(p.x - point.x, p.z - point.z) < 3.5); i++) point.x += 4;
	return point;
}

/**
 * Rig Builder: builds a dummy (THREE bones + DataModel Model > Humanoid > Animator,
 * Parts, Motor6D), registers it under Workspace in the Explorer and hands it to the
 * Animation Editor. Returns the rig root.
 */
function spawnDummy(rigType) {
	const workspace = renderer.findNodeByClassName("Workspace");
	if (!workspace) {
		toast("Este place não tem Workspace para inserir o dummy.");
		return null;
	}
	const { root, instance, partInstances } = buildDummy(rigType);
	const point = dummySpawnPoint();
	root.position.copy(point);
	const toCam = new Vector3().subVectors(renderer.camera.position, point);
	root.rotation.y = Math.atan2(-toCam.x, -toCam.z);
	renderer.scene.add(root);
	syncRigInstances(root);

	const item = renderer.registerInstanceTree(instance, workspace.id);
	const assign = (it) => {
		const three = it.instance.__three;
		if (three && it.instance.ClassName === "Model") three.userData.treeId = it.id;
		if (three && it.instance.ClassName === "Part") three.userData.treeId = it.id;
		it.children.forEach(assign);
	};
	assign(item);
	root.userData.parentTreeId = workspace.id;
	insertExplorerNode(workspace.id, item);
		treeRefresh2();
	animEditor.addRig(root);

	const motors = Object.values(partInstances).reduce((n, p) => n + p.Children.filter((c) => c.ClassName === "Motor6D").length, 0);
	print(`Rig Builder: "${instance.Name}" inserido em (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)}) — Model > Humanoid [RigType ${rigType}] > Animator, ${Object.keys(partInstances).length} Parts, ${motors} Motor6D`);
	tools.select(root, "insert");
	renderer.domElement.focus({ preventScroll: true });
	return root;
}

async function openAnimationEditor({ spells = false } = {}) {
	if (busy || isPlayMode) return;
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	if (activeDoc !== "place") activateDoc("place");
	if (animEditor.isOpen && !spells) return animEditor.close();
	animEditor.open();
	if (spells) animEditor.injectSpells();
}

function selectedInstances() {
	return tools.selectedMeshes.map((m) => m.userData.instance).filter(Boolean);
}

function updateRibbon() {
	ribbon.setState("tool-select", { active: tools.mode === null });
	ribbon.setState("tool-move", { active: tools.mode === "translate" });
	ribbon.setState("tool-rotate", { active: tools.mode === "rotate" });
	ribbon.setState("tool-scale", { active: tools.mode === "scale" });
	ribbon.setState("space", { label: tools.space === "world" ? "World" : "Local" });
	ribbon.setState("snap-rotate", { active: tools.snap.rotate });
	ribbon.setState("snap-move", { active: tools.snap.move });

	const instances = selectedInstances();
	const hasSelection = instances.length > 0;
	for (const action of ["material", "color", "group", "lock", "anchor", "delete", "zoom"]) ribbon.setState(action, { disabled: !hasSelection });
	ribbon.setState("anchor", { active: hasSelection && instances.every((i) => i.Anchored) });
	ribbon.setState("lock", { active: hasSelection && instances.every((i) => i.Locked) });

	const undoBtn = $id("undo-button");
	const redoBtn = $id("redo-button");
	undoBtn.disabled = !tools.canUndo;
	redoBtn.disabled = !tools.canRedo;
	undoBtn.title = tools.canUndo ? `Undo ${tools.undoStack[tools.undoStack.length - 1].label} (Ctrl+Z)` : "Undo (Ctrl+Z)";
	redoBtn.title = tools.canRedo ? `Redo ${tools.redoStack[tools.redoStack.length - 1].label} (Ctrl+Y)` : "Redo (Ctrl+Y)";

	const playing = isPlayMode;
	ribbon.setState("play", { disabled: !placeLoaded || playing });
	ribbon.setState("stop", { disabled: !playing });
	ribbon.setState("render", { disabled: !placeLoaded });
	ribbon.setState("missing-assets", { disabled: !placeLoaded });
	ribbon.setState("anim-editor", { active: animEditor.isOpen, disabled: playing });
	ribbon.setState("anim-spells", { disabled: playing });
	ribbon.setState("rig-builder", { disabled: playing });
	if (tools.target && tools.target.kind === "rig") ribbon.setState("delete", { disabled: false });
	if (guiEditor.selected && !playing) ribbon.setState("delete", { disabled: false });
	ribbon.setState("insert-ui", { disabled: playing });
}

function updatePanelState() {
	for (const panel of ["toolbox", "explorer", "properties", "output"]) {
		ribbon.setState(`view-${panel}`, { active: layout.isVisible(panel) });
	}
}
layout.addEventListener("change", updatePanelState);

function openPartMenu(anchor) {
	const parts = ["block", "sphere", "wedge", "cylinder"].map((id) => RECIPES.find((r) => r.id === id));
	openMenu(anchor, parts.map((recipe) => ({ label: recipe.name, icon: recipe.icon, onClick: () => insertRecipe(recipe) })));
}

function openMaterialMenu(anchor) {
	const instances = selectedInstances();
	const current = instances.length && instances.every((i) => i.Material === instances[0].Material) ? instances[0].Material : null;
	const el = openMenu(anchor, [
		{ title: "Material" },
		...MATERIALS.map((name) => ({ label: name, checked: name === current, onClick: () => setMaterial(name) }))
	]);
	if (el) {
		el.style.maxHeight = "60vh";
		el.style.overflowY = "auto";
	}
}

function openColorPalette(anchor) {
	openPopup(anchor, (el) => {
		el.insertAdjacentHTML("beforeend", `<div class="popup-title">Color</div>`);
		const grid = document.createElement("div");
		grid.className = "palette";
		for (const [name, hex] of PALETTE) {
			const sw = document.createElement("button");
			sw.type = "button";
			sw.className = "palette-swatch";
			sw.style.background = hex;
			sw.title = name;
			sw.setAttribute("aria-label", name);
			sw.addEventListener("click", () => {
				closePopup();
				setColor(name, hex);
			});
			grid.appendChild(sw);
		}
		el.appendChild(grid);
	});
}

function setMaterial(name) {
	for (const mesh of tools.selectedMeshes) {
		const inst = mesh.userData.instance;
		if (!inst) continue;
		setInstanceMaterial(inst, name);
	}
	print(`Material set to ${name} on ${tools.selectedName}`);
	refreshSelectionProperties();
}

function setColor(name, hex) {
	const c3 = hexToColor3(hex);
	for (const mesh of tools.selectedMeshes) {
		const inst = mesh.userData.instance;
		if (!inst) continue;
		inst.Color3 = { ...c3 };
		if (inst.BrickColor) delete inst.BrickColor;
		applyColor(mesh.material, new Color(c3.R, c3.G, c3.B), inst.Material);
	}
	print(`Color set to ${name} on ${tools.selectedName}`);
	refreshSelectionProperties();
}

function toggleFlag(flag) {
	const instances = selectedInstances();
	if (!instances.length) return;
	const value = !instances.every((i) => i[flag]);
	for (const inst of instances) inst[flag] = value;
	print(`${flag} = ${value} on ${tools.selectedName}`);
	updateRibbon();
	refreshSelectionProperties();
}

async function play() {
	if (!placeLoaded || busy || isPlayMode) return;
	if (activeDoc !== "place") activateDoc("place");
	loadingScreen.show({ title: `Entrando em ${placeName || "jogo"}`, theme: "game" });
	loadingScreen.setProgress(0.15, "Preparando o personagem…");
	try {
		await playMode.start();
		if (!playMode.isPlayMode || !playMode.player) {
			await loadingScreen.hide();
			return;
		}
		loadingScreen.setProgress(0.4, "Iniciando os scripts…");
		bridge.start({ player: playMode.player, placeName });
		await luau.start(bridge);
		loadingScreen.setProgress(0.75, "Carregando objetos e efeitos…");
		await waitForAssets((done, total) => {
			loadingScreen.setProgress(total ? 0.75 + 0.25 * (done / total) : 0.9, total ? `Carregando objetos: ${done}/${total}` : "Carregando objetos…");
		});
	} catch (err) {
		console.error(err);
		print(`Luau: falha ao iniciar os scripts — ${err && err.message ? err.message : err}`, "error");
	}
	await loadingScreen.hide();
	if (isPlayMode) renderer.domElement.focus({ preventScroll: true });
}

/** Rolls back everything scripts changed during the session (Roblox Studio Stop semantics). */
function stopScripts() {
	if (!bridge.running && !luau.running) return;
	luau.stop();
	gui.requestWorldScan();
	renderer.effects.requestScan();
	gui.flush();
	const id = guiEditor.selected ? treeIdOf(guiEditor.selected) : undefined;
	if (id !== undefined) showInstanceProperties(id);
}

function stop() {
	if (isPlayMode) playMode.stop();
	else if (document.pointerLockElement) document.exitPointerLock();
}

function zoomToSelection() {
	if (tools.selectedMeshes.length) renderer.focusOn(tools.selectedMeshes);
}

/* ---------- Explorer ---------- */

$(".tree").jstree({
	core: { data: [], check_callback: true, themes: { dots: false } },
	plugins: ["search"],
	search: { show_only_matches: true, show_only_matches_children: true }
});
const treeRef = $(".tree").jstree(true);
const tree = document.querySelector(".tree");
const tree2 = document.querySelector(".tree2");

$(".tree2").jstree({ core: { data: [], themes: { dots: false } } });
const treeRef2 = $(".tree2").jstree(true);

const propsView = new PropertiesView({ container: $id("properties"), title: $id("propertiesTitle"), filter: $id("properties-filter") });

function parentNameOf(treeId) {
	const node = renderer.getNode(treeId);
	if (!node) return undefined;
	const parent = renderer.getNode(node.parentId);
	return parent ? parent.instance.Name : "DataModel";
}

function showInstanceProperties(treeId) {
	const node = renderer.getNode(treeId);
	if (!node) return;
	const instance = node.instance;
	if (instance.ClassName === "Model" && findHumanoid(instance)) return showHumanoidProperties(instance, parentNameOf(treeId));
	if (hasSchema(instance.ClassName)) return showSchemaProperties(instance, parentNameOf(treeId));
	propsView.showInstance(instance, parentNameOf(treeId));
}

/** API-faithful, editable panel for BasePart / Model (via RobloxAPIProperties schema). */
function showSchemaProperties(instance, parentName) {
	const groups = propertyGroupsFor(instance.ClassName);
	propsView.showSchema(`${instance.ClassName} "${instance.Name}"`, groups, (prop) => buildDescriptor(instance, prop, parentName));
}

/** A dummy Model shows its Humanoid (RigType, WalkSpeed, JumpPower, Health, DisplayName…). */
function showHumanoidProperties(model, parentName = "Workspace") {
	const humanoid = findHumanoid(model);
	if (!humanoid) return showSchemaProperties(model, parentName);
	const groups = propertyGroupsFor("Humanoid");
	propsView.showSchema(`Humanoid (${model.Name})`, groups, (prop) => buildDescriptor(humanoid, prop, model.Name));
}

const DEG = Math.PI / 180;

/** The rendered mesh for a part instance, or null (Models/Humanoids have none). */
function meshForInstance(instance) {
	const id = treeIdOf(instance);
	return id !== undefined ? renderer.getMeshForTreeId(id) : null;
}

/** Writes a CFrame rotation matrix (from Roblox Orientation, YXZ degrees) into Components[3..11]. */
function writeComponentsFromOrientation(cf, o) {
	if (!Array.isArray(cf.Components) || cf.Components.length < 12) return;
	const m = new Matrix4().makeRotationFromEuler(new Euler(o.X * DEG, o.Y * DEG, o.Z * DEG, "YXZ"));
	const e = m.elements;
	cf.Components[3] = e[0];  cf.Components[4] = e[4];  cf.Components[5] = e[8];
	cf.Components[6] = e[1];  cf.Components[7] = e[5];  cf.Components[8] = e[9];
	cf.Components[9] = e[2];  cf.Components[10] = e[6]; cf.Components[11] = e[10];
}

function applyPartSizeToMesh(instance) {
	const mesh = meshForInstance(instance);
	const b = mesh && mesh.userData.baseSize;
	if (!mesh || !b || !instance.Size) return;
	mesh.scale.set(instance.Size.X / (b.X || 1), instance.Size.Y / (b.Y || 1), instance.Size.Z / (b.Z || 1));
	renderer.updateMaterialUV(mesh, instance);
	tools.refreshOutline();
}

function applyPartPositionToMesh(instance) {
	const mesh = meshForInstance(instance);
	const cf = instance.CFrame;
	if (!mesh || !cf || !cf.Position) return;
	const off = mesh.userData.positionOffset || { x: 0, y: 0, z: 0 };
	mesh.position.set(cf.Position.X + (off.x || 0), cf.Position.Y + (off.y || 0), cf.Position.Z + (off.z || 0));
}

function applyPartOrientationToMesh(instance) {
	const mesh = meshForInstance(instance);
	const cf = instance.CFrame;
	if (!mesh || !cf) return;
	const o = cf.Orientation || { X: 0, Y: 0, Z: 0 };
	mesh.setRotationFromEuler(new Euler(o.X * DEG, o.Y * DEG, o.Z * DEG, "YXZ"));
	if (mesh.userData.cylinder) mesh.rotation.z += Math.PI / 2;
}

/** Moves every descendant part (instance + mesh) of a Model by a world delta, keeping WorldPivot in sync. */
function translateModel(model, dx, dy, dz) {
	const id = treeIdOf(model);
	const stack = id !== undefined ? [id] : [];
	while (stack.length) {
		const node = renderer.getNode(stack.pop());
		if (!node) continue;
		stack.push(...node.childIds);
		const inst = node.instance;
		const cf = inst.CFrame;
		if (cf && cf.Position) {
			cf.Position = { X: cf.Position.X + dx, Y: cf.Position.Y + dy, Z: cf.Position.Z + dz };
			if (Array.isArray(cf.Components) && cf.Components.length >= 3) { cf.Components[0] += dx; cf.Components[1] += dy; cf.Components[2] += dz; }
			applyPartPositionToMesh(inst);
		}
	}
	const wp = model.WorldPivot || (model.WorldPivot = { Position: { X: 0, Y: 0, Z: 0 }, Orientation: { X: 0, Y: 0, Z: 0 } });
	wp.Position = { X: (wp.Position?.X || 0) + dx, Y: (wp.Position?.Y || 0) + dy, Z: (wp.Position?.Z || 0) + dz };
}

/** Current WorldPivot of a Model: stored value, else the center of its rendered meshes. */
function modelPivot(model) {
	if (model.WorldPivot && model.WorldPivot.Position) return model.WorldPivot;
	const id = treeIdOf(model);
	const meshes = id !== undefined ? renderer.meshesForNode(id) : [];
	const c = { X: 0, Y: 0, Z: 0 };
	if (meshes.length) {
		for (const m of meshes) { c.X += m.position.x; c.Y += m.position.y; c.Z += m.position.z; }
		c.X /= meshes.length; c.Y /= meshes.length; c.Z /= meshes.length;
	}
	return { Position: c, Orientation: { X: 0, Y: 0, Z: 0 } };
}

/** Opens a menu to assign/remove a Model's PrimaryPart from its descendant BaseParts. */
function pickPrimaryPart(model) {
	const id = treeIdOf(model);
	const parts = [];
	const stack = id !== undefined ? [...(renderer.getNode(id)?.childIds || [])] : [];
	while (stack.length) {
		const node = renderer.getNode(stack.pop());
		if (!node) continue;
		stack.push(...node.childIds);
		if (isA(node.instance.ClassName, "BasePart")) parts.push(node.instance);
	}
	const items = parts.map((p) => ({ label: p.Name, onClick: () => { model.PrimaryPart = p; refreshSelectionProperties(); } }));
	if (model.PrimaryPart) items.unshift({ label: "Remove (nil)", onClick: () => { model.PrimaryPart = null; refreshSelectionProperties(); } });
	if (!items.length) items.push({ label: "No BaseParts in this Model", disabled: true });
	openMenu(pointAnchor(window.innerWidth / 2, window.innerHeight / 3), items);
}

/**
 * Builds a two-way-bound descriptor for the Properties panel from a schema property.
 * Edits write to the instance AND its THREE mesh immediately; the viewport gizmo writes back
 * through refreshValues() so Size/CFrame stay live during drag.
 */
function buildDescriptor(instance, prop, parentName) {
	const field = prop.field || prop.name;
	const readOnly = !!prop.readOnly;
	const base = { key: prop.name, type: prop.type, options: prop.options, min: prop.min, max: prop.max, readOnly };
	const getRaw = () => { const v = instance[field]; return v === undefined ? prop.default : v; };
	const isLight = isA(instance.ClassName, "Light");
	const isLightingSvc = instance.ClassName === "Lighting";
	const afterLight = () => { if (isLight) renderer.refreshLight(instance); };
	const afterLighting = () => {
		if (isLightingSvc && typeof renderer.applyLighting === "function") renderer.applyLighting(instance);
	};

	switch (prop.type) {
		case "Color3":
			if (isLight) {
				return {
					...base,
					get: () => instance.Color || instance.Color3,
					set: (hex) => {
						const c3 = hexToColor3(hex);
						instance.Color = { ...c3 };
						afterLight();
					}
				};
			}
			if (isLightingSvc && prop.field) {
				return {
					...base,
					get: () => instance[prop.field],
					set: (hex) => {
						instance[prop.field] = hexToColor3(hex);
						afterLighting();
					}
				};
			}
			return { ...base, get: () => instance.Color3 || instance.Color, set: (hex) => setInstanceColor(instance, hex) };
		case "BrickColor":
			return { ...base, readOnly: true, get: () => instance.Color3 || instance.Color };
		case "enum":
			if (prop.name === "Material") return { ...base, get: getRaw, set: (v) => setInstanceMaterial(instance, v) };
			return { ...base, get: getRaw, set: (v) => { instance[field] = v; afterLight(); afterLighting(); } };
		case "bool":
			return { ...base, get: () => !!getRaw(), set: (v) => { instance[field] = v; afterLight(); afterLighting(); updateRibbon(); } };
		case "float01":
			return { ...base, get: getRaw, set: (v) => setInstanceScalar(instance, field, v) };
		case "number":
		case "int":
			return {
				...base,
				get: getRaw,
				set: (v) => {
					instance[field] = v;
					if (isLightingSvc && prop.name === "ClockTime") instance.TimeOfDay = clockTimeToTimeOfDay(v);
					afterLight();
					afterLighting();
				}
			};
		case "string":
			if (prop.name === "ClassName") return { ...base, readOnly: true, get: () => instance.ClassName };
			if (prop.name === "Name") return { ...base, get: () => instance.Name, set: (v) => renameInstance(instance, v) };
			if (isLightingSvc && prop.name === "TimeOfDay") {
				return {
					...base,
					get: getRaw,
					set: (v) => {
						instance.TimeOfDay = v;
						instance.ClockTime = timeOfDayToClockTime(v);
						afterLighting();
					}
				};
			}
			return { ...base, get: getRaw, set: (v) => { instance[field] = v; } };
		case "path":
			return { ...base, readOnly: true, get: () => parentName ?? parentNameOf(treeIdOf(instance)) ?? "nil" };
		case "primarypart":
			return { ...base, get: () => { const p = instance.PrimaryPart; return p ? (p.Name || String(p)) : null; }, onPick: () => pickPrimaryPart(instance) };
		case "Vector3":
			if (prop.name === "Size") return { ...base, get: () => instance.Size, set: (v) => { instance.Size = v; applyPartSizeToMesh(instance); } };
			return { ...base, get: getRaw, set: (v) => { instance[field] = v; } };
		case "CFrame":
			if (prop.name === "WorldPivot") return cframeModelDescriptor(base, instance);
			return cframePartDescriptor(base, instance);
		default:
			return { ...base, readOnly: true, get: getRaw };
	}
}

/** Editable CFrame for a BasePart (Position moves the mesh, Orientation rebuilds its rotation). */
function cframePartDescriptor(base, instance) {
	return {
		...base,
		get: () => {
			const cf = instance.CFrame || {};
			return { position: cf.Position || { X: 0, Y: 0, Z: 0 }, orientation: cf.Orientation || { X: 0, Y: 0, Z: 0 } };
		},
		setPosition: (v) => {
			const cf = instance.CFrame || (instance.CFrame = { Position: { X: 0, Y: 0, Z: 0 }, Orientation: { X: 0, Y: 0, Z: 0 }, Components: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] });
			cf.Position = { X: v.X, Y: v.Y, Z: v.Z };
			if (Array.isArray(cf.Components) && cf.Components.length >= 3) { cf.Components[0] = v.X; cf.Components[1] = v.Y; cf.Components[2] = v.Z; }
			applyPartPositionToMesh(instance);
		},
		setOrientation: (v) => {
			const cf = instance.CFrame || (instance.CFrame = { Position: { X: 0, Y: 0, Z: 0 }, Orientation: { X: 0, Y: 0, Z: 0 }, Components: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] });
			cf.Orientation = { X: v.X, Y: v.Y, Z: v.Z };
			writeComponentsFromOrientation(cf, cf.Orientation);
			applyPartOrientationToMesh(instance);
		}
	};
}

/** Editable WorldPivot for a Model: Position translates the whole subtree; Orientation is read-only. */
function cframeModelDescriptor(base, model) {
	return {
		...base,
		get: () => { const p = modelPivot(model); return { position: p.Position, orientation: p.Orientation || { X: 0, Y: 0, Z: 0 } }; },
		setPosition: (v) => { const p = modelPivot(model).Position; translateModel(model, v.X - p.X, v.Y - p.Y, v.Z - p.Z); },
		setOrientation: () => {}
	};
}

function setInstanceColor(instance, hex) {
	const c3 = hexToColor3(hex);
	instance.Color3 = { ...c3 };
	if (instance.Color) instance.Color = { ...c3 };
	if (instance.BrickColor) delete instance.BrickColor;
	const mesh = meshForInstance(instance);
	if (mesh) applyColor(mesh.material, new Color(c3.R, c3.G, c3.B), instance.Material);
}

function setInstanceMaterial(instance, name) {
	instance.Material = name;
	if (instance._baseplateGrid) instance._baseplateGrid = false;
	const mesh = meshForInstance(instance);
	if (!mesh) return;
	applyMaterialLook(mesh.material, name, instance.Transparency || 0);
	renderer.applyMaterialTexture(mesh, instance);
	if (!materialHasTexture(name)) {
		const c = instance.Color3 || instance.Color;
		if (c) applyColor(mesh.material, new Color(c.R > 1 ? c.R / 255 : c.R, c.G > 1 ? c.G / 255 : c.G, c.B > 1 ? c.B / 255 : c.B), name);
	}
}

function setInstanceScalar(instance, field, value) {
	instance[field] = value;
	if (field === "Transparency") {
		const mesh = meshForInstance(instance);
		if (mesh) applyMaterialLook(mesh.material, instance.Material || "Plastic", value);
	}
}

function renameInstance(instance, name) {
	instance.Name = name;
	const id = treeIdOf(instance);
	if (id !== undefined && treeRef.get_node(String(id))) treeRef.rename_node(String(id), name);
}

let propertiesTimer = null;
function refreshSelectionProperties() {
	clearTimeout(propertiesTimer);
	propertiesTimer = setTimeout(() => {
		const selected = treeRef.get_selected();
		if (selected.length) showInstanceProperties(Number(selected[0]));
	}, 150);
}

/** jsTree node -> its { id, instance } item; `original` is a JSON copy without the instance. */
function treeItemOf(node) {
	const original = node && node.original;
	if (!original) return null;
	const instance = renderer.nodes[original.id]?.instance || original.instance;
	if (!instance) return null;
	if (original.instance !== instance) Object.defineProperty(original, "instance", { value: instance, enumerable: false, writable: true, configurable: true });
	return original;
}

$(".tree").on("changed.jstree", (e, data) => {
	if (!data || !data.selected || data.selected.length === 0 || data.action === "deselect_all") return;
	const original = treeItemOf(treeRef.get_node(data.selected[0]));
	if (!original) return;
	if (isGuiInstance(original.instance)) {
		renderer.selectFromExplorer(original.id);
		guiEditor.select(original.instance, "explorer");
		showGuiProperties(original.instance);
		return;
	}
	guiEditor.select(null, "explorer");
	showInstanceProperties(original.id);
	renderer.selectFromExplorer(original.id);
});

function treeItemFromEvent(e) {
	return treeItemOf(treeRef.get_node(e.currentTarget));
}

$(".tree").on("dblclick", ".jstree-anchor", (e) => {
	const item = treeItemFromEvent(e);
	if (item && isScriptClass(item.instance.ClassName)) openScript(item.instance, item.id);
});

$(".tree").on("contextmenu", ".jstree-anchor", (e) => {
	const item = treeItemFromEvent(e);
	if (!item) return;
	e.preventDefault();
	if (!treeRef.is_selected(String(item.id))) {
		treeRef.deselect_all(true);
		treeRef.select_node(String(item.id));
	}
	openExplorerContextMenu(item, e.clientX, e.clientY);
});

/** openMenu() anchors under an element; this stands in for the mouse position. */
function pointAnchor(x, y) {
	return { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }), setAttribute() {}, contains: () => false };
}

const INSERT_OBJECTS = [
	{ cls: "Script", hint: "servidor" },
	{ cls: "LocalScript", hint: "cliente" },
	{ cls: "ModuleScript", hint: "require()" },
	{ cls: "Folder", hint: "" }
];

function openExplorerContextMenu(item, x, y) {
	const instance = item.instance;
	const service = renderer.getNode(item.id)?.parentId === undefined;
	const items = [{ title: `${instance.ClassName} "${instance.Name}"` }];
	if (isScriptClass(instance.ClassName)) items.push({ label: "Abrir script", icon: "script", hint: "duplo clique", onClick: () => openScript(instance, item.id) }, "sep");
	items.push({ title: "Insert Object" });
	for (const { cls, hint } of INSERT_OBJECTS) items.push({ label: cls, icon: cls === "Folder" ? "folder" : "script", hint, onClick: () => insertObject(cls, item.id) });
	if (isA(instance.ClassName, "BasePart")) {
		items.push(
			{ label: "PointLight", icon: "assetLamp", hint: "lâmpada · esfera", onClick: () => insertLight("PointLight", item.id) },
			{ label: "SpotLight", icon: "assetLamp", hint: "holofote · cone", onClick: () => insertLight("SpotLight", item.id) },
			{ label: "SurfaceLight", icon: "assetLamp", hint: "painel · quadrado", onClick: () => insertLight("SurfaceLight", item.id) },
			{ label: "SurfaceGui", icon: "ui", hint: "texto/UI", onClick: () => insertSurfaceGui(item.id) }
		);
	}
	if (canParent("ScreenGui", instance).ok || isGuiInstance(instance)) items.push({ label: "Insert UI…", icon: "ui", onClick: () => openGuiMenu(pointAnchor(x, y)) });
	items.push("sep");
	items.push({ label: "Renomear", icon: "notes", disabled: service, onClick: () => renameTreeNode(item) });
	items.push({ label: "Excluir", icon: "trash", disabled: service, onClick: () => deleteTreeNode(item) });
	openMenu(pointAnchor(x, y), items);
}

function makeLight(className) {
	const base = {
		ClassName: className,
		Name: className,
		Children: [],
		Brightness: 1,
		Color: { R: 1, G: 1, B: 1 },
		Enabled: true,
		Shadows: true
	};
	if (className === "PointLight") return { ...base, Range: 32 };
	if (className === "SurfaceLight") return { ...base, Range: 32, Angle: 90, Face: "Bottom" };
	// Spot: Face=Bottom → beam toward the ground; Range fills the magenta cone
	return { ...base, Range: 40, Angle: 90, Face: "Bottom" };
}

async function insertLight(className, parentId) {
	if (isPlayMode) return;
	const instance = makeLight(className);
	const { id, item } = await renderer.addInstance(instance, parentId);
	renderer.attachLightToPart(parentId, instance);
	insertExplorerNode(parentId, item);
	treeRef.deselect_all(true);
	treeRef.select_node(String(id), true);
	showInstanceProperties(id);
	print(`Inserido ${className} em ${fullNameOf(renderer.getNode(parentId).instance)}`);
}

async function insertSurfaceGui(parentId) {
	if (isPlayMode) return;
	const parent = renderer.getNode(parentId)?.instance;
	if (!parent) return;
	const surface = createGuiInstance("SurfaceGui", { Name: "SurfaceGui", Face: "Front" });
	const label = createGuiInstance("TextLabel", {
		Name: "TextLabel",
		Text: "Hello",
		Size: UDim2.fromScale(1, 1),
		BackgroundTransparency: 1,
		TextColor3: Color3.fromRGB(255, 255, 255),
		TextScaled: true
	});
	surface.Children.push(label);
	const { id, item } = await renderer.addInstance(surface, parentId);
	insertExplorerNode(parentId, item);
	gui.requestWorldScan();
	treeRef.deselect_all(true);
	treeRef.select_node(String(id), true);
	print(`Inserido SurfaceGui em ${fullNameOf(parent)}`);
}

async function insertObject(className, parentId) {
	if (isPlayMode) return;
	const instance = isScriptClass(className) ? makeScript(className) : new Folder();
	const { id, item } = await renderer.addInstance(instance, parentId);
	insertExplorerNode(parentId, item);
	treeRef.deselect_all(true);
	treeRef.select_node(String(id), true);
	showInstanceProperties(id);
	print(`Inserido ${className} em ${fullNameOf(renderer.getNode(parentId).instance)}`);
	if (isScriptClass(className)) {
		const issue = scriptPlacementIssue(instance, parentRecordOf);
		if (issue) print(`${instance.Name}: ${issue} — ele não vai executar aqui.`, "warn");
		openScript(instance, id);
	}
}

function renameTreeNode(item) {
	treeRef.edit(String(item.id), item.instance.Name, (node, ok, cancelled) => {
		const name = String(node.text || "").trim();
		if (cancelled || !name) {
			treeRef.rename_node(node, item.instance.Name);
			return;
		}
		item.instance.Name = name;
		const tab = docTabs.querySelector(`[data-doc="script-${item.id}"] .doc-tab-label`);
		if (tab) tab.textContent = name;
		scriptEditor.refreshHeader();
		showInstanceProperties(item.id);
	});
}

function deleteTreeNode(item) {
	const instance = item.instance;
	if (isGuiInstance(instance)) return deleteGui(instance);
	const target = renderer.targetForTreeId(item.id);
	if (target) {
		tools.select(target, "viewport");
		tools.deleteSelected();
		return;
	}
	const stack = [instance];
	while (stack.length) {
		const inst = stack.pop();
		const id = treeIdOf(inst);
		if (id !== undefined) closeDoc(`script-${id}`);
		stack.push(...(inst.Children || []));
	}
	renderer.deleteNode(item.id);
	treeRef.delete_node(String(item.id));
	propsView.clear();
	print(`Removido ${instance.ClassName} "${instance.Name}"`);
}

/* ---------- Explorer clipboard: Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D ---------- */

const LIGHT_CLASSES = new Set(["PointLight", "SpotLight", "SurfaceLight"]);
/** { instance, parentId, height } — instance is a detached deep copy taken at copy time. */
let explorerClipboard = null;

const isInstanceRecord = (v) => !!v && typeof v === "object" && typeof v.ClassName === "string" && Array.isArray(v.Children);

/**
 * Deep-copies an instance subtree. Refs between instances inside the subtree point at the
 * copies (Motor6D Part0/Part1, …); refs to instances outside it are kept as-is.
 */
function cloneInstanceTree(source) {
	const copies = new Map();
	const allocate = (inst) => {
		copies.set(inst, Object.create(Object.getPrototypeOf(inst)));
		for (const child of inst.Children) allocate(child);
	};
	allocate(source);
	const copyValue = (v) => {
		if (v === null || typeof v !== "object") return v;
		if (copies.has(v)) return copies.get(v);
		if (isInstanceRecord(v)) return v;
		if (Array.isArray(v)) return v.map(copyValue);
		if (ArrayBuffer.isView(v)) return v.slice();
		const out = Object.create(Object.getPrototypeOf(v));
		for (const k of Object.keys(v)) out[k] = copyValue(v[k]);
		return out;
	};
	for (const [src, dst] of copies) {
		for (const k of Object.keys(src)) {
			if (k !== "Children") dst[k] = copyValue(src[k]);
		}
		dst.Children = src.Children.map((c) => copies.get(c));
	}
	return copies.get(source);
}

function offsetInstanceTree(instance, dy) {
	const cf = instance.CFrame || instance.CoordinateFrame;
	if (cf && cf.Position) {
		cf.Position.Y += dy;
		if (Array.isArray(cf.Components) && cf.Components.length >= 12) cf.Components[1] += dy;
	}
	for (const child of instance.Children || []) offsetInstanceTree(child, dy);
}

/** Height of a node's rendered parts (studs) — used to paste on top of the original. */
function nodeHeight(treeId) {
	const meshes = renderer.meshesForNode(treeId);
	if (!meshes.length) return 0;
	const box = new Box3();
	for (const mesh of meshes) box.expandByObject(mesh);
	return box.isEmpty() ? 0 : box.max.y - box.min.y;
}

/** Selected Explorer item that can be copied (not a service, GUI or animation rig). */
function clipboardSource() {
	const selected = treeRef.get_selected();
	const id = selected.length ? Number(selected[0]) : undefined;
	const node = id === undefined ? null : renderer.getNode(id);
	if (!node || node.parentId === undefined) return null;
	const instance = node.instance;
	if (isGuiInstance(instance)) {
		toast("Copiar/colar de UI ainda não é suportado.");
		return null;
	}
	if (instance.__three) {
		toast("Dummies do Rig Builder não podem ser copiados.");
		return null;
	}
	return { id, node, instance };
}

function copySelection(cut = false) {
	const src = clipboardSource();
	if (!src) return;
	explorerClipboard = {
		instance: cloneInstanceTree(src.instance),
		parentId: src.node.parentId,
		height: nodeHeight(src.id)
	};
	if (cut) {
		deleteTreeNode({ id: src.id, instance: src.instance });
		print(`Recortado ${src.instance.ClassName} "${src.instance.Name}"`);
	} else {
		print(`Copiado ${src.instance.ClassName} "${src.instance.Name}"`);
	}
}

/** Where a pasted copy goes: lights live inside a part; everything else next to the selection. */
function pasteParentFor(instance, fallbackParentId) {
	const selected = treeRef.get_selected();
	const node = selected.length ? renderer.getNode(Number(selected[0])) : null;
	if (LIGHT_CLASSES.has(instance.ClassName)) {
		if (node && isA(node.instance.ClassName, "BasePart")) return node.id;
		if (node && node.parentId !== undefined && isA(renderer.getNode(node.parentId)?.instance.ClassName, "BasePart")) return node.parentId;
		return renderer.getNode(fallbackParentId) ? fallbackParentId : undefined;
	}
	if (node) return node.parentId === undefined ? node.id : node.parentId;
	if (renderer.getNode(fallbackParentId)) return fallbackParentId;
	return renderer.findNodeByClassName("Workspace")?.id;
}

async function addCopy(source, parentId, dy) {
	const copy = cloneInstanceTree(source);
	if (dy) offsetInstanceTree(copy, dy);
	const { id, item } = await renderer.addInstance(copy, parentId);
	if (LIGHT_CLASSES.has(copy.ClassName)) renderer.attachLightToPart(parentId, copy);
	insertExplorerNode(parentId, item);
	treeRef.deselect_all(true);
	treeRef.select_node(String(id), true);
	showInstanceProperties(id);
	renderer.selectFromExplorer(id);
	return copy;
}

/** Ctrl+V: a new copy stacked on top of the original. */
async function pasteClipboard() {
	if (!explorerClipboard) return;
	const { instance, parentId, height } = explorerClipboard;
	const target = pasteParentFor(instance, parentId);
	if (target === undefined) {
		toast("Selecione uma Part para colar a luz.");
		return;
	}
	const copy = await addCopy(instance, target, height);
	print(`Colado ${copy.ClassName} "${copy.Name}" em ${fullNameOf(renderer.getNode(target).instance)}`);
}

/** Ctrl+D: duplicate in the same parent at the same position. */
async function duplicateSelection() {
	const src = clipboardSource();
	if (!src) return;
	const copy = await addCopy(src.instance, src.node.parentId, 0);
	print(`Duplicado ${copy.ClassName} "${copy.Name}"`);
}

/** Roblox-style dotted path (game.ServerScriptService.Script). */
function fullNameOf(instance) {
	const names = [];
	for (let inst = instance; inst; inst = parentRecordOf(inst)) names.unshift(inst.Name);
	return names.join(".");
}

function parentRecordOf(instance) {
	const id = treeIdOf(instance);
	const node = id === undefined ? null : renderer.getNode(id);
	const parent = node && node.parentId !== undefined ? renderer.getNode(node.parentId) : null;
	return parent ? parent.instance : null;
}

tools.addEventListener("selectionchange", (e) => {
	const { target, source } = e.detail;
	updateRibbon();
	updateHud();
	if (source === "explorer" || source === "gui") return;
	if (guiEditor.selected) guiEditor.select(null, "3d");
	treeRef.deselect_all(true);
	if (target && target.kind === "bone") {
		if (target.treeId !== undefined) treeRef.select_node(String(target.treeId), true);
		showBoneProperties(target.object);
		return;
	}
	if (!target || target.treeId === undefined) {
		propsView.clear();
		return;
	}
	const id = String(target.treeId);
	treeRef.select_node(id, true);
	if (target.kind === "rig") showHumanoidProperties(target.object.userData.rbx);
	else showInstanceProperties(target.treeId);
	requestAnimationFrame(() => {
		const li = treeRef.get_node(id, true);
		if (li && li[0]) li[0].scrollIntoView({ block: "nearest" });
	});
});

tools.addEventListener("statechange", () => {
	updateRibbon();
	updateHud();
});
tools.addEventListener("transformend", (e) => {
	const target = e.detail.target;
	if (target && target.kind === "bone") showBoneProperties(target.object);
	else if (target && target.kind === "rig") {
		syncRigInstances(target.object);
		showHumanoidProperties(target.object.userData.rbx);
	} else refreshSelectionProperties();
});

/** Alt+clicked dummy part: its Part instance (live CFrame) plus the Motor6D joint state. */
function showBoneProperties(bone) {
	let root = bone;
	while (root && !root.userData.isAnimRig) root = root.parent;
	const part = bone.userData.rbx;
	if (!part || !root) {
		propsView.show(`Bone "${bone.name}"`, animEditor.boneProperties(bone));
		return;
	}
	syncRigInstances(root);
	const { Children, CFrame, ...fields } = part;
	propsView.show(`Part "${part.Name}"`, {
		...fields,
		Parent: root.name,
		CFrame,
		Position: CFrame.Position,
		Orientation: CFrame.Orientation,
		...animEditor.boneProperties(bone)
	});
}

tools.addEventListener("deleterequest", (e) => {
	const { target } = e.detail;
	if (target.kind === "rig") animEditor.removeRig(target.object);
	if (target.treeId === undefined) return;
	renderer.deleteNode(target.treeId);
	treeRef.delete_node(String(target.treeId));
	propsView.clear();
	updateRibbon();
});

tools.addEventListener("grouprequest", () => groupSelection());

/* ---------- StarterGui (GUI engine) ---------- */

const GUI_HINTS = { ScreenGui: "camada", Frame: "div", TextLabel: "texto", TextButton: "button", ImageLabel: "imagem", ImageButton: "botão" };

function treeIdOf(instance) {
	const node = renderer.nodes.find((n) => n && n.instance === instance);
	return node ? node.id : undefined;
}

function explorerSelectedInstance() {
	const selected = treeRef.get_selected();
	const node = selected.length ? renderer.getNode(Number(selected[0])) : null;
	return node ? node.instance : null;
}

function revealTreeNode(id) {
	treeRef.deselect_all(true);
	treeRef.select_node(String(id), true);
	requestAnimationFrame(() => {
		const li = treeRef.get_node(String(id), true);
		if (li && li[0]) li[0].scrollIntoView({ block: "nearest" });
	});
}

function openGuiMenu(anchor) {
	openMenu(anchor, [
		{ title: "Insert UI · StarterGui" },
		...CREATABLE_GUI.map((cls) => ({ label: cls, icon: "ui", hint: GUI_HINTS[cls], onClick: () => insertGui(cls) }))
	]);
}

async function addGuiNode(instance, parent) {
	const parentId = treeIdOf(parent);
	if (parentId === undefined) return null;
	const { id, item } = await renderer.addInstance(instance, parentId);
	insertExplorerNode(parentId, item);
	return id;
}

/**
 * Inserts a GUI object respecting the hierarchy rules: ScreenGuis go into StarterGui; other
 * classes go into the selected ScreenGui / GuiObject, else into the first ScreenGui (created
 * on demand). A rejected parent (e.g. StarterGui for a Frame) is reported and wrapped.
 */
async function insertGui(className) {
	if (busy || isPlayMode) return;
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	if (activeDoc !== "place") activateDoc("place");
	const starterGui = renderer.findNodeByClassName("StarterGui")?.instance;
	if (!starterGui) {
		toast("Este place não tem StarterGui.");
		return;
	}
	if (gui.root !== starterGui) gui.attach(starterGui);

	let parent = starterGui;
	if (className !== "ScreenGui") {
		const selected = guiEditor.selected || explorerSelectedInstance();
		parent = selected && (isGuiInstance(selected) || selected === starterGui) ? selected : null;
		if (parent) {
			const check = canParent(className, parent);
			if (!check.ok) {
				print(`${check.reason} — criando um ScreenGui para o ${className}`, "warn");
				parent = null;
			}
		}
		if (!parent && selected !== starterGui) parent = starterGui.Children.find((c) => isGuiInstance(c) && c.ClassName === "ScreenGui") || null;
		if (!parent) {
			parent = createGuiInstance("ScreenGui");
			await addGuiNode(parent, starterGui);
		}
	}
	const check = canParent(className, parent);
	if (!check.ok) {
		print(check.reason, "error");
		toast(check.reason);
		return;
	}

	const siblings = parent.Children.filter(isGuiObject).length;
	const props = {};
	if (className !== "ScreenGui") props.Position = UDim2.fromOffset(24 + siblings * 16, 24 + siblings * 16);
	const instance = createGuiInstance(className, props);
	const id = await addGuiNode(instance, parent);
	if (id === undefined || id === null) return;
	print(`Inserido ${className} "${instance.Name}" [${instance.UniqueId}] em ${parent.ClassName} "${parent.Name}"`);
	guiEditor.select(instance, "insert");
	renderer.domElement.focus({ preventScroll: true });
}

function deleteGui(instance) {
	const id = treeIdOf(instance);
	if (id === undefined) return;
	guiEditor.select(null, "delete");
	renderer.deleteNode(id);
	treeRef.delete_node(String(id));
	propsView.clear();
	print(`Removido ${instance.ClassName} "${instance.Name}"`);
	updateRibbon();
}

/** Properties panel bound both ways to the instance's schema (inputs write, engine changes refresh). */
function showGuiProperties(instance) {
	const entries = { ClassName: instance.ClassName, UniqueId: instance.UniqueId, Parent: instance.Parent ? instance.Parent.Name : "nil" };
	const editors = {};
	for (const [key, spec] of Object.entries(guiSchemaOf(instance))) {
		if (spec.type === "raw") {
			const v = instance[key];
			entries[key] = v == null ? "—" : Array.isArray(v) ? `${v.length} keypoints` : v.Family ? `${String(v.Family).replace(/^.*\//, "")} ${v.Weight ?? ""}` : String(v);
			continue;
		}
		entries[key] = instance[key];
		editors[key] = {
			type: spec.type,
			options: spec.type === "enum" ? ENUMS[spec.enum] : undefined,
			get: () => instance[key],
			set: (value) => setGuiProperty(instance, key, value)
		};
	}
	propsView.show(`${instance.ClassName} "${instance.Name}"`, entries, { editors });
}

function setGuiProperty(instance, key, value) {
	const before = instance[key];
	instance[key] = value;
	const after = instance[key];
	if (before === after || (before && before.equals && before.equals(after))) return;
	recordGuiEdit(instance, key, [{ key, before, after }], true);
}

let lastGuiEdit = null;
/**
 * One undo step per edit (a resize writes Size and Position in one step). Rapid edits of the
 * same property from the Properties panel (color picker drags) are merged.
 */
function recordGuiEdit(instance, label, changes, mergeable = false) {
	const now = performance.now();
	const top = tools.undoStack[tools.undoStack.length - 1];
	const key = changes.map((c) => c.key).join();
	if (mergeable && lastGuiEdit && top === lastGuiEdit.entry && lastGuiEdit.instance === instance && lastGuiEdit.key === key && now - lastGuiEdit.time < 800) {
		lastGuiEdit.changes.forEach((c, i) => { c.after = changes[i].after; });
		lastGuiEdit.time = now;
		return;
	}
	const record = { instance, key, changes, time: now, entry: null };
	const restore = (which) => {
		for (const change of record.changes) instance[change.key] = change[which];
		if (guiEditor.selected === instance) showGuiProperties(instance);
		else guiEditor.select(instance, "history");
	};
	tools.pushCustomHistory(`${label} ${instance.Name}`, {
		undo: () => restore("before"),
		redo: () => restore("after"),
		alive: () => treeIdOf(instance) !== undefined
	});
	record.entry = tools.undoStack[tools.undoStack.length - 1];
	lastGuiEdit = mergeable ? record : null;
}

guiEditor.addEventListener("selectionchange", (e) => {
	const { instance, source } = e.detail;
	updateRibbon();
	if (!instance && source === "viewport") {
		treeRef.deselect_all(true);
		propsView.clear();
	}
	if (!instance || source === "explorer") return;
	if (tools.target) tools.select(null, "gui");
	const id = treeIdOf(instance);
	if (id !== undefined) revealTreeNode(id);
	showGuiProperties(instance);
});
guiEditor.addEventListener("edit", (e) => {
	const { instance, label, changes } = e.detail;
	recordGuiEdit(instance, label, changes);
});
guiEditor.addEventListener("deleterequest", (e) => deleteGui(e.detail.instance));

let guiPropsFrame = 0;
gui.addEventListener("change", (e) => {
	const { instance, key } = e.detail;
	if (key === "Name") {
		const id = treeIdOf(instance);
		if (id !== undefined) treeRef.rename_node(String(id), instance.Name);
	}
	if (instance !== guiEditor.selected || guiPropsFrame) return;
	guiPropsFrame = requestAnimationFrame(() => {
		guiPropsFrame = 0;
		if (guiEditor.selected === instance) propsView.refreshValues();
	});
});
gui.addEventListener("activated", (e) => {
	const inst = e.detail.instance;
	print(`${inst.ClassName} "${inst.Name}".Activated`);
});

async function groupSelection() {
	const target = tools.target;
	if (!target || target.treeId === undefined) return;
	const node = renderer.getNode(target.treeId);
	const parent = node && renderer.getNode(node.parentId);
	if (!parent) {
		toast("Only objects inside Workspace can be grouped.");
		return;
	}
	tools.select(null, "delete");
	const { id, item } = await renderer.addInstance(makeModel("Model"), parent.id);
	treeRef.create_node(String(parent.id), item, "last");
	renderer.moveNode(target.treeId, id);
	treeRef.move_node(String(target.treeId), String(id), "last");
	treeRef.open_node(String(id));
	print(`Grouped ${target.name} into a new Model`);
	tools.select(renderer.targetForTreeId(id), "viewport");
}

let filterTimer = null;
$id("explorer-filter").addEventListener("input", (e) => {
	clearTimeout(filterTimer);
	filterTimer = setTimeout(() => {
		const q = e.target.value.trim();
		if (q) treeRef.search(q);
		else treeRef.clear_search();
	}, 200);
});

function threeNodeToTreeData(nodes) {
	const icons = { AmbientLight: "Lighting", DirectionalLight: "Lighting", Mesh: "Part", Group: "Model", LineSegments: "SelectionBox", Box3Helper: "SelectionBox", AxesHelper: "SelectionBox" };
	const data = [];
	for (const child of nodes) {
		if (child.userData && child.userData.hideInExplorer) continue;
		data.push({
			node: child,
			text: child.name.length > 0 ? child.name : child.type,
			icon: `content/icons/${icons[child.type] || "BaseScript"}.png`,
			children: threeNodeToTreeData(child.children)
		});
	}
	return data;
}

let treeRefresh2Pending = false;
treeRefresh2 = () => {
	if (tree2.hidden) {
		treeRefresh2Pending = true;
		return;
	}
	treeRef2.settings.core.data = threeNodeToTreeData([renderer.scene]);
	treeRef2.refresh();
};

$(".tree2").on("changed.jstree", (e, data) => {
	const node = data.selected.length ? treeRef2.get_node(data.selected[0]).original : null;
	if (!node || !node.node) return;
	const o = node.node;
	const entries = {
		type: o.type, name: o.name, id: o.id, uuid: o.uuid,
		visible: o.visible, castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder, frustumCulled: o.frustumCulled,
		position: o.position, rotation: o.rotation, scale: o.scale,
		children: undefined
	};
	if (o.material && !Array.isArray(o.material)) {
		entries.material = o.material.type;
		if (o.material.color) entries.color = o.material.color;
	} else if (Array.isArray(o.material)) {
		entries.material = `${o.material.length} materials`;
	}
	if (o.geometry) entries.geometry = o.geometry.type;
	if (o.isLight) {
		entries.intensity = o.intensity;
		entries.color = o.color;
	}
	entries.childCount = o.children.length;
	propsView.show(`${o.type} "${o.name || o.type}"`, entries);
});

function setExplorerView(view) {
	const scene = view === "scene";
	tree.hidden = scene;
	tree2.hidden = !scene;
	$id("explorer-filter").parentElement.hidden = scene;
	$id("explorer-title").textContent = scene ? "Explorer - THREE.js Scene" : "Explorer";
	if (scene && treeRefresh2Pending) {
		treeRefresh2Pending = false;
		treeRefresh2();
	} else if (scene) {
		treeRefresh2();
	}
}

/* ---------- Panel menus ---------- */

const PANEL_MENUS = {
	explorer: () => [
		{ label: "DataModel", checked: !tree.hidden, onClick: () => setExplorerView("datamodel") },
		{ label: "THREE.js Scene", checked: tree.hidden, onClick: () => setExplorerView("scene") },
		"sep",
		{ label: "Collapse all", onClick: () => treeRef.close_all() },
		{ label: "Close", icon: "close", onClick: () => layout.setVisible("explorer", false) }
	],
	properties: () => [
		{ label: "Expand all categories", onClick: () => propsView.setAllCollapsed(false) },
		{ label: "Collapse all categories", onClick: () => propsView.setAllCollapsed(true) },
		"sep",
		{ label: "Close", icon: "close", onClick: () => layout.setVisible("properties", false) }
	],
	toolbox: () => [
		{ title: "Thumbnail background" },
		...["white", "black", "none"].map((bg) => ({ label: bg[0].toUpperCase() + bg.slice(1), onClick: () => toolbox.setBackground(bg) })),
		"sep",
		{ label: "Close", icon: "close", onClick: () => layout.setVisible("toolbox", false) }
	],
	output: () => [
		{ label: "Clear output", onClick: () => output.clear() },
		{ label: "Copy all", onClick: () => navigator.clipboard.writeText($id("log").innerText).then(() => toast("Output copied")) },
		"sep",
		{ label: "Close", icon: "close", onClick: () => layout.setVisible("output", false) }
	]
};
for (const btn of document.querySelectorAll("[data-panel-menu]")) {
	btn.addEventListener("click", () => openMenu(btn, PANEL_MENUS[btn.dataset.panelMenu](), { align: "end" }));
}

/* ---------- Undo / Redo ---------- */

$id("undo-button").innerHTML = icon("undo");
$id("redo-button").innerHTML = icon("redo");
$id("undo-button").addEventListener("click", () => tools.undo());
$id("redo-button").addEventListener("click", () => tools.redo());

/* ---------- Export to Roblox ---------- */

/**
 * Writes the whole DataModel as a Roblox XML place (.rbxlx) and downloads it: parts, rigs with
 * their Motor6Ds, GUIs, scripts and the animation editor's clips (as KeyframeSequences).
 * @param {{ download?: boolean }} [options]
 * @returns {{ xml: string, stats: object } | null}
 */
function ExportToRoblox({ download = true } = {}) {
	if (!placeLoaded || !renderer.data) {
		toast("Abra um place antes de exportar");
		return null;
	}
	if (isPlayMode) {
		toast("Pare o Play antes de exportar");
		return null;
	}
	const rigs = [];
	for (const root of animEditor.rigs.keys()) {
		const model = root.userData.rbx;
		if (!model) continue;
		// Joints are written at rest (Motor6D C0/C1); the pose being edited lives in the KeyframeSequences.
		const saved = [];
		root.traverse((o) => {
			if (o.isBone) saved.push([o, o.position.clone(), o.quaternion.clone()]);
		});
		const rest = root.userData.rest || {};
		for (const [bone] of saved) {
			const r = rest[bone.name];
			if (r) {
				bone.position.copy(r.position);
				bone.quaternion.copy(r.quaternion);
			}
		}
		syncRigInstances(root);
		for (const [bone, p, q] of saved) {
			bone.position.copy(p);
			bone.quaternion.copy(q);
		}
		root.updateMatrixWorld(true);
		rigs.push({ model, root, docs: [] });
	}
	let orphanClips = 0;
	for (const doc of animEditor.docs) {
		if (!doc.keyCount()) continue;
		const target = rigs.find((r) => !doc.rigType || r.root.userData.rigType === doc.rigType);
		if (target) target.docs.push(doc);
		else orphanClips++;
	}
	if (orphanClips) print(`${orphanClips} animação(ões) sem um rig compatível no Workspace não foram exportadas (insira um Rig do mesmo RigType)`, "warn");

	const { xml, stats } = buildRbxlx({ instances: renderer.data, animations: rigs, warn: (m) => print(m, "warn") });
	const fileName = `${String(placeName || "Place").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Place"}.rbxlx`;
	if (download) downloadRbxlx(xml, fileName);
	print(`Exportado ${fileName}: ${stats.items} instâncias · ${stats.parts} parts · ${stats.scripts} scripts · ${stats.guis} GUIs · ${stats.keyframeSequences} KeyframeSequence(s) · ${(xml.length / 1024).toFixed(0)} KB`, "info");
	if (download) toast(`Exportado ${fileName} — abra no Roblox Studio (File > Open from File)`);
	return { xml, stats };
}
window.ExportToRoblox = ExportToRoblox;

/* ---------- FILE menu ---------- */

// Hidden picker for "Importar objeto 3D…" (FBX/OBJ/GLTF/GLB/STL).
const import3DInput = document.createElement("input");
import3DInput.type = "file";
import3DInput.id = "import-3d";
import3DInput.accept = SUPPORTED_3D_ACCEPT;
import3DInput.style.display = "none";
document.body.appendChild(import3DInput);
import3DInput.addEventListener("change", (e) => {
	const file = e.target.files[0];
	e.target.value = "";
	if (file) importObject3D(file);
});

/**
 * Imports an external 3D model file into the Workspace as a MeshPart. Geometry is flattened and
 * registered with the renderer; the part is scaled so its largest dimension is a sensible default
 * (external files use arbitrary units) and dropped at the camera's insert point.
 */
async function importObject3D(file) {
	if (busy) return;
	if (!is3DModelFile(file.name)) {
		toast(`Formato não suportado. Use: ${SUPPORTED_3D.map((f) => f.ext.toUpperCase()).join(", ")}.`);
		return;
	}
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	const workspace = renderer.findNodeByClassName("Workspace");
	if (!workspace) { toast("This place has no Workspace to insert into."); return; }

	loadingScreen.show({ title: `Importando ${file.name}`, theme: "studio" });
	loadingScreen.setProgress(0.2, "Lendo o arquivo 3D…");
	let geo;
	try {
		geo = await importModelFile(file);
	} catch (err) {
		await loadingScreen.hide();
		toast(err && err.message ? err.message : "Falha ao importar o objeto 3D.");
		print(`3D import error: ${err && err.message}`, "error");
		return;
	}
	loadingScreen.setProgress(0.7, "Montando o MeshPart…");

	// External files use arbitrary units; normalize so the biggest dimension is ~16 studs.
	const maxDim = Math.max(geo.size.X, geo.size.Y, geo.size.Z);
	const fit = maxDim > 0 ? 16 / maxDim : 1;
	const size = { X: geo.size.X * fit, Y: geo.size.Y * fit, Z: geo.size.Z * fit };
	const origin = renderer.getInsertPoint();
	const pos = { X: origin.x, Y: origin.y + size.Y / 2, Z: origin.z };
	const meshId = renderer.registerImportedMesh(geo);
	const part = {
		ClassName: "MeshPart", Name: geo.name, Children: [],
		Anchored: true, CanCollide: true, CastShadow: true, Locked: false, Massless: false,
		CFrame: { Position: pos, Orientation: { X: 0, Y: 0, Z: 0 }, Components: [pos.X, pos.Y, pos.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1] },
		Color3: { R: 0.64, G: 0.64, B: 0.64 }, Material: "Plastic", Reflectance: 0, Transparency: 0,
		Size: size, MeshId: meshId, TextureID: ""
	};

	const { id, item } = await renderer.addInstance(part, workspace.id);
	insertExplorerNode(workspace.id, item);
	tools.select(renderer.targetForTreeId(id), "insert");
	if (tools.selectedMeshes && tools.selectedMeshes.length) renderer.focusOn(tools.selectedMeshes);
	await loadingScreen.hide();
	print(`Imported 3D object "${geo.name}" (${geo.triangles.toLocaleString()} triângulos, tamanho original ${geo.size.X.toFixed(1)}×${geo.size.Y.toFixed(1)}×${geo.size.Z.toFixed(1)})`);
	renderer.domElement.focus({ preventScroll: true });
}

$id("file-button").addEventListener("click", (e) => {
	openMenu(e.currentTarget, [
		{ label: "Open file…", icon: "folder", onClick: () => $id("browse").click() },
		{ label: "Importar objeto 3D…", icon: "assetTree", hint: "FBX · OBJ · GLTF · STL", onClick: () => import3DInput.click() },
		{ label: "Load from server…", icon: "server", onClick: openRemoteDialog },
		{ label: "New Baseplate", icon: "baseplate", onClick: () => openPlace({ template: true, name: "Baseplate" }) },
		"sep",
		{ label: "Configuração da experiência…", icon: "settings", hint: getExperienceSettings().avatarRigType, onClick: openExperienceSettings },
		{ label: "Exportar para Roblox (.rbxlx)", icon: "roblox", disabled: !placeLoaded || isPlayMode, onClick: () => ExportToRoblox() },
		"sep",
		{ label: "Undo", icon: "undo", hint: "Ctrl+Z", disabled: !tools.canUndo, onClick: () => tools.undo() },
		{ label: "Redo", icon: "redo", hint: "Ctrl+Y", disabled: !tools.canRedo, onClick: () => tools.redo() },
		"sep",
		{ label: "Render image…", icon: "camera", disabled: !placeLoaded, onClick: openRenderDialog },
		{ label: "Missing assets…", icon: "warning", disabled: !placeLoaded, onClick: () => handleAction("missing-assets") },
		"sep",
		{ label: "Reload", icon: "reload", onClick: () => window.location.reload() },
		"sep",
		{ label: "Changelog", icon: "notes", onClick: openChangelog },
		{ label: "About Studio Lite", icon: "info", onClick: openAbout }
	]);
});

/* ---------- Transform HUD ---------- */

const hudButtons = hud.querySelectorAll("button[data-mode]");
for (const btn of hudButtons) {
	btn.addEventListener("click", () => {
		const mode = btn.dataset.mode;
		tools.setMode(tools.mode === mode ? null : mode);
		renderer.domElement.focus({ preventScroll: true });
	});
}

function updateHud() {
	const cam = renderer.controls;
	for (const btn of hudButtons) {
		const active = tools.mode === btn.dataset.mode;
		btn.classList.toggle("active", active);
		btn.setAttribute("aria-pressed", String(active));
	}
	hud.classList.toggle("is-looking", cam.mode !== "idle");
	const name = tools.selectedName;
	let hint;
	if (cam.mode === "play") hint = "Primeira pessoa · WASD/QE voar · ESC para sair";
	else if (cam.playArmed) hint = "Clique na viewport para entrar em primeira pessoa · ESC cancela";
	else if (cam.mode === "look") hint = "Olhando ao redor · solte o botão direito para voltar";
	else if (tools.dragging) hint = "Arrastando · ESC cancela";
	else if (!name) hint = tools.mode ? "Clique numa peça para exibir o gizmo" : "Clique para selecionar (Alt+clique: peça) · segure o botão direito para olhar · WASD/QE voar";
	else if (tools.mode === "translate") hint = `${name} · arraste as setas · ←↑→↓ move 1 stud (Ctrl 0.1, Shift+↑↓ eixo Y) · ESC solta`;
	else if (tools.mode === "rotate") hint = `${name} · arraste os anéis · ←→ gira em Y, ↑↓ inclina (Ctrl 1°) · Shift livre · ESC solta`;
	else if (tools.mode === "scale") hint = `${name} · arraste as alças · ←→ X, ↑↓ Y, Shift+↑↓ Z (Ctrl 0.1) · ESC solta`;
	else hint = `${name} selecionado · [1] Mover · [2] Rotacionar · [3] Escalar · Del apaga`;
	hudHint.textContent = hint;
}

renderer.controls.addEventListener("modechange", () => {
	updateHud();
	updateRibbon();
});

/* ---------- Toolbox ---------- */

// Let the engine fetch Creator Store / asset-delivery content (mesh, decal/texture) through the proxy
// when an asset isn't stored locally. rbxassetid URIs on imported instances resolve to this URL.
renderer.mAssetManager.setRemoteResolver((assetId) => robloxConfig.endpoint(`/assets/${assetId}/content`));

const toolbox = new Toolbox({
	onInsert: (recipe) => insertRecipe(recipe),
	onInsertAsset: (asset) => insertRobloxAsset(asset)
});

async function insertRecipe(recipe, ndc) {
	if (busy) return;
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	const workspace = renderer.findNodeByClassName("Workspace");
	if (!workspace) {
		toast("This place has no Workspace to insert into.");
		return;
	}
	const origin = renderer.getInsertPoint(ndc);
	const parts = recipe.parts.map((spec) => makePart(spec, origin));
	const instance = parts.length === 1 ? parts[0] : makeModel(recipe.name, parts);
	const { id, item } = await renderer.addInstance(instance, workspace.id);
	insertExplorerNode(workspace.id, item);
	tools.select(renderer.targetForTreeId(id), "insert");
	toolbox.markRecent(recipe.id);
	print(`Inserted ${recipe.name} at (${origin.x}, ${origin.y}, ${origin.z})`);
	renderer.domElement.focus({ preventScroll: true });
}

/**
 * Imports a Roblox asset (by RobloxAsset metadata or by id/URL) into the Workspace at the insert
 * point. Images/meshes become a single part; models decode into their native instances. Content is
 * fetched through the proxy; unsupported types surface a clear message instead of inserting.
 */
async function insertRobloxAsset(assetOrId, ndc) {
	if (busy) return;
	if (!placeLoaded) await openPlace({ template: true, name: "Baseplate" });
	const workspace = renderer.findNodeByClassName("Workspace");
	if (!workspace) { toast("This place has no Workspace to insert into."); return; }
	const origin = renderer.getInsertPoint(ndc);
	let result;
	try {
		result = await robloxAssetImporter.importAsset(assetOrId, {
			origin,
			onProgress: (msg) => { if (statusEl) statusEl.textContent = msg; }
		});
	} catch (err) {
		toast(err && err.message ? err.message : "Falha ao importar o asset do Roblox.");
		print(`Roblox import error: ${err && err.message}`);
		return;
	}
	if (!result || !result.success) {
		toast((result && result.message) || "Este asset não pôde ser importado.");
		return;
	}
	const added = [];
	for (const instance of result.instances) {
		const { id, item } = await renderer.addInstance(instance, workspace.id);
		insertExplorerNode(workspace.id, item);
		added.push({ id, instance });
	}
	// Models carry absolute CFrames from their file; drop them at the insert point.
	if (!result.single) {
		for (const { instance } of added) {
			if (instance.ClassName === "Model" || instance.CFrame) {
				const pivot = instance.ClassName === "Model" ? modelPivot(instance) : (instance.CFrame && instance.CFrame.Position);
				const p = pivot && pivot.Position ? pivot.Position : pivot;
				if (p) translateSingleRoot(instance, origin.x - p.X, origin.y - p.Y, origin.z - p.Z);
			}
		}
	}
	const first = added[0];
	if (first) {
		tools.select(renderer.targetForTreeId(first.id), "insert");
		if (tools.selectedMeshes && tools.selectedMeshes.length) renderer.focusOn(tools.selectedMeshes);
	}
	if (result.detail) print(result.detail);
	print(`Imported ${result.name || "asset"} (${result.category}) from Roblox`);
	renderer.domElement.focus({ preventScroll: true });
}

/** Translate a single root instance (Model or Part) by a delta, keeping CFrames + meshes in sync. */
function translateSingleRoot(instance, dx, dy, dz) {
	if (instance.ClassName === "Model") { translateModel(instance, dx, dy, dz); return; }
	const cf = instance.CFrame;
	if (cf && cf.Position) {
		cf.Position = { X: cf.Position.X + dx, Y: cf.Position.Y + dy, Z: cf.Position.Z + dz };
		if (Array.isArray(cf.Components) && cf.Components.length >= 3) { cf.Components[0] += dx; cf.Components[1] += dy; cf.Components[2] += dz; }
		applyPartPositionToMesh(instance);
	}
}

viewport.addEventListener("dragover", (e) => {
	if (!e.dataTransfer.types.includes("application/x-studiolite-asset") && !e.dataTransfer.types.includes("application/x-studiolite-roblox")) return;
	e.preventDefault();
	e.dataTransfer.dropEffect = "copy";
});
viewport.addEventListener("drop", (e) => {
	const rbxId = e.dataTransfer.getData("application/x-studiolite-roblox");
	if (rbxId) {
		e.preventDefault();
		const rect = renderer.domElement.getBoundingClientRect();
		const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
		const cls = classifyQuery(rbxId);
		insertRobloxAsset(cls.kind === "id" ? cls.assetId : Number(rbxId), placeLoaded ? ndc : undefined);
		return;
	}
	const id = e.dataTransfer.getData("application/x-studiolite-asset");
	const recipe = RECIPES.find((r) => r.id === id);
	if (!recipe) return;
	e.preventDefault();
	const rect = renderer.domElement.getBoundingClientRect();
	const ndc = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	insertRecipe(recipe, placeLoaded ? ndc : undefined);
});

/* ---------- Documents (place / script tabs) ---------- */

const scriptDocs = new Map();

const SCRIPT_KIND = {
	Script: "Servidor · roda em Workspace / ServerScriptService",
	LocalScript: "Cliente · roda em StarterPlayerScripts / StarterCharacterScripts / StarterGui",
	ModuleScript: "Módulo · só executa via require()"
};

const scriptEditor = new ScriptEditor(editor, {
	describe: (instance) => ({
		path: fullNameOf(instance),
		kind: SCRIPT_KIND[instance.ClassName] || "",
		issue: scriptPlacementIssue(instance, parentRecordOf)
	})
});

function activateDoc(docId) {
	activeDoc = docId;
	for (const tab of docTabs.querySelectorAll(".doc-tab")) tab.classList.toggle("active", tab.dataset.doc === docId);
	if (docId === "place") {
		scriptEditor.stash();
		editor.hidden = true;
		rendering = true;
		setTitle(placeName);
		return;
	}
	const instance = scriptDocs.get(docId);
	editor.hidden = false;
	rendering = false;
	scriptEditor.show(docId, instance);
	document.title = `${instance.Name} - Studio Lite`;
}

function openScript(instance, treeId) {
	const docId = `script-${treeId}`;
	if (!scriptDocs.has(docId)) {
		scriptDocs.set(docId, instance);
		const tab = document.createElement("button");
		tab.type = "button";
		tab.className = "doc-tab";
		tab.dataset.doc = docId;
		tab.setAttribute("role", "tab");
		tab.innerHTML = `${icon("script")}<span class="doc-tab-label"></span><span class="doc-tab-close" title="Close">${icon("close")}</span>`;
		tab.querySelector(".doc-tab-label").textContent = instance.Name;
		tab.querySelector(".doc-tab-close").addEventListener("click", (e) => {
			e.stopPropagation();
			closeDoc(docId);
		});
		docTabs.appendChild(tab);
	}
	activateDoc(docId);
}

function closeDoc(docId) {
	scriptDocs.delete(docId);
	scriptEditor.close(docId);
	const tab = docTabs.querySelector(`[data-doc="${docId}"]`);
	if (tab) tab.remove();
	if (activeDoc === docId) activateDoc("place");
}

docTabs.addEventListener("click", (e) => {
	const tab = e.target.closest(".doc-tab");
	if (tab) activateDoc(tab.dataset.doc);
});

/* ---------- Loading places ---------- */

function barState(className) {
	bar.className = className;
}

/**
 * @param {{ url?: string, file?: File, template?: boolean, name?: string }} source
 */
async function openPlace(source) {
	if (busy) return;
	if (isPlayMode) playMode.stop();
	busy = true;
	closePopup();
	if (placeLoaded) {
		for (const docId of [...scriptDocs.keys()]) closeDoc(docId);
		tools.select(null, "delete");
		guiEditor.select(null, "delete");
		gui.detach();
		animEditor.removeAllRigs();
		renderer.clearPlace();
		tools.clearHistory();
		treeRef.settings.core.data = [];
		treeRef.refresh();
		propsView.clear();
		placeLoaded = false;
	}
	startPage.hidden = true;
	showMessage("");
	loadingScreen.show({ title: source.template ? `Novo: ${source.name || "Baseplate"}` : (source.name || "Carregando place"), theme: "studio" });
	loadingScreen.setProgress(null, "Buscando arquivo…");
	barState("marquee paused");
	const name = source.name || (source.file ? source.file.name : String(source.url).split("/").pop());
	setStatus(`Fetching ${name}`);

	try {
		if (source.template) {
			print(`Creating new place from template "${name}"`);
			loadingScreen.setProgress(0.5, "Criando place…");
			await renderer.loadDataModel(makeBaseplateDataModel(), { cameraPosition: [0, 22, 46], cameraTarget: [0, 2, 0] });
			} else {
			let buffer;
			if (source.file) {
				print(`DataModel Loading ${source.file.name}`);
				buffer = await source.file.arrayBuffer();
			} else {
				const url = new URL(source.url, window.location.href);
				print(`DataModel Loading ${url}`);
				const response = await fetch(url);
				if (response.status !== 200) throw new Error(`Failed to fetch ${url} (HTTP ${response.status})`);
				buffer = await response.arrayBuffer();
			}
			barState("marquee");
			setStatus(`Loading ${name}`);
			loadingScreen.setProgress(0.25, "Lendo o arquivo do place…");
			await sleep(50);
			loadingScreen.setProgress(0.4, "Interpretando objetos…");
			await renderer.loadPlace(buffer);
		}
	} catch (err) {
		print(`The file could not be read: ${err && err.message ? err.message : err}`, "error");
		barState("error");
		setStatus("Failed to load");
		showMessage("");
		await loadingScreen.hide();
		startPage.hidden = false;
		busy = false;
		return;
	}

	loadingScreen.setProgress(0.6, "Montando a árvore de objetos…");
	setTitle(name);
	const workspaceItem = jsTreeData.find((item) => item.instance.ClassName === "Workspace");
	if (workspaceItem) workspaceItem.state = { opened: true };
	// Nodes created before jsTree finishes refreshing would be wiped by the refresh.
	await new Promise((resolve) => {
		const timer = setTimeout(resolve, 2000);
		$(".tree").one("refresh.jstree", () => {
			clearTimeout(timer);
			resolve();
		});
		treeRef.settings.core.data = jsTreeData;
		treeRef.refresh();
	});
	treeRefresh2();
	loadingScreen.setProgress(0.68, "Carregando objetos e texturas…");
	gui.attach(renderer.findNodeByClassName("StarterGui")?.instance || null);
	gui.setWorldSource(renderer.findNodeByClassName("Workspace")?.instance || null);
	placeLoaded = true;
	busy = false;
	showMessage("");
	hud.hidden = false;
	applyViewState();
	updateRibbon();
	updateHud();
	print("Edit mode: click to select, [1] Move, [2] Rotate, [3] Scale, hold Right Click to look around, ESC for first-person");

	await waitForAssets((done, total) => {
		loadingScreen.setProgress(total ? 0.68 + 0.32 * (done / total) : 0.85, total ? `Carregando objetos: ${done}/${total}` : "Carregando objetos…");
	});
	barState("animate");
	setStatus("Ready");
	applyViewState();
	if (renderer.mAssetManager.hasRbxGameAsset) print("This Place contains rbxgameasset:// paths. Studio Lite cannot resolve them, as they are relative to the published game!", "warn");
	if (renderer.mAssetManager.computeMissingAssetsList()) print("Some assets failed to load! See View > Assets for more info.", "warn");
	await loadingScreen.hide();
	renderer.domElement.focus({ preventScroll: true });
}

/**
 * Resolves when the renderer's async asset queue (meshes, textures) drains, or when it stalls with
 * no progress for a while (an asset failed / needs auth) so the UI never waits forever.
 * @param {(done: number, total: number) => void} [onProgress]
 */
function waitForAssets(onProgress) {
	return new Promise((resolve) => {
		let lastDone = -1;
		let stalledMs = 0;
		const STEP = 150;
		const STALL_LIMIT = 4000;
		const timer = setInterval(() => {
			const total = renderer.queue.total;
			const done = renderer.queue.completed;
			if (onProgress) onProgress(done, total);
			if (renderer.queueSize === 0) {
				clearInterval(timer);
				resolve();
				return;
			}
			if (done === lastDone) stalledMs += STEP;
			else { stalledMs = 0; lastDone = done; }
			if (stalledMs >= STALL_LIMIT) {
				clearInterval(timer);
				resolve();
			}
		}, STEP);
	});
}

function buildStartPage() {
	const grid = $id("template-grid");
	TEMPLATES.forEach((t, i) => {
		const card = document.createElement("button");
		card.type = "button";
		card.className = "template-card";
		card.style.animationDelay = `${i * 50}ms`;
		const thumb = t.template
			? `<div class="template-thumb baseplate">${icon("baseplate")}</div>`
			: `<div class="template-thumb" style="background-image:url('${t.img}')"></div>`;
		card.innerHTML = `${thumb}<div class="template-meta"><div class="template-name"></div><div class="template-sub"></div></div>`;
		card.querySelector(".template-name").textContent = t.name;
		card.querySelector(".template-sub").textContent = t.sub;
		card.addEventListener("click", () => openPlace(t.template ? { template: true, name: t.name } : { url: t.url }));
		grid.appendChild(card);
	});
	$id("open-remote").addEventListener("click", openRemoteDialog);
	$id("browse").addEventListener("change", (e) => {
		const file = e.target.files[0];
		e.target.value = "";
		if (file) openPlace({ file });
	});
}

/* ---------- Dialogs ---------- */

function showDialog(dlg, onClose) {
	const close = () => {
		dlg.removeEventListener("close", close);
		if (dlg.open) dlg.close();
		if (onClose) onClose();
	};
	dlg.addEventListener("close", close);
	for (const btn of dlg.querySelectorAll(".close, .ok, .cancel")) btn.onclick = () => dlg.close();
	dlg.showModal();
}

function openRemoteDialog() {
	const dlg = $id("remoteload");
	const input = $id("remotepath");
	const openBtn = dlg.querySelector(".open");
	const list = $id("examples");
	list.innerHTML = "";
	for (const path of EXAMPLES) {
		const li = document.createElement("li");
		li.setAttribute("role", "option");
		li.textContent = path;
		li.addEventListener("click", () => {
			input.value = path;
			for (const other of list.children) other.setAttribute("aria-selected", String(other === li));
			openBtn.disabled = false;
		});
		li.addEventListener("dblclick", () => submit());
		list.appendChild(li);
	}
	input.value = "";
	openBtn.disabled = true;
	const submit = () => {
		const path = input.value.trim();
		if (!path) return;
		dlg.close();
		openPlace({ url: path });
	};
	input.oninput = () => { openBtn.disabled = input.value.trim().length === 0; };
	input.onkeyup = (e) => { if (e.key === "Enter") submit(); };
	openBtn.onclick = submit;
	showDialog(dlg);
	input.focus();
}

function openRenderDialog() {
	if (!placeLoaded) return;
	const dlg = $id("render");
	const img = dlg.querySelector("img");
	const width = $id("renderwidth");
	const height = $id("renderheight");
	width.value = renderer.conf.width;
	height.value = renderer.conf.height;
	rendering = false;
	$id("dorender").onclick = () => {
		img.src = renderer.renderImage(Number(width.value) || renderer.conf.width, Number(height.value) || renderer.conf.height);
		print(`Rendered ${width.value}x${height.value} image`);
	};
	showDialog(dlg, () => {
		img.removeAttribute("src");
		rendering = activeDoc === "place";
	});
}

function openNotepad(fileName, text) {
	const dlg = $id("notepad");
	dlg.querySelector("#dialog-title").textContent = `${fileName} - Notepad`;
	dlg.querySelector("textarea").value = text;
	if (dlg.open) dlg.close();
	showDialog(dlg);
}

function openExperienceSettings() {
	const dlg = $id("experience");
	const radios = [...dlg.querySelectorAll('input[name="exp-rigtype"]')];
	const { avatarRigType } = getExperienceSettings();
	for (const radio of radios) radio.checked = radio.value === avatarRigType;
	dlg.querySelector(".save").onclick = () => {
		const choice = radios.find((r) => r.checked)?.value || avatarRigType;
		setExperienceSettings({ avatarRigType: choice });
		print(`Configuração da experiência: avatar ${choice}${isPlayMode ? " (vale a partir do próximo Play)" : " - dê Play para jogar com ele"}`);
		toast(`Avatar da experiência: ${choice}`);
		dlg.close();
	};
	showDialog(dlg);
}

function openAbout() {
	const dlg = $id("about");
	dlg.querySelector(".view-notice").onclick = () => {
		dlg.close();
		openNotepad("notice.txt", `Studio Lite is built upon MrSprinkleToes' rbxBinaryParser [https://github.com/MrSprinkleToes/rbxBinaryParser].
Additionally, some code from roblox-in-webbrowser [https://github.com/MrSprinkleToes/roblox-in-webbrowser] and roblox-web-viewer [https://github.com/MrSprinkleToes/roblox-web-viewer] is used.
Please see the README for more information.

The THREE.js library [https://threejs.org] is used for rendering the game view.
The THREE.js add-ons TransformControls and Stats are also included within the application.

jsTree [https://www.jstree.com] is used for displaying interactive trees in the Explorer and Properties views.

Roblox Studio icons and other assets stored within the content/ directory, as well as the favicon.ico, are Copyright © Roblox Corporation.
The assets saved within the asset/ directory and the example files in examples/ are copyright of their respective owners.

Studio Lite is not affiliated in any way, shape or form with Roblox Corporation.`);
	};
	showDialog(dlg);
}

function openChangelog() {
	openNotepad("changelog.txt", `Studio Lite Changelog

New in alpha-2:
- Light theme UI modeled after Roblox Studio: ribbon, Toolbox, Explorer, Properties, Output.
- Resizable and closable panels (layout is remembered).
- Select / Move / Scale / Rotate tools with gizmos, model selection, arrow-key nudging.
- Insert parts and models from the Toolbox (click or drag into the viewport).
- Material, Color, Group, Lock and Anchor editing.
- Categorized, filterable Properties; filterable Explorer; Output with an Errors tab and a command bar.

New in alpha-1:
- Initial release.`);
}

/* ---------- Global shortcuts ---------- */

document.addEventListener("keydown", (e) => {
	// Roblox Studio: F5 = Play, Shift+F5 = Stop.
	if (e.key === "F5" && !e.ctrlKey && !e.metaKey && placeLoaded) {
		e.preventDefault();
		if (e.shiftKey) stop();
		else play();
		return;
	}
	if (isPlayMode) return;
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyX") {
		e.preventDefault();
		layout.setVisible("explorer", true);
		setExplorerView("datamodel");
		$id("explorer-filter").focus();
		return;
	}
	if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyP") {
		e.preventDefault();
		layout.setVisible("properties", true);
		$id("properties-filter").focus();
		return;
	}
	if (isTypingTarget(e.target) || isDialogOpen()) return;
	if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey && placeLoaded) zoomToSelection();
	if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && placeLoaded && !e.repeat) {
		// Leave native copy alone when the user has text highlighted (Output, Properties…)
		const textSelected = String(window.getSelection?.() || "").length > 0;
		if (e.code === "KeyC" && !textSelected) { e.preventDefault(); copySelection(false); }
		else if (e.code === "KeyX" && !textSelected) { e.preventDefault(); copySelection(true); }
		else if (e.code === "KeyV") { e.preventDefault(); pasteClipboard(); }
		else if (e.code === "KeyD") { e.preventDefault(); duplicateSelection(); }
	}
});

window.addEventListener("resize", () => renderer.resize());

/* ---------- Boot ---------- */

output.attachCommandBar($id("command-input"), { renderer, print, tools, layout, playMode, animEditor });
window.studio = { renderer, print, tools, layout, playMode, animEditor, gui };
buildStartPage();
setTitle("Start Page");
applyViewState();
updatePanelState();
updateRibbon();
updateHud();
print("Welcome to Studio Lite (alpha-2)!");

// ?place=path/to/file.rbxl opens a place hosted next to the app straight away.
const placeParam = new URLSearchParams(location.search).get("place");
if (placeParam) openPlace({ url: placeParam });
