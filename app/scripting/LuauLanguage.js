import { StreamLanguage, HighlightStyle, syntaxHighlighting, tags as t, EditorView } from "../thirdparty/codemirror/codemirror.js";

/*
 * Luau for CodeMirror 6: a stream tokenizer (Lua 5.1 + Luau additions: compound assignment,
 * `continue`, type annotations, `export type`, string interpolation with backticks, integer
 * literals with `_` and `0b`) plus Roblox Studio's default dark script theme.
 */

const KEYWORDS = new Set(["and", "break", "do", "else", "elseif", "end", "for", "function", "if", "in", "local", "not", "or", "repeat", "return", "then", "until", "while", "continue"]);
const ATOMS = new Set(["true", "false", "nil"]);
const BUILTINS = new Set([
	"game", "workspace", "script", "plugin", "shared", "_G", "_VERSION",
	"Instance", "Vector3", "Vector2", "CFrame", "Color3", "BrickColor", "UDim", "UDim2", "Enum", "TweenInfo", "Ray", "Random",
	"NumberRange", "NumberSequence", "ColorSequence", "Rect", "Region3", "RaycastParams", "OverlapParams", "DateTime",
	"task", "wait", "spawn", "delay", "tick", "time", "elapsedTime", "print", "warn", "error", "require", "pcall", "xpcall",
	"typeof", "type", "pairs", "ipairs", "next", "select", "tostring", "tonumber", "setmetatable", "getmetatable",
	"rawget", "rawset", "rawequal", "rawlen", "assert", "unpack", "newproxy", "gcinfo", "collectgarbage",
	"string", "table", "math", "coroutine", "os", "debug", "utf8", "bit32", "buffer", "vector"
]);

function readLongBracket(stream) {
	const m = stream.match(/^\[(=*)\[/);
	return m ? m[1].length : -1;
}

function inLong(level, style) {
	const close = "]" + "=".repeat(level) + "]";
	return (stream, state) => {
		while (!stream.eol()) {
			if (stream.match(close)) {
				state.tokenize = base;
				return style;
			}
			stream.next();
		}
		return style;
	};
}

function inString(quote) {
	return (stream, state) => {
		let escaped = false, ch;
		while ((ch = stream.next()) != null) {
			if (ch === quote && !escaped) {
				state.tokenize = base;
				return "string";
			}
			if (ch === "\\" && !escaped && stream.eol()) return "string";
			escaped = !escaped && ch === "\\";
		}
		if (!escaped) state.tokenize = base;
		return "string";
	};
}

function inTemplate(stream, state) {
	let ch;
	while ((ch = stream.peek()) != null) {
		if (ch === "`") {
			stream.next();
			state.tokenize = base;
			return "string";
		}
		if (ch === "{") {
			if (stream.pos > stream.start) return "string";
			stream.next();
			state.templateDepth.push(0);
			state.tokenize = base;
			return "string.special";
		}
		stream.next();
		if (ch === "\\") stream.next();
	}
	return "string";
}

function base(stream, state) {
	if (stream.eatSpace()) return null;
	const ch = stream.peek();

	if (stream.match("--")) {
		const level = readLongBracket(stream);
		if (level >= 0) {
			state.tokenize = inLong(level, "comment");
			return state.tokenize(stream, state);
		}
		stream.skipToEnd();
		return "comment";
	}
	if (ch === "[") {
		const level = readLongBracket(stream);
		if (level >= 0) {
			state.tokenize = inLong(level, "string");
			return state.tokenize(stream, state);
		}
	}
	if (ch === '"' || ch === "'") {
		stream.next();
		state.tokenize = inString(ch);
		return state.tokenize(stream, state);
	}
	if (ch === "`") {
		stream.next();
		state.tokenize = inTemplate;
		return "string";
	}
	if (state.templateDepth.length) {
		if (ch === "{") state.templateDepth[state.templateDepth.length - 1]++;
		if (ch === "}") {
			const depth = state.templateDepth[state.templateDepth.length - 1];
			if (depth === 0) {
				stream.next();
				state.templateDepth.pop();
				state.tokenize = inTemplate;
				return "string.special";
			}
			state.templateDepth[state.templateDepth.length - 1]--;
		}
	}
	if (stream.match(/^0[xX][0-9a-fA-F_]+/) || stream.match(/^0[bB][01_]+/) || stream.match(/^(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d+)?/)) {
		return "number";
	}
	if (/[A-Za-z_]/.test(ch)) {
		stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
		const word = stream.current();
		const prev = state.lastSignificant;
		state.lastSignificant = word;
		if (KEYWORDS.has(word)) {
			state.afterFunction = word === "function";
			return "keyword";
		}
		if (ATOMS.has(word)) return "atom";
		if (word === "self") return "self";
		if ((word === "type" || word === "export") && stream.match(/^\s+[A-Za-z_]/, false)) return "keyword";
		if (state.afterFunction) {
			state.afterFunction = false;
			return "def";
		}
		if (prev === ":" || stream.match(/^\s*[(\"'{]/, false) && prev === ".") return "method";
		if (prev === ".") return "property";
		if (BUILTINS.has(word)) return "builtin";
		if (stream.match(/^\s*\(/, false)) return "call";
		return "variable";
	}
	stream.next();
	state.lastSignificant = ch;
	if (/[+\-*/%^#=<>~.:]/.test(ch)) {
		stream.match(/^[=.:>]+/);
		return "operator";
	}
	return "punctuation";
}

const luauParser = {
	name: "luau",
	startState: () => ({ tokenize: base, templateDepth: [], afterFunction: false, lastSignificant: null }),
	copyState: (s) => ({ ...s, templateDepth: [...s.templateDepth] }),
	token: (stream, state) => state.tokenize(stream, state),
	languageData: { commentTokens: { line: "--", block: { open: "--[[", close: "]]" } }, indentOnInput: /^\s*(end|else|elseif|until|\})$/ },
	tokenTable: {
		self: t.special(t.variableName),
		def: t.function(t.definition(t.variableName)),
		method: t.function(t.propertyName),
		call: t.function(t.variableName),
		builtin: t.standard(t.variableName),
		"string.special": t.special(t.string)
	}
};

export const luau = StreamLanguage.define(luauParser);

/* Roblox Studio "Dark" script editor defaults. */
const STUDIO = {
	bg: "#252525",
	text: "#cccccc",
	keyword: "#f86d7c",
	builtin: "#84d6f7",
	string: "#adf195",
	number: "#ffc600",
	comment: "#666666",
	fn: "#fdfbac",
	property: "#61a1f1",
	gutter: "#858585",
	line: "#2d2d2d",
	selection: "#11406b"
};

export const studioHighlight = syntaxHighlighting(HighlightStyle.define([
	{ tag: t.keyword, color: STUDIO.keyword },
	{ tag: t.special(t.variableName), color: STUDIO.keyword },
	{ tag: [t.atom, t.bool, t.null], color: STUDIO.number },
	{ tag: t.number, color: STUDIO.number },
	{ tag: [t.string, t.special(t.string)], color: STUDIO.string },
	{ tag: t.comment, color: STUDIO.comment, fontStyle: "normal" },
	{ tag: t.standard(t.variableName), color: STUDIO.builtin },
	{ tag: [t.function(t.definition(t.variableName)), t.function(t.propertyName), t.function(t.variableName)], color: STUDIO.fn },
	{ tag: t.propertyName, color: STUDIO.property },
	{ tag: [t.operator, t.punctuation], color: STUDIO.text },
	{ tag: t.variableName, color: STUDIO.text }
]));

export const studioTheme = EditorView.theme({
	"&": { color: STUDIO.text, backgroundColor: STUDIO.bg, height: "100%", fontSize: "14px" },
	".cm-scroller": { fontFamily: "'Source Code Pro', Consolas, monospace", lineHeight: "1.55" },
	".cm-content": { caretColor: "#ffffff", padding: "6px 0" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffffff" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: STUDIO.selection },
	".cm-activeLine": { backgroundColor: STUDIO.line },
	".cm-gutters": { backgroundColor: STUDIO.bg, color: STUDIO.gutter, border: "none", paddingRight: "6px" },
	".cm-activeLineGutter": { backgroundColor: STUDIO.line, color: "#cccccc" },
	".cm-foldPlaceholder": { backgroundColor: "#3a3a3a", border: "none", color: "#cccccc" },
	".cm-matchingBracket": { backgroundColor: "#3d4f63", outline: "1px solid #5f7a99" },
	".cm-selectionMatch": { backgroundColor: "#343f4f" },
	".cm-tooltip": { backgroundColor: "#2f2f2f", border: "1px solid #474747", color: STUDIO.text },
	".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#0e5ea8", color: "#ffffff" },
	".cm-panels": { backgroundColor: "#2f2f2f", color: STUDIO.text },
	".cm-searchMatch": { backgroundColor: "#5b4a12" }
}, { dark: true });

/* ---------- Completion ---------- */

const MEMBERS = [
	"Name", "Parent", "ClassName", "Position", "CFrame", "Orientation", "Size", "Color", "BrickColor", "Material", "Transparency",
	"Anchored", "CanCollide", "Reflectance", "Shape", "Velocity", "Text", "TextColor3", "TextSize", "Font", "BackgroundColor3",
	"BackgroundTransparency", "Visible", "Image", "Enabled", "Value", "Health", "MaxHealth", "WalkSpeed", "JumpPower", "Character",
	"LocalPlayer", "PlayerGui", "Humanoid", "HumanoidRootPart", "PrimaryPart", "AnchorPoint", "ZIndex", "Rotation", "Magnitude", "Unit",
	"X", "Y", "Z", "LookVector", "RightVector", "UpVector",
	"FindFirstChild", "FindFirstChildOfClass", "FindFirstChildWhichIsA", "FindFirstAncestor", "WaitForChild", "GetChildren",
	"GetDescendants", "IsA", "Destroy", "Clone", "ClearAllChildren", "GetFullName", "IsDescendantOf", "GetAttribute", "SetAttribute",
	"GetPropertyChangedSignal", "GetService", "Connect", "Once", "Wait", "Disconnect", "Fire", "Play", "Stop", "Pause", "Cancel",
	"Create", "MoveTo", "PivotTo", "GetPivot", "Lerp", "Dot", "Cross", "Inverse", "ToWorldSpace", "ToObjectSpace", "GetPlayers",
	"Touched", "TouchEnded", "MouseButton1Click", "Activated", "MouseEnter", "MouseLeave", "Changed", "ChildAdded", "ChildRemoved",
	"Heartbeat", "Stepped", "RenderStepped", "InputBegan", "InputEnded", "IsKeyDown", "Completed", "Died", "MouseClick", "PlayerAdded"
];
const LIBS = {
	task: ["wait", "spawn", "defer", "delay", "cancel"],
	math: ["abs", "ceil", "floor", "clamp", "sign", "round", "max", "min", "sqrt", "sin", "cos", "tan", "atan2", "rad", "deg", "random", "randomseed", "noise", "pi", "huge", "lerp", "map"],
	string: ["format", "sub", "len", "lower", "upper", "rep", "reverse", "split", "find", "match", "gmatch", "gsub", "byte", "char"],
	table: ["insert", "remove", "find", "sort", "concat", "clear", "clone", "freeze", "create", "unpack", "pack"],
	Vector3: ["new", "zero", "one", "xAxis", "yAxis", "zAxis"],
	CFrame: ["new", "Angles", "lookAt", "fromEulerAnglesXYZ", "fromEulerAnglesYXZ", "fromOrientation", "fromAxisAngle", "identity"],
	Color3: ["new", "fromRGB", "fromHSV", "fromHex"],
	UDim2: ["new", "fromScale", "fromOffset"],
	Instance: ["new"],
	TweenInfo: ["new"],
	Enum: ["Material", "PartType", "EasingStyle", "EasingDirection", "KeyCode", "UserInputType", "Font", "TextXAlignment", "TextYAlignment", "HumanoidRigType"]
};

function luauCompletions(context) {
	const lib = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_]*$/);
	if (lib) {
		const [obj] = lib.text.split(".");
		const members = LIBS[obj];
		if (members) return { from: lib.from + obj.length + 1, options: members.map((m) => ({ label: m, type: "function" })) };
	}
	const member = context.matchBefore(/[.:][A-Za-z_]*$/);
	if (member) return { from: member.from + 1, options: MEMBERS.map((m) => ({ label: m, type: /^[A-Z][a-z]+[A-Z]|^(Find|Wait|Get|Is|Destroy|Clone|Clear|Set|Connect|Once|Fire|Play|Stop|Pause|Cancel|Create|MoveTo|PivotTo|Lerp|Dot|Cross|Inverse|To)/.test(m) && !/^(Name|Parent)$/.test(m) ? "method" : "property" })) };
	const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);
	if (!word || (word.from === word.to && !context.explicit)) return null;
	return {
		from: word.from,
		options: [
			...[...KEYWORDS, ...ATOMS, "self", "type", "export"].map((k) => ({ label: k, type: "keyword" })),
			...[...BUILTINS].map((b) => ({ label: b, type: "variable", boost: 1 }))
		]
	};
}

export const luauCompletionSource = luauCompletions;
