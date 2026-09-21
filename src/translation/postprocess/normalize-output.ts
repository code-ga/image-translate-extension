import type { TokenMap } from "../preprocess/protect-tokens";

const LINE_BREAK_NORMALIZE = /\r\n|\r/g;
const INLINE_WHITESPACE = /[ \t\f\v]+/g;

export function normalizeOutput(text: string, tokens?: TokenMap): string {
	if (!text) return "";

	let result = text.replace(LINE_BREAK_NORMALIZE, "\n");
	result = result
		.split("\n")
		.map((line) => line.replace(INLINE_WHITESPACE, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n")
		.trim();

	return tokens ? restoreProtectedTokens(result, tokens) : result;
}

function restoreProtectedTokens(text: string, tokens: TokenMap): string {
	let result = text;
	for (const [placeholder, original] of [...tokens.entries()].sort(
		(a, b) => b[0].length - a[0].length,
	)) {
		const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		result = result.replace(new RegExp(escaped, "g"), original);
	}
	return result;
}

export function preserveIntentionalLineBreaks(text: string): string {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n");
}
