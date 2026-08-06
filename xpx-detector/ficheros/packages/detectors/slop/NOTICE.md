# Procedencia y licencia

Este paquete integra **[distil-ai-slop-detector](https://github.com/distil-labs/distil-ai-slop-detector)**
de Distil Labs, publicado bajo **Apache-2.0**.

## Qué se toma del original

- El **formato del prompt** y los parámetros de muestreo (`src/prompt.ts` en
  `@xpx/runtime`), reproducidos literalmente. Un modelo destilado se entrena
  contra un formato concreto; alterarlo cambia el comportamiento en silencio.
- El **modelo**: `distil-labs/ai-slop-detector-v1-gguf`, Gemma 3 270M destilado
  de GPT-OSS 120B, cuantizado a Q4_K_M (~253 MB). Se descarga de HuggingFace
  tras la instalación; **no se empaqueta** (ADR-003).
- La estrategia de ejecución: wllama sobre WebAssembly, en un contexto aislado.

## Qué NO se toma

No se copia código de la extensión original. Su `background.js`, `popup.js` y
`offscreen.js` resuelven un producto distinto —un panel donde pegar texto a
mano— y este integra la detección en la navegación.

## Diferencia sustantiva: probabilidad frente a etiqueta

El original devuelve solo una etiqueta y declina inventar una puntuación de
confianza. Es una decisión correcta, pero deja sin usar una señal que sí existe:
las log-probabilidades del primer token generado, que es el que decide entre
`ai_generated` y `human_written`.

Este paquete las pide (`logprobs`) y las convierte en un LLR acotado por la
exactitud publicada del modelo (~95 %), como exige ADR-006. Si el backend no las
aporta, degrada a la etiqueta con evidencia media en lugar de fingir precisión.

## Frontera de licencia

Apache-2.0, igual que `@xpx/kernel`. A diferencia de
`@xpx/extinction-validator` (GPL-3.0), **este paquete no impone copyleft** y
puede formar parte del SDK comercial.
