import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const cwd = new URL('../node_modules/pokemon-showdown/', import.meta.url);
if (!existsSync(new URL('dist/sim/index.js', cwd))) {
  const result = spawnSync(process.execPath, ['build'], {cwd, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(new URL('dist/sim/index.d.ts', cwd))) {
  const compiler = new URL('../node_modules/typescript/bin/tsc', import.meta.url);
  const result = spawnSync(process.execPath, [compiler.pathname, 'sim/global-types.ts', 'sim/index.ts', '--declaration', '--emitDeclarationOnly', '--declarationDir', 'dist/', '--rootDir', '.', '--target', 'es2020', '--strict', '--moduleResolution', 'node', '--types', 'node', '--lib', 'es2020', '--skipLibCheck'], {cwd, stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
