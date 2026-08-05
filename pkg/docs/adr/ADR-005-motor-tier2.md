# ADR-005 · Selección del motor Tier 2 por medición

## Estado
Propuesto — la decisión se cierra con datos, no con esta ADR

## Contexto

El brief especifica `distil-ai-slop-detector` como motor principal de texto: Gemma 3 270M
destilado desde GPT-OSS 120B, Q4_K_M, ~242 MB, wllama sobre WebAssembly, 0,5–2 s por consulta,
~95 % de exactitud en su conjunto de test, Apache-2.0.

Es un proyecto sólido y el candidato natural. Pero hay tres razones para no fijarlo por decreto:

1. **0,5–2 s por consulta** hace imposible el objetivo de primer veredicto por debajo de 1 s si una
   página tiene decenas de bloques. No puede ser el motor por defecto.
2. La literatura zero-shot ofrece alternativas con mejor generalización entre dominios, que es
   exactamente donde fallan los clasificadores supervisados. **Binoculars** es insensible a la
   longitud de entrada y generaliza bien con modelos de ~1 B; **Fast-DetectGPT** usa curvatura de
   probabilidad condicional, necesita un solo modelo y es dos órdenes de magnitud más rápido que
   DetectGPT.
3. Un ~95 % en el conjunto de test propio no predice el comportamiento en la distribución abierta
   de la web, y el criterio que importa no es la exactitud sino el **FPR a igual recall** y la
   **calibración**.

## Decisión

Tier 2 es **opt-in, bajo demanda y nunca automático**. Su motor concreto se decide con un banco de
pruebas, no por preferencia.

Candidatos a evaluar, los tres con la misma interfaz `Detector`:

| Candidato | Enfoque | Coste de memoria |
|---|---|---|
| `distil-ai-slop-detector` (Gemma 3 270M Q4) | Clasificador destilado | ~242 MB, un modelo |
| Fast-DetectGPT | Curvatura de probabilidad condicional | Un modelo pequeño |
| Binoculars | Perplejidad / cross-perplejidad | **Dos modelos simultáneos** |

Criterios de decisión, en orden de peso:

1. **FPR a recall fijo** en `human-multiling` y `hard-negatives`.
2. **Δ FPR entre subgrupos** nativo / no nativo. Un candidato que falle el *gate* de equidad queda
   descartado, tenga la exactitud que tenga.
3. **ECE** tras calibración.
4. **Independencia respecto de Tier 1**: correlación de errores con el clasificador ONNX. Un
   segundo motor que se equivoca en los mismos casos no aporta nada como segunda opinión.
5. Latencia p95 y memoria pico en el navegador.

El criterio 4 es el que suele olvidarse y el que determina si el ensemble reduce falsos positivos
de verdad o solo los confirma con más confianza.

## Alternativas consideradas

**Fijar Gemma-270M como motor único, según el brief.** Rechazada como decisión previa a la
medición. Sigue siendo el favorito por madurez, licencia Apache-2.0 y evidencia de funcionamiento
en navegador; pero se confirma con datos.

**Tier 2 activo por defecto.** Rechazada: 242 MB de descarga, memoria alta y 0,5–2 s por consulta
harían el producto inaceptable para el usuario mediano.

**Solo Tier 1, sin Tier 2.** Rechazada: hay casos —periodismo, peritaje— donde el usuario acepta
esperar dos segundos a cambio de una segunda opinión independiente.

## Nota sobre "Extinction"

El brief menciona un proyecto llamado *Extinction* como segundo motor. No se localiza un proyecto
público identificable con ese nombre en detección de texto generado. La ranura arquitectónica del
segundo motor existe y está diseñada; el candidato preferente para ocuparla es un detector
zero-shot por perplejidad, precisamente porque maximiza la independencia respecto del clasificador
supervisado de Tier 1. Si *Extinction* es una referencia concreta, se pide confirmarla y se evalúa
en el mismo banco de pruebas.

## Consecuencias

### Positivas
- La decisión se toma con evidencia, en un producto cuya propuesta de valor es la honestidad
  estadística. Elegir el motor por intuición contradiría el producto.
- Los tres candidatos comparten interfaz, así que el banco de pruebas es trabajo reutilizable y no
  desechable.
- El criterio de independencia de errores garantiza que el ensemble reduzca falsos positivos en
  lugar de reforzarlos.

### Negativas
- Retrasa la decisión y exige construir el arnés de evaluación antes de tener el motor definitivo.
- Binoculars puede quedar descartado por memoria pese a ser el mejor en calidad, lo cual sería un
  resultado incómodo pero correcto.
- Existe el riesgo de que ningún candidato supere el *gate* de equidad, en cuyo caso **Tier 2 no se
  lanza**. Es un resultado aceptable y debe estar sobre la mesa desde el principio.
