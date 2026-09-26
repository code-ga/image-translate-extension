import ort from "onnxruntime-web";
import { type PaddleOcrResult, PaddleOcrService } from "ppu-paddle-ocr/web";
import { OCR_CONCURRENCY } from "@/config/ocr-config";
import type { OCRBox, OCRRegion, OcrInputItem } from "@/types";
import { groupOcrBoxesIntoRegions } from "./ocr-region-grouping";

ort.env.wasm.wasmPaths = browser.runtime.getURL("onnx/" as any);
// ort.env.wasm.numThreads = 1;

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
			verbose: false,
		},
		session: {
			// Left unset on purpose: the SDK resolves ["webgpu", "wasm"] (or
			// ["wasm"]) from an actual adapter probe, which is more reliable than
			// the previous hand-written list that named the same EP twice.
			enableCpuMemArena: true,
			enableMemPattern: true,
			graphOptimizationLevel: "all",
		},
	});
	await ocrModelInstance.initialize();

	console.log("Model successfully fetched and cached in memory!");
	return ocrModelInstance;
}

type RunBatchResultItem =
	| { success: true; data: OCRRegion[] }
	| { success: false; error: string };

async function recognizeImage(
	model: PaddleOcrService,
	item: OcrInputItem,
): Promise<RunBatchResultItem> {
	try {
		const buffer = base64ToArrayBuffer(item.imageData);
		const ocrResult = await model.batchRecognize([buffer], {
			settle: true,
			strategy: "per-box",
		});
		const result = ocrResult[0];
		if (!result) {
			return { success: false, error: "OCR returned no result" };
		}
		if (result.status !== "fulfilled") {
			return { success: false, error: String(result.reason) };
		}

		const rawBoxes: OCRBox[] = (result.value as PaddleOcrResult).lines.flatMap(
			(value) =>
				value.flatMap((box) => {
					if (box.text.length === 0) return [];
					const x = box.box.x;
					const y = box.box.y;
					const width = box.box.width;
					const height = box.box.height;
					return [
						{
							text: box.text,
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

		return { success: true, data: groupOcrBoxesIntoRegions(rawBoxes) };
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export async function runBatchOcr(
	items: OcrInputItem[],
): Promise<RunBatchResultItem[]> {
	const model = await initOcrModel();
	const results = new Array<RunBatchResultItem>(items.length);

	// Bounded pool: the detection and recognition sessions are shared by every
	// image, so only OCR_CONCURRENCY pipelines may be in flight at a time.
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await recognizeImage(model, items[index]);
		}
	};

	const workerCount = Math.max(1, Math.min(OCR_CONCURRENCY, items.length));
	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	return results;
}
