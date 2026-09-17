import type { OCRRegion } from "@/types";

const CACHE_KEY_PREFIX = "ocr-cache:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OcrCacheEntry {
	source: string;
	ocrData: OCRRegion[];
	timestamp: number;
}

export async function getCachedOcr(
	source: string,
): Promise<OCRRegion[] | null> {
	try {
		const result = (await browser.storage.local.get(
			CACHE_KEY_PREFIX + source,
		)) as Record<string, OcrCacheEntry | undefined>;
		const entry = result[CACHE_KEY_PREFIX + source];
		if (!entry) return null;
		if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
			await browser.storage.local.remove(CACHE_KEY_PREFIX + source);
			return null;
		}
		return entry.ocrData;
	} catch {
		return null;
	}
}

export async function storeCachedOcr(
	source: string,
	ocrData: OCRRegion[],
): Promise<void> {
	try {
		await browser.storage.local.set({
			[CACHE_KEY_PREFIX + source]: {
				source,
				ocrData,
				timestamp: Date.now(),
			} satisfies OcrCacheEntry,
		});
	} catch {
		// Ignore storage errors
	}
}
