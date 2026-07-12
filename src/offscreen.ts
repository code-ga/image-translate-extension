import ort from 'onnxruntime-web';

import { PaddleOcrService } from "ppu-paddle-ocr/web";
// Route ONNX directly to the automated assets folder inside your build folder
ort.env.wasm.wasmPaths = chrome.runtime.getURL('onnx-assets/');
ort.env.wasm.numThreads = 1;

const OCR_CACHE_DB_NAME = 'image-translate-extension-ocr-cache';
const OCR_CACHE_STORE_NAME = 'model-assets';
const OCR_CACHE_VERSION = 1;
const OCR_CACHE_URL_PATTERNS = [/ppu-paddle-ocr/i, /paddleocr/i, /\.onnx$/i, /\.bin$/i, /\.json$/i];

let ocrModelInstance: PaddleOcrService | null = null;
let cacheDbPromise: Promise<IDBDatabase> | null = null;
let isFetchWrapperInstalled = false;

type CachedModelAsset = {
	url: string;
	arrayBuffer: ArrayBuffer;
	cachedAt: number;
};

function shouldCacheAssetUrl(url: string) {
	if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('chrome-extension:') || url.startsWith('chrome:')) {
		return false;
	}

	try {
		const parsedUrl = new URL(url, globalThis.location.href);
		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			return false;
		}
		return OCR_CACHE_URL_PATTERNS.some((pattern) => pattern.test(parsedUrl.href));
	} catch {
		return false;
	}
}

function openModelAssetDatabase() {
	if (cacheDbPromise) {
		return cacheDbPromise;
	}

	cacheDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(OCR_CACHE_DB_NAME, OCR_CACHE_VERSION);

		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(OCR_CACHE_STORE_NAME)) {
				database.createObjectStore(OCR_CACHE_STORE_NAME, { keyPath: 'url' });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Failed to open OCR model cache database'));
	});

	return cacheDbPromise;
}

async function getCachedModelAsset(url: string) {
	if (typeof indexedDB === 'undefined') {
		return null;
	}

	const database = await openModelAssetDatabase();
	return new Promise<ArrayBuffer | null>((resolve, reject) => {
		const transaction = database.transaction(OCR_CACHE_STORE_NAME, 'readonly');
		const store = transaction.objectStore(OCR_CACHE_STORE_NAME);
		const request = store.get(url);

		request.onsuccess = () => {
			const result = request.result as CachedModelAsset | undefined;
			resolve(result?.arrayBuffer ?? null);
		};
		request.onerror = () => reject(request.error ?? new Error(`Failed to read cached OCR asset: ${url}`));
	});
}

async function storeCachedModelAsset(url: string, arrayBuffer: ArrayBuffer) {
	if (typeof indexedDB === 'undefined') {
		return;
	}

	const database = await openModelAssetDatabase();
	return new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(OCR_CACHE_STORE_NAME, 'readwrite');
		const store = transaction.objectStore(OCR_CACHE_STORE_NAME);
		const request = store.put({ url, arrayBuffer, cachedAt: Date.now() } satisfies CachedModelAsset);

		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error ?? new Error(`Failed to cache OCR asset: ${url}`));
	});
}

function installModelAssetFetchCache() {
	if (isFetchWrapperInstalled || typeof globalThis.fetch !== 'function' || typeof indexedDB === 'undefined') {
		return;
	}

	const originalFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestUrl = typeof input === 'string'
			? input
			: input instanceof Request
				? input.url
				: input.toString();

		if (shouldCacheAssetUrl(requestUrl) && (!init?.method || init.method.toUpperCase() === 'GET')) {
			const cachedAsset = await getCachedModelAsset(requestUrl);
			if (cachedAsset) {
				return new Response(cachedAsset, {
					status: 200,
					statusText: 'OK',
					headers: { 'content-type': 'application/octet-stream', 'x-ocr-cache': 'hit' },
				});
			}

			const response = await originalFetch(input, init);
			if (!response.ok) {
				return response;
			}

			const arrayBuffer = await response.arrayBuffer();
			await storeCachedModelAsset(requestUrl, arrayBuffer);
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

installModelAssetFetchCache();

async function initOcrModel() {
	if (ocrModelInstance) {
		console.log("Using cached model instance");
		if (!ocrModelInstance.isInitialized()) {
			console.log("Model instance exists but is not initialized. Initializing now...");
			await ocrModelInstance.initialize();
		} else {
			console.log("Model instance is already initialized.");
		}
		return ocrModelInstance;
	}

	console.log("Downloading models and initializing engine...");

	// The JS library runs locally, but it fetches the heavy model layers from your remote CDN
	ocrModelInstance = new PaddleOcrService({
		debugging: {
			debug: false,
			verbose: true,
		},
		session: {
			executionProviders: ["webgpu", 'wasm'],
			enableCpuMemArena: false,
			enableMemPattern: false,
		}
	});
	await ocrModelInstance.initialize();

	console.log("Model successfully fetched and cached in memory!");
	return ocrModelInstance;
}
function base64ToArrayBuffer(base64: string) {
	// Decode base64 to a binary string
	const binaryString = window.atob(base64.startsWith('data:') ? base64.split(',')[1] : base64);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);

	// Populate the typed array
	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	// Return the underlying ArrayBuffer
	return bytes.buffer;
}
// Receive processing requests from background.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.target === 'offscreen' && message.type === 'run-ocr') {
		(async () => {
			try {
				const model = await initOcrModel(); // Reuses the cached model structure instantly
				console.log("Running OCR on the provided image data...", message, "With ort model version is", model);
				const result = await model.recognize(base64ToArrayBuffer(message.imageDataUrl));
				console.log("OCR processing completed:", result);
				model.destroy(); // Clean up the model instance after processing
				sendResponse({ success: true, data: result });
			} catch (error) {
				console.log("Error during OCR processing:", error);
				sendResponse({ success: false, error: new String(error) });
			}
		})();
		return true;
	}
});
