export interface Language {
	code: string;
	label: string;
}

export const DEFAULT_TARGET_LANG = "vi";

export const SUPPORTED_LANGUAGES: Language[] = [
	{ code: "en", label: "English" },
	{ code: "vi", label: "Vietnamese" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "zh", label: "Chinese (Simplified)" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "ru", label: "Russian" },
	{ code: "pt", label: "Portuguese" },
	{ code: "ar", label: "Arabic" },
	{ code: "th", label: "Thai" },
	{ code: "tr", label: "Turkish" },
	{ code: "id", label: "Indonesian" },
	{ code: "it", label: "Italian" },
	{ code: "nl", label: "Dutch" },
	{ code: "hi", label: "Hindi" },
];

export function findLanguage(code: string): Language | undefined {
	return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

export function getLanguageLabel(code: string): string {
	return findLanguage(code)?.label ?? code;
}
