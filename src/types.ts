export type OCRResult = { text: string, top: number, left: number, width: number, height: number }[]
export type InternalMessageType = {
  action: "PROCESS_OCR",
  fetchingType: "url" | "base64",
  imageData: string
}