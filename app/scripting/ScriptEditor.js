import {
	EditorView, EditorState, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor,
	rectangularSelection, crosshairCursor, highlightSpecialChars, indentOnInput, bracketMatching, foldGutter, foldKeymap, indentUnit,
	defaultKeymap, history, historyKeymap, indentWithTab, searchKeymap, highlightSelectionMatches, autocompletion, completionKeymap,
	closeBrackets, closeBracketsKeymap
} from "../thirdparty/codemirror/codemirror.js";
import { luau, studioHighlight, studioTheme, luauCompletionSource } from "./LuauLanguage.js";

/**
 * Script tabs: one CodeMirror EditorState per open script (cursor, scroll and undo history survive
 * tab switches). Every edit writes straight into `instance.Source`, the same string Play compiles
 * and the exporter serializes.
 */
export class ScriptEditor {
	/**
	 * @param {HTMLElement} container  the viewport `.editor` element
	 * @param {{ describe(instance): { path: string, kind: string, issue: string|null }, onChange?(instance): void }} hooks
	 */
	constructor(container, hooks) {
		this.container = container;
		this.hooks = hooks;
		this.states = new Map();
		this.instances = new Map();
		this.activeId = null;
		this.view = null;
		this.selectionScroll = new Map();

		container.textContent = "";
		container.classList.add("script-editor");
		this.header = document.createElement("div");
		this.header.className = "script-editor-header";
		this.host = document.createElement("div");
		this.host.className = "script-editor-host";
		container.append(this.header, this.host);
	}

	_extensions(instance) {
		return [
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightSpecialChars(),
			history(),
			foldGutter({ openText: "▾", closedText: "▸" }),
			drawSelection(),
			dropCursor(),
			EditorState.allowMultipleSelections.of(true),
			indentOnInput(),
			indentUnit.of("\t"),
			EditorState.tabSize.of(4),
			bracketMatching(),
			closeBrackets(),
			autocompletion({ override: [luauCompletionSource], icons: false }),
			rectangularSelection(),
			crosshairCursor(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			luau,
			studioHighlight,
			studioTheme,
			keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				instance.Source = update.state.doc.toString();
				this.hooks.onChange?.(instance);
			})
		];
	}

	_stateFor(docId, instance) {
		let state = this.states.get(docId);
		const source = typeof instance.Source === "string" ? instance.Source : "";
		if (!state || state.doc.toString() !== source) state = EditorState.create({ doc: source, extensions: this._extensions(instance) });
		return state;
	}

	show(docId, instance) {
		this.stash();
		this.instances.set(docId, instance);
		this.activeId = docId;
		this.view = new EditorView({ state: this._stateFor(docId, instance), parent: this.host });
		const scroll = this.selectionScroll.get(docId);
		if (scroll) requestAnimationFrame(() => this.view && (this.view.scrollDOM.scrollTop = scroll));
		this.refreshHeader();
		this.view.focus();
	}

	/** Detaches the live view, remembering its state for when the tab comes back. */
	stash() {
		if (!this.view) return;
		this.states.set(this.activeId, this.view.state);
		this.selectionScroll.set(this.activeId, this.view.scrollDOM.scrollTop);
		this.view.destroy();
		this.view = null;
		this.activeId = null;
	}

	close(docId) {
		if (this.activeId === docId) {
			this.view?.destroy();
			this.view = null;
			this.activeId = null;
		}
		this.states.delete(docId);
		this.instances.delete(docId);
		this.selectionScroll.delete(docId);
	}

	refreshHeader() {
		const instance = this.instances.get(this.activeId);
		if (!instance) return;
		const { path, kind, issue } = this.hooks.describe(instance);
		this.header.textContent = "";
		const cls = document.createElement("span");
		cls.className = `script-editor-kind kind-${instance.ClassName}`;
		cls.textContent = instance.ClassName;
		const where = document.createElement("span");
		where.className = "script-editor-path";
		where.textContent = path;
		const note = document.createElement("span");
		note.className = issue ? "script-editor-note warn" : "script-editor-note";
		note.textContent = issue || kind;
		this.header.append(cls, where, note);
	}

	/** Moves the cursor to a 1-based line (used by clickable errors in Output). */
	goToLine(line) {
		if (!this.view) return;
		const doc = this.view.state.doc;
		const ln = doc.line(Math.max(1, Math.min(doc.lines, line)));
		this.view.dispatch({ selection: { anchor: ln.from, head: ln.to }, scrollIntoView: true });
		this.view.focus();
	}
}
