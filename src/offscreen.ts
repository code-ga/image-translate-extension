import ort from 'onnxruntime-web';

import { PaddleOcrService } from "ppu-paddle-ocr/web";
// Route ONNX directly to the automated assets folder inside your build folder
ort.env.wasm.wasmPaths = chrome.runtime.getURL('onnx-assets/');
ort.env.wasm.numThreads = 1;

let ocrModelInstance: PaddleOcrService | null = null;

async function initOcrModel() {
	if (ocrModelInstance) return ocrModelInstance;

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

// Receive processing requests from background.js
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.target === 'offscreen' && message.type === 'run-ocr') {
		(async () => {
			try {
				const model = await initOcrModel(); // Reuses the cached model structure instantly
				const result = await model.recognize(message.imageDataUrl);
				sendResponse({ success: true, data: result });
			} catch (error) {
				console.log("Error during OCR processing:", error);
				sendResponse({ success: false, error: error });
			}
		})();
		return true;
	}
});
