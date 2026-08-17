import ort from "onnxruntime-web";
import { type PaddleOcrResult, PaddleOcrService, V6_SMALL_MODEL } from "ppu-paddle-ocr/web";
import { MAX_CONCURRENT } from "@/config/ocr-config";
import type { OCRBox, OCRRegion } from "@/types";
import { groupOcrBoxesIntoRegions } from "./ocr-region-grouping";

type BatchOcrItem = {
	fetchingType: "url" | "base64";
	imageData: string;
	headers?: Record<string, string>;
};

ort.env.wasm.wasmPaths = browser.runtime.getURL("onnx/" as any);
// ort.env.wasm.numThreads = 1;

console.log("Web gpu", ort.env.webgpu)
console.log("Web gl", ort.env.webgl)
console.log("wasm", ort.env.wasm)
console.log("navigator gpu", navigator.gpu)

let ocrModelInstance: PaddleOcrService | null = null;

function base64ToArrayBuffer(base64: string) {
	const binaryString = window.atob(
		base64.startsWith("data:") ? base64.split(",")[1] : base64,
	);
	const len = binaryString.length;
	const bytes = new Uint8Array(len);

	for (let i = 0; i < len; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return bytes.buffer;
}

export async function initOcrModel(): Promise<PaddleOcrService> {
	if (ocrModelInstance) {
		console.log("Using cached model instance");
		if (!ocrModelInstance.isInitialized()) {
			console.log(
				"Model instance exists but is not initialized. Initializing now...",
			);
			await ocrModelInstance.initialize();
		} else {
			console.log("Model instance is already initialized.");
		}
		return ocrModelInstance;
	}

	console.log("Downloading models and initializing engine...");

	ocrModelInstance = new PaddleOcrService({
		debugging: {
			debug: false,
			verbose: true,
		},
		session: {
			executionProviders: ["gpu", "webgpu", "webgl", "wasm"],
			enableCpuMemArena: false,
			enableMemPattern: false,
			graphOptimizationLevel: "disabled"
		},
	});
	await ocrModelInstance.initialize();
	console.log("Web gpu", ort.env.webgpu)
	console.log("Web gl", ort.env.webgl)
	console.log("wasm", ort.env.wasm)
	console.log("navigator gpu", navigator.gpu)


	console.log("Model successfully fetched and cached in memory!");
	return ocrModelInstance;
}

export async function runBatchOcr(items: BatchOcrItem[]) {
	const model = await initOcrModel();
	const imageBuffers = items.map((item) => base64ToArrayBuffer(item.imageData));

	console.log(`Running batch OCR on ${imageBuffers.length} images...`);
	const results = await model.batchRecognize(imageBuffers, {
		settle: true,
		strategy: "per-box",
	});

 	return results.map((result) => {
 		if (result.status === "fulfilled") {
 			const rawBoxes: OCRBox[] = (
 				result.value as PaddleOcrResult
 			).lines.flatMap((value) =>
 				value.flatMap((a) => {
 					if (a.text.length === 0) return [];
 					const x = a.box.x;
 					const y = a.box.y;
 					const width = a.box.width;
 					const height = a.box.height;
 					return [
 						{
 							text: a.text,
 							box: { x, y, width, height },
 							polygon: [
 								{ x, y },
 								{ x: x + width, y },
 								{ x: x + width, y: y + height },
 								{ x, y: y + height },
 							],
 						},
 					];
 				}),
 			);
 			const regions = groupOcrBoxesIntoRegions(rawBoxes);
 			return { success: true, data: regions };
 		} else {
 			return { success: false, error: new String(result.reason) };
 		}
 	});
}
