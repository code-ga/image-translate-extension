// content.js

import type { InternalMessageType, OCRResult } from "./types";

async function sendImageToBackground(imageSelector: string) {
  const img = document.querySelector(imageSelector);
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
    boxDiv.style.top = `${box.top/2}px`;
    boxDiv.style.left = `${box.left/2}px`;
    boxDiv.style.width = `${box.width/2}px`;
    boxDiv.style.height = `${box.height/2}px`;
    boxDiv.style.border = "2px dashed #00ff00";
    boxDiv.style.backgroundColor = "rgba(0, 255, 0, 0.15)";
    boxDiv.style.color = "#00ff00";
    overlay.appendChild(boxDiv);
  });

  wrapper.appendChild(overlay);
}

// Trigger selection
sendImageToBackground("img");
