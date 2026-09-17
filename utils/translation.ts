import { pipeline, env } from "@huggingface/transformers"

env.useBrowserCache = true
env.allowLocalModels = true
const loadedModels = {} as Record<string, Awaited<ReturnType<typeof pipeline<"translation">>>>

export async function translateDynamic(text: string | string[], srcLang: string, targetLang = "vi"): Promise<Record<string, string>> {
	const texts = Array.isArray(text) ? text : [text];
	if (texts.length === 0) return {};

	const modelName = `Xenova/opus-mt-${srcLang}-${targetLang}`;
	try {
		if (!loadedModels[modelName]) {
			console.log(`Loading model for ${srcLang} -> ${targetLang}...`);
			loadedModels[modelName] = await pipeline("translation", modelName);
		}

		const output = await loadedModels[modelName](texts);
		console.log(output);
		const translations = output.map((o: any) => o.translation_text);
		const result: Record<string, string> = {};
		texts.forEach((text, i) => {
			result[text] = translations[i];
		});
		return result;
	} catch (err) {
		console.error(`Không tìm thấy model dịch cho cặp ${srcLang}->${targetLang}`, err);
		throw err;
	}
}
