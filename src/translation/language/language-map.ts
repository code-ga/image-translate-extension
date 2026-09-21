import type { NllbLanguageCode, SupportedSourceLanguage } from "../types";

export const SUPPORTED_SOURCE_LANGUAGES: Record<
	SupportedSourceLanguage,
	NllbLanguageCode
> = {
	eng: "eng_Latn",
	jpn: "jpn_Jpan",
	cmn: "zho_Hans",
	zho: "zho_Hant",
	kor: "kor_Hang",
	fra: "fra_Latn",
	deu: "deu_Latn",
	spa: "spa_Latn",
	por: "por_Latn",
	ita: "ita_Latn",
	rus: "rus_Cyrl",
	ara: "arb_Arab",
	hin: "hin_Deva",
	tha: "tha_Thai",
	vie: "vie_Latn",
} as const;

export const SOURCE_TO_NLLB: Record<string, NllbLanguageCode> = {
	...SUPPORTED_SOURCE_LANGUAGES,
	en: "eng_Latn",
	ja: "jpn_Jpan",
	zh: "zho_Hans",
	ko: "kor_Hang",
	fr: "fra_Latn",
	de: "deu_Latn",
	es: "spa_Latn",
	pt: "por_Latn",
	it: "ita_Latn",
	ru: "rus_Cyrl",
	ar: "arb_Arab",
	hi: "hin_Deva",
	th: "tha_Thai",
	vi: "vie_Latn",
};

export const NLLB_TO_SOURCE: Record<NllbLanguageCode, SupportedSourceLanguage> =
	{
		eng_Latn: "eng",
		jpn_Jpan: "jpn",
		zho_Hans: "cmn",
		zho_Hant: "zho",
		kor_Hang: "kor",
		fra_Latn: "fra",
		deu_Latn: "deu",
		spa_Latn: "spa",
		por_Latn: "por",
		ita_Latn: "ita",
		rus_Cyrl: "rus",
		arb_Arab: "ara",
		hin_Deva: "hin",
		tha_Thai: "tha",
		vie_Latn: "vie",
	};

export function mapToNllbCode(lang: string): NllbLanguageCode | null {
	return SOURCE_TO_NLLB[lang] ?? null;
}

export function mapFromNllbCode(
	nllbCode: NllbLanguageCode,
): SupportedSourceLanguage {
	return NLLB_TO_SOURCE[nllbCode];
}

export function isSupportedSourceLanguage(
	lang: string,
): lang is SupportedSourceLanguage {
	return lang in SUPPORTED_SOURCE_LANGUAGES;
}

export function getSupportedSourceLanguages(): SupportedSourceLanguage[] {
	return Object.keys(SUPPORTED_SOURCE_LANGUAGES) as SupportedSourceLanguage[];
}
