/**
 * Decodificador CBOR (RFC 8949), subconjunto suficiente para C2PA.
 *
 * Propio y no una dependencia: esto parsea bytes de terceros dentro de una
 * extensión con acceso a páginas del usuario. Cada dependencia en esa ruta es
 * superficie de ataque, y el subconjunto que C2PA necesita cabe en un fichero.
 *
 * Endurecido a propósito: límite de profundidad, límite de tamaño, y ningún
 * bucle cuyo número de iteraciones venga de la entrada sin comprobar contra los
 * bytes disponibles.
 */

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | undefined
  | CborValue[]
  | Map<CborValue, CborValue>
  | CborTagged;

export interface CborTagged {
  readonly tag: number;
  readonly value: CborValue;
}

export class CborError extends Error {
  override readonly name = 'CborError';
}

const MAX_DEPTH = 32;

export function decodeCbor(bytes: Uint8Array): CborValue {
  const r = new Reader(bytes);
  const v = r.value(0);
  return v;
}

/** Decodifica y devuelve además cuántos bytes consumió. */
export function decodeCborPrefix(bytes: Uint8Array): { value: CborValue; length: number } {
  const r = new Reader(bytes);
  const value = r.value(0);
  return { value, length: r.offset };
}

class Reader {
  offset = 0;
  constructor(private readonly b: Uint8Array) {}

  value(depth: number): CborValue {
    if (depth > MAX_DEPTH) throw new CborError('profundidad excesiva');

    const ib = this.u8();
    const major = ib >> 5;
    const minor = ib & 0x1f;

    switch (major) {
      case 0:
        return this.length(minor);
      case 1: {
        const n = this.length(minor);
        return typeof n === 'bigint' ? -1n - n : -1 - n;
      }
      case 2:
        return this.bytes(this.count(minor));
      case 3:
        return utf8(this.bytes(this.count(minor)));
      case 4: {
        const n = this.count(minor);
        const out: CborValue[] = [];
        for (let i = 0; i < n; i += 1) out.push(this.value(depth + 1));
        return out;
      }
      case 5: {
        const n = this.count(minor, 2);
        const m = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i += 1) {
          const k = this.value(depth + 1);
          m.set(normalizeKey(k), this.value(depth + 1));
        }
        return m;
      }
      case 6: {
        const tag = this.length(minor);
        if (typeof tag === 'bigint') throw new CborError('tag fuera de rango');
        return { tag, value: this.value(depth + 1) };
      }
      case 7:
        return this.simple(minor);
      default:
        throw new CborError(`major type no soportado: ${major}`);
    }
  }

  private simple(minor: number): CborValue {
    switch (minor) {
      case 20:
        return false;
      case 21:
        return true;
      case 22:
        return null;
      case 23:
        return undefined;
      case 25:
        return f16(this.u16());
      case 26: {
        const dv = new DataView(this.bytes(4).slice().buffer);
        return dv.getFloat32(0, false);
      }
      case 27: {
        const dv = new DataView(this.bytes(8).slice().buffer);
        return dv.getFloat64(0, false);
      }
      case 31:
        throw new CborError('longitud indefinida no soportada');
      default:
        return minor;
    }
  }

  /** Argumento de longitud. Devuelve bigint solo si excede el entero seguro. */
  private length(minor: number): number | bigint {
    if (minor < 24) return minor;
    switch (minor) {
      case 24:
        return this.u8();
      case 25:
        return this.u16();
      case 26:
        return this.u32();
      case 27: {
        const hi = this.u32();
        const lo = this.u32();
        const v = (BigInt(hi) << 32n) | BigInt(lo);
        return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
      }
      case 31:
        throw new CborError('longitud indefinida no soportada');
      default:
        throw new CborError(`argumento inválido: ${minor}`);
    }
  }

  /**
   * Longitud declarada, acotada contra los bytes que quedan.
   * `perItem` es el mínimo de bytes que ocupa cada elemento: 1 para cadenas y
   * arrays, 2 para mapas (clave y valor). Sin esta cota, un array que declara
   * cuatro mil millones de elementos intentaría reservarlos.
   */
  private count(minor: number, perItem = 1): number {
    const n = this.length(minor);
    if (typeof n === 'bigint') throw new CborError('longitud fuera de rango');
    if (n * perItem > this.b.length - this.offset) {
      throw new CborError('longitud mayor que la entrada');
    }
    return n;
  }

  private u8(): number {
    const v = this.b[this.offset];
    if (v === undefined) throw new CborError('fin de entrada inesperado');
    this.offset += 1;
    return v;
  }

  private u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  private u32(): number {
    return ((this.u16() << 16) >>> 0) + this.u16();
  }

  private bytes(n: number): Uint8Array {
    if (this.offset + n > this.b.length) throw new CborError('fin de entrada inesperado');
    const out = this.b.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

/** Las claves Uint8Array no comparan por identidad en un Map: se normalizan. */
function normalizeKey(k: CborValue): CborValue {
  return k instanceof Uint8Array ? `bytes:${[...k].join(',')}` : k;
}

function utf8(b: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i] as number;
    if (c < 0x80) {
      s += String.fromCharCode(c);
      i += 1;
    } else if (c < 0xe0) {
      s += String.fromCharCode(((c & 0x1f) << 6) | ((b[i + 1] ?? 0) & 0x3f));
      i += 2;
    } else if (c < 0xf0) {
      s += String.fromCharCode(
        ((c & 0x0f) << 12) | (((b[i + 1] ?? 0) & 0x3f) << 6) | ((b[i + 2] ?? 0) & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((c & 0x07) << 18) |
        (((b[i + 1] ?? 0) & 0x3f) << 12) |
        (((b[i + 2] ?? 0) & 0x3f) << 6) |
        ((b[i + 3] ?? 0) & 0x3f);
      const u = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    }
  }
  return s;
}

function f16(h: number): number {
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  const sign = h & 0x8000 ? -1 : 1;
  if (exp === 0) return sign * 2 ** -24 * frac;
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exp - 25) * (1024 + frac);
}

// ---------------------------------------------------------------------------
// Codificación: solo lo necesario para reconstruir la Sig_structure de COSE.
// ---------------------------------------------------------------------------

export function encodeCborBytes(b: Uint8Array): Uint8Array {
  return concat(head(2, b.length), b);
}

export function encodeCborText(s: string): Uint8Array {
  const b = Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  return concat(head(3, b.length), b);
}

export function encodeCborArray(items: readonly Uint8Array[]): Uint8Array {
  return concat(head(4, items.length), ...items);
}

function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.from([(major << 5) | n]);
  if (n < 0x100) return Uint8Array.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Uint8Array.from([(major << 5) | 25, n >> 8, n & 0xff]);
  return Uint8Array.from([
    (major << 5) | 26,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
