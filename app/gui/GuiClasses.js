import { UDim, UDim2, Vector2, Color3 } from "./UDim2.js";

/*
 * StarterGui class tree (Roblox reflection, trimmed):
 *
 *   GuiBase ─┬─ ScreenGui                       (only ScreenGuis may sit directly in StarterGui)
 *            └─ GuiObject ─┬─ Frame
 *                          ├─ TextLabel  ── TextButton
 *                          └─ ImageLabel ── ImageButton
 *
 * Instances stay plain DataModel records (ClassName, Name, Children…) so the Explorer and
 * the place loader keep working, but every schema property is a reactive accessor and
 * Children is a reactive array: any write notifies the GUI engine, which re-renders the DOM.
 */

/** Roblox Enum.Font value order (binary places store the number). */
const FONT_ENUM = [
	"Legacy", "Arial", "ArialBold", "SourceSans", "SourceSansBold", "SourceSansLight", "SourceSansItalic", "Bodoni", "Garamond",
	"Cartoon", "Code", "Highway", "SciFi", "Arcade", "Fantasy", "Antique", "SourceSansSemibold", "Gotham", "GothamMedium",
	"GothamBold", "GothamBlack", "AmaticSC", "Bangers", "Creepster", "DenkOne", "Fondamento", "FredokaOne", "GrenzeGotisch",
	"IndieFlower", "JosefinSans", "Jura", "Kalam", "LuckiestGuy", "Merriweather", "Michroma", "Nunito", "Oswald", "PatrickHand",
	"PermanentMarker", "Roboto", "RobotoCondensed", "RobotoMono", "Sarpanch", "SpecialElite", "TitilliumWeb", "Ubuntu"
];

/** Roblox font -> web font (Google Fonts family, weight, style). */
export const FONTS = {
	Legacy: { family: "Arial", fallback: "sans-serif", weight: 400 },
	Arial: { family: "Arial", fallback: "sans-serif", weight: 400 },
	ArialBold: { family: "Arial", fallback: "sans-serif", weight: 700 },
	SourceSans: { family: "Source Sans 3", google: "Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400", weight: 400 },
	SourceSansLight: { family: "Source Sans 3", google: "Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400", weight: 300 },
	SourceSansSemibold: { family: "Source Sans 3", google: "Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400", weight: 600 },
	SourceSansBold: { family: "Source Sans 3", google: "Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400", weight: 700 },
	SourceSansItalic: { family: "Source Sans 3", google: "Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400", weight: 400, style: "italic" },
	Gotham: { family: "Montserrat", google: "Montserrat:ital,wght@0,400;0,500;0,700;0,800;0,900;1,800", weight: 400 },
	GothamMedium: { family: "Montserrat", google: "Montserrat:ital,wght@0,400;0,500;0,700;0,800;0,900;1,800", weight: 500 },
	GothamBold: { family: "Montserrat", google: "Montserrat:ital,wght@0,400;0,500;0,700;0,800;0,900;1,800", weight: 700 },
	GothamBlack: { family: "Montserrat", google: "Montserrat:ital,wght@0,400;0,500;0,700;0,800;0,900;1,800", weight: 900 },
	Bodoni: { family: "Bodoni Moda", google: "Bodoni+Moda:wght@400;700", fallback: "serif", weight: 400 },
	Garamond: { family: "EB Garamond", google: "EB+Garamond:wght@400;700", fallback: "serif", weight: 400 },
	Cartoon: { family: "Comic Neue", google: "Comic+Neue:wght@400;700", weight: 700 },
	Code: { family: "Inconsolata", google: "Inconsolata:wght@400;700", fallback: "monospace", weight: 400 },
	Highway: { family: "Exo 2", google: "Exo+2:wght@400;700", weight: 400 },
	SciFi: { family: "Orbitron", google: "Orbitron:wght@400;700", weight: 400 },
	Arcade: { family: "Press Start 2P", google: "Press+Start+2P", fallback: "monospace", weight: 400 },
	Fantasy: { family: "Cinzel Decorative", google: "Cinzel+Decorative:wght@400;700", fallback: "serif", weight: 400 },
	Antique: { family: "IM Fell English", google: "IM+Fell+English", fallback: "serif", weight: 400 },
	AmaticSC: { family: "Amatic SC", google: "Amatic+SC:wght@400;700", weight: 700 },
	Bangers: { family: "Bangers", google: "Bangers", weight: 400 },
	Creepster: { family: "Creepster", google: "Creepster", weight: 400 },
	DenkOne: { family: "Denk One", google: "Denk+One", weight: 400 },
	Fondamento: { family: "Fondamento", google: "Fondamento", fallback: "serif", weight: 400 },
	FredokaOne: { family: "Fredoka", google: "Fredoka:wght@400;600", weight: 600 },
	GrenzeGotisch: { family: "Grenze Gotisch", google: "Grenze+Gotisch:wght@400;700", fallback: "serif", weight: 400 },
	IndieFlower: { family: "Indie Flower", google: "Indie+Flower", fallback: "cursive", weight: 400 },
	JosefinSans: { family: "Josefin Sans", google: "Josefin+Sans:wght@400;700", weight: 400 },
	Jura: { family: "Jura", google: "Jura:wght@400;700", weight: 400 },
	Kalam: { family: "Kalam", google: "Kalam:wght@400;700", fallback: "cursive", weight: 400 },
	LuckiestGuy: { family: "Luckiest Guy", google: "Luckiest+Guy", weight: 400 },
	Merriweather: { family: "Merriweather", google: "Merriweather:wght@400;700", fallback: "serif", weight: 400 },
	Michroma: { family: "Michroma", google: "Michroma", weight: 400 },
	Nunito: { family: "Nunito", google: "Nunito:wght@400;700", weight: 400 },
	Oswald: { family: "Oswald", google: "Oswald:wght@400;700", weight: 400 },
	PatrickHand: { family: "Patrick Hand", google: "Patrick+Hand", fallback: "cursive", weight: 400 },
	PermanentMarker: { family: "Permanent Marker", google: "Permanent+Marker", fallback: "cursive", weight: 400 },
	Roboto: { family: "Roboto", google: "Roboto:wght@400;700", weight: 400 },
	RobotoCondensed: { family: "Roboto Condensed", google: "Roboto+Condensed:wght@400;700", weight: 400 },
	RobotoMono: { family: "Roboto Mono", google: "Roboto+Mono:wght@400;700", fallback: "monospace", weight: 400 },
	Sarpanch: { family: "Sarpanch", google: "Sarpanch:wght@400;700", weight: 400 },
	SpecialElite: { family: "Special Elite", google: "Special+Elite", fallback: "monospace", weight: 400 },
	TitilliumWeb: { family: "Titillium Web", google: "Titillium+Web:wght@400;700", weight: 400 },
	Ubuntu: { family: "Ubuntu", google: "Ubuntu:wght@400;700", weight: 400 },
	BuilderSans: { family: "Nunito Sans", google: "Nunito+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700", weight: 400 }
};

/** FontFace families of modern places (rbxasset://fonts/families/<File>.json) -> Enum.Font. */
const FONT_FAMILY_FILES = { BuilderSans: "BuilderSans", SourceSansPro: "SourceSans", GothamSSm: "Gotham", Arimo: "Arial", Roboto: "Roboto", RobotoMono: "RobotoMono", Ubuntu: "Ubuntu", Oswald: "Oswald", Nunito: "Nunito", Montserrat: "Gotham", FredokaOne: "FredokaOne", LuckiestGuy: "LuckiestGuy", PermanentMarker: "PermanentMarker", Bangers: "Bangers", Creepster: "Creepster", PressStart2P: "Arcade", ComicNeueAngular: "Cartoon", Inconsolata: "Code", Michroma: "Michroma", Merriweather: "Merriweather", TitilliumWeb: "TitilliumWeb" };

export const ENUMS = {
	Font: Object.keys(FONTS),
	TextXAlignment: ["Left", "Right", "Center"],
	TextYAlignment: ["Top", "Center", "Bottom"],
	ScaleType: ["Stretch", "Slice", "Tile", "Fit", "Crop"],
	BorderMode: ["Outline", "Middle", "Inset"],
	ZIndexBehavior: ["Global", "Sibling"],
	ScreenInsets: ["None", "DeviceSafeInsets", "CoreUISafeInsets", "TopbarSafeInsets"],
	FillDirection: ["Horizontal", "Vertical"],
	HorizontalAlignment: ["Center", "Left", "Right"],
	VerticalAlignment: ["Center", "Top", "Bottom"],
	SortOrder: ["Name", "Custom", "LayoutOrder"],
	StartCorner: ["TopLeft", "TopRight", "BottomLeft", "BottomRight"],
	UIFlexAlignment: ["None", "Fill", "SpaceAround", "SpaceBetween", "SpaceEvenly"],
	ApplyStrokeMode: ["Contextual", "Border"],
	LineJoinMode: ["Round", "Bevel", "Miter"],
	AspectType: ["FitWithinMaxSize", "ScaleWithParentSize"],
	DominantAxis: ["Width", "Height"],
	ScrollingDirection: ["X", "Y", "XY"],
	AutomaticSize: ["None", "X", "Y", "XY"],
	ResamplerMode: ["Default", "Pixelated"],
	NormalId: ["Right", "Top", "Back", "Left", "Bottom", "Front"],
	SurfaceGuiSizingMode: ["FixedSize", "PixelsPerStud"]
};

/** Binary places store enums as numbers (Roblox EnumItem.Value). */
const ENUM_BY_VALUE = { ...ENUMS, Font: FONT_ENUM, ScrollingDirection: [undefined, "X", "Y", undefined, "XY"] };

const FONT_WEIGHT_VALUES = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Heavy: 900 };

/** FontFace { Family, Weight, Style } -> { key: FONTS key, weight, style } (null when unknown). */
export function fontOfFace(face) {
	if (!face || typeof face.Family !== "string") return null;
	const file = face.Family.match(/([A-Za-z0-9]+)\.json$/);
	const key = file && FONT_FAMILY_FILES[file[1]];
	if (!key) return null;
	const weight = typeof face.Weight === "string" ? FONT_WEIGHT_VALUES[face.Weight] || 400 : Number(face.Weight) || 400;
	return { key, weight, style: String(face.Style) === "Italic" || face.Style === 1 ? "italic" : "normal" };
}

function toEnum(enumName, value, fallback) {
	const items = ENUMS[enumName];
	if (typeof value === "string" && items.includes(value)) return value;
	if (typeof value === "number") {
		const name = ENUM_BY_VALUE[enumName][value];
		if (name && items.includes(name)) return name;
	}
	if (value && typeof value === "object" && "Value" in value) return toEnum(enumName, value.Value, fallback);
	return fallback;
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const toNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Normalizers per schema type: any input (Properties text, parser record, script value) -> typed value. */
const COERCE = {
	string: (v, d) => (v === undefined || v === null ? d : String(v)),
	bool: (v, d) => (v === undefined || v === null ? d : v === true || v === "true" || v === 1),
	number: (v, d) => toNumber(v, d),
	int: (v, d) => Math.round(toNumber(v, d)),
	float01: (v, d) => (v === undefined || v === null ? d : clamp01(v)),
	UDim2: (v, d) => UDim2.from(v, d),
	UDim: (v, d) => {
		if (v instanceof UDim) return v;
		if (v && typeof v === "object" && "Scale" in v) return new UDim(v.Scale, v.Offset);
		if (typeof v === "string") {
			const parts = v.match(/-?\d*\.?\d+/g);
			return parts && parts.length === 2 ? new UDim(Number(parts[0]), Number(parts[1])) : d;
		}
		return d;
	},
	Vector2: (v, d) => Vector2.from(v, d),
	Color3: (v, d) => Color3.from(v, d),
	/** Opaque values (ColorSequence, NumberSequence, FontFace) kept in the parser / bridge shape. */
	raw: (v, d) => (v === undefined ? d : v)
};

const SAME = {
	UDim: (a, b) => a.equals(b),
	UDim2: (a, b) => a.equals(b),
	Vector2: (a, b) => a.equals(b),
	Color3: (a, b) => a.equals(b)
};

let nextGuiId = 1;
let invalidateHook = () => {};

/** Set by the GuiEngine: called with (instance, propertyName | "Children"). */
export function setInvalidateHook(fn) {
	invalidateHook = fn || (() => {});
}

/** Minimal RBXScriptSignal: Connect / Once / Fire. */
export class Signal {
	constructor() {
		this._handlers = new Set();
	}

	Connect(fn) {
		this._handlers.add(fn);
		return { Disconnect: () => this._handlers.delete(fn), Connected: true };
	}

	Once(fn) {
		const connection = this.Connect((...args) => {
			connection.Disconnect();
			fn(...args);
		});
		return connection;
	}

	Fire(...args) {
		for (const fn of [...this._handlers]) {
			try {
				fn(...args);
			} catch (err) {
				console.error(err);
			}
		}
	}
}

const p = (type, def, extra = {}) => ({ type, def, ...extra });

/** Base of every GUI class. Schemas are merged down the class chain. */
export class GuiBase {
	static className = "GuiBase";
	static creatable = false;
	static schema = {
		Name: p("string", () => "GuiBase"),
		Archivable: p("bool", () => true)
	};

	constructor(props = {}) {
		adoptGuiInstance({ ClassName: this.constructor.className, Name: this.constructor.className, Children: [], ...props }, this.constructor, this);
	}

	/** Merged schema of the class chain (subclass entries override). */
	static fullSchema() {
		if (Object.prototype.hasOwnProperty.call(this, "_fullSchema")) return this._fullSchema;
		const chain = [];
		for (let c = this; c && c.schema; c = Object.getPrototypeOf(c)) chain.unshift(c);
		const merged = {};
		for (const c of chain) Object.assign(merged, Object.prototype.hasOwnProperty.call(c, "schema") ? c.schema : {});
		for (const c of chain) {
			if (!Object.prototype.hasOwnProperty.call(c, "defaults")) continue;
			for (const [key, def] of Object.entries(c.defaults)) if (merged[key]) merged[key] = { ...merged[key], def };
		}
		this._fullSchema = merged;
		return merged;
	}

	get UniqueId() {
		return this.__gui.id;
	}

	get Parent() {
		return this.__gui.parent;
	}

	IsA(className) {
		for (let c = this.constructor; c && c.className; c = Object.getPrototypeOf(c)) if (c.className === className) return true;
		return false;
	}

	GetChildren() {
		return [...this.Children];
	}

	GetDescendants() {
		const out = [];
		const walk = (inst) => {
			for (const child of inst.Children || []) {
				out.push(child);
				walk(child);
			}
		};
		walk(this);
		return out;
	}

	FindFirstChild(name, recursive = false) {
		const list = recursive ? this.GetDescendants() : this.Children;
		return list.find((c) => c.Name === name) || null;
	}

	FindFirstChildOfClass(className) {
		return this.Children.find((c) => c.ClassName === className) || null;
	}

	GetPropertyChangedSignal(prop) {
		const signals = this.__gui.signals;
		if (!signals.has(prop)) signals.set(prop, new Signal());
		return signals.get(prop);
	}
}

export class ScreenGui extends GuiBase {
	static className = "ScreenGui";
	static creatable = true;
	static schema = {
		Enabled: p("bool", () => true),
		DisplayOrder: p("int", () => 0),
		IgnoreGuiInset: p("bool", () => false),
		ScreenInsets: p("enum", () => "CoreUISafeInsets", { enum: "ScreenInsets" }),
		ResetOnSpawn: p("bool", () => true),
		ClipToDeviceSafeArea: p("bool", () => true),
		ZIndexBehavior: p("enum", () => "Sibling", { enum: "ZIndexBehavior" })
	};
}

/** 3D-anchored containers: rendered by GuiEngine's world layer, positioned every frame. */
export class BillboardGui extends GuiBase {
	static className = "BillboardGui";
	static world = true;
	static schema = {
		Enabled: p("bool", () => true),
		Active: p("bool", () => false),
		Size: p("UDim2", () => new UDim2(0, 200, 0, 50)),
		SizeOffset: p("Vector2", () => new Vector2(0, 0)),
		StudsOffset: p("raw", () => null),
		StudsOffsetWorldSpace: p("raw", () => null),
		ExtentsOffset: p("raw", () => null),
		ExtentsOffsetWorldSpace: p("raw", () => null),
		AlwaysOnTop: p("bool", () => false),
		MaxDistance: p("raw", () => Infinity),
		LightInfluence: p("number", () => 1),
		Brightness: p("number", () => 1),
		Adornee: p("raw", () => null),
		ClipsDescendants: p("bool", () => false),
		ResetOnSpawn: p("bool", () => true),
		ZIndexBehavior: p("enum", () => "Global", { enum: "ZIndexBehavior" })
	};
}

export class SurfaceGui extends GuiBase {
	static className = "SurfaceGui";
	static world = true;
	static schema = {
		Enabled: p("bool", () => true),
		Active: p("bool", () => true),
		Face: p("enum", () => "Front", { enum: "NormalId" }),
		CanvasSize: p("Vector2", () => new Vector2(800, 600)),
		SizingMode: p("enum", () => "FixedSize", { enum: "SurfaceGuiSizingMode" }),
		PixelsPerStud: p("number", () => 50),
		AlwaysOnTop: p("bool", () => false),
		LightInfluence: p("number", () => 1),
		Brightness: p("number", () => 1),
		MaxDistance: p("raw", () => Infinity),
		ZOffset: p("number", () => 0),
		Adornee: p("raw", () => null),
		ClipsDescendants: p("bool", () => true),
		ResetOnSpawn: p("bool", () => true),
		ZIndexBehavior: p("enum", () => "Sibling", { enum: "ZIndexBehavior" })
	};
}

export class GuiObject extends GuiBase {
	static className = "GuiObject";
	static schema = {
		Visible: p("bool", () => true),
		Active: p("bool", () => false),
		Interactable: p("bool", () => true),
		AnchorPoint: p("Vector2", () => new Vector2(0, 0)),
		Position: p("UDim2", () => new UDim2(0, 0, 0, 0)),
		Size: p("UDim2", () => new UDim2(0, 100, 0, 100)),
		Rotation: p("number", () => 0),
		ZIndex: p("int", () => 1),
		LayoutOrder: p("int", () => 0),
		ClipsDescendants: p("bool", () => false),
		BackgroundColor3: p("Color3", () => Color3.fromRGB(255, 255, 255)),
		BackgroundTransparency: p("float01", () => 0),
		BorderColor3: p("Color3", () => Color3.fromRGB(0, 0, 0)),
		BorderSizePixel: p("int", () => 0),
		BorderMode: p("enum", () => "Outline", { enum: "BorderMode" })
	};

	/** Fired by the engine for buttons in Play mode. */
	get Activated() {
		return this.GetPropertyChangedSignal("@Activated");
	}

	get MouseButton1Click() {
		return this.GetPropertyChangedSignal("@MouseButton1Click");
	}

	get MouseEnter() {
		return this.GetPropertyChangedSignal("@MouseEnter");
	}

	get MouseLeave() {
		return this.GetPropertyChangedSignal("@MouseLeave");
	}
}

export class Frame extends GuiObject {
	static className = "Frame";
	static creatable = true;
}

const TEXT_SCHEMA = {
	Text: p("string", () => "Label"),
	TextColor3: p("Color3", () => Color3.fromRGB(0, 0, 0)),
	TextTransparency: p("float01", () => 0),
	TextSize: p("int", () => 14),
	Font: p("enum", () => "SourceSans", { enum: "Font" }),
	TextXAlignment: p("enum", () => "Center", { enum: "TextXAlignment" }),
	TextYAlignment: p("enum", () => "Center", { enum: "TextYAlignment" }),
	TextWrapped: p("bool", () => false),
	TextScaled: p("bool", () => false),
	RichText: p("bool", () => false),
	LineHeight: p("number", () => 1),
	TextStrokeColor3: p("Color3", () => Color3.fromRGB(0, 0, 0)),
	TextStrokeTransparency: p("float01", () => 1),
	FontFace: p("raw", () => null)
};

const IMAGE_SCHEMA = {
	Image: p("string", () => ""),
	ImageColor3: p("Color3", () => Color3.fromRGB(255, 255, 255)),
	ImageTransparency: p("float01", () => 0),
	ScaleType: p("enum", () => "Stretch", { enum: "ScaleType" }),
	ImageRectOffset: p("Vector2", () => new Vector2(0, 0)),
	ImageRectSize: p("Vector2", () => new Vector2(0, 0)),
	SliceCenter: p("raw", () => null),
	SliceScale: p("number", () => 1),
	TileSize: p("UDim2", () => new UDim2(1, 0, 1, 0)),
	ResampleMode: p("enum", () => "Default", { enum: "ResamplerMode" })
};

export class TextLabel extends GuiObject {
	static className = "TextLabel";
	static creatable = true;
	static schema = TEXT_SCHEMA;
	static defaults = { Size: () => new UDim2(0, 200, 0, 50) };
}

export class TextButton extends TextLabel {
	static className = "TextButton";
	static schema = {
		AutoButtonColor: p("bool", () => true),
		Modal: p("bool", () => false),
		Selected: p("bool", () => false)
	};
	static defaults = { Text: () => "Button", Active: () => true };
}

export class ImageLabel extends GuiObject {
	static className = "ImageLabel";
	static creatable = true;
	static schema = IMAGE_SCHEMA;
}

export class ImageButton extends ImageLabel {
	static className = "ImageButton";
	static schema = {
		AutoButtonColor: p("bool", () => true),
		HoverImage: p("string", () => ""),
		PressedImage: p("string", () => ""),
		Modal: p("bool", () => false),
		Selected: p("bool", () => false)
	};
	static defaults = { Active: () => true };
}

export class ScrollingFrame extends GuiObject {
	static className = "ScrollingFrame";
	static creatable = true;
	static schema = {
		CanvasSize: p("UDim2", () => new UDim2(0, 0, 2, 0)),
		CanvasPosition: p("Vector2", () => new Vector2(0, 0)),
		AutomaticCanvasSize: p("enum", () => "None", { enum: "AutomaticSize" }),
		ScrollingDirection: p("enum", () => "XY", { enum: "ScrollingDirection" }),
		ScrollingEnabled: p("bool", () => true),
		ScrollBarThickness: p("int", () => 12),
		ScrollBarImageColor3: p("Color3", () => Color3.fromRGB(0, 0, 0)),
		ScrollBarImageTransparency: p("float01", () => 0)
	};
	static defaults = { ClipsDescendants: () => true };
}

export class TextBox extends GuiObject {
	static className = "TextBox";
	static creatable = true;
	static schema = {
		...TEXT_SCHEMA,
		PlaceholderText: p("string", () => ""),
		PlaceholderColor3: p("Color3", () => Color3.fromRGB(178, 178, 178)),
		ClearTextOnFocus: p("bool", () => true),
		TextEditable: p("bool", () => true),
		MultiLine: p("bool", () => false)
	};
	static defaults = { Size: () => new UDim2(0, 200, 0, 50), Text: () => "", Active: () => true };

	get FocusLost() {
		return this.GetPropertyChangedSignal("@FocusLost");
	}

	get Focused() {
		return this.GetPropertyChangedSignal("@Focused");
	}
}

export class CanvasGroup extends GuiObject {
	static className = "CanvasGroup";
	static creatable = true;
	static schema = {
		GroupTransparency: p("float01", () => 0),
		GroupColor3: p("Color3", () => Color3.fromRGB(255, 255, 255))
	};
}

/** UI modifiers: no element of their own, they restyle (or lay out) their parent GuiObject. */
export class UIComponent extends GuiBase {
	static className = "UIComponent";
	static modifier = true;
}

export class UICorner extends UIComponent {
	static className = "UICorner";
	static schema = { CornerRadius: p("UDim", () => new UDim(0, 8)) };
}

export class UIStroke extends UIComponent {
	static className = "UIStroke";
	static schema = {
		Enabled: p("bool", () => true),
		Color: p("Color3", () => Color3.fromRGB(0, 0, 0)),
		Thickness: p("number", () => 1),
		Transparency: p("float01", () => 0),
		ApplyStrokeMode: p("enum", () => "Contextual", { enum: "ApplyStrokeMode" }),
		LineJoinMode: p("enum", () => "Round", { enum: "LineJoinMode" })
	};
}

export class UIGradient extends UIComponent {
	static className = "UIGradient";
	static schema = {
		Enabled: p("bool", () => true),
		Color: p("raw", () => null),
		Transparency: p("raw", () => null),
		Rotation: p("number", () => 0),
		Offset: p("Vector2", () => new Vector2(0, 0))
	};
}

export class UIPadding extends UIComponent {
	static className = "UIPadding";
	static schema = {
		PaddingTop: p("UDim", () => new UDim(0, 0)),
		PaddingBottom: p("UDim", () => new UDim(0, 0)),
		PaddingLeft: p("UDim", () => new UDim(0, 0)),
		PaddingRight: p("UDim", () => new UDim(0, 0))
	};
}

export class UIScale extends UIComponent {
	static className = "UIScale";
	static schema = { Scale: p("number", () => 1) };
}

export class UIAspectRatioConstraint extends UIComponent {
	static className = "UIAspectRatioConstraint";
	static schema = {
		AspectRatio: p("number", () => 1),
		AspectType: p("enum", () => "FitWithinMaxSize", { enum: "AspectType" }),
		DominantAxis: p("enum", () => "Width", { enum: "DominantAxis" })
	};
}

export class UITextSizeConstraint extends UIComponent {
	static className = "UITextSizeConstraint";
	static schema = { MaxTextSize: p("int", () => 100), MinTextSize: p("int", () => 1) };
}

export class UISizeConstraint extends UIComponent {
	static className = "UISizeConstraint";
	static schema = { MinSize: p("Vector2", () => new Vector2(0, 0)), MaxSize: p("Vector2", () => new Vector2(1e9, 1e9)) };
}

const LAYOUT_SCHEMA = {
	FillDirection: p("enum", () => "Vertical", { enum: "FillDirection" }),
	HorizontalAlignment: p("enum", () => "Left", { enum: "HorizontalAlignment" }),
	VerticalAlignment: p("enum", () => "Top", { enum: "VerticalAlignment" }),
	SortOrder: p("enum", () => "LayoutOrder", { enum: "SortOrder" })
};

export class UIListLayout extends UIComponent {
	static className = "UIListLayout";
	static layout = true;
	static schema = {
		...LAYOUT_SCHEMA,
		Padding: p("UDim", () => new UDim(0, 0)),
		HorizontalFlex: p("enum", () => "None", { enum: "UIFlexAlignment" }),
		VerticalFlex: p("enum", () => "None", { enum: "UIFlexAlignment" }),
		Wraps: p("bool", () => false)
	};
}

export class UIGridLayout extends UIComponent {
	static className = "UIGridLayout";
	static layout = true;
	static schema = {
		...LAYOUT_SCHEMA,
		FillDirection: p("enum", () => "Horizontal", { enum: "FillDirection" }),
		CellSize: p("UDim2", () => new UDim2(0, 100, 0, 100)),
		CellPadding: p("UDim2", () => new UDim2(0, 5, 0, 5)),
		FillDirectionMaxCells: p("int", () => 0),
		StartCorner: p("enum", () => "TopLeft", { enum: "StartCorner" })
	};
}

export const GUI_CLASSES = {
	ScreenGui, BillboardGui, SurfaceGui, Frame, TextLabel, TextButton, ImageLabel, ImageButton, ScrollingFrame, TextBox, CanvasGroup,
	UICorner, UIStroke, UIGradient, UIPadding, UIScale, UIAspectRatioConstraint, UITextSizeConstraint, UISizeConstraint, UIListLayout, UIGridLayout
};
export const CREATABLE_GUI = ["ScreenGui", "Frame", "TextLabel", "TextButton", "ImageLabel", "ImageButton", "ScrollingFrame", "TextBox"];
export const INTERACTIVE_GUI = new Set(["TextButton", "ImageButton"]);

export function guiClassOf(className) {
	return GUI_CLASSES[className] || null;
}

export function isGuiModifier(instance) {
	return !!instance && instance instanceof UIComponent;
}

export function isGuiInstance(instance) {
	return !!instance && instance instanceof GuiBase;
}

export function isGuiObject(instance) {
	return !!instance && instance instanceof GuiObject;
}

/**
 * Parenting rules: StarterGui only takes ScreenGuis, ScreenGuis live in StarterGui (or
 * PlayerGui), GuiObjects live in a ScreenGui or another GuiObject.
 */
export function canParent(childClassName, parent) {
	const cls = guiClassOf(childClassName);
	if (!parent) return { ok: false, reason: "sem pai" };
	const parentClass = parent.ClassName;
	if (parentClass === "StarterGui" || parentClass === "PlayerGui") {
		return childClassName === "ScreenGui"
			? { ok: true }
			: { ok: false, reason: `${parentClass} só aceita ScreenGui como filho direto (recebeu ${childClassName})` };
	}
	if (childClassName === "ScreenGui") return { ok: false, reason: `ScreenGui precisa ficar dentro de StarterGui (não em ${parentClass})` };
	if (childClassName === "SurfaceGui" || childClassName === "BillboardGui") {
		// World GUIs live on parts (or Model with Adornee). Part-like classes are enough here.
		if (parent.Size || parentClass === "Model" || parentClass === "Workspace") return { ok: true };
	}
	if (cls && cls.prototype instanceof GuiObject) {
		const parentCls = guiClassOf(parentClass);
		if (parentCls === ScreenGui || parentCls === SurfaceGui || parentCls === BillboardGui
			|| (parentCls && parentCls.prototype instanceof GuiObject)) return { ok: true };
		return { ok: false, reason: `${childClassName} precisa ficar dentro de um ScreenGui/SurfaceGui/BillboardGui ou de outro GuiObject (não em ${parentClass})` };
	}
	return { ok: true };
}

function legacyFont(record) {
	const face = record.FontFace;
	const family = face && typeof face.Family === "string" ? face.Family.match(/([A-Za-z0-9]+)\.json$/) : null;
	if (family && FONT_FAMILY_FILES[family[1]]) {
		const base = FONT_FAMILY_FILES[family[1]];
		const weight = Number(face.Weight) || 400;
		if (base === "SourceSans") return weight >= 700 ? "SourceSansBold" : weight >= 600 ? "SourceSansSemibold" : weight <= 300 ? "SourceSansLight" : "SourceSans";
		if (base === "Gotham") return weight >= 900 ? "GothamBlack" : weight >= 700 ? "GothamBold" : weight >= 500 ? "GothamMedium" : "Gotham";
		return base;
	}
	return undefined;
}

function reactiveChildren(owner, list) {
	if (list && list.__isReactive) return list;
	const target = Array.isArray(list) ? list : [];
	return new Proxy(target, {
		get(t, key) {
			if (key === "__isReactive") return true;
			return t[key];
		},
		set(t, key, value) {
			t[key] = value;
			if (key !== "length" && value && value.__gui) value.__gui.parent = owner;
			invalidateHook(owner, "Children");
			return true;
		},
		deleteProperty(t, key) {
			delete t[key];
			invalidateHook(owner, "Children");
			return true;
		}
	});
}

/** Makes a container's Children reactive (used for StarterGui, which is a plain service). */
export function makeChildrenReactive(owner) {
	const list = reactiveChildren(owner, owner.Children);
	Object.defineProperty(owner, "Children", { value: list, enumerable: true, writable: true, configurable: true });
	return list;
}

/**
 * Upgrades a DataModel record (from the binary parser or a literal) in place into a reactive
 * GUI instance of `Cls`: same object identity, so Explorer nodes keep pointing at it.
 */
export function adoptGuiInstance(record, Cls = guiClassOf(record.ClassName), into = null) {
	if (!Cls) return record;
	if (record.__gui) return record;
	const instance = into || record;
	if (into && into !== record) Object.assign(into, record);
	Object.setPrototypeOf(instance, Cls.prototype);

	const schema = Cls.fullSchema();
	const store = {};
	Object.defineProperty(instance, "__gui", { value: { id: `GUI_${String(nextGuiId++).padStart(5, "0")}`, store, parent: null, signals: new Map() } });
	const legacy = { Font: legacyFont(instance) };

	Object.defineProperty(instance, "ClassName", { value: Cls.className, enumerable: true, writable: false, configurable: true });
	for (const [key, spec] of Object.entries(schema)) {
		const raw = key in legacy && legacy[key] !== undefined ? legacy[key] : instance[key];
		delete instance[key];
		const def = spec.def();
		store[key] = spec.type === "enum" ? toEnum(spec.enum, raw, def) : COERCE[spec.type](raw, def);
		Object.defineProperty(instance, key, {
			enumerable: true,
			configurable: true,
			get: () => store[key],
			set: (value) => {
				const next = spec.type === "enum" ? toEnum(spec.enum, value, store[key]) : COERCE[spec.type](value, store[key]);
				const same = SAME[spec.type] ? SAME[spec.type](next, store[key]) : next === store[key];
				if (same) return;
				store[key] = next;
				if (key === "Font" && store.FontFace) store.FontFace = null;
				invalidateHook(instance, key);
				const signal = instance.__gui.signals.get(key);
				if (signal) signal.Fire(next);
			}
		});
	}
	if (!instance.Name) instance.Name = Cls.className;

	const children = instance.Children;
	makeChildrenReactive(instance);
	for (const child of children || []) {
		const childCls = guiClassOf(child && child.ClassName);
		if (childCls) adoptGuiInstance(child, childCls);
		if (child && child.__gui) child.__gui.parent = instance;
	}
	return instance;
}

/** Creates a new GUI instance with Studio-like defaults for freshly inserted objects. */
export function createGuiInstance(className, props = {}) {
	const Cls = guiClassOf(className);
	if (!Cls) throw new Error(`Classe de GUI desconhecida: ${className}`);
	return new Cls({ Name: className, ...props });
}

/** Schema entries for the Properties panel: [key, spec] in class order. */
export function guiSchemaOf(instance) {
	const Cls = guiClassOf(instance.ClassName);
	return Cls ? Cls.fullSchema() : {};
}
