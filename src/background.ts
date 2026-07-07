/// <reference types="chrome" />
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-image") {

    console.log("Thông tin phần tử:", info, tab);

    if (tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
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

function base64ToArrayBuffer(base64: string) {
  // Decode base64 to a binary string
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);

  // Populate the typed array
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Return the underlying ArrayBuffer
  return bytes.buffer;
}

chrome.runtime.onMessage.addListener((message: InternalMessageType, _sender, sendResponse) => {
  if (message.action === "PROCESS_OCR") {
    // Handle asynchronously inside an IIFE to keep sendResponse pipeline open
    (async () => {
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
      try {
        const imageData = message.fetchingType === "base64" ? base64ToArrayBuffer(message.imageData) : await (await fetch(message.imageData)).arrayBuffer()
        // Send data payload to your custom server / API endpoint
        const data = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'run-ocr',
          imageDataUrl: imageData
        })
        console.log(data)
        const ocrData: OCRResult = []

        // Send backend coordinates back to content script
        sendResponse({ success: true, ocrData: ocrData });
      } catch (err) {
        console.error("OCR API error:", err);
        sendResponse({ success: false, error: err });
      }
    })();

    return true; // Crucial rule: keeps messaging channel open for async response
  }
});