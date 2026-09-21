import type { NllbLanguageCode, TranslationCacheEntry } from "../types";

const CACHE_DB_NAME = "translation-cache";
const CACHE_STORE_NAME = "entries";
const CACHE_DB_VERSION = 1;
const MAX_L1_SIZE = 500;
const MAX_L2_SIZE = 5000;

const l1Cache = new Map<string, TranslationCacheEntry>();
let l1AccessOrder: string[] = [];
let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is unavailable"));
			return;
		}
		const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
				db.createObjectStore(CACHE_STORE_NAME, { keyPath: "hash" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return dbPromise;
}

async function sha256(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function createCacheKey(
	modelVersion: string,
	engineVersion: string,
	srcLang: NllbLanguageCode,
	targetLang: NllbLanguageCode,
	normalizedText: string,
): Promise<string> {
	return sha256(
		`${modelVersion}|${engineVersion}|${srcLang}|${targetLang}|${normalizedText}`,
	);
}

export async function getFromCache(
	modelVersion: string,
	engineVersion: string,
	srcLang: NllbLanguageCode,
	targetLang: NllbLanguageCode,
	normalizedText: string,
): Promise<string | null> {
	const key = await createCacheKey(
		modelVersion,
		engineVersion,
		srcLang,
		targetLang,
		normalizedText,
	);
	const l1Entry = l1Cache.get(key);
	if (l1Entry) {
		updateL1Access(key);
		return l1Entry.result;
	}

	try {
		const db = await getDb();
		const transaction = db.transaction(CACHE_STORE_NAME, "readonly");
		const request = transaction.objectStore(CACHE_STORE_NAME).get(key);
		const entry = await new Promise<TranslationCacheEntry | undefined>(
			(resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			},
		);
		if (entry) {
			l1Cache.set(key, entry);
			updateL1Access(key);
			enforceL1Limit();
			return entry.result;
		}
	} catch {
		return null;
	}
	return null;
}

export async function setInCache(
	modelVersion: string,
	engineVersion: string,
	srcLang: NllbLanguageCode,
	targetLang: NllbLanguageCode,
	normalizedText: string,
	result: string,
): Promise<void> {
	const key = await createCacheKey(
		modelVersion,
		engineVersion,
		srcLang,
		targetLang,
		normalizedText,
	);
	const entry: TranslationCacheEntry = {
		hash: key,
		modelVersion,
		engineVersion,
		srcLang,
		targetLang,
		result,
		timestamp: Date.now(),
	};
	l1Cache.set(key, entry);
	updateL1Access(key);
	enforceL1Limit();

	try {
		const db = await getDb();
		const transaction = db.transaction(CACHE_STORE_NAME, "readwrite");
		const request = transaction.objectStore(CACHE_STORE_NAME).put(entry);
		await new Promise<void>((resolve, reject) => {
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
		await enforceL2Limit(db);
	} catch {
		// L1 remains available when persistent storage is blocked.
	}
}

function updateL1Access(key: string): void {
	const index = l1AccessOrder.indexOf(key);
	if (index !== -1) l1AccessOrder.splice(index, 1);
	l1AccessOrder.push(key);
}

function enforceL1Limit(): void {
	while (l1Cache.size > MAX_L1_SIZE && l1AccessOrder.length > 0) {
		const oldest = l1AccessOrder.shift();
		if (oldest) l1Cache.delete(oldest);
	}
}

async function enforceL2Limit(db: IDBDatabase): Promise<void> {
	try {
		const transaction = db.transaction(CACHE_STORE_NAME, "readwrite");
		const store = transaction.objectStore(CACHE_STORE_NAME);
		const count = await new Promise<number>((resolve, reject) => {
			const request = store.count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		if (count <= MAX_L2_SIZE) return;

		let deleted = 0;
		await new Promise<void>((resolve, reject) => {
			const request = store.openCursor();
			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (!cursor || deleted >= count - MAX_L2_SIZE) {
					resolve();
					return;
				}
				cursor.delete();
				deleted++;
				cursor.continue();
			};
			request.onerror = () => reject(request.error);
		});
	} catch {
		// Cache eviction is best-effort.
	}
}

export async function clearCache(): Promise<void> {
	l1Cache.clear();
	l1AccessOrder = [];
	try {
		const db = await getDb();
		const transaction = db.transaction(CACHE_STORE_NAME, "readwrite");
		const request = transaction.objectStore(CACHE_STORE_NAME).clear();
		await new Promise<void>((resolve, reject) => {
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	} catch {
		// Persistent cache may be unavailable.
	}
}

export function getL1CacheSize(): number {
	return l1Cache.size;
}

export function getL1CacheKeys(): string[] {
	return [...l1Cache.keys()];
}
