import { getCachedTranslation, setCachedTranslation } from "./cache";
import { detectLanguagesForUnits } from "./language-detector";
import type {
	ModelStatus,
	NllbLanguageCode,
	TranslationRequest,
	TranslationResponse,
	TranslationResult,
	TranslationUnit,
	WorkerMessage,
	WorkerResponse,
} from "./types";

let worker: Worker | null = null;
const pendingRequests = new Map<string, (response: WorkerResponse) => void>();
let requestCounter = 0;
let isDisposed = false;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const response = event.data;
			const resolver = pendingRequests.get(response.requestId);
			if (resolver) {
				pendingRequests.delete(response.requestId);
				resolver(response);
			}
		};
		worker.onerror = (error) => {
			console.error("Translation worker error:", error);
			for (const [, resolver] of pendingRequests) {
				resolver({
					type: "error",
					requestId: "unknown",
					error: "Worker crashed",
				});
			}
			pendingRequests.clear();
			worker = null;
		};
	}
	return worker;
}

function sendToWorker(message: WorkerMessage): Promise<WorkerResponse> {
	return new Promise((resolve, reject) => {
		const w = getWorker();
		pendingRequests.set(message.requestId, resolve);
		w.postMessage(message);
		setTimeout(() => {
			if (pendingRequests.has(message.requestId)) {
				pendingRequests.delete(message.requestId);
				reject(new Error("Worker request timeout"));
			}
		}, 120000);
	});
}

export async function warmup(): Promise<void> {
	if (isDisposed) throw new Error("Translation engine disposed");
	const requestId = `warmup_${++requestCounter}`;
	const response = await sendToWorker({ type: "warmup", requestId });
	if (response.type === "error") {
		throw new Error(response.error);
	}
	if (response.type === "warmup" && !response.success) {
		throw new Error("Warmup failed");
	}
}

export async function getStatus(): Promise<ModelStatus> {
	if (isDisposed) return { state: "unavailable" };
	const requestId = `status_${++requestCounter}`;
	const response = await sendToWorker({ type: "status", requestId });
	if (response.type === "status") {
		return response.status;
	}
	if (response.type === "error") {
		return { state: "error", message: response.error };
	}
	return { state: "error", message: "Status check failed" };
}

export async function dispose(): Promise<void> {
	if (!worker || isDisposed) return;
	isDisposed = true;
	const requestId = `dispose_${++requestCounter}`;
	try {
		await sendToWorker({ type: "dispose", requestId });
	} finally {
		worker.terminate();
		worker = null;
		pendingRequests.clear();
	}
}

export async function translate(
	request: TranslationRequest,
): Promise<TranslationResponse> {
	if (isDisposed) throw new Error("Translation engine disposed");
	if (!request.units.length) return { results: [], errors: [] };

	const unitsWithLang = await detectLanguagesForUnits(request.units);
	const cachedResults: TranslationResult[] = [];
	const uncachedUnits: TranslationUnit[] = [];

	for (const unit of unitsWithLang) {
		const cached = await getCachedTranslation({
			units: [unit],
			targetLang: request.targetLang,
		});
		if (cached) {
			cachedResults.push(...cached);
		} else {
			uncachedUnits.push(unit);
		}
	}

	if (!uncachedUnits.length) {
		return { results: cachedResults, errors: [] };
	}

	const requestId = `translate_${++requestCounter}`;
	const workerRequest: TranslationRequest = {
		units: uncachedUnits,
		targetLang: request.targetLang,
	};
	const response = await sendToWorker({
		type: "translate",
		request: workerRequest,
		requestId,
	});

	if (response.type === "error") {
		throw new Error(response.error);
	}
	if (response.type !== "translate") {
		throw new Error("Translation failed");
	}

	await setCachedTranslation(workerRequest, response.response.results);

	return {
		results: [...cachedResults, ...response.response.results],
		errors: response.response.errors,
	};
}

export async function translateText(
	text: string,
	srcLang: string,
	targetLang: NllbLanguageCode,
): Promise<{ translatedText: string; detectedLang: NllbLanguageCode }> {
	const unit: TranslationUnit = {
		id: `text_${Date.now()}_${Math.random().toString(36).slice(2)}`,
		sourceText: text,
		bbox: { x: 0, y: 0, width: 0, height: 0 },
		boxReferences: [],
		detectedLanguage: (srcLang ||
			"unknown") as TranslationUnit["detectedLanguage"],
		detectionConfidence: srcLang ? 1 : 0,
	};

	const response = await translate({ units: [unit], targetLang });
	if (response.results.length > 0) {
		return {
			translatedText: response.results[0].translatedText,
			detectedLang: response.results[0].sourceLang,
		};
	}
	if (response.errors.length > 0) {
		throw new Error(response.errors[0].message);
	}
	throw new Error("No translation result");
}
