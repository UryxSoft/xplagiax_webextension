# Cambios — IPC tipado y host de inferencia offscreen en Chromium

Base: `d659185` (merge de la PR #1). Sin push: este paquete es el entregable.

## Cómo aplicarlo

Desde la raíz del repositorio, con el árbol limpio y situado en `d659185`:

```bash
git am 0001-ipc-y-host-offscreen.patch
```

Si prefieres los ficheros sueltos, el resto del tar los trae ya en su ruta
final; basta con copiarlos sobre el repositorio.

Después:

```bash
pnpm install     # @xpx/ipc es nuevo en el workspace
pnpm test        # 165 en verde
pnpm typecheck   # limpio en los 5 paquetes
```

## Qué entra

**`packages/ipc` (nuevo)** — RPC tipado sobre un `Transport` abstracto, cero
dependencias.

- Validación en ambos extremos con predicados de tipo, no con Zod ni Valibot.
  El paquete corre también en el content script, donde el presupuesto es de
  15 KB gzip. Cada canal declara su validador junto al manejador, así que no
  hay forma de registrar una ruta sin decir qué acepta.
- Los errores internos se sanean antes de salir. El content script vive en la
  página del usuario y un mensaje de excepción puede llevar rutas o contenido;
  solo un `IpcError` explícito viaja con su texto intacto.
- Temporizadores y señales de cancelación se inyectan (`env.ts`) en lugar de
  tomarse del global, porque el paquete compila sin `lib DOM` para poder correr
  en Node. Efecto lateral útil: los tests controlan el tiempo sin trucos.

**`apps/extension/src/platform/` (nuevo y modificado)**

- `extension-api.ts` — la superficie exacta de `chrome.*` de la que depende la
  extensión, como interfaz. Si algo no está ahí, no se usa.
- `port-transport.ts` — única traducción entre el puerto del navegador y el RPC.
- `chromium-host.ts` — `ChromiumRuntimeHost` real. Resuelve los dos problemas de
  ciclo de vida de MV3: la carrera de arranque (el service worker muere y
  revive, varias llamadas concurrentes intentan crear el documento offscreen a
  la vez, y `createDocument` falla si ya existe de forma indistinguible de un
  error real) y la caída del puerto (cuando el navegador reclama el documento,
  el host se marca no listo y la siguiente llamada reconstruye documento y
  puerto en vez de escribir en un canal muerto).
- `runtime-host.ts` — `RuntimeHost.run` exige ahora un validador: el resultado
  cruza una frontera de proceso. `detectPlatform` recibe el user-agent por
  parámetro, porque leerlo del global lo hacía imposible de probar (`navigator`
  es de solo lectura en Node).

**`docs/03-arquitectura.md` §11** — se corrige a lo que realmente se construyó:
sin librería de esquemas, y con el porqué.

## Arreglo aparte, previo a este trabajo

El typecheck de los detectores fallaba en un checkout limpio: usan project
references pero corrían con `tsc -p`, que no construye las declaraciones del
kernel. Pasan a `tsc --build`. Afecta a `packages/detectors/*/package.json`.

## Estado

- 165 tests en verde (47 nuevos: 22 de IPC, 25 del host).
- Typecheck limpio en los 5 paquetes, partiendo de cero.
- `pnpm lint` sigue roto y no se toca aquí: el script es `eslint .` y en el
  repositorio no hay ni configuración de ESLint ni la dependencia.
