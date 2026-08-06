# Detector de texto IA · overlay de ficheros

    tar -xzf xpx-detector.tar.gz
    ./xpx-detector/aplicar.sh
    rm -rf xpx-detector xpx-detector.tar.gz

Idempotente: se puede repetir.

## Para que el detector actúe de verdad

Recarga la extensión en `chrome://extensions`, abre una página **en inglés**,
pulsa el icono y elige **«Análisis profundo»**. El botón normal sigue siendo
Tier 1: instantáneo, sin descargas, solo procedencia de imágenes.

La primera vez que pulses «Análisis profundo» se descargan 253 MB del modelo.

## Qué esperar

Verás evidencia real y el LLR moverse. **La banda seguirá siendo prudente**: con
un solo detector el intervalo conforme cruza el umbral, y con certeza extrema el
validador de Extinction veta la acusación. Eso es ADR-007 funcionando. Salir de
la abstención necesita Tier 1 que corrobore, y aún no existe.

## Si no detecta nada

Abre la consola del documento offscreen (`chrome://extensions` → «documento
offscreen» → inspeccionar). Si el formato de respuesta de wllama no coincide con
lo esperado, verás un error explícito con las claves reales. Está hecho así a
propósito: antes devolvía cadena vacía y el sistema se abstenía en silencio para
siempre.
