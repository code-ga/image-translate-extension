declare const self: ServiceWorkerGlobalScope;

import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type {
	AppMessage,
	OCRRegion,
	OffscreenTranslateRegionsMessage,
	OffscreenTranslateRegionsResponse,
	OffscreenTranslateTextMessage,
	OffscreenTranslateTextResponse,
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
	async main() {
		browser.runtime.onStartup.addListener(async () => {
			await ensureOffscreenRunning();
			console.log("model init successful");
		});

		browser.runtime.onInstalled.addListener(async () => {
			console.log("browser extension installed");
			await ensureOffscreenRunning();
			console.log("model init successful");
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
						console.log("[Background] translate/text received", {
							text: msg.text,
							srcLang: msg.srcLang,
							targetLang: msg.targetLang,
						});
						forwardTranslateText(msg, sendResponse);
						return true;
					}
					case "translate/regions": {
						console.log("[Background] translate/regions received", {
							regionCount: msg.regions.length,
						});
						forwardTranslateRegions(msg, sendResponse);
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

async function forwardTranslateText(
	msg: TranslateTextMessage,
	sendResponse: (response: TranslateTextResponse) => void,
): Promise<void> {
	try {
		console.log("[Background] forwarding translate-text to offscreen");
		const offscreenMsg: OffscreenTranslateTextMessage = {
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-text",
			text: msg.text,
			srcLang: msg.srcLang,
			targetLang: msg.targetLang,
		};
		const response = await new Promise<OffscreenTranslateTextResponse>(
			(resolve) => {
				browser.runtime.sendMessage(offscreenMsg, (resp) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(resp as OffscreenTranslateTextResponse);
				});
			},
		);
		console.log("[Background] translate-text response", {
			success: response.success,
			translatedText: response.translatedText,
		});
		sendResponse({
			success: response.success,
			translatedText: response.translatedText,
			error: response.error,
		});
	} catch (error) {
		console.error("[Background] translate-text failed", error);
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
	}
}

async function forwardTranslateRegions(
	msg: TranslateRegionsMessage,
	sendResponse: (response: TranslateRegionsResponse) => void,
): Promise<void> {
	try {
		const settings = await getExtensionSettings();
		console.log("[Background] forwarding translate-regions to offscreen", {
			regionCount: msg.regions.length,
			targetLang: settings.targetLang,
		});
		const offscreenMsg: OffscreenTranslateRegionsMessage = {
			from: "background",
			to: "offscreen",
			type: "offscreen/translate-regions",
			regions: msg.regions,
			targetLang: settings.targetLang,
		};
		const response = await new Promise<OffscreenTranslateRegionsResponse>(
			(resolve) => {
				browser.runtime.sendMessage(offscreenMsg, (resp) => {
					if (browser.runtime.lastError) {
						resolve({
							success: false,
							error: browser.runtime.lastError.message,
						});
						return;
					}
					resolve(resp as OffscreenTranslateRegionsResponse);
				});
			},
		);
		console.log("[Background] translate-regions response", {
			success: response.success,
			regionCount: response.regions?.length,
		});
		sendResponse({
			success: response.success,
			regions: response.regions,
			errors: response.errors,
			error: response.error,
		});
	} catch (error) {
		console.error("[Background] translate-regions failed", error);
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Translation failed",
		});
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
