import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,

  name: "Image Translate Extension",

  version: "1.0.0",

  description: "A simple Image Translate Extension",

  action: {
    default_popup: "index.html",
  },

  background: {
    service_worker: "src/background.ts",
    type: "module",
  },

  permissions: [
    "activeTab",
    "scripting",
    "offscreen",
    "contextMenus",
    "storage",
    "declarativeNetRequest",
    "declarativeNetRequestFeedback",
  ],

  host_permissions: ["<all_urls>"],

  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },

  web_accessible_resources: [
    {
      resources: [
        "onnx-assets/ort-wasm-simd-threaded.jsep.mjs",
        "onnx-assets/ort-wasm-simd-threaded.jsep.wasm",
      ],
      matches: ["<all_urls>"],
    },
  ],

  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
});