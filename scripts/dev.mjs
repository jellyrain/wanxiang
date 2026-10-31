import { createServer, build } from 'vite';
import './build-api-contract.mjs';
import './build-skills.mjs';
import { spawn } from 'node:child_process';
import { electronExecutable } from './electron-path.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const executable = electronExecutable();
const compile = spawn(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.desktop.json'], {
  cwd: root, stdio: 'inherit', windowsHide: true
});
const compileExit = await new Promise((done, reject) => {
  compile.on('error', reject);
  compile.on('exit', done);
});
if (compileExit !== 0) process.exit(1);

await build({configFile:resolve(root,'vite.config.ts')});
const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
const env = { ...process.env, WANXIANG_DEV_URL: 'http://127.0.0.1:5173', WANXIANG_DATA_DIR: resolve(root, '.local-data') };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(executable, ['.'], { cwd: root, stdio: 'inherit', env, windowsHide: false });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (desktop.exitCode === null) desktop.kill();
  await server.close();
  process.exit(code);
}
desktop.on('error', async error => { console.error(error.message); await stop(1); });
desktop.on('exit', code => void stop(code ?? 0));
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
