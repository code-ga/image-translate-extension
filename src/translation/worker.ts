import { getModelStatus, loadModel, unloadModel } from "./model-manager";
import { scheduleTranslation } from "./scheduler";
import type {
	TranslationError,
	TranslationWorkerRequest,
	TranslationWorkerResponse,
} from "./types";

const WORKER_API = {
	translate: "translate",
	warmup: "warmup",
	dispose: "dispose",
	result: "result",
	progress: "progress",
	error: "error",
	status: "status",
} as const;

function sendResponse(
	type: TranslationWorkerResponse["type"],
	payload: TranslationWorkerResponse["payload"],
	requestId: string,
): void {
	self.postMessage({ type, payload, requestId } as TranslationWorkerResponse);
}

async function handleTranslate(
	request: TranslationWorkerRequest,
): Promise<void> {
	const { payload, requestId } = request;

	if (!payload) {
		sendResponse(
			"error",
			{ code: "WORKER_ERROR", message: "Missing payload", recoverable: false },
			requestId,
		);
		return;
	}

	try {
		sendResponse(
			"progress",
			{ status: "INFERENCE", message: "Starting translation" },
			requestId,
		);

		const response = await scheduleTranslation(payload, (progress) => {
			sendResponse("progress", progress, requestId);
		});

		sendResponse("result", response, requestId);
	} catch (error) {
		const translationError: TranslationError = {
			code: "WORKER_ERROR",
			message:
				error instanceof Error ? error.message : "Worker translation failed",
			recoverable: true,
		};
		sendResponse("error", translationError, requestId);
	}
}

async function handleWarmup(request: TranslationWorkerRequest): Promise<void> {
	try {
		await loadModel((progress) =>
			sendResponse("progress", progress, request.requestId),
		);
		sendResponse("status", getModelStatus(), request.requestId);
	} catch (error) {
		const translationError: TranslationError = {
			code: "MODEL_LOAD_FAILED",
			message: error instanceof Error ? error.message : "Model warmup failed",
			recoverable: true,
		};
		sendResponse("error", translationError, request.requestId);
	}
}

async function handleDispose(request: TranslationWorkerRequest): Promise<void> {
	try {
		await unloadModel();
		sendResponse("status", getModelStatus(), request.requestId);
	} catch (error) {
		const translationError: TranslationError = {
			code: "WORKER_ERROR",
			message: error instanceof Error ? error.message : "Worker dispose failed",
			recoverable: false,
		};
		sendResponse("error", translationError, request.requestId);
	}
}

export function startTranslationWorker(): void {
	self.onmessage = async (event: MessageEvent<TranslationWorkerRequest>) => {
		const request = event.data;

		switch (request.type) {
			case WORKER_API.translate:
				await handleTranslate(request);
				break;
			case WORKER_API.warmup:
				await handleWarmup(request);
				break;
			case WORKER_API.dispose:
				await handleDispose(request);
				break;
			default:
				sendResponse(
					"error",
					{
						code: "WORKER_ERROR",
						message: `Unknown message type: ${(request as TranslationWorkerRequest).type}`,
						recoverable: false,
					},
					request.requestId,
				);
		}
	};
}

startTranslationWorker();
