import fs from "fs"
import path from "path"
const script = process.argv[2];
console.log(`Running script: ${script}`);
const onnxDir = "node_modules/onnxruntime-web/dist"
if (script === "postinstall") {
  // Perform any post-installation tasks here
  if (fs.existsSync(onnxDir)) {
    const files = fs.readdirSync(onnxDir)
    const targetDir = "public/onnx"
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir)
    for (const file of files) {
      const fullDir = path.join(onnxDir, file)
      const fullTargetDir = path.join(targetDir, file)
      fs.cpSync(fullDir, fullTargetDir)
    }
  }
}