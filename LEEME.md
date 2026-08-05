# Cambios — IPC, host offscreen y servidor de inferencia

Base: `d659185` (merge de la PR #1). Dos commits. Sin push.

## Cómo aplicarlo

Desde la raíz del repositorio, con el árbol limpio y situado en `d659185`:

```bash
git am 0001-*.patch 0002-*.patch
```

Si prefieres los ficheros sueltos, el resto del tar los trae en su ruta final.

Después:

```bash
pnpm install     # @xpx/ipc es nuevo en el workspace
pnpm test        # 197 en verde
pnpm typecheck   # limpio en los 5 paquetes
```

## Commit 1 — IPC tipado y host offscreen

**`packages/ipc` (nuevo)** — RPC tipado sobre un `Transport` abstracto, cero
dependencias.

- Validación en ambos extremos con predicados de tipo, no con Zod ni Valibot.
  El paquete corre también en el content script, donde el presupuesto es de
  15 KB gzip. Cada canal declara su validador junto al manejador.
- Los errores internos se sanean antes de salir: un mensaje de excepción puede
  llevar rutas o contenido, y el content script es un contexto no privilegiado
  dentro de una página ajena. Solo un `IpcError` explícito viaja intacto.
- Temporizadores y señales se inyectan (`env.ts`); el paquete compila sin
  `lib DOM` para poder correr en Node.

**`ChromiumRuntimeHost`** — documento offscreen. Resuelve los dos problemas de
ciclo de vida de MV3: la carrera de arranque (el service worker muere y revive,
y `createDocument` falla si ya existe de forma indistinguible de un error real)
y la caída del puerto (el host se marca no listo y la siguiente llamada
reconstruye documento y puerto).

`RuntimeHost.run` exige un validador. `detectPlatform` recibe el user-agent por
parámetro: leerlo del global lo hacía imposible de probar.

## Commit 2 — el otro extremo del puerto

**`startInferenceServer`** — lo que corre dentro del documento offscreen. Sin
esto, `run('infer', …)` hablaba con un puerto que nadie escuchaba.

Aquí se impone por primera vez **en código** la regla de arquitectura §11: el
content script no puede pedir inferencia. `runtime.onConnect` no distingue por
sí solo quién llama —un content script puede invocar `runtime.connect` igual
que el background— así que la comprobación de `sender.tab` es lo único que
separa ambos contextos.

Un veredicto cuyo hash no coincide con el de la entrada no se entrega: acabaría
en la caché del llamante bajo una clave que no le corresponde.

**`messaging/wire.ts`** — validadores del contrato que cruza el puerto. Es la
frontera de confianza real:

- El `hash` se exige como sha256 hexadecimal, porque es la clave de caché y lo
  único que se persiste.
- El texto lleva techo, porque quien envía puede ser un content script
  comprometido y un texto sin cota tumba el documento offscreen.
- Las dimensiones de los píxeles se contrastan con el tamaño del búfer. Es el
  único invariante del objeto que no se ve a simple vista, y un desajuste
  provocaría una lectura fuera de rango en un detector.

**`portTransport`** deja de tragarse los fallos de clonado. Un puerto caído se
absorbe —el cliente ya tiene tiempo de espera—, pero una carga no clonable es
un error de programación que el `catch` amplio convertía en una petición que
jamás vuelve.

El doble de navegador clona con `structuredClone` como Chrome y encola los
mensajes enviados antes de que el receptor registre su oyente. Sin esa cola,
los tests pasaban o fallaban según el orden de microtareas.

## Estado

- 197 tests en verde (79 nuevos), con el camino completo service worker ↔
  documento offscreen ↔ kernel ejercitado de extremo a extremo.
- Typecheck limpio en los 5 paquetes, partiendo de cero.

## Dos cosas que debes saber

1. **Arreglo previo, fuera de encargo**: el typecheck de los detectores fallaba
   en un checkout limpio. Usan project references pero corrían con `tsc -p`,
   que no construye las declaraciones del kernel. Pasan a `tsc --build`. Sin
   eso no había forma de verificar el trabajo con `pnpm check`.
2. **`pnpm lint` sigue roto y no se toca aquí**: el script es `eslint .` y en
   el repositorio no hay ni configuración de ESLint ni la dependencia.

## Lo siguiente, cuando retomes

El camino está montado pero aún no hay quien lo use: faltan los *entrypoints*
de wxt (`src/entrypoints/`). En orden natural:

1. `offscreen.html` + su `main.ts`, que instancia `startInferenceServer` con un
   `Pipeline` real y registra los detectores de procedencia y estilometría.
2. El service worker de background, dueño del `RuntimeHost`, sirviendo el canal
   `analyze` a los content scripts.
3. El content script: extracción de bloques, normalización y hash.

Tier 0 (procedencia + estilometría) ya es TypeScript puro y no necesita ONNX,
así que el primer veredicto de punta a punta es alcanzable antes de tocar los
modelos.
