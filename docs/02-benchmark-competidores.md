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

### 3.4 Extinction — no es lo que parecía, y es mejor de lo que parecía

[`v81d/extinction`](https://github.com/v81d/extinction) resulta ser un proyecto distinto del que
el brief daba a entender. No es un segundo motor de ML: **no usa modelos en absoluto**.

| Aspecto | Realidad |
|---|---|
| Método | Heurístico puro: regex ponderadas + Type-Token Ratio + burstiness + sigmoide |
| Modelos | Ninguno. Cero descarga, cero inferencia |
| Stack | TypeScript, Vue, Vite, Tailwind, **WXT** |
| Navegadores | Chromium, Firefox, Safari |
| Precisión declarada | ~80–90 % en texto humano, ~80 % en texto IA. Umbral por defecto 0,65 |
| Licencia | **GPL-3.0+** |

Tres consecuencias, en orden de importancia:

**1 · La licencia es un problema serio.** GPL-3.0 es copyleft fuerte. Incorporar su código
obligaría a publicar XplagiaX entero bajo GPL-3.0, lo que destruye el modelo de licencia comercial
del SDK descrito en [`10-monetizacion.md`](./10-monetizacion.md#3-api-y-sdk). Es la diferencia
entre un activo y un pasivo, y se resuelve en [ADR-010](./adr/ADR-010-extinction-gpl.md).

**2 · Su sitio en la arquitectura es Tier 0, no Tier 2.** Al ser heurístico y sin modelos, su
coste es de milisegundos y funciona sin descargar nada. Encaja exactamente en el detector
`stylometry` de Tier 0, no en la ranura de segunda opinión pesada. Eso lo hace **más** útil de lo
previsto: aporta señal antes de cargar ningún modelo.

**3 · Su independencia estadística es su mayor valor.** Un detector basado en regex y métricas
léxicas se equivoca en casos distintos de los que falla un transformer. Es justo lo que pide el
criterio de decorrelación de [ADR-006](./adr/ADR-006-evidencia-llr.md): un segundo motor que
falla igual que el primero no aporta nada; uno que falla distinto reduce falsos positivos de
verdad.

La contrapartida: ~80 % de precisión está muy por debajo del objetivo de FPR ≤ 1 %. **No puede
emitir veredictos por sí solo.** Entra como una fuente de evidencia más, con su LLR calibrado y
su `reliability`, nunca como decisor. Sus propios autores reconocen que un método basado en regex
no puede igualar a uno basado en ML.

**Validación externa de una decisión nuestra:** Extinction usa WXT para cubrir Chromium, Firefox
y Safari — la misma elección de [ADR-002](./adr/ADR-002-framework-build.md), tomada de forma
independiente para el mismo problema.

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
- [v81d/extinction](https://github.com/v81d/extinction)
- [Ensemble-AI-Text-Detection](https://github.com/iamjr15/Ensemble-AI-Text-Detection) · [Open-Detector](https://github.com/Imalwayshere/Open-Detector)
- [MOSAIC: Multiple Observers Spotting AI Content (arXiv:2409.07615)](https://arxiv.org/pdf/2409.07615)
