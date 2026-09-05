declare const self: ServiceWorkerGlobalScope;

import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type {
	AppMessage,
	ProcessOcrMessage,
	TranslateTextMessage,
	TranslateTextResponse,
} from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";
import { translateDynamic } from "@/utils/translation";
import { FastText } from "fasttext.wasm";

export default defineBackground({
	type: "module",
	main() {
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
				.catch(() => { });
		});

		browser.action.onClicked.addListener((tab) => {
			console.log("Extension icon clicked", tab);
		});

		browser.runtime.onMessage.addListener(
			async (msg: AppMessage, _sender, sendResponse) => {
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
										.catch(() => { });
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
										.catch(() => { });
								}
							}
						});
						sendResponse({ ok: true });
						return true;
					case "translate/text": {
						await enqueueTranslation(msg.text, msg.srcLang, msg.targetLang, sendResponse);
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
	let targetLang = targetLangParam
	if (targetLangParam === "auto") {
		const fastText = await FastText.create(); // don't call new FastText() directly
		await fastText.loadModel(); // load default model(lid.176.ftz)
		const result = fastText.detect(text);
		console.log(result); // 'en'
		targetLang = result
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
