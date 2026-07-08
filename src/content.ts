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
  // Create canvas element
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.maxWidth = img.style.maxWidth || "100%";
  canvas.style.height = img.style.height || "auto";
  canvas.style.display = img.style.display || "block";

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Failed to get canvas context");
    return;
  }

  // Draw the image on canvas
  ctx.drawImage(img, 0, 0);

  // Draw OCR boxes and text
  ocrData.forEach(box => {
    const x = box.left;
    const y = box.top;
    const width = box.width;
    const height = box.height;

    // Draw rectangle background
    ctx.fillStyle = "rgba(0, 255, 0, 0.15)";
    ctx.fillRect(x, y, width, height);

    // Draw rectangle border (dashed)
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw text
    ctx.fillStyle = "#00ff00";
    ctx.font = "14px Arial";
    ctx.textBaseline = "top";
    ctx.fillText(box.text, x + 4, y + 4);
  });

  // Replace image with canvas
  img.parentNode?.replaceChild(canvas, img);
}

// Trigger selection
sendImageToBackground("img");
