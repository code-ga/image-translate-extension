/// <reference types="chrome" />
import { PaddleOcrResult } from "ppu-paddle-ocr";
import { InternalMessageType, OCRResult } from "./types";


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
  const response = await fetch(url, { headers });
  const arrayBuffer = await response.arrayBuffer();
  return arrayBufferToBase64Legacy(arrayBuffer);
}


chrome.runtime.onMessage.addListener((message: InternalMessageType, _sender, sendResponse) => {
    if (message.action === "PROCESS_OCR") {
      (async () => {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });

        if (contexts.length === 0) {
          await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_PARSER'],
            justification: 'Maintains persistent memory cache for the PaddleOCR engine.'
          });
        }

        try {
          console.log("Processing OCR request in background script...", message);
          const imageData = message.fetchingType === "base64"
            ? message.imageData
            : await fetchImageAsBase64(message.imageData, message.headers);
          // Send data payload to your custom server / API endpoint
          console.log("Sending image data to offscreen for OCR processing...", message.fetchingType === "base64" ? "base64 data" : "URL: " + message.imageData);
          const data: { success: true; data: PaddleOcrResult } | { success: false; error: string } = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'run-ocr',
          imageDataUrl: imageData // Convert ArrayBuffer to base64 string
        })
        if (!data.success) {
          console.error("OCR processing failed:", data);
          sendResponse({ success: false, error: data.error });
          return;
        }
        const ocrData: OCRResult = data.data.lines.flatMap(value => (value.flatMap(a => a.text.length > 0 ? [{ text: a.text, top: a.box.y, left: a.box.x, width: a.box.width, height: a.box.height }] : [])))

        // Send backend coordinates back to content script
        sendResponse({ success: true, ocrData: ocrData });
      } catch (err) {
        console.error("OCR API error:", err);
        sendResponse({ success: false, error: new String(err) });
      }
    })();

    return true; // Crucial rule: keeps messaging channel open for async response
  }
});