# Cambios — del kernel a una extensión instalable

Base: `d659185` (merge de la PR #1). Tres commits. Sin push.

## Cómo aplicarlo

```bash
git am 0001-*.patch 0002-*.patch 0003-*.patch
pnpm install
pnpm test        # 246 en verde
pnpm typecheck   # limpio en los 5 paquetes
pnpm build       # produce las 5 extensiones
```

## Qué hay ahora que antes no había

El camino completo del producto, cerrado y probado sin navegador:

```
content script ──analyze──▶ background ──infer──▶ documento offscreen ──▶ kernel
```

Cárgalo en Chrome con «Cargar descomprimida» apuntando a `chrome_extension/`.

## Commit 1 — IPC tipado y host offscreen

`packages/ipc`: RPC tipado sobre un `Transport` abstracto, cero dependencias.
Validación en ambos extremos con predicados de tipo en vez de Zod o Valibot —
el paquete corre también en el content script, con 15 KB gzip de presupuesto.
Los errores internos se sanean antes de salir: un mensaje de excepción puede
llevar rutas o contenido, y el content script vive en la página del usuario.

`ChromiumRuntimeHost`: documento offscreen, con los dos problemas de ciclo de
vida de MV3 resueltos — la carrera de arranque y la caída del puerto.

## Commit 2 — el otro extremo del puerto

`startInferenceServer`: lo que corre dentro del documento offscreen. Impone por
primera vez **en código** la regla de arquitectura §11. `runtime.onConnect` no
distingue quién llama: un content script puede invocar `runtime.connect` igual
que el background, así que comprobar `sender.tab` es lo único que separa ambos
contextos.

`messaging/wire.ts`: los validadores de la frontera. El `hash` se exige como
sha256 hexadecimal porque es la clave de caché y lo único que se persiste; el
texto lleva techo porque quien envía puede ser un content script comprometido;
y las dimensiones de los píxeles se contrastan con el tamaño del búfer, que es
el invariante que no se ve y cuya violación sería una lectura fuera de rango.

## Commit 3 — entrypoints, normalización y artefacto real

`content/normalize.ts`: normaliza a NFC y elimina caracteres de ancho cero. Dos
motivos que apuntan al mismo sitio — dos textos que se leen igual deben hashear
igual, o la caché no sirve; e insertar invisibles entre letras es la evasión más
barata contra un detector. Los homoglifos **no** se tocan: esos sí cambian el
significado y su tratamiento es de un detector.

`core/analyze-service.ts`: el canal del background, imagen especular del
servidor de inferencia — aquel rechaza a quien tenga `sender.tab`, este lo
exige. Entre los dos no queda un tercer camino hacia el motor.

## Lo que debes saber, y no es agradable

**No hay detector de texto.** El registro planea cero detectores para texto, así
que hoy el kernel se abstiene siempre con `NO_EVIDENCE`. Está fijado por test a
propósito, para que el test caiga el día que llegue la estilometría (hito S4) y
no antes. Es la respuesta correcta: un llr sin su conjunto de calibración no
significa nada (ADR-006), e inventar uno para que «salga algo» sería peor que
callarse. Las imágenes sí producen veredicto real vía procedencia.

**Tres fallos previos impedían tener artefacto**, y estaban ahí desde antes:

1. Los scripts pasaban `wxt build --outDir`, que no es una opción de wxt. El
   build fallaba antes de compilar nada.
2. `default_locale: 'es'` sin árbol `_locales`. El navegador se niega a cargar
   una extensión así.
3. Firefox y Safari se construían como MV2, contra la matriz de compatibilidad.

**Choque de versiones**: wxt 0.21 exige Vite 6 y vitest 2 arrastraba Vite 5, con
lo que el build ni arrancaba. Se sube a vitest 3 y Vite 6.

**`pnpm lint` sigue roto** y no se toca aquí: el script es `eslint .` y no hay
ni configuración de ESLint ni la dependencia. Es el único punto de `pnpm check`
que no pasa.

## Estado frente al plan del MVP

| Hito | Antes | Ahora |
|---|---|---|
| S1 · fundamentos y build | parcial | **build instalable en 5 navegadores**; siguen faltando ESLint y CI |
| S2 · contratos del kernel | completo | completo |
| S3 · procedencia | completo | completo |
| S4 · estilometría + content script | parcial | normalización lista; **falta el detector y la extracción del DOM** |
| S5 · RuntimeHost, Workers, ORT | parcial | host y cableado completos; faltan Workers, ORT y ModelManager |

## Lo siguiente

1. **Detector estilométrico Tier 0.** Es el que desbloquea cualquier veredicto
   de texto. Necesita corpus para calibrar: sin él solo se pueden inventar
   números, que es justo lo que el diseño prohíbe.
2. **Extracción del DOM** en el content script: bloques visibles, sin
   boilerplate, con las pistas de `domHints`.
3. **Motor de overlay** en shadow root cerrado, sin mutar el DOM del anfitrión.
