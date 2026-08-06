import { cp, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copia el build de un navegador a su directorio de artefacto en la raíz.
 *
 *   apps/extension/.output/chrome  →  chrome_extension/
 *
 * Existe porque `wxt build` no acepta un directorio de salida por CLI: solo lo
 * lee de la configuración, que se carga antes de saber qué navegador se está
 * construyendo. Los scripts del repositorio pasaban `--outDir` y fallaban.
 *
 * El mapa vive aquí y solo aquí. Estaba duplicado en `wxt.config.ts`, donde
 * además no hacía nada salvo emitir un aviso.
 */

const ARTIFACT_DIRS = {
  chrome: 'chrome_extension',
  firefox: 'firefox_extension',
  // "edge_extesion" está mal escrito en el repositorio desde el primer commit.
  // Se respeta: renombrarlo rompería enlaces y no arregla nada.
  edge: 'edge_extesion',
  opera: 'opera_extension',
  safari: 'Safari_extension',
};

const here = dirname(fileURLToPath(import.meta.url));
const browser = process.argv[2];

const target = ARTIFACT_DIRS[browser];
if (target === undefined) {
  console.error(`navegador desconocido: "${browser}". Esperado: ${Object.keys(ARTIFACT_DIRS).join(', ')}`);
  process.exit(1);
}

const source = resolve(here, '..', '.output', browser);
const destination = resolve(here, '..', '..', '..', target);

await access(source).catch(() => {
  throw new Error(`no hay build en ${source}. Ejecuta "wxt build -b ${browser}" primero.`);
});

// El README de cada directorio es fuente, no artefacto: se conserva.
const readme = resolve(destination, 'README.md');
const keptReadme = await readFileOrUndefined(readme);

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

if (keptReadme !== undefined) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(readme, keptReadme);
}

console.log(`${browser}: ${source} → ${destination}`);

async function readFileOrUndefined(path) {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
