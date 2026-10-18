export interface Language {
	code: string;
	label: string;
}

export const DEFAULT_TARGET_LANG = "vie_Latn";

export const SUPPORTED_LANGUAGES: Language[] = [
	{ code: "eng_Latn", label: "English" },
	{ code: "vie_Latn", label: "Vietnamese" },
	{ code: "spa_Latn", label: "Spanish" },
	{ code: "fra_Latn", label: "French" },
	{ code: "deu_Latn", label: "German" },
	{ code: "zho_Hans", label: "Chinese (Simplified)" },
	{ code: "zho_Hant", label: "Chinese (Traditional)" },
	{ code: "jpn_Jpan", label: "Japanese" },
	{ code: "kor_Hang", label: "Korean" },
	{ code: "rus_Cyrl", label: "Russian" },
	{ code: "por_Latn", label: "Portuguese" },
	{ code: "ara_Arab", label: "Arabic" },
	{ code: "tha_Thai", label: "Thai" },
	{ code: "tur_Latn", label: "Turkish" },
	{ code: "ind_Latn", label: "Indonesian" },
	{ code: "ita_Latn", label: "Italian" },
	{ code: "nld_Latn", label: "Dutch" },
	{ code: "hin_Deva", label: "Hindi" },
	{ code: "ell_Grek", label: "Greek" },
	{ code: "heb_Hebr", label: "Hebrew" },
	{ code: "hun_Latn", label: "Hungarian" },
	{ code: "ron_Latn", label: "Romanian" },
	{ code: "bul_Cyrl", label: "Bulgarian" },
	{ code: "hrv_Latn", label: "Croatian" },
	{ code: "ces_Latn", label: "Czech" },
	{ code: "swe_Latn", label: "Swedish" },
	{ code: "pol_Latn", label: "Polish" },
	{ code: "ukr_Cyrl", label: "Ukrainian" },
	{ code: "dan_Latn", label: "Danish" },
	{ code: "fin_Latn", label: "Finnish" },
	{ code: "nor_Latn", label: "Norwegian" },
	{ code: "msa_Latn", label: "Malay" },
	{ code: "slk_Latn", label: "Slovak" },
	{ code: "slv_Latn", label: "Slovenian" },
	{ code: "est_Latn", label: "Estonian" },
	{ code: "lav_Latn", label: "Latvian" },
	{ code: "lit_Latn", label: "Lithuanian" },
];

export function findLanguage(code: string): Language | undefined {
	return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

export function getLanguageLabel(code: string): string {
	return findLanguage(code)?.label ?? code;
}
