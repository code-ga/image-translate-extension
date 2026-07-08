import ort from 'onnxruntime-web';

import { PaddleOcrService } from "ppu-paddle-ocr/web";
// Route ONNX directly to the automated assets folder inside your build folder
ort.env.wasm.wasmPaths = chrome.runtime.getURL('onnx-assets/');
ort.env.wasm.numThreads = 1;

let ocrModelInstance: PaddleOcrService | null = null;

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
	});
	await ocrModelInstance.initialize();

	console.log("Model successfully fetched and cached in memory!");
	return ocrModelInstance;
}
function base64ToArrayBuffer(base64: string) {
	// Decode base64 to a binary string
	const binaryString = window.atob(base64);
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
				console.log(message);
				const result = await model.recognize(base64ToArrayBuffer(message.imageDataUrl));
				console.log("OCR processing completed:", result);
				sendResponse({ success: true, data: result });
			} catch (error) {
				console.log("Error during OCR processing:", error);
				sendResponse({ success: false, error: error });
			}
		})();
		return true;
	}
});
