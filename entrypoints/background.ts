declare const self: ServiceWorkerGlobalScope;

import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type {
	AppMessage,
	OffscreenTranslateRegionsMessage,
	OffscreenTranslateTextMessage,
	ProcessOcrMessage,
	TranslateRegionsMessage,
	TranslateRegionsResponse,
	TranslateTextMessage,
	TranslateTextResponse,
} from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";

export default defineBackground({
	type: "module",
	main() {
		browser.runtime.onStartup.addListener(() => {
			ensureOffscreenRunning().catch((error) => {
				console.error("Failed to start the offscreen document", error);
			});
		});

		browser.runtime.onInstalled.addListener(() => {
			console.log("browser extension installed");
			ensureOffscreenRunning().catch((error) => {
				console.error("Failed to start the offscreen document", error);
			});
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
			console.log("Extension icon clicked", tab);
		});

		browser.runtime.onMessage.addListener(
			(msg: AppMessage, _sender, sendResponse) => {
				switch (msg.type) {
					case "ocr/process":
						ocrBatchQueue.push({ msg, sendResponse });
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
						browser.runtime.sendMessage({
							from: "background",
							to: "all",
							type: "extension/error",
							error: msg.error,
						});
						sendResponse({ ok: true });
						return true;
					case "translate/text": {
						if (msg.from !== "content" || msg.to !== "background") break;
						void handleTranslateText(msg, sendResponse);
						return true;
					}
					case "translate/regions": {
						if (msg.from !== "content" || msg.to !== "background") break;
						void handleTranslateRegions(msg, sendResponse);
						return true;
					}
				}
			},
		);
	},
});

interface OcrBatchItem {
	msg: ProcessOcrMessage;
	sendResponse: (response: any) => void;
}

const ocrBatchQueue: OcrBatchItem[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let activeBatchCount = 0;

function scheduleBatchFlush() {
	if (batchTimer !== null) return;
	batchTimer = setTimeout(() => {
		batchTimer = null;
		flushOcrBatch();
	}, OCR_BATCH_DEBOUNCE_MS);
}

let offscreenStartPromise: Promise<void> | null = null;

function ensureOffscreenRunning(): Promise<void> {
	if (offscreenStartPromise) return offscreenStartPromise;
	offscreenStartPromise = ensureOffscreenDocument().finally(() => {
		offscreenStartPromise = null;
	});
	return offscreenStartPromise;
}

async function ensureOffscreenDocument() {
	const contexts = await browser.runtime.getContexts({
		contextTypes: ["OFFSCREEN_DOCUMENT"],
	});

	if (contexts.length === 0) {
		await browser.offscreen.createDocument({
			url: "offscreen.html",
			reasons: ["WORKERS"],
			justification:
				"Hosts the PaddleOCR engine and the translation worker used by the extension.",
		});
	}
}

async function flushOcrBatch() {
	if (ocrBatchQueue.length === 0 || activeBatchCount > 0) return;

	const batch = ocrBatchQueue.splice(
		0,
		Math.min(ocrBatchQueue.length, OCR_BATCH_SIZE),
	);
	activeBatchCount++;

	try {
		const resolvedItems = await Promise.all(
			batch.map(async (item) => {
				if (item.msg.fetchingType === "url" && item.msg.headers) {
					const base64 = await fetchImageAsBase64(
						item.msg.imageData,
						item.msg.headers,
					);
					return { fetchingType: "base64" as const, imageData: base64 };
				}
				return {
					fetchingType: item.msg.fetchingType,
					imageData: item.msg.imageData,
				};
			}),
		);

		await ensureOffscreenRunning();
		const response = await new Promise<{
			success: boolean;
			results?: any[];
			error?: string;
		}>((resolve) => {
			browser.runtime.sendMessage(
				{
					from: "background",
					to: "offscreen",
					type: "offscreen/batch-run-ocr",
					items: resolvedItems,
				},
				(msgResponse) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(
						msgResponse as {
							success: boolean;
							results?: any[];
							error?: string;
						},
					);
				},
			);
		});

		if (response?.success && Array.isArray(response.results)) {
			const results = response.results;
			batch.forEach((item, index) => {
				const result = results[index];
				if (result?.success) {
					item.sendResponse({ success: true, ocrData: result.data });
				} else {
					item.sendResponse({
						success: false,
						error: result?.error || "Unknown batch item error",
					});
				}
			});
		} else {
			batch.forEach((item) => {
				item.sendResponse({
					success: false,
					error: response?.error || "Batch processing failed",
				});
			});
		}
	} catch (error) {
		batch.forEach((item) => {
			item.sendResponse({
				success: false,
				error:
					error instanceof Error ? error.message : "Batch processing failed",
			});
		});
	} finally {
		activeBatchCount--;
		scheduleBatchFlush();
	}
}

async function handleTranslateText(
	msg: TranslateTextMessage,
	sendResponse: (response: TranslateTextResponse) => void,
): Promise<void> {
	try {
		const response = await sendToOffscreen<TranslateTextResponse>({
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-text",
			text: msg.text,
			srcLang: msg.srcLang,
			targetLang: msg.targetLang,
		});
		sendResponse(response);
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

async function handleTranslateRegions(
	msg: TranslateRegionsMessage,
	sendResponse: (response: TranslateRegionsResponse) => void,
): Promise<void> {
	try {
		const response = await sendToOffscreen<TranslateRegionsResponse>({
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-regions",
			regions: msg.regions,
		});
		sendResponse(response);
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

function sendToOffscreen<T>(
	message: OffscreenTranslateTextMessage | OffscreenTranslateRegionsMessage,
): Promise<T> {
	return ensureOffscreenRunning().then(
		() =>
			new Promise<T>((resolve, reject) => {
				browser.runtime.sendMessage(message, (response: T) => {
					const lastError = browser.runtime.lastError;
					if (lastError) {
						reject(new Error(lastError.message));
						return;
					}
					resolve(response);
				});
			}),
	);
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
	const headersInit = headers ? new Headers() : undefined;
	if (headers) {
		for (const [key, value] of Object.entries(headers)) {
			headersInit?.append(key, value);
		}
	}
	const response = await fetch(url, { headers: headersInit });
	const arrayBuffer = await response.arrayBuffer();
	return arrayBufferToBase64Legacy(arrayBuffer);
}
