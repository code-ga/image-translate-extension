import { pipeline, env } from "@huggingface/transformers"

env.useBrowserCache = true
env.allowLocalModels = true
const loadedModels = {} as Record<string, Awaited<ReturnType<typeof pipeline<"translation">>>>

export async function translateDynamic(text: string, srcLang: string, targetLang = "vi") {
  const modelName = `Xenova/opus-mt-${srcLang}-${targetLang}`
  try {
    if (!loadedModels[modelName]) {
      console.log(`Loading model for ${srcLang} -> ${targetLang}...`);
      loadedModels[modelName] = await pipeline('translation', modelName);
    }

    const output = await loadedModels[modelName](text);
    console.log(output)
    return output[0].translation_text;
  } catch (err) {
    console.error(`Không tìm thấy model dịch cho cặp ${srcLang}->${targetLang}`, err);
  }
}