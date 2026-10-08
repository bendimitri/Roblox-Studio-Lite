import { RIG_TYPES } from "../animation/RigSpecs.js";

/*
 * Experience + in-game ESC menu settings. Persisted per browser.
 */
const STORAGE_KEY = "studiolite.experience.v1";
const GAME_KEY = "studiolite.gameSettings.v1";

const DEFAULTS = { avatarRigType: "R15" };

const GAME_DEFAULTS = {
	shiftLockSwitch: true, // permission: may press Shift to toggle lock
	cameraMode: "Default (Classic)",
	movementMode: "Default (Keyboard)",
	mouseSensitivity: 5,
	volume: 5,
	fullscreen: false,
	graphicsMode: "Manual", // Automatic | Manual
	graphicsQuality: 6
};

let current = load();
let game = loadGame();

function load() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
		const settings = { ...DEFAULTS, ...saved };
		if (!RIG_TYPES.includes(settings.avatarRigType)) settings.avatarRigType = DEFAULTS.avatarRigType;
		return settings;
	} catch {
		return { ...DEFAULTS };
	}
}

function loadGame() {
	try {
		const saved = JSON.parse(localStorage.getItem(GAME_KEY) || "{}");
		return { ...GAME_DEFAULTS, ...saved };
	} catch {
		return { ...GAME_DEFAULTS };
	}
}

export function getExperienceSettings() {
	return { ...current };
}

export function setExperienceSettings(patch) {
	const next = { ...current, ...patch };
	if (!RIG_TYPES.includes(next.avatarRigType)) throw new Error(`RigType desconhecido: ${next.avatarRigType}`);
	current = next;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
	} catch {}
	return getExperienceSettings();
}

export function getGameSettings() {
	return { ...game };
}

export function setGameSettings(patch) {
	game = { ...game, ...patch };
	if (typeof game.mouseSensitivity === "number") {
		game.mouseSensitivity = Math.max(1, Math.min(10, Math.round(game.mouseSensitivity)));
	}
	if (typeof game.volume === "number") {
		game.volume = Math.max(1, Math.min(10, Math.round(game.volume)));
	}
	if (typeof game.graphicsQuality === "number") {
		game.graphicsQuality = Math.max(1, Math.min(10, Math.round(game.graphicsQuality)));
	}
	if (game.graphicsMode !== "Automatic") game.graphicsMode = "Manual";
	try {
		localStorage.setItem(GAME_KEY, JSON.stringify(game));
	} catch {}
	return getGameSettings();
}
