const BLUE = "#2f8be6";
const BLUE_DARK = "#1d6fc4";
const BLUE_LIGHT = "#7cc0ff";

const ICONS = {
	select: `<path d="M6 3l12 9.5-5.2.9 3 6.3-2.4 1.1-3-6.3L6 18z" fill="#fff" stroke="#222" stroke-width="1.4" stroke-linejoin="round"/>`,
	move: `<path d="M12 4v16M4 12h16" stroke="${BLUE_DARK}" stroke-width="2" stroke-linecap="round"/><g fill="${BLUE_DARK}"><path d="M12 1.5l3.5 4h-7z"/><path d="M12 22.5l-3.5-4h7z"/><path d="M1.5 12l4-3.5v7z"/><path d="M22.5 12l-4 3.5v-7z"/></g>`,
	scale: `<rect x="3" y="9" width="12" height="12" rx="1" fill="#cfe6fb" stroke="${BLUE_DARK}" stroke-width="1.6"/><path d="M10 14l9-9" stroke="${BLUE_DARK}" stroke-width="2" stroke-linecap="round"/><path d="M14 3h7v7z" fill="${BLUE_DARK}"/>`,
	rotate: `<path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="${BLUE_DARK}" stroke-width="2.2" stroke-linecap="round"/><path d="M20.5 3.5v6.2h-6.2z" fill="${BLUE_DARK}"/>`,
	terrain: `<path d="M2 20l6.5-11 4 6.5 2.5-4L22 20z" fill="#3fa35b"/><path d="M8.5 9l1.9 3.1-1.9 1-1.7-1z" fill="#e8f5e9"/><rect x="2" y="19" width="20" height="2.6" rx="1" fill="#8d6e63"/>`,
	toolbox: `<path d="M4 8h16l-1.2 12.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3z" fill="${BLUE}"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" fill="none" stroke="${BLUE_DARK}" stroke-width="1.8"/>`,
	part: `<path d="M12 2.5l8.5 4.5-8.5 4.5L3.5 7z" fill="${BLUE_LIGHT}"/><path d="M3.5 7l8.5 4.5v10L3.5 17z" fill="${BLUE}"/><path d="M20.5 7L12 11.5v10l8.5-4.5z" fill="${BLUE_DARK}"/>`,
	sphere: `<circle cx="12" cy="12" r="9" fill="${BLUE}"/><ellipse cx="9" cy="8.5" rx="3.4" ry="2.3" fill="#a9d6ff" opacity=".85"/>`,
	wedge: `<path d="M3 20.5V9l14 11.5z" fill="${BLUE}"/><path d="M3 9l4-3.5 14 11.5-4 3.5z" fill="${BLUE_LIGHT}"/><path d="M17 20.5l4-3.5v0z" fill="${BLUE_DARK}"/>`,
	cylinder: `<path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6c0 1.7-3.1 3-7 3S5 7.7 5 6z" fill="${BLUE}"/><ellipse cx="12" cy="6" rx="7" ry="3" fill="${BLUE_LIGHT}"/>`,
	ui: `<rect x="3" y="4" width="18" height="16" rx="2" fill="#fff" stroke="${BLUE}" stroke-width="1.8"/><rect x="6" y="7" width="12" height="3" rx="1" fill="${BLUE}"/><rect x="6" y="12" width="7" height="5" rx="1" fill="#a9d6ff"/>`,
	material: `<circle cx="12" cy="12" r="9" fill="#8d8d8d"/><path d="M5.2 8.5h13.6M3.4 12.5h17.2M5 16.5h14" stroke="#c4c4c4" stroke-width="1.3"/><circle cx="8.8" cy="8" r="2.6" fill="#fff" opacity=".45"/>`,
	color: `<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z" fill="#f4e1c1" stroke="#a1887f" stroke-width="1.2"/><circle cx="7.5" cy="11" r="1.7" fill="#e53935"/><circle cx="10" cy="7" r="1.7" fill="#fdd835"/><circle cx="14.5" cy="7" r="1.7" fill="#43a047"/><circle cx="17.5" cy="10.5" r="1.7" fill="#1e88e5"/>`,
	group: `<rect x="3" y="3" width="11" height="11" rx="1.5" fill="#a9d6ff" stroke="${BLUE_DARK}" stroke-width="1.4"/><rect x="10" y="10" width="11" height="11" rx="1.5" fill="${BLUE}" stroke="${BLUE_DARK}" stroke-width="1.4"/>`,
	lock: `<rect x="5" y="10" width="14" height="11" rx="2" fill="#f2b100"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="#8d6e00" stroke-width="2"/>`,
	anchor: `<g fill="none" stroke="#455a64" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 11h8M4.5 14a7.5 7.5 0 0 0 15 0"/></g>`,
	play: `<circle cx="12" cy="12" r="10" fill="#2e9d48"/><path d="M10 7.5l6.5 4.5-6.5 4.5z" fill="#fff"/>`,
	resume: `<path d="M5.5 6h2.6v12H5.5z" fill="#2e9d48"/><path d="M10.5 6l8.5 6-8.5 6z" fill="#2e9d48"/>`,
	undo: `<path d="M9 5L4 10l5 5" fill="none" stroke="${BLUE_DARK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 10H14a6 6 0 0 1 0 12h-3" fill="none" stroke="${BLUE_DARK}" stroke-width="2.2" stroke-linecap="round"/>`,
	redo: `<path d="M15 5l5 5-5 5" fill="none" stroke="${BLUE_DARK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 10H10a6 6 0 0 0 0 12h3" fill="none" stroke="${BLUE_DARK}" stroke-width="2.2" stroke-linecap="round"/>`,
	stop: `<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="#e53935"/>`,
	explorer: `<rect x="3" y="3" width="7" height="5" rx="1" fill="${BLUE}"/><rect x="12" y="10" width="9" height="4" rx="1" fill="${BLUE_LIGHT}"/><rect x="12" y="17" width="9" height="4" rx="1" fill="${BLUE_LIGHT}"/><path d="M6.5 8v11H12M6.5 12H12" fill="none" stroke="#666" stroke-width="1.4"/>`,
	properties: `<rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="#666" stroke-width="1.4"/><path d="M3 9h18M3 15h18M10 3v18" stroke="#9e9e9e" stroke-width="1.2"/>`,
	output: `<rect x="2.5" y="4" width="19" height="16" rx="2" fill="#37474f"/><path d="M6 9l3 3-3 3M11 15h6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
	stats: `<path d="M5 20v-8M10 20V6M15 20v-9M20 20V9" stroke="${BLUE}" stroke-width="2.6" stroke-linecap="round"/>`,
	axes: `<path d="M5 19h14" stroke="#e53935" stroke-width="2" stroke-linecap="round"/><path d="M5 19V5" stroke="#43a047" stroke-width="2" stroke-linecap="round"/><path d="M5 19l8-8" stroke="#1e88e5" stroke-width="2" stroke-linecap="round"/>`,
	sky: `<circle cx="9" cy="9" r="4" fill="#fdd835"/><path d="M8 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1.5A2.75 2.75 0 0 0 8 19z" fill="#90caf9"/>`,
	theme: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="#4b5566"/><circle cx="15.5" cy="7.5" r="1" fill="#cfd8dc"/><circle cx="18" cy="11" r=".8" fill="#cfd8dc"/>`,
	hover: `<rect x="3" y="3" width="15" height="15" rx="1" fill="none" stroke="#1aa3ff" stroke-width="1.6" stroke-dasharray="3 2"/><path d="M12 11l9 4-4 1-1 4z" fill="#222"/>`,
	selection: `<rect x="4" y="4" width="16" height="16" fill="#cce8ff" stroke="#1aa3ff" stroke-width="1.8"/>`,
	camera: `<rect x="2.5" y="7" width="19" height="13" rx="2" fill="#546e7a"/><path d="M8 7l1.5-2.5h5L16 7z" fill="#546e7a"/><circle cx="12" cy="13.5" r="4" fill="#cfd8dc"/><circle cx="12" cy="13.5" r="2" fill="#37474f"/>`,
	zoom: `<circle cx="10.5" cy="10.5" r="6.5" fill="#e3f2fd" stroke="${BLUE_DARK}" stroke-width="2"/><path d="M15.5 15.5L21 21" stroke="${BLUE_DARK}" stroke-width="2.6" stroke-linecap="round"/>`,
	snap: `<path d="M3 8h18M3 16h18M8 3v18M16 3v18" stroke="#9e9e9e" stroke-width="1.3"/><circle cx="16" cy="8" r="2.6" fill="#1aa3ff"/>`,
	space: `<circle cx="12" cy="12" r="9" fill="#e3f2fd" stroke="${BLUE_DARK}" stroke-width="1.6"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="${BLUE_DARK}" stroke-width="1.3"/>`,
	animation: `<rect x="2.5" y="14" width="19" height="7" rx="1.5" fill="#37474f"/><path d="M7 15.6l1.9 1.9L7 19.4l-1.9-1.9zM13 15.6l1.9 1.9-1.9 1.9-1.9-1.9z" fill="#f0a01a"/><path d="M18 14v7" stroke="#e5322d" stroke-width="1.6"/><circle cx="12" cy="4" r="2.2" fill="#f5cd30"/><path d="M12 6.5v4.5M12 11l-3 2.2M12 11l3 2.2M8.5 7.6l3.5 1.2 3.8-2.3" fill="none" stroke="${BLUE_DARK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
	spell: `<path d="M3.5 20.5L14 10" stroke="#5a3a22" stroke-width="2.4" stroke-linecap="round"/><path d="M17 2.5l1.3 3.2 3.2 1.3-3.2 1.3L17 11.5l-1.3-3.2-3.2-1.3 3.2-1.3z" fill="#e5322d"/><circle cx="20" cy="15" r="1.3" fill="#f0a01a"/><circle cx="9" cy="4.5" r="1" fill="#f0a01a"/>`,
	rig: `<rect x="9" y="1.8" width="6" height="5" rx="1.6" fill="#f5cd30"/><rect x="7.6" y="7.6" width="8.8" height="7" rx=".8" fill="#0d69ac"/><rect x="4.2" y="7.6" width="3" height="7" rx=".8" fill="#f5cd30"/><rect x="16.8" y="7.6" width="3" height="7" rx=".8" fill="#f5cd30"/><rect x="7.6" y="15.2" width="4.1" height="7" rx=".8" fill="#a4bd47"/><rect x="12.3" y="15.2" width="4.1" height="7" rx=".8" fill="#a4bd47"/>`,
	plugin: `<path d="M10 3.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H19v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H6a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H5V7a1 1 0 0 1 1-1h4z" fill="#7e57c2"/>`,
	folder: `<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" fill="#f2b100"/>`,
	server: `<path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18z" fill="#90caf9"/><path d="M12 10v6m-2.5-2.5L12 16l2.5-2.5" stroke="${BLUE_DARK}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
	baseplate: `<path d="M12 9l10 5-10 5L2 14z" fill="#6b6e78"/><path d="M2 14v2l10 5v-2zM22 14v2l-10 5v-2z" fill="#4b4e57"/><path d="M12 3.5l3.5 1.8L12 7 8.5 5.3z" fill="${BLUE_LIGHT}"/><path d="M8.5 5.3V9L12 10.7V7zM15.5 5.3V9L12 10.7V7z" fill="${BLUE}"/>`,
	reload: `<path d="M20 12a8 8 0 1 1-2.3-5.7" fill="none" stroke="#555" stroke-width="2" stroke-linecap="round"/><path d="M20 3.5v5.5h-5.5z" fill="#555"/>`,
	info: `<circle cx="12" cy="12" r="9.5" fill="${BLUE_DARK}"/><path d="M12 10.5v6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1.3" fill="#fff"/>`,
	notes: `<rect x="5" y="3" width="14" height="18" rx="2" fill="#fff" stroke="#666" stroke-width="1.4"/><path d="M8 8h8M8 12h8M8 16h5" stroke="#9e9e9e" stroke-width="1.4" stroke-linecap="round"/>`,
	settings: `<path d="M10.3 2.5h3.4l.5 2.6 1.6.9 2.5-.9 1.7 2.9-2 1.8v1.9l2 1.7-1.7 3-2.5-.9-1.6.9-.5 2.6h-3.4l-.5-2.6-1.6-.9-2.5.9-1.7-3 2-1.7v-1.9l-2-1.8 1.7-2.9 2.5.9 1.6-.9z" fill="#607d8b"/><circle cx="12" cy="12" r="3.2" fill="#fff"/>`,
	warning: `<path d="M12 3l10 18H2z" fill="#f2b100"/><path d="M12 9.5v5" stroke="#3b3b3b" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.5" r="1.2" fill="#3b3b3b"/>`,
	script: `<path d="M6 3h9l4 4v14H6z" fill="#fff" stroke="#555" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 11l-2 2 2 2M15 11l2 2-2 2" fill="none" stroke="${BLUE_DARK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
	roblox: `<rect x="4" y="4" width="16" height="16" rx="1.6" transform="rotate(15 12 12)" fill="#1b1b1b"/><rect x="10" y="10" width="4" height="4" transform="rotate(15 12 12)" fill="#fff"/>`,
	trash: `<path d="M5 7h14M10 7V4.5h4V7M6.5 7l1 13h9l1-13" fill="none" stroke="#c62828" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`,
	close: `<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
	chevron: `<path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
	clear: `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 17.5l11-11" stroke="currentColor" stroke-width="2"/>`,

	tabMarketplace: `<path d="M5 8h14l-1 13H6z" fill="currentColor"/><path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
	tabInventory: `<g fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></g>`,
	tabRecent: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
	tabCreations: `<path d="M9 18h6M10 21h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" fill="currentColor"/>`,

	assetTree: `<path d="M12 2l6 8h-3l5 7H4l5-7H6z" fill="currentColor"/><rect x="10.8" y="17" width="2.4" height="5" fill="currentColor"/>`,
	assetOak: `<circle cx="12" cy="9" r="7" fill="currentColor"/><rect x="10.8" y="14" width="2.4" height="8" fill="currentColor"/>`,
	assetCar: `<path d="M3 15l2-5.5A2 2 0 0 1 6.9 8h10.2a2 2 0 0 1 1.9 1.5L21 15v4h-2.5a2 2 0 0 1-4 0h-5a2 2 0 0 1-4 0H3z" fill="currentColor"/>`,
	assetHouse: `<path d="M3 11l9-7 9 7v10H3z" fill="currentColor"/>`,
	assetLamp: `<path d="M11 7h2v15h-2zM7 3h10l-2 4H9z" fill="currentColor"/>`,
	assetBench: `<path d="M3 10h18v2.2H3zM4 5h16v3H4zM5 12h2v8H5zM17 12h2v8h-2z" fill="currentColor"/>`,
	assetWall: `<rect x="2" y="5" width="20" height="14" fill="currentColor" opacity=".3"/><path d="M2 9.7h20M2 14.3h20M8 5v4.7M16 5v4.7M12 9.7v4.6M5 14.3V19M19 14.3V19" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="5" width="20" height="14" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
	assetStairs: `<path d="M3 21v-4h4v-4h4V9h4V5h6v16z" fill="currentColor"/>`,
	assetCrate: `<rect x="3" y="3" width="18" height="18" rx="1" fill="currentColor" opacity=".3"/><path d="M3 3l18 18M21 3L3 21" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
	assetSpawn: `<rect x="3" y="15" width="18" height="5" rx="1" fill="currentColor"/><path d="M12 3v9m-3.5-3.5L12 12l3.5-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
};

/**
 * @param {string} name key of ICONS
 * @param {string} [extraClass]
 * @returns {string} inline SVG markup
 */
export function icon(name, extraClass = "") {
	const body = ICONS[name] || ICONS.part;
	return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Fills elements that declare their icon through markup (panel buttons, dialog close). */
export function hydrateIcons(root = document) {
	for (const el of root.querySelectorAll("[data-panel-close], .dialog-close")) el.innerHTML = icon("close");
	for (const el of root.querySelectorAll("[data-panel-menu]")) el.innerHTML = icon("chevron");
	for (const el of root.querySelectorAll("[data-output-clear]")) el.innerHTML = icon("clear");
}
