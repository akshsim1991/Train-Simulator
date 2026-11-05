// Copies the parts of three.js we use into vendor/ and rewrites bare 'three'
// imports to relative paths so no bundler / importmap / CSP exception is needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'three');
const dst = path.join(root, 'src', 'vendor', 'three');
const files = [
  'build/three.module.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/MaskPass.js',
  'examples/jsm/postprocessing/Pass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/postprocessing/SMAAPass.js',
  'examples/jsm/shaders/CopyShader.js',
  'examples/jsm/shaders/LuminosityHighPassShader.js',
  'examples/jsm/shaders/OutputShader.js',
  'examples/jsm/shaders/SMAAShader.js',
  'examples/jsm/objects/Sky.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
];
fs.rmSync(dst, { recursive: true, force: true });
for (const f of files) {
  const out = path.join(dst, f);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let code = fs.readFileSync(path.join(src, f), 'utf8');
  const rel = path.relative(path.dirname(out), path.join(dst, 'build/three.module.js')).split(path.sep).join('/');
  code = code.replace(/from\s+'three'/g, `from '${rel.startsWith('.') ? rel : './' + rel}'`);
  fs.writeFileSync(out, code);
}
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(dst, 'LICENSE'));
console.log('vendored', files.length, 'files');
