import type { OCRBox } from "@/types";

export function getOrCreateOverlayContainer(): HTMLElement {
	let container = document.getElementById("ocr-overlay-container");
	if (!container) {
		container = document.createElement("div");
		container.id = "ocr-overlay-container";
		container.style.cssText =
			"position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;overflow:hidden;";
		document.body.appendChild(container);
	}
	return container;
}

export function updateElementOverlayPosition(
	element: { getBoundingClientRect: () => DOMRect },
	overlay: HTMLElement,
) {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) {
		overlay.style.display = "none";
	} else {
		const style = getComputedStyle(element as Element);
		overlay.style.display = "";
		overlay.style.top = `${rect.top}px`;
		overlay.style.left = `${rect.left}px`;
		overlay.style.width = `${rect.width}px`;
		overlay.style.height = `${rect.height}px`;
		overlay.style.transform = style.transform;
		overlay.style.transformOrigin = style.transformOrigin;
	}
}

export function addOcrBoxes(
	overlay: HTMLElement,
	elementWidth: number,
	elementHeight: number,
	ocrData: OCRBox[],
) {
	for (const box of ocrData) {
		const fontSize = Math.max(
			10,
			((Math.min(box.box.height, box.box.width) * box.box.width) / elementWidth) * 0.7,
		);
		const boxDiv = document.createElement("div");
		boxDiv.style.pointerEvents = "auto";
		boxDiv.innerText = box.text;
		boxDiv.style.position = "absolute";
		boxDiv.style.top = `${(box.box.y / elementHeight) * 100}%`;
		boxDiv.style.left = `${(box.box.x / elementWidth) * 100}%`;
		boxDiv.style.width = `${(box.box.width / elementWidth) * 100}%`;
		boxDiv.style.height = `${(box.box.height / elementHeight) * 100}%`;
		boxDiv.style.border = "2px dashed #00ff00";
		boxDiv.style.backgroundColor = "rgba(255, 255, 255, 1)";
		boxDiv.style.color = "#00ff00";
		boxDiv.style.textAlign = "center";
		boxDiv.style.display = "flex";
		boxDiv.style.alignItems = "center";
		boxDiv.style.justifyContent = "center";
		boxDiv.style.fontSize = `${fontSize}px`;
		boxDiv.style.whiteSpace = "nowrap";
		boxDiv.style.textOverflow = "ellipsis";
		overlay.appendChild(boxDiv);
	}
}

export function clearOcrOverlays(overlay: HTMLElement) {
	while (overlay.firstChild) {
		overlay.removeChild(overlay.firstChild);
	}
}

export function removeOverlay(overlay: HTMLElement) {
	overlay.remove();
}
