/*
 * Maps upstream Roblox/HTTP failures to a stable { status, code, message } the frontend can show
 * directly. Messages are user-facing (pt-BR); technical detail stays in server logs.
 */

/** Error carrying a safe, user-facing message plus the HTTP status to return. */
export class ApiError extends Error {
	/**
	 * @param {number} status HTTP status to send to the frontend
	 * @param {string} code machine-readable code (e.g. "not_found")
	 * @param {string} message user-facing message (pt-BR)
	 * @param {unknown} [detail] technical detail for server logs only
	 */
	constructor(status, code, message, detail) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

const MESSAGES = {
	400: ["bad_request", "Requisição inválida."],
	401: ["unauthorized", "Este asset existe, mas seu conteúdo não está disponível para esta integração."],
	403: ["forbidden", "Este asset não pode ser acessado por esta integração."],
	404: ["not_found", "Asset não encontrado."],
	429: ["rate_limited", "Limite da API Roblox atingido. Tente novamente em alguns segundos."],
	500: ["upstream_error", "Roblox está temporariamente indisponível."],
	502: ["upstream_error", "Roblox está temporariamente indisponível."],
	503: ["upstream_error", "Roblox está temporariamente indisponível."]
};

/** Builds an ApiError from an upstream HTTP status. */
export function fromStatus(status, detail) {
	const [code, message] = MESSAGES[status] || ["upstream_error", "Roblox está temporariamente indisponível."];
	return new ApiError(status >= 400 && status <= 599 ? status : 502, code, message, detail);
}

export const timeoutError = () => new ApiError(504, "timeout", "Tempo limite ao consultar o Roblox.");
export const noImporterError = (type) => new ApiError(422, "no_importer", `Encontramos o asset, mas o tipo "${type || "desconhecido"}" ainda não possui suporte de importação na engine.`);
export const noContentError = () => new ApiError(422, "no_content", "Este asset existe, mas seu conteúdo não está disponível para esta integração.");
export const badIdError = () => new ApiError(400, "invalid_id", "Asset ID inválido.");
