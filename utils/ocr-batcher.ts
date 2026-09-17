import ort from "onnxruntime-web";
import {
	type AnyOcrResult,
	type BatchItemResult,
	PaddleOcrService,
	type RecognitionResult,
} from "ppu-paddle-ocr/web";
import { MAX_CONCURRENT } from "@/config/ocr-config";
import type { OCRBox, OCRRegion, OcrImagePayload } from "@/types";
import { groupOcrBoxesIntoRegions } from "./ocr-region-grouping";

ort.env.wasm.wasmPaths = browser.runtime.getURL("onnx/" as never);

let ocrModelInstance: PaddleOcrService | null = null;

export type OcrBatchResult =
	| { success: true; data: OCRRegion[] }
	| { success: false; error: string };

type DecodedOcrItem = {
	originalIndex: number;
	item: OcrImagePayload;
	buffer: ArrayBuffer;
};

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}

function getErrorDetails(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return { value: String(error) };
}

function decodeImageData(item: OcrImagePayload): ArrayBuffer {
	const raw = item.imageData.trim();
	const encoded = (
		raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw
	).replace(/\s/g, "");
	console.info("[image-translate] Decoding image data", {
		fetchingType: item.fetchingType,
		rawLength: raw.length,
		encodedLength: encoded.length,
		hasDataPrefix: raw.startsWith("data:"),
	});
	if (!encoded) throw new Error("Image data is empty");
	const binaryString = window.atob(encoded);
	const bytes = new Uint8Array(binaryString.length);
	for (let index = 0; index < binaryString.length; index++) {
		bytes[index] = binaryString.charCodeAt(index);
	}
	console.info("[image-translate] Image data decoded", {
		bufferSize: bytes.buffer.byteLength,
		fetchingType: item.fetchingType,
	});
	return bytes.buffer;
}

function recognitionResultToBox(result: RecognitionResult): OCRBox {
	const { x, y, width, height } = result.box;
	return {
		text: result.text,
		box: { x, y, width, height },
		polygon: [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
	};
}

function resultToBoxes(result: AnyOcrResult): OCRBox[] {
	if ("lines" in result) {
		return result.lines.flatMap((line) =>
			line.map((recognition) => recognitionResultToBox(recognition)),
		);
	}
	if ("results" in result) {
		return result.results.map((recognition) =>
			recognitionResultToBox(recognition),
		);
	}
	return [];
}

function resultToBatchItem(result: AnyOcrResult): OcrBatchResult {
	try {
		const regions = groupOcrBoxesIntoRegions(resultToBoxes(result));
		return { success: true, data: regions };
	} catch (error) {
		return {
			success: false,
			error: getErrorMessage(error, "Failed to group OCR regions"),
		};
	}
}

function fulfilledBatchItem(
	result: Extract<BatchItemResult<AnyOcrResult>, { status: "fulfilled" }>,
	decodedItems: DecodedOcrItem[],
): OcrBatchResult {
	const decodedItem = decodedItems[result.index];
	if (!decodedItem) {
		return { success: false, error: "OCR result index was out of range" };
	}
	return resultToBatchItem(result.value);
}

async function recognizeIndividually(
	model: PaddleOcrService,
	decodedItems: DecodedOcrItem[],
	results: OcrBatchResult[],
) {
	const outcomes = await Promise.allSettled(
		decodedItems.map(async (decodedItem) => {
			const value = await model.recognize(decodedItem.buffer, {
				strategy: "per-box",
			});
			return { decodedItem, value };
		}),
	);
	outcomes.forEach((outcome, index) => {
		const decodedItem = decodedItems[index];
		if (!decodedItem) return;
		if (outcome.status === "rejected") {
			results[decodedItem.originalIndex] = {
				success: false,
				error: getErrorMessage(outcome.reason, "Individual OCR failed"),
			};
			return;
		}
		results[decodedItem.originalIndex] = resultToBatchItem(outcome.value.value);
	});
}

export async function initOcrModel(): Promise<PaddleOcrService> {
	if (ocrModelInstance) {
		if (!ocrModelInstance.isInitialized()) {
			try {
				console.info("[image-translate] Re-initializing OCR model");
				await ocrModelInstance.initialize();
			} catch (error) {
				console.error("[image-translate] OCR model re-init failed", {
					error: getErrorDetails(error),
				});
				ocrModelInstance = null;
				throw error;
			}
		}
		return ocrModelInstance;
	}

	console.info("[image-translate] Creating new OCR model instance");
	ocrModelInstance = new PaddleOcrService({
		debugging: {
			debug: false,
			// verbose: true,
		},
		session: {
			executionProviders: ["wasm"],
			enableCpuMemArena: false,
			enableMemPattern: false,
			graphOptimizationLevel: "disabled",
		},
	});
	try {
		console.info("[image-translate] OCR model initializing");
		await ocrModelInstance.initialize();
		console.info("[image-translate] OCR model initialized successfully");
		return ocrModelInstance;
	} catch (error) {
		console.error("[image-translate] OCR model initialization failed", {
			error: getErrorDetails(error),
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
		});
		ocrModelInstance = null;
		throw error;
	}
}

export async function runBatchOcr(
	items: OcrImagePayload[],
): Promise<OcrBatchResult[]> {
	if (items.length === 0) return [];

	const results: OcrBatchResult[] = items.map(() => ({
		success: false,
		error: "Image decoding failed",
	}));
	const decodeOutcomes = await Promise.allSettled(
		items.map((item) => decodeImageData(item)),
	);
	const decodedItems: DecodedOcrItem[] = [];
	decodeOutcomes.forEach((outcome, originalIndex) => {
		if (outcome.status === "rejected") {
			results[originalIndex] = {
				success: false,
				error: getErrorMessage(outcome.reason, "Image decoding failed"),
			};
			console.error("[image-translate] OCR image decode failed", {
				index: originalIndex,
				fetchingType: items[originalIndex]?.fetchingType,
				error: getErrorDetails(outcome.reason),
			});
			return;
		}
		decodedItems.push({
			originalIndex,
			item: items[originalIndex],
			buffer: outcome.value,
		});
	});

	if (decodedItems.length === 0) return results;

	console.info("[image-translate] Initializing OCR model", {
		totalItems: items.length,
		decodedItems: decodedItems.length,
		bufferSizes: decodedItems.map((d) => d.buffer.byteLength),
	});
	const model = await initOcrModel();
	console.info("[image-translate] OCR model initialized", {
		totalItems: items.length,
		decodedItems: decodedItems.length,
	});
	console.info("[image-translate] OCR batch started", {
		total: items.length,
		decoded: decodedItems.length,
	});
	try {
		const engineResults = await model.batchRecognize(
			decodedItems.map((decodedItem) => decodedItem.buffer),
			{
				settle: true,
				strategy: "per-box",
				concurrency: MAX_CONCURRENT,
			},
		);
		console.info("[image-translate] OCR batch recognize completed", {
			total: items.length,
			resultsCount: engineResults.length,
			fulfilledCount: engineResults.filter((r) => r.status === "fulfilled")
				.length,
			rejectedCount: engineResults.filter((r) => r.status === "rejected")
				.length,
		});
		engineResults.forEach((result) => {
			const decodedItem = decodedItems[result.index];
			if (!decodedItem) return;
			results[decodedItem.originalIndex] =
				result.status === "fulfilled"
					? fulfilledBatchItem(result, decodedItems)
					: {
							success: false,
							error: getErrorMessage(
								result.reason,
								"OCR failed for this image",
							),
						};
		});
	} catch (error) {
		console.error(
			"[image-translate] OCR batch call failed; retrying images individually",
			{
				total: decodedItems.length,
				error: getErrorDetails(error),
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			},
		);
		console.info("[image-translate] Retrying OCR images individually", {
			decodedCount: decodedItems.length,
		});
		await recognizeIndividually(model, decodedItems, results);
	}

	const successCount = results.filter((result) => result.success).length;
	console.info("[image-translate] OCR batch finished", {
		total: items.length,
		successCount,
		failureCount: items.length - successCount,
	});
	return results;
}
