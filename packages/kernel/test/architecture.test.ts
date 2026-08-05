import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Reglas de arquitectura impuestas por test. Una regla que solo vive en un
 * documento se erosiona en el tercer sprint.
 */

const ROOT = resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  return [...src.matchAll(re)].map((m) => m[1] ?? '');
}

describe('ADR-001 — el kernel no sabe que existe un navegador', () => {
  const files = sourceFiles(join(ROOT, 'packages/kernel/src'));

  it('encuentra los ficheros del kernel', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('no importa ningún paquete interno', () => {
    for (const f of files) {
      for (const imp of imports(f)) {
        expect(imp.startsWith('@xpx/'), `${f} importa ${imp}`).toBe(false);
      }
    }
  });

  it('no importa nada externo: cero dependencias en runtime', () => {
    for (const f of files) {
      for (const imp of imports(f)) {
        const isRelative = imp.startsWith('.') || imp.startsWith('/');
        expect(isRelative, `${f} importa el paquete externo ${imp}`).toBe(true);
      }
    }
  });

  it('no usa APIs de extensión ni globales del DOM', () => {
    const forbidden = [
      /\bchrome\./,
      /\bbrowser\.\w/,
      /\bdocument\./,
      /\bwindow\./,
      /\blocalStorage\b/,
      /\bindexedDB\b/,
      /\bfetch\s*\(/,
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // Se ignoran los comentarios: los documentos citan estas APIs.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of forbidden) {
        expect(re.test(code), `${f} usa ${re}`).toBe(false);
      }
    }
  });
});

describe('ADR-010 — frontera de licencia GPL', () => {
  it('el kernel es Apache-2.0', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'packages/kernel/package.json'), 'utf8'),
    ) as { license: string };
    expect(pkg.license).toBe('Apache-2.0');
  });

  it('el validador de Extinction es GPL-3.0', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(ROOT, 'packages/detectors/extinction-validator/package.json'),
        'utf8',
      ),
    ) as { license: string };
    expect(pkg.license).toBe('GPL-3.0-or-later');
  });

  /**
   * La garantía que hace posible incluir Extinction sin invalidar el SDK
   * comercial: la dependencia va en un solo sentido. El validador GPL usa el
   * kernel; el kernel no sabe que el validador existe.
   */
  it('el kernel NO depende del paquete GPL, ni en código ni en package.json', () => {
    const files = sourceFiles(join(ROOT, 'packages/kernel/src'));
    for (const f of files) {
      for (const imp of imports(f)) {
        expect(imp.includes('extinction'), `${f} importa ${imp}`).toBe(false);
      }
    }

    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'packages/kernel/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });

  it('la extensión, que sí incluye el validador, se declara GPL-3.0', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'apps/extension/package.json'), 'utf8'),
    ) as { license: string; dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty('@xpx/extinction-validator');
    expect(pkg.license).toBe('GPL-3.0-or-later');
  });
});
