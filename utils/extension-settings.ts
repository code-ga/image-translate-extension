import type { DomainPattern } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";
import { DEFAULT_TARGET_LANG } from "@/utils/languages";

export interface ExtensionSettings {
	enabled: boolean;
	enabledDomains: DomainPattern[];
	targetLang: string;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
	enabled: true,
	enabledDomains: [],
	targetLang: DEFAULT_TARGET_LANG,
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
	const enabledDomains = settings.enabledDomains;
	return isUrlAllowed(url, enabledDomains);
}
