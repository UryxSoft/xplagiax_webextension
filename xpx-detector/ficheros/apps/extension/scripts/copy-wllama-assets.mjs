import { cp, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copia el WebAssembly de wllama a `public/` antes del build.
 *
 * No se commitea el binario: es un artefacto de una dependencia, y tenerlo en
 * el repositorio significaría que una actualización de wllama deja un `.wasm`
 * desincronizado sin que nada avise. Copiarlo en cada build lo ata a la versión
 * declarada en package.json, que es la única fuente de verdad.
 */

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const wllamaRoot = dirname(require.resolve('@wllama/wllama/package.json'));
const source = join(wllamaRoot, 'esm', 'wasm');
const target = resolve(here, '..', 'public', 'wllama');

await access(source).catch(() => {
  throw new Error(`no se encuentra el wasm de wllama en ${source}. ¿Falta pnpm install?`);
});

await mkdir(target, { recursive: true });
// Solo lo que hace falta en tiempo de ejecución: las declaraciones de tipos
// que wllama publica junto al wasm no pintan nada en el artefacto.
await cp(source, target, {
  recursive: true,
  filter: (src) => !src.endsWith('.d.ts'),
});

console.log(`wllama: ${source} → ${target}`);
