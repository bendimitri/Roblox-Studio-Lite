export function isTypingTarget(target) {
	if (!target || !target.tagName) return false;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function isDialogOpen() {
	return document.querySelector("dialog[open]") !== null;
}

/**
 * Keys that must not steal input from panels (arrows, etc.) only apply
 * when nothing else on the page holds keyboard focus.
 */
export function viewportHasFocus(canvas) {
	const active = document.activeElement;
	return !active || active === document.body || active === canvas;
}
