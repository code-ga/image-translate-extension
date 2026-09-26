import { PriorityQueue } from "@/src/queue/priority-queue";
import {
	type Job,
	type JobResponse,
	type OcrJob,
	OFFSCREEN_PORT_NAME,
	type PortControlMessage,
	type QueueRequest,
	type QueueResult,
	type TranslateTextJobPayload,
} from "@/src/queue/types";
import {
	applyTranslationsToRegions,
	translateRegions,
	translationEngine,
} from "@/src/translation/engine";
import type {
	NllbLanguageCode,
	TranslationResponse,
	TranslationUnit,
} from "@/src/translation/types";
import type { OCRRegion, OcrInputItem } from "@/types";
import { installAssetFetchCache } from "@/utils/asset-cache";
import { fetchImageAsBase64 } from "@/utils/image-fetch";
import { runBatchOcr } from "@/utils/ocr-batcher";

installAssetFetchCache();

const jobQueue = new PriorityQueue();
let draining = false;

browser.runtime.onConnect.addListener((port) => {
	if (port.name !== OFFSCREEN_PORT_NAME) return;

	const postResult = (jobId: string, response: JobResponse) => {
		try {
			const message: QueueResult = {
				type: "queue/result",
				jobId,
				response,
			};
			port.postMessage(message);
		} catch {
			// The background port is gone; the job result is dropped.
		}
	};

	const postReady = () => {
		try {
			const message: PortControlMessage = { type: "queue/ready" };
			port.postMessage(message);
		} catch {
			// The background gave up on this port.
		}
	};

	port.onMessage.addListener((message: QueueRequest | PortControlMessage) => {
		if (message?.type === "queue/ping") {
			postReady();
			return;
		}
		if (message?.type !== "queue/enqueue") return;

		jobQueue.enqueue({
			id: message.jobId,
			payload: message.payload,
			resolve: (response) => postResult(message.jobId, response),
			reject: (error) =>
				postResult(message.jobId, { success: false, error: error.message }),
		});
		scheduleDrain();
	});

	postReady();
});

function scheduleDrain(): void {
	if (draining) return;
	draining = true;
	queueMicrotask(() => {
		void drainQueue();
	});
}

async function drainQueue(): Promise<void> {
	try {
		while (!jobQueue.isEmpty()) {
			// One job at a time: OCR inference is serial now, so holding several
			// jobs in one dispatch would only starve translation.
			const job = jobQueue.dequeue();
			if (!job) break;
			await processJob(job);
		}
	} catch (error) {
		console.error("Queue drain failed:", error);
	} finally {
		draining = false;
		if (!jobQueue.isEmpty()) scheduleDrain();
	}
}

async function processJob(job: Job): Promise<void> {
	if (job.type === "ocr") {
		await processOcrJob(job as OcrJob);
		return;
	}
	await processTranslateJob(job);
}

async function processOcrJob(job: OcrJob): Promise<void> {
	try {
		const payload = job.payload;
		const item: OcrInputItem =
			payload.fetchingType === "url" && payload.headers
				? {
						fetchingType: "base64",
						imageData: await fetchImageAsBase64(
							payload.imageData,
							payload.headers,
						),
					}
				: {
						fetchingType: payload.fetchingType,
						imageData: payload.imageData,
					};

		const results = await runBatchOcr([item]);
		const result = results[0];

		if (result?.success) {
			job.resolve({ success: true, ocrData: stripTranslations(result.data) });
		} else {
			job.resolve({
				success: false,
				error: result?.error ?? "Unknown batch item error",
			});
		}
	} catch (error) {
		job.resolve({
			success: false,
			error: error instanceof Error ? error.message : "Batch processing failed",
		});
	}
}

async function processTranslateJob(job: Job): Promise<void> {
	const payload = job.payload;

	if (payload.kind === "ocr") {
		job.resolve({
			success: false,
			error: "OCR job reached the translation dispatcher",
		});
		return;
	}

	try {
		if (payload.kind === "translate-text") {
			job.resolve(await translateText(payload));
			return;
		}

		const response: TranslationResponse = await translateRegions(
			payload.regions,
		);
		const regions: OCRRegion[] = applyTranslationsToRegions(
			payload.regions,
			response,
		);
		job.resolve({ success: true, regions, errors: response.errors });
	} catch (error) {
		job.resolve({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

async function translateText(
	payload: TranslateTextJobPayload,
): Promise<JobResponse> {
	const units: TranslationUnit[] = [
		{
			id: `text_${Date.now()}`,
			sourceText: payload.text,
			bbox: { x: 0, y: 0, width: 0, height: 0 },
			boxReferences: [],
			boxIndexes: [],
			detectedLanguage: (payload.srcLang ||
				"unknown") as TranslationUnit["detectedLanguage"],
			detectionConfidence: payload.srcLang ? 1 : 0,
		},
	];

	const response = await translationEngine.translate({
		units,
		targetLang: payload.targetLang as NllbLanguageCode,
	});

	const result = response.results[0];
	if (!result) {
		return {
			success: false,
			error: response.errors[0]?.message || "No translation result",
		};
	}

	return { success: true, translatedText: result.translatedText };
}

function stripTranslations(regions: OCRRegion[]): OCRRegion[] {
	return regions.map((region) => ({
		...region,
		translation: undefined,
		boxes: region.boxes.map((box) => ({ ...box })),
	}));
}
