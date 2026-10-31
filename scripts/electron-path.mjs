import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Resolve the file without importing Electron: its package entry downloads missing binaries.
export function electronExecutable() {
  const require = createRequire(import.meta.url);
  const directory = dirname(require.resolve('electron/package.json'));
  const pathFile = join(directory,'path.txt');
  if (!existsSync(pathFile)) throw new Error('Electron 运行文件尚未安装，请由你执行 pnpm exec install-electron。');
  const executable = join(directory,'dist',readFileSync(pathFile,'utf8').trim());
  if (!existsSync(executable)) throw new Error('Electron 运行文件缺失，请由你执行 pnpm exec install-electron。');
  return executable;
}
