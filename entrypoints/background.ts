declare const self: ServiceWorkerGlobalScope;

import { OCR_BATCH_DEBOUNCE_MS, OCR_BATCH_SIZE } from "@/config/ocr-config";
import type { InternalMessageType } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { getExtensionSettings } from "@/utils/extension-settings";

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
				title: "X\u1eed l\u00fd ph\u1ea7n t\u01b0\u1eddng n\xE0y",
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
				(settings.enabledDomains.length === 0 ||
					isUrlAllowed(tabUrl, settings.enabledDomains));
			if (!isAllowed) return;

			browser.tabs
				.sendMessage(tab.id, {
					type: "translate",
					url: info.srcUrl,
				})
				.catch(() => {});
		});

		browser.action.onClicked.addListener((tab) => {
			console.log("Extension icon clicked", tab);
		});

		browser.runtime.onMessage.addListener(
			(msg: InternalMessageType, _sender, sendResponse) => {
				if (msg.action === "PROCESS_OCR") {
					ocrBatchQueue.push({ msg, sendResponse });
					scheduleBatchFlush();
					return true;
				}
			},
		);

		browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
			if (msg.type === "get-settings") {
				getExtensionSettings().then((settings) => {
					sendResponse(settings);
				});
				return true;
			}

			if (msg.type === "notify-settings-changed") {
				browser.tabs.query({}, (tabs) => {
					for (const tab of tabs) {
						if (tab.id) {
							browser.tabs
								.sendMessage(tab.id, {
									type: "settings-changed",
									settings: msg.settings,
								})
								.catch(() => {});
						}
					}
				});
				sendResponse({ ok: true });
				return true;
			}
		});
	},
});

interface OcrBatchItem {
	msg: InternalMessageType;
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
					target: "offscreen",
					type: "batch-run-ocr",
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
