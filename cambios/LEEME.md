# Cambios · IPC, host offscreen y detección de texto IA

Base: `d659185` (main tras la PR #1). Dos commits. **No se ha hecho push**: el
remoto devuelve 403 (token de sesión sin permiso de escritura).

## Aplicar

    git am -3 < 0001-*.patch < 0002-*.patch   # o uno a uno
    # o bien:
    cp -r ficheros/. /ruta/al/repo/ && pnpm install

## Verificar

    pnpm exec vitest run                      # 234 tests
    pnpm -r typecheck                         # 7 paquetes
    pnpm --filter @xpx/extension build        # los 5 navegadores
    pnpm --filter @xpx/extension smoke        # carga real en Chromium

## Probar a mano

1. `pnpm --filter @xpx/extension build:chrome`
2. `chrome://extensions` → modo desarrollador → "Cargar descomprimida" →
   elegir `chrome_extension/`
3. Abrir una página en inglés y pulsar el icono de la barra.

El primer análisis profundo descarga 253 MB desde HuggingFace. Ese tramo no
está verificado en este entorno.
