const OCR_CACHE_DB_NAME = "image-translate-extension-ocr-cache";
const OCR_CACHE_STORE_NAME = "model-assets";
const OCR_CACHE_VERSION = 1;
const OCR_CACHE_URL_PATTERNS = [
	/ppu-paddle-ocr/i,
	/paddleocr/i,
	/\.onnx$/i,
	/\.bin$/i,
	/\.json$/i,
];

let isFetchWrapperInstalled = false;

function shouldCacheAssetUrl(url: string) {
	if (
		!url ||
		url.startsWith("data:") ||
		url.startsWith("blob:") ||
		url.startsWith("chrome-extension:") ||
		url.startsWith("chrome:")
	) {
		return false;
	}

	try {
		const parsedUrl = new URL(url, globalThis.location.href);
		if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
			return false;
		}
		return OCR_CACHE_URL_PATTERNS.some((pattern) =>
			pattern.test(parsedUrl.href),
		);
	} catch {
		return false;
	}
}

let cacheDbPromise: Promise<IDBDatabase> | null = null;

function openModelAssetDatabase() {
	if (cacheDbPromise) {
		return cacheDbPromise;
	}

	cacheDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(OCR_CACHE_DB_NAME, OCR_CACHE_VERSION);

		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(OCR_CACHE_STORE_NAME)) {
				database.createObjectStore(OCR_CACHE_STORE_NAME, { keyPath: "url" });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(
				request.error ?? new Error("Failed to open OCR model cache database"),
			);
	});

	return cacheDbPromise;
}

export async function getCachedAsset(url: string): Promise<ArrayBuffer | null> {
	if (typeof indexedDB === "undefined") {
		return null;
	}

	const database = await openModelAssetDatabase();
	return new Promise<ArrayBuffer | null>((resolve, reject) => {
		const transaction = database.transaction(OCR_CACHE_STORE_NAME, "readonly");
		const store = transaction.objectStore(OCR_CACHE_STORE_NAME);
		const request = store.get(url);

		request.onsuccess = () => {
			const result = request.result as
				| { url: string; arrayBuffer: ArrayBuffer; cachedAt: number }
				| undefined;
			resolve(result?.arrayBuffer ?? null);
		};
		request.onerror = () =>
			reject(
				request.error ?? new Error(`Failed to read cached OCR asset: ${url}`),
			);
	});
}

export async function storeCachedAsset(url: string, arrayBuffer: ArrayBuffer) {
	if (typeof indexedDB === "undefined") {
		return;
	}

	const database = await openModelAssetDatabase();
	return new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(OCR_CACHE_STORE_NAME, "readwrite");
		const store = transaction.objectStore(OCR_CACHE_STORE_NAME);
		const request = store.put({
			url,
			arrayBuffer,
			cachedAt: Date.now(),
		});

		request.onsuccess = () => resolve();
		request.onerror = () =>
			reject(request.error ?? new Error(`Failed to cache OCR asset: ${url}`));
	});
}

export function isAssetCacheable(url: string) {
	return shouldCacheAssetUrl(url);
}

export function installAssetFetchCache() {
	if (
		isFetchWrapperInstalled ||
		typeof globalThis.fetch !== "function" ||
		typeof indexedDB === "undefined"
	) {
		return;
	}

	const originalFetch = globalThis.fetch.bind(globalThis);

	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestUrl =
			typeof input === "string"
				? input
				: input instanceof Request
					? input.url
					: input.toString();

		if (
			shouldCacheAssetUrl(requestUrl) &&
			(!init?.method || init.method.toUpperCase() === "GET")
		) {
			const cachedAsset = await getCachedAsset(requestUrl);
			if (cachedAsset) {
				return new Response(cachedAsset, {
					status: 200,
					statusText: "OK",
					headers: {
						"content-type": "application/octet-stream",
						"x-ocr-cache": "hit",
					},
				});
			}

			const response = await originalFetch(input, init);
			if (!response.ok) {
				return response;
			}

			const arrayBuffer = await response.arrayBuffer();
			await storeCachedAsset(requestUrl, arrayBuffer);
			return new Response(arrayBuffer, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
		}

		return originalFetch(input, init);
	}) as typeof fetch;

	isFetchWrapperInstalled = true;
}
