import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'public/manifest.json',
          dest: '.',
        },
        {
          // Grab the threaded WASM and matching JS wrapper file paths
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.*',
          // Destination folder inside your final build/ directory
          dest: 'onnx-assets',
          rename: {
            stripBase: true
          }
        }
      ],
    }),
  ],
  build: {
    outDir: 'build',
    rollupOptions: {
      input: {
        main: './index.html',
        background: './src/background.ts',
        content: "./src/content.ts",
        offscreen: "./src/offscreen.ts"
      },
      output: {
        format: 'es',
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') {
            return ("background.js");
          } else if (chunkInfo.name === "content") {
            return "content.js"
          } else if (chunkInfo.name === "offscreen") {
            return "offscreen.js"
          } else {
            return 'assets/[name]-[hash].js'
          };
        },
      },
    },
  },
});