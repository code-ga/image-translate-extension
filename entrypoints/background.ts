declare const self: ServiceWorkerGlobalScope;

import { FastText } from "fasttext.wasm";
import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type {
	AppMessage,
	BatchRunOcrResponse,
	OCRRegion,
	OcrImagePayload,
	OcrResultItem,
	OcrResultMessage,
	ProcessOcrMessage,
	TranslateTextResponse,
} from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";
import { translateDynamic } from "@/utils/translation";

export default defineBackground({
	type: "module",
	main() {
		browser.runtime.onStartup.addListener(async () => {
			await ensureOffscreenRunning();
			console.info("[image-translate] Offscreen OCR document ready");
		});

		browser.runtime.onInstalled.addListener(async () => {
			console.info("[image-translate] Extension installed");
			await ensureOffscreenRunning();
			console.info("[image-translate] Offscreen OCR document ready");
		});

		browser.runtime.onInstalled.addListener(() => {
			browser.contextMenus.create({
				id: "translate-image",
				title: "Xử lý phần tường này",
				contexts: ["all"],
			});
		});

		browser.contextMenus.onClicked.addListener(async (info, tab) => {
			if (info.menuItemId !== "translate-image") return;
			if (!tab?.id || !info.srcUrl) return;

			const settings = await getExtensionSettings();
			const tabUrl = tab.url || "";
			const isAllowed =
				settings.enabled &&
				settings.enabledDomains.length > 0 &&
				isUrlAllowed(tabUrl, settings.enabledDomains);
			if (!isAllowed) return;

			browser.tabs
				.sendMessage(tab.id, {
					from: "background",
					to: "content",
					type: "background/translate",
					url: info.srcUrl,
				})
				.catch(() => {});
		});

		browser.action.onClicked.addListener((tab) => {
			console.info("[image-translate] Extension icon clicked", {
				tabId: tab?.id,
				url: tab?.url,
			});
		});

		browser.runtime.onMessage.addListener(
			async (msg: AppMessage, sender, sendResponse) => {
				switch (msg.type) {
					case "ocr/process":
						if (!sender.tab?.id) return false;
						ocrBatchQueue.push({
							msg,
							sendResponse: createResponseSender(sendResponse),
							tabId: sender.tab.id,
						});
						scheduleBatchFlush();
						return true;
					case "settings/get":
						getExtensionSettings().then((settings) => {
							sendResponse(settings);
						});
						return true;
					case "settings/notify-changed":
						browser.tabs.query({}, (tabs) => {
							for (const tab of tabs) {
								if (tab.id) {
									browser.tabs
										.sendMessage(tab.id, {
											from: "background",
											to: "all",
											type: "settings/changed",
											settings: msg.settings,
										})
										.catch(() => {});
								}
							}
						});
						sendResponse({ ok: true });
						return true;
					case "extension/error":
						console.error("[image-translate] Reported content error", {
							message: msg.error,
							context: msg.context,
						});
						browser.tabs.query({}, (tabs) => {
							for (const tab of tabs) {
								if (tab.id) {
									browser.tabs
										.sendMessage(tab.id, {
											from: "background",
											to: "all",
											type: "extension/error",
											error: msg.error,
										})
										.catch(() => {});
								}
							}
						});
						sendResponse({ ok: true });
						return true;
					case "translate/text": {
						await enqueueTranslation(
							msg.text,
							msg.srcLang,
							msg.targetLang,
							sendResponse,
						);
						return true;
					}
				}
			},
		);
	},
});

interface OcrBatchItem {
	msg: ProcessOcrMessage;
	sendResponse: (response: OcrProcessResponse) => void;
	tabId: number;
}

type OcrProcessResponse =
	| { success: true; ocrData: OCRRegion[] }
	| { success: false; error: string };

type ResolvedOcrBatchItem = {
	index: number;
	item: OcrBatchItem;
	payload: OcrImagePayload;
};

const ocrBatchQueue: OcrBatchItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let activeBatchCount = 0;
const OFFSCREEN_REQUEST_TIMEOUT_MS = 30_000;

function scheduleBatchFlush() {
	if (batchTimer !== null) return;
	batchTimer = setTimeout(() => {
		batchTimer = null;
		void flushOcrBatch();
	}, OCR_BATCH_DEBOUNCE_MS);
}

async function ensureOffscreenRunning() {
	const contexts = await browser.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
	});

	if (contexts.length === 0) {
		await browser.offscreen.createDocument({
			url: "offscreen.html",
			reasons: ["WORKERS"],
			justification:
				"Maintains persistent memory cache for the PaddleOCR engine.",
		});
	}
}

function createResponseSender(
	sendResponse: (response: OcrProcessResponse) => void,
): (response: OcrProcessResponse) => void {
	let settled = false;
	return (response) => {
		if (settled) return;
		settled = true;
		try {
			sendResponse(response);
		} catch (error) {
			console.error("[image-translate] Failed to send OCR response", {
				error: getErrorDetails(error),
			});
		}
	};
}

function getErrorText(error: unknown, fallback: string): string {
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

function getSourceLabel(item: OcrBatchItem): string {
	return item.msg.fetchingType === "url"
		? item.msg.imageData
		: "<base64-image>";
}

function logOcrError(
	stage: string,
	index: number,
	item: OcrBatchItem,
	error: unknown,
) {
	console.error("[image-translate] OCR batch item failed", {
		stage,
		index,
		source: getSourceLabel(item),
		fetchingType: item.msg.fetchingType,
		error: getErrorDetails(error),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isOcrResultItem(value: unknown): value is OcrResultItem {
	if (!isRecord(value) || typeof value.success !== "boolean") return false;
	if (value.success) return Array.isArray(value.data);
	return typeof value.error === "string";
}

function normalizeOcrResponse(value: unknown): BatchRunOcrResponse {
	if (!isRecord(value)) {
		return { success: false, error: "Offscreen returned no OCR response" };
	}
	if (
		value.success === true &&
		Array.isArray(value.results) &&
		value.results.every(isOcrResultItem)
	) {
		return { success: true, results: value.results };
	}
	if (value.success === false && typeof value.error === "string") {
		return { success: false, error: value.error };
	}
	return { success: false, error: "Invalid offscreen OCR response" };
}

function sendOcrRequest(
	items: OcrImagePayload[],
): Promise<BatchRunOcrResponse> {
	return new Promise<BatchRunOcrResponse>((resolve) => {
		let settled = false;
		const finish = (response: BatchRunOcrResponse) => {
			if (settled) return;
			settled = true;
			if (timeoutId !== null) clearTimeout(timeoutId);
			resolve(normalizeOcrResponse(response));
		};
		const timeoutId = setTimeout(() => {
			finish({ success: false, error: "Offscreen OCR request timed out" });
		}, OFFSCREEN_REQUEST_TIMEOUT_MS);

		try {
			browser.runtime.sendMessage(
				{
					from: "background",
					to: "offscreen",
					type: "offscreen/batch-run-ocr",
					items,
				},
				(response) => {
					const runtimeError = browser.runtime.lastError;
					if (runtimeError) {
						finish({
							success: false,
							error: runtimeError.message || "Offscreen OCR request failed",
						});
						return;
					}
					finish(response);
				},
			);
		} catch (error) {
			finish({
				success: false,
				error: getErrorText(error, "Failed to send OCR request"),
			});
		}
	});
}

function sendOcrResultToTab(
	tabId: number,
	requestId: string,
	result: { success: boolean; ocrData?: OCRRegion[]; error?: string },
) {
	browser.tabs
		.sendMessage(tabId, {
			from: "background",
			to: "content",
			type: "ocr/result",
			requestId,
			success: result.success,
			ocrData: result.ocrData,
			error: result.error,
		} satisfies OcrResultMessage)
		.catch(() => {});
}

function sendOcrFailure(item: OcrBatchItem, error: unknown) {
	sendOcrResultToTab(item.tabId, item.msg.requestId || "unknown", {
		success: false,
		error: getErrorText(error, "OCR processing failed"),
	});
}

function sendOcrResult(item: OcrBatchItem, result: unknown) {
	if (isOcrResultItem(result) && result.success) {
		sendOcrResultToTab(item.tabId, item.msg.requestId || "unknown", {
			success: true,
			ocrData: result.data,
		});
		return;
	}
	sendOcrFailure(
		item,
		isRecord(result) && typeof result.error === "string"
			? result.error
			: "Unknown OCR batch item error",
	);
}

async function resolveOcrPayload(
	msg: ProcessOcrMessage,
): Promise<OcrImagePayload> {
	if (msg.fetchingType === "url") {
		const imageData = await fetchImageAsBase64(msg.imageData, msg.headers);
		return { fetchingType: "base64", imageData };
	}
	return { fetchingType: "base64", imageData: msg.imageData };
}

async function flushOcrBatch() {
	if (ocrBatchQueue.length === 0 || activeBatchCount > 0) return;

	const batch = ocrBatchQueue.splice(
		0,
		Math.min(ocrBatchQueue.length, OCR_BATCH_SIZE),
	);
	activeBatchCount++;

	try {
		try {
			await ensureOffscreenRunning();
		} catch (error) {
			console.error(
				"[image-translate] Failed to start offscreen OCR document",
				{
					error: getErrorDetails(error),
				},
			);
			batch.forEach((item) => {
				sendOcrFailure(item, error);
			});
			return;
		}

		console.info("[image-translate] OCR batch flush starting", {
			batchSize: batch.length,
			queueLength: ocrBatchQueue.length,
		});

		const fetchOutcomes = await Promise.allSettled(
			batch.map(async (item, index): Promise<ResolvedOcrBatchItem> => {
				console.info("[image-translate] Resolving OCR payload", {
					index,
					fetchingType: item.msg.fetchingType,
					imageDataLength: item.msg.imageData.length,
					imageDataPrefix: item.msg.imageData.slice(0, 60),
				});
				const payload = await resolveOcrPayload(item.msg);
				console.info("[image-translate] OCR payload resolved", {
					index,
					fetchingType: payload.fetchingType,
					imageDataLength: payload.imageData.length,
					imageDataPrefix: payload.imageData.slice(0, 60),
				});
				return { index, item, payload };
			}),
		);
		const eligible: ResolvedOcrBatchItem[] = [];
		fetchOutcomes.forEach((outcome, index) => {
			if (outcome.status === "rejected") {
				const item = batch[index];
				if (item) {
					logOcrError("fetch", index, item, outcome.reason);
					sendOcrFailure(item, outcome.reason);
				}
				return;
			}
			eligible.push(outcome.value);
		});
		console.info("[image-translate] OCR payload resolution complete", {
			eligibleCount: eligible.length,
			rejectedCount: fetchOutcomes.filter((o) => o.status === "rejected")
				.length,
		});

		if (eligible.length === 0) return;

		try {
			const response = await sendOcrRequest(
				eligible.map((entry) => entry.payload),
			);
			console.info("[image-translate] OCR batch request completed", {
				batchSize: eligible.length,
				success: response.success,
				error: (response as BatchRunOcrResponse & { error?: string }).error,
			});
			if (response.success && Array.isArray(response.results)) {
				eligible.forEach((entry, index) => {
					sendOcrResult(entry.item, response.results[index]);
				});
				return;
			}
			const batchError = response.success ? undefined : response.error;
			console.error(
				"[image-translate] OCR batch call failed; retrying items individually",
				{
					batchSize: eligible.length,
					error: batchError,
				},
			);
			console.info("[image-translate] Retrying OCR items individually", {
				batchSize: eligible.length,
			});
		} catch (error) {
			console.error(
				"[image-translate] OCR batch call threw; retrying items individually",
				{
					batchSize: eligible.length,
					error: getErrorDetails(error),
				},
			);
		}

		const individualOutcomes = await Promise.allSettled(
			eligible.map(async (entry) => {
				const response = await sendOcrRequest([entry.payload]);
				return { entry, response };
			}),
		);
		individualOutcomes.forEach((outcome, index) => {
			const entry = eligible[index];
			if (!entry) return;
			if (outcome.status === "rejected") {
				logOcrError("individual-fallback", index, entry.item, outcome.reason);
				sendOcrFailure(entry.item, outcome.reason);
				return;
			}
			const { response } = outcome.value;
			const responseError = response.success ? undefined : response.error;
			console.info("[image-translate] Individual OCR result", {
				success: response.success,
				error: responseError,
			});
			if (response.success && Array.isArray(response.results)) {
				sendOcrResult(entry.item, response.results[0]);
			} else {
				sendOcrFailure(
					entry.item,
					responseError || "Individual OCR retry failed",
				);
			}
		});
	} catch (error) {
		console.error("[image-translate] OCR batch flush failed", {
			batchSize: batch.length,
			error: getErrorDetails(error),
		});
		batch.forEach((item) => {
			sendOcrFailure(item, error);
		});
	} finally {
		activeBatchCount--;
		scheduleBatchFlush();
	}
}

interface TranslationBatchItem {
	text: string;
	sendResponse: (response: TranslateTextResponse) => void;
}

interface TranslationBatch {
	texts: string[];
	items: TranslationBatchItem[];
	timer: ReturnType<typeof setTimeout> | null;
	flushing: boolean;
}

const translationBatches = new Map<string, TranslationBatch>();
const TRANSLATION_BATCH_DEBOUNCE_MS = 20;

async function enqueueTranslation(
	text: string,
	srcLang: string,
	targetLangParam: string,
	sendResponse: (response: TranslateTextResponse) => void,
) {
	let targetLang = targetLangParam;
	if (targetLangParam === "auto") {
		const fastText = await FastText.create(); // don't call new FastText() directly
		await fastText.loadModel(); // load default model(lid.176.ftz)
		const result = fastText.detect(text);
		console.log(result); // 'en'
		targetLang = result;
	}
	const key = `${srcLang}:${targetLang}`;
	let batch = translationBatches.get(key);

	if (!batch) {
		batch = { texts: [], items: [], timer: null, flushing: false };
		translationBatches.set(key, batch);
	}

	const existingIndex = batch.texts.indexOf(text);
	if (existingIndex === -1) {
		batch.texts.push(text);
	}
	batch.items.push({ text, sendResponse });

	if (batch.timer === null && !batch.flushing) {
		batch.timer = setTimeout(() => {
			batch.timer = null;
			flushTranslationBatch(key);
		}, TRANSLATION_BATCH_DEBOUNCE_MS);
	}
}

async function flushTranslationBatch(key: string) {
	const batch = translationBatches.get(key);
	if (!batch) return;

	batch.flushing = true;
	const texts = [...batch.texts];
	const items = [...batch.items];
	batch.texts = [];
	batch.items = [];

	const [srcLang, targetLang] = key.split(":");

	try {
		const results = await translateDynamic(texts, srcLang, targetLang);

		items.forEach((item) => {
			item.sendResponse({
				success: true,
				translatedText: results[item.text],
			});
		});
	} catch (error) {
		items.forEach((item) => {
			item.sendResponse({
				success: false,
				error: error instanceof Error ? error.message : "Translation failed",
			});
		});
	} finally {
		batch.flushing = false;
		if (batch.texts.length > 0) {
			setTimeout(() => flushTranslationBatch(key), 0);
		} else if (batch.items.length === 0) {
			translationBatches.delete(key);
		}
	}
}

function arrayBufferToBase64Legacy(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const len = bytes.byteLength;

	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

async function fetchImageAsBase64(
	url: string,
	headers?: Record<string, string>,
): Promise<string> {
	if (!url.trim()) throw new Error("Image URL is empty");
	const headersInit = headers ? new Headers() : undefined;
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			headersInit?.append(key, value);
		}
	}
	const response = await fetch(url, { headers: headersInit });
	if (!response.ok) {
		throw new Error(
			`Image fetch failed with HTTP ${response.status} ${response.statusText}`.trim(),
		);
	}
	const arrayBuffer = await response.arrayBuffer();
	if (arrayBuffer.byteLength === 0) throw new Error("Image response was empty");
	return arrayBufferToBase64Legacy(arrayBuffer);
}
