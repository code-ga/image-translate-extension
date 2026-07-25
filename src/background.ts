/// <reference types="chrome" />
import { InternalMessageType } from "./types";
import { OCR_BATCH_SIZE, OCR_BATCH_DEBOUNCE_MS } from "./ocr-config";


chrome.runtime.onStartup.addListener(async () => {
  // Check if the offscreen canvas container is already active
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

  if (contexts.length === 0) {
    // This spins up the offscreen tab, which triggers model caching instantly
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Maintains persistent memory cache for the PaddleOCR engine.'
    });
  }
  console.log("model init successful")
})


chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-image",
    title: "Xử lý phần tử này",
    contexts: ["all"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translate-image") {

    console.log("Thông tin phần tử:", info, tab);

    if (tab?.id && info.srcUrl) {
      const result = await chrome.storage.sync.get('extensionSettings')
      const settings = (result as any)['extensionSettings'] || {}
      const enabledDomains: string[] = settings.enabledDomains || []
      const enabled: boolean = settings.enabled ?? true
      const domain = new URL(tab.url || '').hostname
      const isAllowed = enabled && (enabledDomains.length === 0 || enabledDomains.some((d: string) => domain === d || domain.endsWith('.' + d)))
      if (!isAllowed) return

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, {
        type: "translate",
        url: info.srcUrl,
      });
    }
  }
});


chrome.runtime.onInstalled.addListener(async () => {
  console.log('Chrome extension installed');
  // Check if the offscreen canvas container is already active
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

  if (contexts.length === 0) {
    // This spins up the offscreen tab, which triggers model caching instantly
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Maintains persistent memory cache for the PaddleOCR engine.'
    });
  }
  console.log("model init successful")
});

chrome.action.onClicked.addListener((tab) => {
  console.log('Extension icon clicked', tab);
});



function arrayBufferToBase64Legacy(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;

  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchImageAsBase64(url: string, headers?: Record<string, string>): Promise<string> {
  const headersInit = headers ? new Headers() : undefined;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      headersInit?.append(key, value);
    }
  }
  console.log("Fetching image from URL:", url, "with headers:", headersInit, headers);
  console.log([...headersInit?.entries() || []]);
  const response = await fetch(url, { headers: headersInit });
  const arrayBuffer = await response.arrayBuffer();
  return arrayBufferToBase64Legacy(arrayBuffer);
}


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

async function flushOcrBatch() {
	if (ocrBatchQueue.length === 0 || activeBatchCount > 0) return;

	const batch = ocrBatchQueue.splice(0, Math.min(ocrBatchQueue.length, OCR_BATCH_SIZE));
	activeBatchCount++;

	try {
		const resolvedItems = await Promise.all(batch.map(async (item) => {
			if (item.msg.fetchingType === "url" && item.msg.headers) {
				const base64 = await fetchImageAsBase64(item.msg.imageData, item.msg.headers);
				return { fetchingType: "base64" as const, imageData: base64 };
			}
			return { fetchingType: item.msg.fetchingType, imageData: item.msg.imageData };
		}));

		const response = await new Promise<{ success: boolean; results?: any[]; error?: string }>((resolve) => {
			chrome.runtime.sendMessage({
				target: 'offscreen',
				type: 'batch-run-ocr',
				items: resolvedItems
			}, (msgResponse) => {
				if (chrome.runtime.lastError) {
					resolve({ success: false, error: chrome.runtime.lastError.message });
					return;
				}
				resolve(msgResponse as { success: boolean; results?: any[]; error?: string });
			});
		});

		if (response && response.success && Array.isArray(response.results)) {
			const results = response.results;
			batch.forEach((item, index) => {
				const result = results[index];
				if (result && result.success) {
					item.sendResponse({ success: true, ocrData: result.data });
				} else {
					item.sendResponse({
						success: false,
						error: result?.error || 'Unknown batch item error'
					});
				}
			});
		} else {
			batch.forEach(item => {
				item.sendResponse({
					success: false,
					error: response?.error || 'Batch processing failed'
				});
			});
		}
	} catch (error) {
		batch.forEach(item => {
			item.sendResponse({
				success: false,
				error: error instanceof Error ? error.message : 'Batch processing failed'
			});
		});
	} finally {
		activeBatchCount--;
		scheduleBatchFlush();
	}
}

chrome.runtime.onMessage.addListener((msg: InternalMessageType, _sender, sendResponse) => {
	if (msg.action === "PROCESS_OCR") {
		ocrBatchQueue.push({ msg, sendResponse });
		scheduleBatchFlush();
		return true;
	}
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg.type === "get-settings") {
    chrome.storage.sync.get("extensionSettings", (result: any) => {
      const settings = result["extensionSettings"] || { enabledDomains: [], enabled: true }
      sendResponse(settings)
    })
    return true
  }

  if (msg.type === "notify-settings-changed") {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "settings-changed", settings: msg.settings }).catch(() => {})
        }
      }
    })
    sendResponse({ ok: true })
    return true
  }
});