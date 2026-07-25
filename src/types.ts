export type OCRResult = { text: string, top: number, left: number, width: number, height: number }[]
export type InternalMessageType = {
  action: "PROCESS_OCR",
  fetchingType: "url" | "base64",
  imageData: string,
  headers?: Record<string, string>
}

export type PopupMessageType = {
  type: "get-images"
}

export type PopupResponseType = {
  type: "images-list";
  images: { src: string; currentSrc: string; width: number; height: number }[]
}

export type TranslateCommandType = {
  type: "translate-images";
  urls: string[];
}

export type ProgressMessageType = {
  type: "translate-images-progress";
  url: string;
  index: number;
  total: number;
  success: boolean;
  error?: string;
}

export type CompleteMessageType = {
  type: "translate-images-complete";
  total: number;
  successCount: number;
}

export type CanvasInfo = {
  index: number;
  width: number;
  height: number;
}

export type CanvasListResponse = {
  type: "canvas-list";
  canvases: CanvasInfo[];
}

export type CanvasTranslateCommand = {
  type: "translate-canvases";
  indices: number[];
}

export type SettingsResponse = {
  type: "settings-response";
  enabledDomains: string[];
  enabled: boolean;
}

export type SettingsUpdate = {
  type: "settings-update";
  enabledDomains?: string[];
  enabled?: boolean;
}

export type NotifySettingsChanged = {
  type: "notify-settings-changed";
  settings: { enabled: boolean; enabledDomains: string[] };
}

export type SettingsChanged = {
  type: "settings-changed";
  settings: { enabled: boolean; enabledDomains: string[] };
}

export type ImageInfoWithStatus = {
  src: string;
  currentSrc: string;
  width: number;
  height: number;
  status: 'pending' | 'processing' | 'done'
}

export type CanvasInfoWithStatus = {
  index: number;
  width: number;
  height: number;
  status: 'pending' | 'processing' | 'done'
}

export type ImageStatusResponse = {
  type: "image-status-list";
  images: ImageInfoWithStatus[]
}

export type CanvasStatusResponse = {
  type: "canvas-status-list";
  canvases: CanvasInfoWithStatus[]
}