import type { TranslationProvider } from "@/src/translation/types";
import type { DomainPattern } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { DEFAULT_TARGET_LANG } from "@/utils/languages";

export interface ExtensionSettings {
	enabled: boolean;
	enabledDomains: DomainPattern[];
	targetLang: string;
	/**
	 * `api` sends text to the hosted translate endpoint (no model download, no
	 * GPU memory); `local` runs the in-browser NLLB model.
	 */
	translationProvider: TranslationProvider;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
	enabled: true,
	enabledDomains: [],
	targetLang: DEFAULT_TARGET_LANG,
	translationProvider: "api",
};

export async function getExtensionSettings(): Promise<ExtensionSettings> {
	const result = await browser.storage.sync.get("extensionSettings");
	const stored = (result as Record<string, unknown>).extensionSettings;
	if (stored && typeof stored === "object") {
		return {
			...DEFAULT_SETTINGS,
			...(stored as Partial<ExtensionSettings>),
		};
	}
	return DEFAULT_SETTINGS;
}

export async function isUrlAllowedInSettings(url: string): Promise<boolean> {
	const settings = await getExtensionSettings();
	if (!settings.enabled) return false;
	return isUrlAllowed(url, settings.enabledDomains);
}
