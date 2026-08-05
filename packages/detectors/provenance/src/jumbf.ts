/**
 * JUMBF (JPEG Universal Metadata Box Format, ISO/IEC 19566-5), el contenedor
 * en el que C2PA guarda su manifest store.
 *
 * Estructura de caja ISO BMFF: longitud BE de 4 bytes, tipo de 4 bytes, carga.
 * Una superbox 'jumb' contiene primero una caja descriptora 'jumd' —de la que
 * sale la etiqueta— y después las cajas de contenido.
 */

export interface JumbfBox {
  readonly type: string;
  /** Etiqueta de la caja descriptora, si la superbox la trae. */
  readonly label?: string;
  readonly payload: Uint8Array;
  readonly children: readonly JumbfBox[];
}

const MAX_DEPTH = 16;

export function parseJumbf(bytes: Uint8Array): readonly JumbfBox[] {
  return parseBoxes(bytes, 0);
}

function parseBoxes(bytes: Uint8Array, depth: number): JumbfBox[] {
  if (depth > MAX_DEPTH) return [];

  const out: JumbfBox[] = [];
  let i = 0;

  while (i + 8 <= bytes.length) {
    const size = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);

    // size 0 significa "hasta el final"; size 1 usa longitud extendida de 64
    // bits, que C2PA no necesita y no aceptamos.
    let start = i + 8;
    let end: number;
    if (size === 0) end = bytes.length;
    else if (size === 1) break;
    else if (size < 8) break;
    else end = i + size;

    if (end > bytes.length) break;

    const payload = bytes.subarray(start, end);
    const isSuperbox = type === 'jumb';

    if (isSuperbox) {
      const children = parseBoxes(payload, depth + 1);
      const descriptor = children.find((c) => c.type === 'jumd');
      const label = descriptor === undefined ? undefined : readLabel(descriptor.payload);
      out.push({
        type,
        ...(label !== undefined ? { label } : {}),
        payload,
        children,
      });
    } else {
      out.push({ type, payload, children: [] });
    }

    if (end <= i) break; // no avanzar nunca hacia atrás
    i = end;
  }

  return out;
}

/**
 * Caja descriptora 'jumd': UUID de 16 bytes, 1 byte de toggles, y si el bit 1
 * está puesto, una etiqueta terminada en NUL.
 */
function readLabel(payload: Uint8Array): string | undefined {
  if (payload.length < 17) return undefined;
  const toggles = payload[16] as number;
  if ((toggles & 0x02) === 0) return undefined;

  let end = 17;
  while (end < payload.length && payload[end] !== 0) end += 1;
  if (end === 17) return undefined;
  return ascii(payload, 17, end - 17);
}

/** Busca en profundidad la primera caja cuya etiqueta empiece por el prefijo. */
export function findByLabel(
  boxes: readonly JumbfBox[],
  prefix: string,
): JumbfBox | undefined {
  for (const b of boxes) {
    if (b.label !== undefined && b.label.startsWith(prefix)) return b;
    const found = findByLabel(b.children, prefix);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Busca en profundidad todas las cajas de un tipo dado. */
export function findByType(boxes: readonly JumbfBox[], type: string): JumbfBox[] {
  const out: JumbfBox[] = [];
  for (const b of boxes) {
    if (b.type === type) out.push(b);
    out.push(...findByType(b.children, type));
  }
  return out;
}

function u32be(b: Uint8Array, o: number): number {
  return (
    (((b[o] ?? 0) << 24) >>> 0) + ((b[o + 1] ?? 0) << 16) + ((b[o + 2] ?? 0) << 8) + (b[o + 3] ?? 0)
  );
}

function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i += 1) s += String.fromCharCode(b[i] ?? 0);
  return s;
}
