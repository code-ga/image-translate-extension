import {
	POPUP_Z_INDEX,
	POPUP_FONT,
	POPUP_BORDER_RADIUS,
	POPUP_BOX_SHADOW,
	POPUP_COLORS,
	injectPopupStyles,
} from "./popup-base";

let currentPopup: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const POPUP_DEBOUNCE_MS = 300;
const POPUP_CLOSE_DELAY_MS = 1000;
const POPUP_GAP = 6;

export function showTranslationPopup(
	anchor: HTMLElement,
	text: string,
	onReady?: (popup: HTMLDivElement) => void,
): HTMLDivElement | null {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	dismissTranslationPopup();
	cancelCloseDelay();

	debounceTimer = setTimeout(() => {
		debounceTimer = null;

		const popup = document.createElement("div");
		popup.textContent = text;

		popup.style.cssText = `
			position: fixed;
			z-index: ${POPUP_Z_INDEX};
			background: ${POPUP_COLORS.info.bg};
			color: ${POPUP_COLORS.info.text};
			border: 1px solid ${POPUP_COLORS.info.border};
			border-radius: ${POPUP_BORDER_RADIUS};
			font-family: ${POPUP_FONT};
			font-size: 13px;
			line-height: 1.4;
			padding: 8px 12px;
			max-width: 320px;
			box-shadow: ${POPUP_BOX_SHADOW};
			pointer-events: auto;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		`;

		document.body.appendChild(popup);

		injectPopupStyles(popup);

		const anchorRect = anchor.getBoundingClientRect();
		const gap = POPUP_GAP;

		let top = anchorRect.bottom + gap;
		let left = anchorRect.left;

		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		const popupWidth = popup.offsetWidth;
		const popupHeight = popup.offsetHeight;

		if (left + popupWidth > viewportWidth - 8) {
			left = Math.max(8, viewportWidth - popupWidth - 8);
		}

		if (top + popupHeight > viewportHeight - 8) {
			top = anchorRect.top - popupHeight - gap;
		}

		top = Math.max(8, top);
		left = Math.max(8, left);

		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;

		currentPopup = popup;
		currentAnchor = anchor;

		onReady?.(popup);
	}, POPUP_DEBOUNCE_MS);

	return null;
}

export function updateTranslationPopup(
	popup: HTMLDivElement | null,
	translation?: string,
	error?: string,
) {
	if (!popup || popup !== currentPopup) return;

	if (error) {
		popup.textContent = error;
		popup.style.background = POPUP_COLORS.error.bg;
		popup.style.color = POPUP_COLORS.error.text;
		popup.style.borderColor = POPUP_COLORS.error.border;
	} else if (translation) {
		popup.textContent = translation;
		popup.style.background = POPUP_COLORS.success.bg;
		popup.style.color = POPUP_COLORS.success.text;
		popup.style.borderColor = POPUP_COLORS.success.border;
	}
}

export function dismissTranslationPopup() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	cancelCloseDelay();
	if (currentPopup && currentPopup.parentNode) {
		currentPopup.remove();
	}
	currentPopup = null;
	currentAnchor = null;
}

export function cancelCloseDelay() {
	if (closeTimer) {
		clearTimeout(closeTimer);
		closeTimer = null;
	}
}

export function startCloseDelay(callback: () => void, ms = POPUP_CLOSE_DELAY_MS) {
	cancelCloseDelay();
	closeTimer = setTimeout(callback, ms);
}
