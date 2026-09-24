import type { OCRRegion } from "@/types";
import { detectLanguagesForUnits } from "./language/language-resolver";
import { groupRegionsIntoTranslationUnits } from "./preprocess/grouping";
import type {
	ModelProgress,
	ModelStatus,
	TranslationRequest,
	TranslationResponse,
	TranslationUnit,
	TranslationWorkerRequest,
	TranslationWorkerResponse,
} from "./types";
import { MAX_TRANSLATION_CHARS, TARGET_LANGUAGE } from "./types";
import TranslationWorker from "./worker?worker";

type PendingRequest = {
	resolve: (response: TranslationWorkerResponse) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
	onProgress: ((progress: ModelProgress) => void) | undefined;
};

let worker: Worker | null = null;
let requestIdCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();

function getWorker(): Worker | null {
	if (worker) return worker;

	worker = new TranslationWorker({ name: "image-translate-model" });

	worker.onmessage = (event: MessageEvent<TranslationWorkerResponse>) => {
		const data = event.data;
		const pending = pendingRequests.get(data.requestId);
		if (!pending) return;

		if (data.type === "progress") {
			pending.onProgress?.(data.payload);
			return;
		}

		clearTimeout(pending.timeout);
		pendingRequests.delete(data.requestId);
		pending.resolve(data);
	};

	worker.onerror = (event) => {
		const error = new Error(event.message || "Translation worker failed");
		for (const pending of pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		pendingRequests.clear();
		worker = null;
	};

	return worker;
}

function generateRequestId(): string {
	return `translation_${++requestIdCounter}_${Date.now()}`;
}

function sendToWorker(
	request: TranslationWorkerRequest,
	onProgress?: (progress: ModelProgress) => void,
): Promise<TranslationWorkerResponse> {
	const workerInstance = getWorker();
	if (!workerInstance) {
		return Promise.reject(new Error("Translation worker is unavailable"));
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingRequests.delete(request.requestId);
			reject(new Error("Translation worker request timed out"));
		}, 120000);
		pendingRequests.set(request.requestId, {
			resolve,
			reject,
			timeout,
			onProgress,
		});
		workerInstance.postMessage(request);
	});
}

async function requestWorker(
	request: TranslationWorkerRequest,
	onProgress?: (progress: ModelProgress) => void,
): Promise<TranslationWorkerResponse> {
	const response = await sendToWorker(request, onProgress);
	if (response.type === "error") {
		throw new Error(response.payload.message);
	}
	return response;
}

export interface TranslationEngine {
	translate(
		request: TranslationRequest,
		onProgress?: (progress: ModelProgress) => void,
	): Promise<TranslationResponse>;
	warmup(): Promise<void>;
	dispose(): Promise<void>;
	getStatus(): Promise<ModelStatus>;
}

function workerUnavailableResponse(
	request: TranslationRequest,
	message: string,
): TranslationResponse {
	return {
		results: request.units.map((unit) => ({
			unitId: unit.id,
			translatedText: unit.sourceText,
			sourceLanguage: unit.detectedLanguage,
			cached: false,
			bbox: unit.bbox,
			boxReferences: unit.boxReferences,
			boxIndexes: unit.boxIndexes,
		})),
		errors: [
			{
				code: "WORKER_ERROR",
				message,
				recoverable: true,
			},
		],
	};
}

export const translationEngine: TranslationEngine = {
	async translate(request, onProgress) {
		let unitsWithLang: TranslationUnit[];
		try {
			unitsWithLang = await detectLanguagesForUnits(request.units);
		} catch (error) {
			return workerUnavailableResponse(
				request,
				error instanceof Error ? error.message : "Language detection failed",
			);
		}

		const updatedRequest: TranslationRequest = {
			...request,
			units: unitsWithLang,
			targetLang: TARGET_LANGUAGE,
		};

		try {
			const response = await requestWorker(
				{
					type: "translate",
					payload: updatedRequest,
					requestId: generateRequestId(),
				},
				onProgress,
			);
			if (response.type !== "result") {
				return workerUnavailableResponse(
					request,
					"Translation worker returned an invalid response",
				);
			}
			return response.payload;
		} catch (error) {
			return workerUnavailableResponse(
				request,
				error instanceof Error
					? error.message
					: "Translation worker is unavailable",
			);
		}
	},

	async warmup() {
		const response = await requestWorker({
			type: "warmup",
			requestId: generateRequestId(),
		});
		if (response.type !== "status")
			throw new Error("Translation warmup failed");
	},

	async dispose() {
		if (worker) {
			try {
				await requestWorker({
					type: "dispose",
					requestId: generateRequestId(),
				});
			} finally {
				worker.terminate();
				worker = null;
			}
		}
	},

	async getStatus() {
		const response = await requestWorker({
			type: "status",
			requestId: generateRequestId(),
		});
		if (response.type !== "status") return "UNAVAILABLE";
		return response.payload;
	},
};

export async function translateRegions(
	regions: OCRRegion[],
): Promise<TranslationResponse> {
	const units = groupRegionsIntoTranslationUnits(regions);
	return translationEngine.translate({ units });
}

export function applyTranslationsToRegions(
	regions: OCRRegion[],
	response: TranslationResponse,
): OCRRegion[] {
	const translatedRegions: OCRRegion[] = regions.map((region) => ({
		...region,
		translation: undefined,
		boxes: region.boxes.map((box) => ({ ...box })),
	}));

	for (const result of response.results) {
		const candidateIndexes = [
			...(result.boxIndexes?.map((index) => index.regionIndex) ?? []),
		];
		const uniqueCandidateIndexes = [...new Set(candidateIndexes)];
		const searchIndexes =
			uniqueCandidateIndexes.length > 0
				? uniqueCandidateIndexes
				: translatedRegions.map((_region, index) => index);

		let targetIndex: number | undefined;
		let largestIntersection = -1;
		for (const index of searchIndexes) {
			const area = intersectionArea(
				result.bbox,
				translatedRegions[index].bounds,
			);
			if (area > largestIntersection) {
				largestIntersection = area;
				targetIndex = index;
			}
		}
		if (targetIndex === undefined || largestIntersection <= 0) continue;

		const previousTranslation = translatedRegions[targetIndex].translation;
		const translation = previousTranslation
			? `${previousTranslation} ${result.translatedText}`
			: result.translatedText;
		translatedRegions[targetIndex] = {
			...translatedRegions[targetIndex],
			translation,
			boxes: translatedRegions[targetIndex].boxes.map((box) => ({
				...box,
				translation,
			})),
		};
	}

	return translatedRegions;
}

function intersectionArea(
	bbox: { x: number; y: number; width: number; height: number },
	bounds: { top: number; left: number; width: number; height: number },
): number {
	const left = Math.max(bbox.x, bounds.left);
	const top = Math.max(bbox.y, bounds.top);
	const right = Math.min(bbox.x + bbox.width, bounds.left + bounds.width);
	const bottom = Math.min(bbox.y + bbox.height, bounds.top + bounds.height);
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export { MAX_TRANSLATION_CHARS, TARGET_LANGUAGE };
