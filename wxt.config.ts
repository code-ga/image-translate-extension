import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    // action: {},
    // permissions: ["offscreen", "activeTab"],
    action: {
      "default_popup": "index.html"
    },
    background: {
      "service_worker": "background.js",
      "type": "module"
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    permissions: [
      "activeTab",
      "scripting",
      "offscreen",
      "contextMenus",
      "storage",
      "declarativeNetRequest",
      "declarativeNetRequestFeedback"
    ],
    host_permissions: [
      "<all_urls>"
    ],
    web_accessible_resources: [
      {
        resources: ['onnx/*'],
        matches: ['<all_urls>']
      }
    ]
  },
});
