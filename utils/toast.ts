import {
	getOrCreateContainer,
	injectPopupStyles,
	POPUP_BORDER_RADIUS,
	POPUP_BOX_SHADOW,
	POPUP_COLORS,
	POPUP_FONT,
	POPUP_Z_INDEX,
} from "./popup-base";

const TOAST_CONTAINER_ID = "ocr-toast-container";
const TOAST_CLASSES = {
	error: "ocr-toast-error",
	warning: "ocr-toast-warning",
	info: "ocr-toast-info",
};

const DEDUP_WINDOW_MS = 10000;
const DEFAULT_DURATION_MS = 4000;

const shownErrors: Record<string, number> = {};

function dedupKey(message: string, type: string): string {
	return `${type}:${message}`;
}

export function showToast(
	message: string,
	type: "error" | "warning" | "info" = "error",
	duration: number = DEFAULT_DURATION_MS,
) {
	const key = dedupKey(message, type);
	const now = Date.now();
	if (shownErrors[key] && now - shownErrors[key] < DEDUP_WINDOW_MS) {
		return;
	}
	shownErrors[key] = now;

	const container = getOrCreateContainer(
		TOAST_CONTAINER_ID,
		`position:fixed;top:12px;right:12px;z-index:${POPUP_Z_INDEX};display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px;`,
	);
	injectPopupStyles(container);

	const toast = document.createElement("div");
	toast.className = TOAST_CLASSES[type] || TOAST_CLASSES.error;
	toast.textContent = message;

	const c = POPUP_COLORS[type] || POPUP_COLORS.error;

	toast.style.cssText = `
		background:${c.bg};
		color:${c.text};
		border:1px solid ${c.border};
		padding:10px 14px;
		border-radius:${POPUP_BORDER_RADIUS};
		font-size:13px;
		font-family:${POPUP_FONT};
		pointer-events:auto;
		box-shadow:${POPUP_BOX_SHADOW};
		animation:ocr-toast-in 0.2s ease-out;
		line-height:1.4;
	`;

	container.appendChild(toast);

	setTimeout(() => {
		if (toast.parentNode) {
			toast.remove();
		}
	}, duration);
}

export function removeToast(element: HTMLElement) {
	if (element.parentNode) {
		element.remove();
	}
}
