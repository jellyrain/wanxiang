import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { electronExecutable } from './electron-path.mjs';

const root = fileURLToPath(new URL('..',import.meta.url));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electronExecutable(),['.',...process.argv.slice(2).filter(arg=>arg==='--background')],{ cwd:root,env,stdio:'inherit',windowsHide:false });
desktop.on('error',error => { console.error(error.message); process.exitCode=1; });
desktop.on('exit',code => { process.exitCode=code ?? 0; });
process.on('SIGINT',() => desktop.kill());
process.on('SIGTERM',() => desktop.kill());
