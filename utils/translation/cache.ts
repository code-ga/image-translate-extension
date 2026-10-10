import type { TranslationRequest, TranslationResult } from "./types";

const memoryCache = new Map<string, TranslationResult[]>();

function generateCacheKey(request: TranslationRequest): string {
	const texts = request.units.map((u) => u.sourceText).join("\0");
	const langPair = `${request.targetLang}`;
	return `${langPair}|${texts}`;
}

export async function getCachedTranslation(
	request: TranslationRequest,
): Promise<TranslationResult[] | null> {
	const key = generateCacheKey(request);
	const hit = memoryCache.get(key);
	if (hit) {
		return hit.map((r) => ({ ...r, cached: true }));
	}
	return null;
}

export async function setCachedTranslation(
	request: TranslationRequest,
	results: TranslationResult[],
): Promise<void> {
	const key = generateCacheKey(request);
	memoryCache.set(key, results);
}

export function clearMemoryCache(): void {
	memoryCache.clear();
}
