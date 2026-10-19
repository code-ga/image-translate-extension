export const POPUP_Z_INDEX = "2147483647";
export const POPUP_FONT =
	'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
export const POPUP_BORDER_RADIUS = "6px";
export const POPUP_BOX_SHADOW = "0 4px 12px rgba(0,0,0,0.4)";

export const POPUP_COLORS = {
	error: { bg: "#2a1f1f", border: "#3a2a2a", text: "#ff6b6b" },
	warning: { bg: "#2a2418", border: "#3a3525", text: "#ffaa33" },
	info: { bg: "#1a2433", border: "#253040", text: "#6bb5ff" },
	success: { bg: "#1a2a1f", border: "#253025", text: "#6bff6b" },
};

export function getOrCreateContainer(
	id: string,
	extraStyles: string = "",
): HTMLElement {
	let container = document.getElementById(id);
	if (!container) {
		container = document.createElement("div");
		container.id = id;
		container.style.cssText = extraStyles;
		document.body.appendChild(container);
	}
	return container;
}

export function injectPopupStyles(container: HTMLElement): HTMLStyleElement {
	const existing = container.querySelector("style[data-popup-keyframes]");
	if (existing instanceof HTMLStyleElement) {
		return existing;
	}

	const style = document.createElement("style");
	style.dataset.popupKeyframes = "true";
	style.textContent = `
		@keyframes ocr-toast-in {
			from { opacity: 0; transform: translateX(20px); }
			to { opacity: 1; transform: translateX(0); }
		}
	`;
	container.appendChild(style);
	return style;
}
