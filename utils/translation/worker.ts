import type {
	ModelStatus,
	TranslationRequest,
	TranslationResponse,
	WorkerMessage,
	WorkerResponse,
} from "./types";

let model: any = null;
let modelStatus: ModelStatus = { state: "unavailable" };
const _pendingRequests = new Map<string, (response: WorkerResponse) => void>();

async function loadModel() {
	if (
		modelStatus.state === "ready" ||
		modelStatus.state === "loading" ||
		modelStatus.state === "downloading"
	) {
		return;
	}

	modelStatus = { state: "downloading", progress: 0 };
	try {
		const { pipeline } = await import("@huggingface/transformers");
		modelStatus = { state: "loading", progress: 50 };
		model = await pipeline("translation", "Xenova/nllb-200-distilled-600M", {
			device: "webgpu",
			dtype: "q4",
			progress_callback: (p: any) => {
				if (p.status === "downloading") {
					modelStatus = {
						state: "downloading",
						progress: Math.round(p.progress * 50),
					};
				} else if (p.status === "loading") {
					modelStatus = {
						state: "loading",
						progress: 50 + Math.round(p.progress * 50),
					};
				}
			},
		});
		modelStatus = { state: "ready" };
	} catch (error) {
		modelStatus = {
			state: "error",
			message: error instanceof Error ? error.message : "Model load failed",
		};
		throw error;
	}
}

async function translate(
	request: TranslationRequest,
): Promise<TranslationResponse> {
	if (!model) {
		await loadModel();
	}

	if (modelStatus.state !== "ready") {
		throw new Error(`Model not ready: ${modelStatus.state}`);
	}

	modelStatus = { state: "inference" };

	try {
		const results: TranslationResponse["results"] = [];
		const errors: TranslationResponse["errors"] = [];

		for (const unit of request.units) {
			try {
				const srcLang =
					unit.detectedLanguage === "unknown"
						? "eng_Latn"
						: unit.detectedLanguage;
				const output = await model(unit.sourceText, {
					src_lang: srcLang,
					tgt_lang: request.targetLang,
				});
				results.push({
					unitId: unit.id,
					translatedText: output[0].translation_text,
					sourceLang: srcLang,
					targetLang: request.targetLang,
					cached: false,
				});
			} catch (error) {
				errors.push({
					unitId: unit.id,
					message:
						error instanceof Error ? error.message : "Translation failed",
					code: "INFERENCE_FAILED",
				});
			}
		}

		modelStatus = { state: "ready" };
		return { results, errors };
	} catch (error) {
		modelStatus = { state: "ready" };
		throw error;
	}
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;
	const requestId = message.requestId;

	const sendResponse = (response: WorkerResponse) => {
		self.postMessage(response);
	};

	try {
		switch (message.type) {
			case "translate": {
				const response = await translate(message.request);
				sendResponse({ type: "translate", requestId, response });
				break;
			}
			case "warmup": {
				await loadModel();
				sendResponse({
					type: "warmup",
					requestId,
					success: modelStatus.state === "ready",
				});
				break;
			}
			case "dispose": {
				model = null;
				modelStatus = { state: "unavailable" };
				sendResponse({ type: "dispose", requestId, success: true });
				break;
			}
			case "status": {
				sendResponse({ type: "status", requestId, status: modelStatus });
				break;
			}
		}
	} catch (error) {
		sendResponse({
			type: "error",
			requestId,
			error: error instanceof Error ? error.message : "Worker error",
		});
	}
};
