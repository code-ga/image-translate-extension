import type { DomainPattern } from "@/types";
import { isUrlAllowed } from "@/utils/domain-matcher";

export interface ExtensionSettings {
	enabled: boolean;
	enabledDomains: DomainPattern[];
}

const DEFAULT_SETTINGS: ExtensionSettings = {
	enabled: true,
	enabledDomains: [],
};

export async function getExtensionSettings(): Promise<ExtensionSettings> {
	const result = await browser.storage.sync.get("extensionSettings");
	const stored = (result as Record<string, unknown>).extensionSettings;
	if (stored && typeof stored === "object") {
		return stored as ExtensionSettings;
	}
	return DEFAULT_SETTINGS;
}

export async function isUrlAllowedInSettings(url: string): Promise<boolean> {
	const settings = await getExtensionSettings();
	console.log("Extension settings:", settings);
	if (!settings.enabled) return false;
	const enabledDomains = settings.enabledDomains;
	return isUrlAllowed(url, enabledDomains);
}
