import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { crx } from "@crxjs/vite-plugin";
import manifest from './src/manifest'

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
    crx({
      manifest,
    }),
  ],
  build: {
    outDir: 'build',
  },
});