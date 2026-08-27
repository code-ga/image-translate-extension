import type { AppMessage, TranslateTextResponse } from "@/types";
import { DEFAULT_TARGET_LANG, SUPPORTED_LANGUAGES } from "./languages";
import {
	POPUP_BORDER_RADIUS,
	POPUP_BOX_SHADOW,
	POPUP_COLORS,
	POPUP_FONT,
	POPUP_Z_INDEX,
	injectPopupStyles,
} from "./popup-base";

const POPUP_DEBOUNCE_MS = 300;
const POPUP_CLOSE_DELAY_MS = 1000;
const POPUP_GAP = 6;

type PopupStatus = "info" | "success" | "error";

let currentPopup: HTMLDivElement | null = null;
let currentResultEl: HTMLElement | null = null;
let currentSelect: HTMLSelectElement | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let cachedTargetLang: string = DEFAULT_TARGET_LANG;

export function setDefaultTargetLang(lang: string): void {
	cachedTargetLang = lang;
}

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
			padding: 0;
			max-width: 320px;
			box-shadow: ${POPUP_BOX_SHADOW};
			pointer-events: auto;
			white-space: pre-wrap;
			overflow: hidden;
		`;

		injectPopupStyles(popup);

		const header = document.createElement("div");
		header.style.cssText = `
			padding: 8px 12px;
			font-size: 11px;
			color: #a0a0b0;
			border-bottom: 1px solid ${POPUP_COLORS.info.border};
		`;
		const headerLabel = document.createElement("span");
		headerLabel.textContent = "Original";
		const headerText = document.createElement("span");
		headerText.textContent = text;
		headerText.style.cssText = `
			display: block;
			margin-top: 2px;
			font-size: 12px;
			color: #e4e6eb;
			word-break: break-all;
		`;
		headerText.title = text;
		header.append(headerLabel, headerText);
		popup.appendChild(header);

		const langRow = document.createElement("div");
		langRow.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 8px 12px;
			border-bottom: 1px solid ${POPUP_COLORS.info.border};
		`;
		const langLabel = document.createElement("span");
		langLabel.textContent = "Translate to:";
		langLabel.style.cssText = `font-size: 11px; color: #a0a0b0;`;
		const select = document.createElement("select");
		select.style.cssText = `
			flex: 1;
			font-size: 12px;
			padding: 2px 6px;
			border-radius: 4px;
			border: 1px solid #3a3a4a;
			background: #252536;
			color: #e4e6eb;
			outline: none;
			cursor: pointer;
		`;
		for (const lang of SUPPORTED_LANGUAGES) {
			const option = document.createElement("option");
			option.value = lang.code;
			option.textContent = lang.label;
			select.appendChild(option);
		}
		select.value = cachedTargetLang;
		langRow.append(langLabel, select);
		popup.appendChild(langRow);

		const result = document.createElement("div");
		result.style.cssText = `
			padding: 10px 12px;
			font-size: 12px;
			color: ${POPUP_COLORS.info.text};
			word-break: break-word;
		`;
		result.textContent = "Translating...";
		popup.appendChild(result);

		positionPopup(popup, anchor);

		document.body.appendChild(popup);
		currentPopup = popup;
		currentResultEl = result;
		currentSelect = select;

		select.addEventListener("change", () => {
			const targetLang = select.value;
			requestTranslate(text, targetLang);
		});

		requestTranslate(text, select.value);

		onReady?.(popup);
	}, POPUP_DEBOUNCE_MS);

	return null;
}

function positionPopup(popup: HTMLElement, anchor: HTMLElement) {
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
}

function requestTranslate(text: string, targetLang: string) {
	if (!currentPopup || !currentResultEl || !currentSelect) return;
	if (currentSelect.value !== targetLang) {
		currentSelect.value = targetLang;
	}
	setResult("Translating...", "info");

	const popup = currentPopup;
	const resultEl = currentResultEl;

	browser.runtime
		.sendMessage<AppMessage>({
			from: "content",
			to: "background",
			type: "translate/text",
			srcLang: "",
			targetLang,
			text,
		})
		.then((response: TranslateTextResponse) => {
			if (popup !== currentPopup || resultEl !== currentResultEl) return;
			if (response.success) {
				setResult(response.translatedText || "(no translation)", "success");
			} else {
				setResult(response.error || "Translation failed", "error");
			}
		})
		.catch((err) => {
			if (popup !== currentPopup || resultEl !== currentResultEl) return;
			setResult(
				err instanceof Error ? err.message : "Translation failed",
				"error",
			);
		});
}

function setResult(text: string, status: PopupStatus) {
	if (!currentResultEl) return;
	currentResultEl.textContent = text;
	const color = POPUP_COLORS[status];
	currentResultEl.style.background = color.bg;
	currentResultEl.style.color = color.text;
}

export function updateTranslationPopup(
	popup: HTMLDivElement | null,
	translation?: string,
	error?: string,
) {
	if (!popup || popup !== currentPopup) return;

	if (error) {
		setResult(error, "error");
	} else if (translation) {
		setResult(translation, "success");
	}
}

export function dismissTranslationPopup() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	cancelCloseDelay();
	if (currentPopup?.parentNode) {
		currentPopup.remove();
	}
	currentPopup = null;
	currentResultEl = null;
	currentSelect = null;
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
