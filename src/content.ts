// content.js

import type { InternalMessageType, OCRResult } from "./types";

async function sendImageToBackground(img: HTMLImageElement | null) {
  if (!img || !(img instanceof HTMLImageElement)) return console.error("Image not found");
  console.log(img)

  try {
    console.log("Sending image safely from isolated world...");
    // 3. Now chrome.runtime is guaranteed to be defined!
    const bgResponse = await chrome.runtime.sendMessage<InternalMessageType>({
      action: "PROCESS_OCR",
      fetchingType: "url",
      imageData: img.src
    });
    console.log(bgResponse)

    if (bgResponse && bgResponse.success) {
      renderOcrOverlays(img, bgResponse.ocrData);
    }
    // // 1. Fetch the image directly as a binary BLOB using extension privileges
    // const response = await fetch(img.src);
    // const blob = await response.blob();

    // // 2. Convert blob directly to base64 using FileReader
    // const reader = new FileReader();
    // reader.readAsDataURL(blob);
    // reader.onloadend = async () => {
    //   const base64Image = reader.result; // This is your data URL string
    //   console.log(base64Image)


    // };
  } catch (error) {
    console.error("Failed to extract or pass image text:", error);
  }
}

function renderOcrOverlays(img: HTMLImageElement, ocrData: OCRResult) {
  // Container wrapper setup (as established in previous setup step)
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.className += img.className ? ` ${img.className}` : "";
  img.parentNode?.insertBefore(wrapper, img);
  wrapper.appendChild(img);

  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.top = "0"; overlay.style.left = "0";
  overlay.style.width = "100%"; overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";

  ocrData.forEach(box => {
    const boxDiv = document.createElement("div");
    boxDiv.innerText = box.text;
    boxDiv.style.position = "absolute";
    // Assuming backend returns percentages:
    boxDiv.style.top = `${(box.top / img.naturalHeight) * 100}%`;
    boxDiv.style.left = `${(box.left / img.naturalWidth) * 100}%`;
    boxDiv.style.width = `${(box.width / img.naturalWidth) * 100}%`;
    boxDiv.style.height = `${(box.height / img.naturalHeight) * 100}%`;
    boxDiv.style.border = "2px dashed #00ff00";
    boxDiv.style.backgroundColor = "rgba(255, 255, 255, 1)";
    boxDiv.style.color = "#00ff00";
    // Additional styling for text visibility
    boxDiv.style.textAlign = "center";
    boxDiv.style.display = "flex";
    boxDiv.style.alignItems = "center";
    boxDiv.style.justifyContent = "center";
    boxDiv.style.fontSize = "auto";
    boxDiv.style.whiteSpace = "nowrap";
    boxDiv.style.textOverflow = "ellipsis";
    overlay.appendChild(boxDiv);
  });

  wrapper.appendChild(overlay);
}

chrome.runtime.onMessage.addListener(msg => {

  if (msg.type !== "translate")
    return;
  console.log("translate message received in content script", msg)
  document.querySelectorAll(`img[src="${msg.url}"]`).forEach(img => {
    sendImageToBackground(img as HTMLImageElement);
  });
});