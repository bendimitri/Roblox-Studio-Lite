import { icon } from './icons.js';
import { color3ToHex, hexToColor3 } from '../rendering/Materials.js';

const clampRange = (n, min, max) => Math.min(max, Math.max(min, n));
const roundTo = (n, p = 1000) => Math.round(n * p) / p;

/** First signed decimal in free text, or null when there's no number (blocks stray letters). */
function parseNum(text) {
	const m = String(text).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/i);
	return m ? parseFloat(m[0]) : null;
}

const fmtNum = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : String(roundTo(Number(v))));
const asColor255 = (c) => {
	if (!c) return "0, 0, 0";
	const norm = c.R > 1 || c.G > 1 || c.B > 1 ? { R: c.R / 255, G: c.G / 255, B: c.B / 255 } : c;
	return `${Math.round(norm.R * 255)}, ${Math.round(norm.G * 255)}, ${Math.round(norm.B * 255)}`;
};
const colorHex = (c) => {
	if (!c) return "#000000";
	const norm = c.R > 1 || c.G > 1 || c.B > 1 ? { R: c.R / 255, G: c.G / 255, B: c.B / 255 } : c;
	return color3ToHex(norm);
};

const HIDDEN = new Set(["Children", "Source", "CollisionGroupData", "PhysicsGrid", "SmoothGrid", "MaterialColors", "AttributesSerialize", "Tags", "DefinesCapabilities", "MaterialVariantSerialized", "FormFactorRaw", "children", "parent", "userData", "_baseplateGrid"]);

const ORDER = ["Data", "Humanoid", "Joint", "Appearance", "Text", "Image", "Behavior", "Transform", "Part", "Collision", "Surface", "Environment", "Other"];

const EXACT = {
	Data: ["ClassName", "Name", "UniqueId", "Parent", "PrimaryPart", "type", "name", "id", "uuid", "ZIndex", "LayoutOrder", "DisplayOrder"],
	Text: ["Text", "TextColor3", "TextTransparency", "TextSize", "Font", "TextXAlignment", "TextYAlignment", "TextWrapped", "TextScaled", "RichText", "LineHeight", "TextStrokeColor3", "TextStrokeTransparency"],
	Image: ["Image", "ImageColor3", "ImageTransparency", "ScaleType", "HoverImage", "PressedImage"],
	Humanoid: ["RigType", "DisplayName", "Health", "MaxHealth", "WalkSpeed", "JumpPower", "JumpHeight", "UseJumpPower", "HipHeight", "AutoRotate", "RequiresNeck", "BreakJointsOnDeath", "DisplayDistanceType", "HealthDisplayType", "Animator", "Motor6D", "Keyframes"],
	Joint: ["Part0", "Part1", "C0", "C1", "CurrentAngle", "DesiredAngle", "MaxVelocity", "JointOffset", "JointRotation"],
	Appearance: ["BrickColor", "Color", "Color3", "Material", "MaterialVariant", "Reflectance", "Transparency", "CastShadow", "Texture", "TextureId", "MeshId", "Face", "StudsPerTileU", "StudsPerTileV", "TintColor", "VertexColor", "color", "intensity", "visible", "castShadow", "receiveShadow", "renderOrder", "Visible", "BackgroundColor3", "BackgroundTransparency", "BorderColor3", "BorderSizePixel", "BorderMode"],
	Behavior: ["Active", "Interactable", "AutoButtonColor", "Modal", "Selected", "ClipsDescendants", "IgnoreGuiInset", "ClipToDeviceSafeArea", "ZIndexBehavior", "ScreenInsets", "Anchored", "Archivable", "CanCollide", "CanQuery", "CanTouch", "Locked", "Massless", "Disabled", "Enabled", "RunContext", "ResetOnSpawn", "AudioCanCollide", "EnableFluidForces", "RootPriority", "frustumCulled", "matrixAutoUpdate"],
	Transform: ["AnchorPoint", "CFrame", "CoordinateFrame", "Position", "Orientation", "Size", "Rotation", "PivotOffset", "Origin", "WorldPivot", "Velocity", "RotVelocity", "position", "rotation", "scale", "quaternion", "up"],
	Part: ["Shape", "FormFactor", "MeshType", "Scale", "Offset"],
	Collision: ["CollisionGroup", "CollisionGroupId", "CustomPhysicalProperties", "Elasticity", "Friction"]
};

const EXACT_LOOKUP = new Map();
for (const [cat, keys] of Object.entries(EXACT)) for (const k of keys) EXACT_LOOKUP.set(k, cat);

function categorize(key) {
	if (EXACT_LOOKUP.has(key)) return EXACT_LOOKUP.get(key);
	if (/Surface(Input)?$|Param[AB]$/.test(key)) return "Surface";
	if (/^(Fog|Clock|Geographic|TimeOfDay|Ambient|OutdoorAmbient|Brightness|ColorShift|Exposure|EnvironmentDiffuse|EnvironmentSpecular|GlobalShadows|ShadowSoftness|Technology)/.test(key)) return "Environment";
	return "Other";
}

const round = (n) => {
	if (!Number.isFinite(n)) return String(n);
	return String(Math.round(n * 1000) / 1000);
};

function isVector(v) {
	return v && typeof v === "object" && (("X" in v && "Y" in v) || ("x" in v && "y" in v));
}

function isColor(v) {
	return v && typeof v === "object" && "R" in v && "G" in v && "B" in v;
}

/** Euler angles (degrees, Roblox YXZ order) from a CFrame rotation matrix. */
function orientationFromComponents(c) {
	const r02 = c[5], r10 = c[6], r11 = c[7], r12 = c[8], r22 = c[11];
	const x = Math.asin(Math.max(-1, Math.min(1, -r12)));
	const y = Math.atan2(r02, r22);
	const z = Math.atan2(r10, r11);
	return [x, y, z].map((a) => Math.round((a * 180 / Math.PI) * 1000) / 1000);
}

function describe(key, value) {
	if (value === null || value === undefined) return { text: "nil", muted: true };
	if (typeof value === "boolean") return { check: value };
	if (typeof value === "number") return { text: round(value) };
	if (typeof value === "string") return { text: value === "" ? "\u00a0" : value };
	if (value.isUDim2) return { text: value.toString() };
	if (isColor(value)) {
		const color = value.R > 1 || value.G > 1 || value.B > 1
			? { R: value.R / 255, G: value.G / 255, B: value.B / 255 }
			: value;
		return { swatch: color3ToHex(color), text: `${Math.round(color.R * 255)}, ${Math.round(color.G * 255)}, ${Math.round(color.B * 255)}` };
	}
	if (value.isColor) return { swatch: `#${value.getHexString()}`, text: `#${value.getHexString()}` };
	if (value.Color && isColor(value.Color)) {
		const c = value.Color;
		const norm = c.R > 1 || c.G > 1 || c.B > 1 ? { R: c.R / 255, G: c.G / 255, B: c.B / 255 } : c;
		return { swatch: color3ToHex(norm), text: value.Name || `${c.R}, ${c.G}, ${c.B}` };
	}
	if (value.Position && isVector(value.Position)) {
		const p = value.Position;
		return { text: `${round(p.X)}, ${round(p.Y)}, ${round(p.Z)}` };
	}
	if (isVector(value)) {
		const x = value.X ?? value.x, y = value.Y ?? value.y, z = value.Z ?? value.z;
		return { text: z === undefined ? `${round(x)}, ${round(y)}` : `${round(x)}, ${round(y)}, ${round(z)}` };
	}
	if (value.isEuler) return { text: `${round(value.x * 180 / Math.PI)}°, ${round(value.y * 180 / Math.PI)}°, ${round(value.z * 180 / Math.PI)}°` };
	if (Array.isArray(value)) return { text: `[${value.length} items]`, muted: true };
	if (value.isObject3D) return { text: value.name || value.type };
	try {
		const json = JSON.stringify(value);
		return { text: json.length > 80 ? json.slice(0, 77) + "…" : json, title: json, muted: true };
	} catch (ignored) {
		return { text: "{…}", muted: true };
	}
}

/**
 * Renders categorized, filterable two-column property grids.
 */
export class PropertiesView {
	constructor({ container, title, filter }) {
		this.container = container;
		this.title = title;
		this.filter = filter;
		this.collapsed = new Set(JSON.parse(localStorage.getItem("studiolite.props.collapsed") || "[]"));
		this.filter.addEventListener("input", () => this._applyFilter());
	}

	clear() {
		this.controls = null;
		this._schemaRows = null;
		this.title.textContent = "Properties";
		this.container.innerHTML = `<p class="empty-state">Select an object to see its properties.</p>`;
	}

	setAllCollapsed(collapsed) {
		this.collapsed = new Set(collapsed ? ORDER : []);
		this._persist();
		for (const group of this.container.querySelectorAll(".prop-group")) group.classList.toggle("collapsed", collapsed);
	}

	/**
	 * @param {string} heading e.g. `Part "Baseplate"`
	 * @param {Record<string, any>} entries key/value pairs (order is kept inside categories)
	 * @param {{ editors?: Record<string, PropertyEditor> }} [options] editable rows, bound both ways:
	 *        the input writes through `set`, and refreshValues() pulls `get` back into the inputs.
	 *
	 * @typedef {{ type: "string"|"number"|"int"|"float01"|"bool"|"enum"|"Color3"|"UDim2"|"Vector2", options?: string[], get: () => any, set: (value: any) => void }} PropertyEditor
	 */
	show(heading, entries, { editors = {} } = {}) {
		this.title.textContent = `Properties - ${heading}`;
		this.controls = [];
		this._schemaRows = null;
		const groups = new Map();
		for (const [key, value] of Object.entries(entries)) {
			if (HIDDEN.has(key) || typeof value === "function") continue;
			const cat = categorize(key);
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat).push([key, value]);
		}

		const table = document.createElement("table");
		table.className = "prop-table";
		table.innerHTML = `<colgroup><col class="prop-col-name"><col></colgroup>`;
		for (const cat of ORDER) {
			const rows = groups.get(cat);
			if (!rows) continue;
			if (cat === "Data") rows.sort((a, b) => EXACT.Data.indexOf(a[0]) - EXACT.Data.indexOf(b[0]));
			else rows.sort((a, b) => a[0].localeCompare(b[0]));
			const body = document.createElement("tbody");
			body.className = "prop-group" + (this.collapsed.has(cat) ? " collapsed" : "");
			body.dataset.category = cat;
			body.innerHTML = `<tr class="prop-head"><th colspan="2"><button type="button">${icon("chevron")}<span></span></button></th></tr>`;
			body.querySelector("span").textContent = cat;
			body.querySelector("button").addEventListener("click", () => {
				const collapsed = body.classList.toggle("collapsed");
				if (collapsed) this.collapsed.add(cat);
				else this.collapsed.delete(cat);
				this._persist();
			});
			for (const [key, value] of rows) body.appendChild(this._row(key, value, editors[key]));
			table.appendChild(body);
		}
		this.container.innerHTML = "";
		this.container.appendChild(table);
		this._applyFilter();
	}

	/** Roblox instance: adds derived Position / Orientation rows from its CFrame. */
	showInstance(instance, parentName) {
		const entries = { ...instance };
		if (parentName !== undefined) entries.Parent = parentName;
		const cf = instance.CFrame || instance.CoordinateFrame;
		if (cf && cf.Position) {
			entries.Position = cf.Position;
			if (Array.isArray(cf.Components) && cf.Components.length >= 12) {
				const [x, y, z] = orientationFromComponents(cf.Components);
				entries.Orientation = { X: x, Y: y, Z: z };
			}
		}
		this.show(`${instance.ClassName} "${instance.Name}"`, entries);
	}

	/** Pulls the current values of editable rows back into their inputs (skips the focused one). */
	refreshValues() {
		if (!this.controls) return;
		for (const control of this.controls) control.update();
	}

	/**
	 * Dynamic, API-faithful renderer driven by a schema (see RobloxAPIProperties.js).
	 * @param {string} heading e.g. `Part "MySphere"`
	 * @param {{name: string, props: object[]}[]} groups ordered property groups
	 * @param {(prop: object) => (Descriptor|null)} bind builds a bound descriptor per schema prop
	 *
	 * @typedef {object} Descriptor
	 * @property {string} key display name
	 * @property {string} type bool|enum|string|number|int|float01|Color3|BrickColor|path|primarypart|Vector3|CFrame
	 * @property {string[]} [options] for enum
	 * @property {number} [min] @property {number} [max]
	 * @property {boolean} [readOnly]
	 * @property {() => any} get @property {(v:any)=>void} [set]
	 * @property {() => void} [onPick] for primarypart click
	 */
	showSchema(heading, groups, bind) {
		this.title.textContent = `Properties - ${heading}`;
		this.controls = [];
		this._schemaRows = [];

		const table = document.createElement("table");
		table.className = "prop-table";
		table.innerHTML = `<colgroup><col class="prop-col-name"><col></colgroup>`;
		for (const group of groups) {
			const descriptors = [];
			for (const prop of group.props) {
				const desc = bind(prop);
				if (desc) descriptors.push(desc);
			}
			if (!descriptors.length) continue;
			const body = document.createElement("tbody");
			body.className = "prop-group" + (this.collapsed.has(group.name) ? " collapsed" : "");
			body.dataset.category = group.name;
			body.innerHTML = `<tr class="prop-head"><th colspan="2"><button type="button">${icon("chevron")}<span></span></button></th></tr>`;
			body.querySelector("span").textContent = group.name;
			body.querySelector("button").addEventListener("click", () => {
				const collapsed = body.classList.toggle("collapsed");
				if (collapsed) this.collapsed.add(group.name);
				else this.collapsed.delete(group.name);
				this._persist();
			});
			for (const desc of descriptors) this._schemaRow(body, desc, 0, desc.key, null);
			table.appendChild(body);
		}
		this.container.innerHTML = "";
		this.container.appendChild(table);
		this._applyFilter();
	}

	/** Recursively appends a schema row (and its children for Vector3 / CFrame). */
	_schemaRow(body, desc, depth, path, parent) {
		const tr = document.createElement("tr");
		tr.className = "prop-row";
		tr.dataset.key = path.toLowerCase();
		tr.dataset.depth = String(depth);
		const children = this._childDescriptors(desc);

		const name = document.createElement("td");
		name.className = "prop-name";
		const pad = 8 + depth * 14;
		name.style.paddingLeft = (children ? pad : pad + 14) + "px";
		let toggle = null;
		if (children) {
			toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "prop-expand";
			toggle.innerHTML = icon("chevron");
			name.appendChild(toggle);
		}
		const label = document.createElement("span");
		label.textContent = desc.key;
		label.title = desc.key;
		name.appendChild(label);

		const cell = document.createElement("td");
		cell.appendChild(this._schemaEditor(desc));
		tr.append(name, cell);
		body.appendChild(tr);

		const record = { tr, parent, open: false, childRows: [] };
		this._schemaRows.push(record);

		if (children) {
			tr.classList.add("has-children");
			for (const child of children) {
				const childRows = this._schemaRow(body, child, depth + 1, `${path} ${child.key}`, record);
				record.childRows.push(childRows);
			}
			const setOpen = (open) => {
				record.open = open;
				tr.classList.toggle("open", open);
				for (const cr of record.childRows) cr.tr.hidden = !open || tr.hidden;
			};
			toggle.addEventListener("click", () => setOpen(!record.open));
			setOpen(false);
		}
		return record;
	}

	/** Expands composite types into leaf descriptors. */
	_childDescriptors(desc) {
		if (desc.type === "Vector3") {
			return ["X", "Y", "Z"].map((axis) => ({
				key: axis,
				type: "number",
				readOnly: desc.readOnly,
				get: () => (desc.get() || {})[axis],
				set: desc.readOnly ? undefined : (n) => { const v = { ...(desc.get() || { X: 0, Y: 0, Z: 0 }) }; v[axis] = n; desc.set(v); }
			}));
		}
		if (desc.type === "CFrame") {
			return [
				{
					key: "Position", type: "Vector3", readOnly: desc.readOnly,
					get: () => (desc.get() || {}).position || { X: 0, Y: 0, Z: 0 },
					set: desc.readOnly ? undefined : (v) => desc.setPosition(v)
				},
				{
					key: "Orientation", type: "Vector3", readOnly: desc.readOnly,
					get: () => (desc.get() || {}).orientation || { X: 0, Y: 0, Z: 0 },
					set: desc.readOnly ? undefined : (v) => desc.setOrientation(v)
				}
			];
		}
		return null;
	}

	/** Builds the value-cell editor for a single descriptor, registering it for refreshValues(). */
	_schemaEditor(desc) {
		const wrap = document.createElement("div");
		wrap.className = "prop-value prop-edit";
		let update = () => {};

		if (desc.type === "bool") {
			const box = document.createElement("span");
			box.className = "prop-check-box";
			box.setAttribute("role", "checkbox");
			box.tabIndex = desc.readOnly ? -1 : 0;
			const toggle = () => { if (desc.readOnly) return; desc.set(!desc.get()); update(); };
			box.addEventListener("click", toggle);
			box.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } });
			wrap.appendChild(box);
			update = () => box.classList.toggle("checked", !!desc.get());
		} else if (desc.type === "enum") {
			const select = document.createElement("select");
			select.className = "prop-select";
			select.disabled = !!desc.readOnly;
			for (const opt of desc.options || []) select.add(new Option(opt, opt));
			select.addEventListener("change", () => { desc.set(select.value); update(); });
			wrap.appendChild(select);
			update = () => { if (document.activeElement !== select) select.value = desc.get(); };
		} else if (desc.type === "Color3" || desc.type === "BrickColor") {
			const swatch = document.createElement("input");
			swatch.type = "color";
			swatch.className = "prop-color";
			swatch.disabled = desc.type === "BrickColor" || !!desc.readOnly;
			const text = document.createElement("span");
			text.className = "prop-color-text";
			if (!swatch.disabled) swatch.addEventListener("input", () => { desc.set(swatch.value); update(); });
			wrap.append(swatch, text);
			update = () => {
				const v = desc.get();
				if (document.activeElement !== swatch) swatch.value = colorHex(v);
				text.textContent = desc.type === "BrickColor" ? (desc.label ? desc.label() : asColor255(v)) : `[${asColor255(v)}]`;
			};
		} else if (desc.type === "primarypart") {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "prop-link";
			btn.addEventListener("click", () => { if (desc.onPick) desc.onPick(); });
			wrap.appendChild(btn);
			update = () => { const v = desc.get(); btn.textContent = v || "nil"; btn.classList.toggle("muted", !v); };
		} else if (desc.type === "path" || desc.readOnly) {
			const span = document.createElement("span");
			span.className = "prop-ro";
			wrap.appendChild(span);
			update = () => { const v = desc.get(); span.textContent = (v === null || v === undefined || v === "") ? "\u00a0" : String(v); span.title = span.textContent; };
		} else {
			const input = document.createElement("input");
			input.type = "text";
			input.className = "prop-input";
			input.spellcheck = false;
			const numeric = ["number", "int", "float01"].includes(desc.type);
			const vector = desc.type === "Vector3";
			if (numeric) input.inputMode = "decimal";
			const format = () => {
				const v = desc.get();
				if (vector) { const o = v || {}; return `${fmtNum(o.X)}, ${fmtNum(o.Y)}, ${fmtNum(o.Z)}`; }
				if (numeric) return fmtNum(v);
				return v === null || v === undefined ? "" : String(v);
			};
			const commit = () => {
				if (vector) {
					const nums = input.value.split(",").map((s) => parseNum(s));
					const o = desc.get() || { X: 0, Y: 0, Z: 0 };
					desc.set({ X: nums[0] ?? o.X, Y: nums[1] ?? o.Y, Z: nums[2] ?? o.Z });
				} else if (numeric) {
					let n = parseNum(input.value);
					if (n === null) { input.value = format(); return; }
					if (desc.type === "int") n = Math.round(n);
					if (desc.type === "float01") n = clampRange(n, 0, 1);
					if (desc.min !== undefined) n = Math.max(desc.min, n);
					if (desc.max !== undefined) n = Math.min(desc.max, n);
					desc.set(n);
				} else {
					desc.set(input.value);
				}
				input.value = format();
			};
			input.addEventListener("change", commit);
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); input.blur(); }
				else if (e.key === "Escape") { input.value = format(); input.blur(); }
			});
			wrap.appendChild(input);
			update = () => { if (document.activeElement !== input) input.value = format(); };
		}

		update();
		this.controls.push({ update });
		return wrap;
	}

	_row(key, value, editor) {
		const tr = document.createElement("tr");
		tr.className = "prop-row";
		tr.dataset.key = key.toLowerCase();
		const name = document.createElement("td");
		name.textContent = key;
		name.title = key;
		const cell = document.createElement("td");
		if (editor) {
			tr.classList.add("editable");
			cell.appendChild(this._editor(key, editor));
			tr.append(name, cell);
			return tr;
		}
		const wrap = document.createElement("div");
		wrap.className = "prop-value";
		const d = describe(key, value);
		if (d.check !== undefined) {
			wrap.innerHTML = `<span class="prop-check${d.check ? " checked" : ""}" role="img" aria-label="${d.check}"></span>`;
		} else {
			if (d.swatch) wrap.insertAdjacentHTML("beforeend", `<span class="prop-swatch" style="background:${d.swatch}"></span>`);
			const text = document.createElement("span");
			text.textContent = d.text;
			wrap.appendChild(text);
			wrap.title = d.title || d.text;
			if (d.muted) wrap.classList.add("muted");
		}
		cell.appendChild(wrap);
		tr.append(name, cell);
		return tr;
	}

	_editor(key, editor) {
		const wrap = document.createElement("div");
		wrap.className = "prop-value prop-edit";
		const focused = () => wrap.contains(document.activeElement);
		let update;

		if (editor.type === "bool") {
			const box = document.createElement("input");
			box.type = "checkbox";
			box.className = "prop-checkbox";
			box.setAttribute("aria-label", key);
			box.addEventListener("change", () => {
				editor.set(box.checked);
				update();
			});
			wrap.appendChild(box);
			update = () => { box.checked = !!editor.get(); };
		} else if (editor.type === "enum") {
			const select = document.createElement("select");
			select.className = "prop-select";
			select.setAttribute("aria-label", key);
			for (const option of editor.options || []) select.add(new Option(option, option));
			select.addEventListener("change", () => {
				editor.set(select.value);
				update();
			});
			wrap.appendChild(select);
			update = () => { if (!focused()) select.value = editor.get(); };
		} else {
			let swatch = null;
			if (editor.type === "Color3") {
				swatch = document.createElement("input");
				swatch.type = "color";
				swatch.className = "prop-color";
				swatch.setAttribute("aria-label", `${key} (cor)`);
				swatch.addEventListener("input", () => editor.set(swatch.value));
				wrap.appendChild(swatch);
			}
			const input = document.createElement("input");
			input.type = "text";
			input.className = "prop-input";
			input.spellcheck = false;
			input.setAttribute("aria-label", key);
			if (["number", "int", "float01"].includes(editor.type)) input.inputMode = "decimal";
			const format = (v) => {
				if (v === null || v === undefined) return "";
				if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
				return String(v);
			};
			const commit = () => {
				editor.set(input.value);
				input.value = format(editor.get());
			};
			input.addEventListener("change", commit);
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					input.blur();
				} else if (e.key === "Escape") {
					input.value = format(editor.get());
					input.blur();
				}
			});
			wrap.appendChild(input);
			update = () => {
				const v = editor.get();
				if (swatch && document.activeElement !== swatch) swatch.value = v && v.toHex ? v.toHex() : "#000000";
				if (document.activeElement !== input) input.value = format(v);
			};
		}
		update();
		this.controls.push({ update });
		return wrap;
	}

	_applyFilter() {
		if (this._schemaRows) return this._applyFilterSchema();
		const q = this.filter.value.trim().toLowerCase();
		for (const group of this.container.querySelectorAll(".prop-group")) {
			let visible = 0;
			for (const row of group.querySelectorAll(".prop-row")) {
				const match = !q || row.dataset.key.includes(q);
				row.hidden = !match;
				if (match) row.classList.toggle("zebra", visible++ % 2 === 1);
			}
			group.hidden = visible === 0;
			if (q && visible > 0) group.classList.remove("collapsed");
			else if (!q) group.classList.toggle("collapsed", this.collapsed.has(group.dataset.category));
		}
	}

	/** Filter for nested schema rows: respects collapse when empty, reveals matches + ancestors when searching. */
	_applyFilterSchema() {
		const q = this.filter.value.trim().toLowerCase();
		for (const rec of this._schemaRows) {
			if (!q) {
				let open = true;
				for (let p = rec.parent; p; p = p.parent) if (!p.open) { open = false; break; }
				rec.tr.hidden = !open;
			} else {
				const selfMatch = rec.tr.dataset.key.includes(q);
				let show = selfMatch;
				if (!show) for (const descendant of this._schemaRows) {
					if (descendant === rec) continue;
					if (descendant.tr.dataset.key.includes(q)) {
						for (let p = descendant.parent; p; p = p.parent) if (p === rec) { show = true; break; }
					}
					if (show) break;
				}
				rec.tr.hidden = !show;
			}
		}
		for (const group of this.container.querySelectorAll(".prop-group")) {
			let visible = 0;
			for (const row of group.querySelectorAll(".prop-row")) if (!row.hidden) row.classList.toggle("zebra", visible++ % 2 === 1);
			group.hidden = visible === 0;
			if (q && visible > 0) group.classList.remove("collapsed");
			else if (!q) group.classList.toggle("collapsed", this.collapsed.has(group.dataset.category));
		}
	}

	_persist() {
		localStorage.setItem("studiolite.props.collapsed", JSON.stringify([...this.collapsed]));
	}
}
