import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const {version}=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')) as {version:string};
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [{name:'wanxiang-build-version',generateBundle(){
    this.emitFile({type:'asset',fileName:'app-version.json',source:JSON.stringify({format:1,version})+'\n'});
  }}],
  root: resolve(root, 'src/renderer'),
  publicDir: resolve(root, 'public'),
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: resolve(root, 'dist-ui'), emptyOutDir: true,
    rolldownOptions: {
      onwarn(warning, warn) {
        // This desktop renderer is entirely client-side; preserve all other warnings.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client') && warning.message.includes('@radix-ui')) return;
        warn(warning);
      }
    }
  }
});
