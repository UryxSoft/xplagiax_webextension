# 02 · Benchmark de competidores

## 1. Mapa del mercado

La categoría se divide en cuatro segmentos que rara vez compiten entre sí. Entender esto importa
porque define contra quién se gana y contra quién no vale la pena pelear.

| Segmento | Jugadores | Modelo | Dónde vive | Debilidad estructural |
|---|---|---|---|---|
| **Detección académica** | Turnitin, Copyleaks, Originality.ai | B2B licencia institucional | LMS, servidor | Retirada institucional por falsos positivos; sin control de FPR |
| **Detección de consumo** | GPTZero, Winston AI, ZeroGPT | Freemium web + API | Web app, servidor | Comoditizado, cero foso técnico, contenido sube a la nube |
| **Deepfake / media forense** | Reality Defender, Hive, Sensity | Enterprise, alto ACV | API en la nube | Caro, no llega al usuario final, sin distribución en navegador |
| **Procedencia** | C2PA / CAI, Truepic, verificadores | Estándar + herramientas | Cámara, plataforma | No detecta nada: solo registra. Cadena rota al recodificar |
| **Extensiones open source** | `distil-ai-slop-detector`, DejAIvu, `ai-slop-detector` | Gratis, OSS | Navegador, local | Prueba de concepto: un modelo, una modalidad, sin calibración |

**Nadie ocupa la intersección**: local + multimodal + multi-navegador + procedencia + calibración
honesta + capa de API/SDK. Ese es el hueco.

---

## 2. Comparativa detallada

| Criterio | GPTZero | Originality.ai | Turnitin | Copyleaks | Hive / Reality Defender | distil-ai-slop-detector | DejAIvu | **XplagiaX** |
|---|---|---|---|---|---|---|---|---|
| Procesamiento local | No | No | No | No | No | **Sí** | **Sí** | **Sí (por defecto)** |
| Texto | Sí | Sí | Sí | Sí | Parcial | Sí | No | Sí |
| Imagen | Parcial | Parcial | No | Parcial | Sí | No | **Sí** | Sí |
| Vídeo | No | No | No | No | Sí | No | No | V2 |
| Procedencia C2PA | No | No | No | No | Parcial | No | No | **Sí, prioritaria** |
| Explicabilidad | Frases resaltadas | Mínima | Mínima | Mínima | Puntuación | Ninguna | **Saliency maps** | **XAI multimodal** |
| Calibración publicada | No | No | No | No | No | No | No | **Sí (ECE + FPR)** |
| Abstención explícita | No | No | No | No | No | No | No | **Sí** |
| Multi-navegador | — | — | — | — | — | Chrome | Chrome | **5 navegadores** |
| API pública | Sí | Sí | Limitada | Sí | Sí | No | No | V1.5 |
| SDK embebible | No | No | No | No | Parcial | No | No | V2 |
| Precio entrada | ~15 USD/mes | ~15 USD/mes | Institucional | ~10 USD/mes | Enterprise | Gratis | Gratis | Free → 9 USD/mes |

---

## 3. Lecturas competitivas que cambian decisiones

### 3.1 Los detectores de nube tienen un problema de privacidad que no pueden resolver

GPTZero, Originality y Copyleaks reciben el contenido en su servidor. Para un periodista
verificando un documento filtrado, un abogado revisando un contrato, o un empleado analizando un
correo interno, eso es descalificatorio. **No es una desventaja de marketing: es una barrera de
compra.** Un producto local no puede ser igualado aquí sin que ellos reescriban su arquitectura y
renuncien a su telemetría de contenido.

Esta es la ventaja más duradera del producto y debe ser el primer mensaje, no el tercero.

### 3.2 La retirada académica es una oportunidad mal leída

El movimiento obvio sería concluir que el mercado educativo está muerto. Es la lectura
equivocada. Las instituciones no retiraron los detectores porque no necesiten la señal: los
retiraron porque **la señal venía sin garantías y producía acusaciones injustas**. Un producto
que ofrece control formal de la tasa de falsos positivos, abstención en textos cortos y en
idiomas no validados, y un informe de evidencia en lugar de un veredicto, entra por la puerta que
los otros cerraron. El "Modo académico" del brief se rediseña alrededor de esta idea: la
herramienta nunca acusa a un estudiante, produce evidencia para una conversación.

### 3.3 Los proyectos OSS son referencias, no competidores

`distil-ai-slop-detector` y DejAIvu son excelentes demostraciones de un componente. Ninguno
tiene calibración, fusión, gestión de modelos, presupuesto de rendimiento, ni soporte
multi-navegador. Se usan como **motores** dentro de XplagiaX, con atribución y respeto de
licencia (Apache-2.0 en el caso de distil-labs). Competir con ellos sería un error de encuadre;
integrarlos y superarlos en la capa de plataforma es el movimiento correcto.

### 3.4 Nota sobre "Extinction"

El brief menciona un proyecto llamado *Extinction* como segundo motor de texto. La búsqueda no
localiza un proyecto público identificable con ese nombre en el ámbito de detección de texto IA.
Puede tratarse de un nombre interno, un proyecto privado o una confusión de nomenclatura.

**Esto no bloquea la arquitectura.** El requisito real detrás de la petición — un segundo motor
independiente que actúe como segunda opinión y reduzca falsos positivos — está satisfecho por
diseño: el `DetectorRegistry` acepta N detectores y la fusión de evidencia está construida para
combinarlos. Los candidatos concretos para ese segundo motor, listados por preferencia:

1. Un detector zero-shot por perplejidad (Fast-DetectGPT o Binoculars) — **máxima independencia
   respecto del clasificador supervisado de Tier 1**, que es exactamente lo que reduce el error
   correlacionado.
2. Un ensemble clásico de features estilométricas (coste casi nulo, útil como Tier 0 reforzado).
3. `Open-Detector` (BERT) para el vertical académico.

Se pide al solicitante que confirme la referencia exacta de *Extinction* si existe; mientras
tanto, la ranura está diseñada y ocupada por la opción 1.

---

## 4. Posicionamiento

```
                 alta explicabilidad y calibración
                              ▲
                              │
              DejAIvu ●       │        ● XplagiaX
                              │
     nube ◄────────────────────┼────────────────────► local
                              │
     GPTZero ●   Turnitin ●   │   ● distil-ai-slop-detector
     Originality ●  Hive ●    │
                              │
                              ▼
                 veredicto opaco, sin garantías
```

El cuadrante superior derecho —local y honesto— está vacío y es el único desde el que se puede
construir una capa de infraestructura, porque es el único en el que un tercero aceptaría
integrar el motor en su propio producto.

---

## 5. Fosos defensivos, por durabilidad

| Foso | Durabilidad | Por qué |
|---|---|---|
| Calibración auditada y abstención | **Alta** | Requiere corpus, metodología y disciplina de producto; no se copia con un fine-tuning |
| Fusión multimodal + procedencia | **Alta** | Es arquitectura, no modelo |
| Distribución en 5 navegadores | Media-alta | Coste real de ingeniería y de review en cinco tiendas |
| Reputación de dominios agregada | **Alta y creciente** | Efecto de red de datos; mejora con cada usuario y no requiere contenido privado |
| Kernel reutilizable → API/SDK | Alta | Coste de cambio para el integrador |
| El clasificador concreto | **Nula** | Se comoditiza cada seis meses. Nunca debe ser el argumento de venta |

---

## Fuentes

- [AI Detection Tools Used by Universities (2026): Who Uses What, Who Quit](https://detectiondrama.com/ai-detection-tools-used-by-universities/)
- [Universities That Banned AI Detectors: 2026 Full List](https://detectiondrama.com/universities-that-banned-ai-detectors/)
- [UK universities drop AI detection tools over accuracy fears](https://www.resultsense.com/news/2026-07-24-uk-universities-drop-ai-detection/)
- [The Problems with AI Detectors — University of San Diego LRC](https://lawlibguides.sandiego.edu/c.php?g=1443311&p=10721367)
- [GPTZero vs Turnitin: Comparing AI Detection in Education](https://www.eyesift.com/blog/gptzero-vs-turnitin/)
- [C2PA vs Deepfake Detection: Key Differences](https://www.paladintech.ai/blogs/c2pa-vs-deepfake-detection-guide)
- [Deepfakes vs. Provenance: Why C2PA Beats Detection](https://blog.pebblous.ai/blog/deepfake-detection-vs-provenance/en/)
- [Ensemble-AI-Text-Detection](https://github.com/iamjr15/Ensemble-AI-Text-Detection) · [Open-Detector](https://github.com/Imalwayshere/Open-Detector)
- [MOSAIC: Multiple Observers Spotting AI Content (arXiv:2409.07615)](https://arxiv.org/pdf/2409.07615)
