# ADR-004 · ONNX Runtime Web como runtime único

## Estado
Propuesto

## Contexto

El brief pide integrar tanto ONNX Runtime Web como TensorFlow.js, y menciona `ClassifierAI`
basado en TensorFlow.js entre los motores de imagen.

Hay un dato medido que resuelve la cuestión: los autores de DejAIvu documentan que **usar ONNX
Runtime Web en lugar de TensorFlow.js reduce la latencia en unos 35 ms por imagen**. En un
producto cuyo presupuesto para el primer veredicto es de 800 ms y que puede analizar decenas de
imágenes por página, no es un detalle.

El coste de mantener dos runtimes va más allá de la latencia: duplica el peso de WASM en el
paquete, duplica la superficie de fallo entre navegadores, obliga a mantener dos rutas de
aceleración (WebGL/WebGPU en TF.js, WASM+SIMD/WebGPU en ORT) y complica el sondeo de capacidades.

## Decisión

**ONNX Runtime Web es el único runtime de inferencia para Tier 0 y Tier 1.**

Los modelos publicados como TensorFlow.js o SavedModel se convierten a ONNX en el pipeline de
build, offline. La conversión se valida con un test de equivalencia numérica frente al modelo
original.

**wllama es la única excepción**, exclusivamente para el path GGUF de Tier 2, que es opt-in
(ver [ADR-005](./ADR-005-motor-tier2.md)).

Selección de backend en tiempo de ejecución, con degradación silenciosa:

```
WebGPU  →  WASM + SIMD + threads  →  WASM simple
```

El sondeo comprueba WebGPU, `crossOriginIsolated`, `SharedArrayBuffer`, núcleos y
`navigator.deviceMemory`. El resultado se cachea y se expone en el modo desarrollador.

## Alternativas consideradas

**Ambos runtimes, eligiendo por modelo.** Es lo que pide el brief. Rechazada por el coste medido
en latencia, peso y superficie de fallo, sin beneficio identificado que lo compense.

**Solo TensorFlow.js.** Ecosistema amplio y buen soporte de WebGL. Rechazada: peor latencia
medida, y el ecosistema de modelos de detección relevante publica en ONNX.

**WebNN.** Prometedor y con aceleración por hardware del sistema. Rechazada por ahora:
disponibilidad insuficiente en los cinco navegadores objetivo. Se reevalúa en V2 como backend
adicional detrás de la misma fachada.

## Consecuencias

### Positivas
- ~35 ms menos por imagen, según la medición publicada por DejAIvu.
- Un solo binario WASM en el paquete.
- Una sola ruta de aceleración que probar en cinco navegadores.
- La fachada `InferenceRuntime` permite añadir WebNN u otro backend sin tocar los detectores.

### Negativas
- Los modelos de TensorFlow.js requieren un paso de conversión, que puede fallar con operadores
  poco comunes y exige validación numérica.
- Se renuncia al backend WebGL de TF.js, que en algunos dispositivos antiguos sin WebGPU podría
  ser más rápido que WASM+SIMD. Es un caso minoritario y decreciente.
- Dependencia de un único proyecto para toda la inferencia de Tier 1. Mitigada por la fachada:
  cambiar de runtime afecta a un paquete, no a los detectores.
