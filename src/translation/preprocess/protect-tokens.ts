const TOKEN_PATTERNS: RegExp[] = [
	/https?:\/\/[^\s]+/g,
	/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
	/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*%/g,
	/[$€£¥₹]\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/g,
	/\b0x[0-9a-fA-F]+\b/g,
	/#[0-9a-fA-F]{3,8}\b/g,
	/(?:[a-zA-Z]:[\\/]|[\\/])(?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]*/g,
	/\b(?:[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*\d[A-Za-z0-9_]*|\d[A-Za-z0-9_]*_[A-Za-z0-9_]*)\b/g,
	/\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\b/g,
];

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function protectTokens(text: string): {
	protectedText: string;
	tokens: Map<string, string>;
} {
	const tokens = new Map<string, string>();
	let protectedText = text;
	let tokenCounter = 0;

	for (const pattern of TOKEN_PATTERNS) {
		for (const match of protectedText.matchAll(pattern)) {
			const original = match[0];
			const placeholder = `__TOKEN_${tokenCounter}__`;
			tokens.set(placeholder, original);
			protectedText = protectedText.replace(
				escapeRegExp(original),
				placeholder,
			);
			tokenCounter++;
		}
	}

	return { protectedText, tokens };
}

export function restoreTokens(
	translatedText: string,
	tokens: Map<string, string>,
): string {
	let result = translatedText;
	for (const [placeholder, original] of [...tokens.entries()].sort(
		(a, b) => b[0].length - a[0].length,
	)) {
		result = result.replace(
			new RegExp(escapeRegExp(placeholder), "g"),
			original,
		);
	}
	return result;
}

export type TokenMap = Map<string, string>;
