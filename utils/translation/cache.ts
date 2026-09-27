import type { TranslationRequest, TranslationResult } from "./types";

const CACHE_DB_NAME = "translation-cache";
const CACHE_STORE_NAME = "entries";
const CACHE_VERSION = 1;
const MODEL_VERSION = "nllb-200-distilled-600M-v1";

const memoryCache = new Map<string, TranslationResult[]>();

function generateCacheKey(request: TranslationRequest): string {
	const texts = request.units.map((u) => u.sourceText).join("\0");
	const langPair = `${request.targetLang}`;
	const combined = `${MODEL_VERSION}|${langPair}|${texts}`;
	let hash = 0;
	for (let i = 0; i < combined.length; i++) {
		const char = combined.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0;
	}
	return hash.toString(36);
}

async function getDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(CACHE_DB_NAME, CACHE_VERSION);
		request.onerror = () => reject(new Error("Failed to open IndexedDB"));
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
				db.createObjectStore(CACHE_STORE_NAME);
			}
		};
	});
}

export async function getCachedTranslation(
	request: TranslationRequest,
): Promise<TranslationResult[] | null> {
	const key = generateCacheKey(request);

	const memoryHit = memoryCache.get(key);
	if (memoryHit) {
		return memoryHit.map((r) => ({ ...r, cached: true }));
	}

	try {
		const db = await getDb();
		const transaction = db.transaction(CACHE_STORE_NAME, "readonly");
		const store = transaction.objectStore(CACHE_STORE_NAME);
		const getRequest = store.get(key);

		return new Promise((resolve, reject) => {
			getRequest.onsuccess = () => {
				const result = getRequest.result as TranslationResult[] | undefined;
				if (result) {
					memoryCache.set(key, result);
					resolve(result.map((r) => ({ ...r, cached: true })));
				} else {
					resolve(null);
				}
			};
			getRequest.onerror = () => reject(new Error("Cache read failed"));
		});
	} catch {
		return null;
	}
}

export async function setCachedTranslation(
	request: TranslationRequest,
	results: TranslationResult[],
): Promise<void> {
	const key = generateCacheKey(request);
	memoryCache.set(key, results);

	try {
		const db = await getDb();
		const transaction = db.transaction(CACHE_STORE_NAME, "readwrite");
		const store = transaction.objectStore(CACHE_STORE_NAME);
		store.put(results, key);
	} catch {}
}

export function clearMemoryCache(): void {
	memoryCache.clear();
}
