# 01 · Estado del arte

Revisión de lo que funciona, lo que no funciona y lo que se puede ejecutar dentro de un
navegador en 2026. Todo lo que sigue condiciona decisiones de arquitectura; lo que no las
condiciona se ha omitido deliberadamente.

---

## 1. Detección de texto generado por IA

### 1.1 Familias de métodos

| Familia | Ejemplos | Cómo funciona | Ventaja | Límite |
|---|---|---|---|---|
| **Clasificador supervisado** | Turnitin, GPTZero, `Open-Detector` (BERT), Gemma-270M destilado | Fine-tuning binario humano/IA | Rápido, pequeño, desplegable | Se degrada fuera de su distribución; sesgo hacia texto "simple" |
| **Zero-shot por perplejidad** | DetectGPT, Fast-DetectGPT, Binoculars | Compara señales estadísticas del propio LM | No requiere datos de entrenamiento, generaliza mejor entre dominios | Necesita uno o dos LM cargados; caro en navegador |
| **Ensemble clásico** | NB + LogReg + LightGBM + CatBoost con soft-voting | Voto probabilístico sobre features | Muy barato, interpretable | Techo de exactitud bajo; frágil ante paráfrasis |
| **Marca de agua** | SynthID (Google), esquemas de watermarking en decodificación | El generador inserta señal | Precisión altísima *si* está presente | Solo cubre a generadores que cooperan; se destruye al parafrasear |
| **Procedencia criptográfica** | C2PA / Content Credentials | Firma la historia del archivo | Evidencia dura, verificable | Se rompe al recodificar; cobertura parcial |

### 1.2 Los dos métodos zero-shot relevantes

**Binoculars** (ICML 2024) calcula el cociente entre la perplejidad de un texto medida por un
modelo *observador* y la cross-perplejidad respecto de un modelo *ejecutor*. Es zero-shot,
agnóstico de dominio, **no es sensible a la longitud de la entrada** y funciona razonablemente
con modelos de ~1 B parámetros. Su generalización entre dominios es su mayor virtud.

**Fast-DetectGPT** sustituye el muestreo de perturbaciones de DetectGPT por *curvatura de
probabilidad condicional*: mejora la velocidad en dos órdenes de magnitud y la exactitud en
torno a un 75 % relativo, y necesita un solo modelo. Mejor precisión reportada en noticias.

Para XplagiaX ambos son candidatos a **Tier 2**. Binoculars exige dos modelos en memoria
simultáneamente, lo cual es caro en un navegador; Fast-DetectGPT es más viable en memoria pero
menos robusto entre dominios. La decisión se toma por medición, no por preferencia:
[ADR-005](./adr/ADR-005-motor-tier2.md).

### 1.3 El problema que la categoría no ha resuelto

La literatura crítica es consistente y no admite matices cómodos:

- **Sesgo contra no nativos.** El estudio de Stanford midió 61,3 % de falsos positivos sobre
  ensayos TOEFL frente a casi cero en escritores nativos. La causa es estructural: quien aprendió
  el idioma como segunda lengua produce frases más cortas, léxico más común y sintaxis más
  regular — exactamente el perfil estadístico del texto generado.
- **Sin garantías estadísticas.** Los detectores comerciales entrenados no ofrecen control formal
  de la tasa de falsos positivos. No hay un "p < 0,05" detrás del 78 % que muestran.
- **Evasión trivial.** Existe literatura demostrando que se puede guiar a un LLM para evadir
  detección, y la paráfrasis destruye tanto las señales estadísticas como las marcas de agua.
- **Retirada institucional.** Universidades de primer nivel han desactivado estas herramientas.
  Ese es el veredicto del mercado más motivado que existía para comprarlas.

Trabajo reciente apunta al camino de salida: marcos **conformes** que dan garantía de cobertura
sobre la tasa de error, y detección con **abstención**. XplagiaX adopta esa línea como núcleo del
producto, no como añadido.

### 1.4 Un dato incómodo y útil

Existe evidencia de que personas que usan ChatGPT con frecuencia para escribir son detectores
precisos y robustos de texto generado — en algunos escenarios mejores que los detectores
automáticos. Implicación de producto: el humano en el bucle no es una concesión, es una fuente
de señal. El sistema de *feedback* del usuario (marcar falso positivo / confirmar acierto) debe
ser un ciudadano de primera clase de la interfaz desde el día uno, y alimenta la recalibración.

---

## 2. Detección de imagen generada por IA

### 2.1 DejAIvu — la referencia de explicabilidad en navegador

[DejAIvu](https://arxiv.org/abs/2502.08821) (arXiv:2502.08821) es la referencia correcta del
brief. Arquitectura en dos etapas: clasificación con una ResNet modificada, y generación de
**mapas de saliencia** basados en gradientes que se superponen sobre la imagen. Detalle de
ingeniería directamente aplicable: los autores usan **ONNX Runtime Web en lugar de
TensorFlow.js y obtienen ~35 ms menos de latencia por imagen**.

Eso resuelve una pregunta abierta del brief. El brief pedía integrar `ClassifierAI` basado en
TensorFlow.js *además* de ONNX. Mantener dos runtimes de inferencia en un producto cuyo
presupuesto de rendimiento es estricto duplica el peso de WASM, duplica la superficie de fallo y
cuesta latencia medida. **Recomendación: ONNX Runtime Web como runtime único.** Los modelos de
TensorFlow.js que aporten valor se convierten a ONNX en el pipeline de build, no en tiempo de
ejecución. Registrado en [ADR-004](./adr/ADR-004-runtime-inferencia.md).

### 2.2 El techo de la detección de imagen

La detección de imagen sintética generaliza aún peor que la de texto: un modelo entrenado con
salidas de difusión de 2024 falla con generadores de 2026. Los benchmarks cross-paradigma de
2026 lo confirman. Por eso, en imagen, **la procedencia pesa todavía más que en texto**.

### 2.3 Procedencia: C2PA en 2026

Situación real, no promesa:

- Más de 6.000 miembros y afiliados en enero de 2026.
- Firma en captura disponible en Leica (M11, Q3, SL3), Sony (Alpha 1 II, Alpha 9 III, Xperia 1 VI),
  Nikon (Z8, Z9, Zf), Canon (EOS R1, R5 II), Samsung (Galaxy S26). Anunciados y no enviados:
  Apple (iOS 20, otoño 2026), Pixel 11, Fujifilm GFX.
- X muestra credenciales desde marzo de 2026 para Premium. TikTok etiqueta con C2PA. Google
  despliega verificación en Gemini, Search y superficies de Chrome.
- Limitación crítica: **la cadena se rompe cuando la plataforma elimina metadatos** al subir y
  recodificar. Y análisis académico de 2026 concluye que la especificación es todavía incompleta
  e inconsistente en puntos de seguridad, y debe tratarse como tecnología emergente.

Lectura estratégica: C2PA presente es evidencia fuerte. C2PA **ausente** no es evidencia de nada
— y esa asimetría debe estar codificada en el motor de fusión. Un producto que interprete
"sin credenciales" como "sospechoso" será injusto con la mayor parte de la web.

---

## 3. Ejecución de modelos en el navegador

| Runtime | Formato | Aceleración | Dónde encaja |
|---|---|---|---|
| **ONNX Runtime Web** | ONNX | WASM + SIMD + threads; WebGPU | Tier 1 (texto e imagen). Runtime principal |
| **wllama** | GGUF | WASM (CPU) | Tier 2, path Gemma-270M |
| **Transformers.js** | ONNX | Comparte ORT Web | Tokenización y pre/post-proceso |
| **TensorFlow.js** | TF / TFLite | WebGL, WebGPU | Descartado como runtime de producción |

Restricciones prácticas que condicionan el diseño:

- **SharedArrayBuffer y threads** requieren aislamiento cross-origin. Dentro de páginas de
  extensión es gestionable; dentro de un content script inyectado en una página de terceros, no
  se puede asumir. Corolario: **la inferencia nunca ocurre en el content script.**
- **WebGPU** no está disponible de forma uniforme en los cinco navegadores objetivo. Debe ser una
  ruta acelerada opcional con degradación automática a WASM+SIMD.
- **Presupuesto de memoria.** Un modelo Q4 de 242 MB en disco ocupa considerablemente más en
  memoria durante la inferencia. En equipos modestos esto compite con la propia página.

---

## 4. Lo que la web ya expone y casi nadie usa

Señales de coste cero que Tier 0 puede leer antes de cargar un solo modelo:

- Manifiestos C2PA embebidos y en sidecar; IPTC `digitalSourceType`
  (`trainedAlgorithmicMedia`, `compositeSynthetic`).
- EXIF de generadores conocidos, campos `Software`, y en PNG los chunks `tEXt` con parámetros de
  generación que muchas herramientas dejan intactos.
- Etiquetado voluntario de plataforma en el propio DOM (marcas de "AI-generated" de las redes).
- Señales estructurales: densidad de bloques de longitud casi idéntica, ausencia total de erratas
  en textos largos, patrones de puntuación.

Estas señales son baratas, no requieren ML, y en una fracción relevante de casos resuelven la
pregunta con evidencia dura. Ningún competidor las prioriza. Es la parte del producto con mejor
relación valor/coste y la primera que se construye.

---

## 5. Conclusiones que entran en la arquitectura

1. Ningún clasificador único es suficiente → **fusión de evidencia multi-señal** obligatoria.
2. La exactitud sin calibración es un número de marketing → **medir ECE y abstención**, no solo
   AUC.
3. La procedencia es evidencia dura y su ausencia no es evidencia → **asimetría explícita** en el
   scoring.
4. ONNX Runtime Web es el runtime; **un solo runtime**.
5. La inferencia nunca ocurre en el content script.
6. Tier 2 es opcional y bajo demanda; el producto debe ser útil sin él.
7. El feedback humano es señal, no cortesía.

---

## Fuentes

- [Binoculars: Zero-Shot Detection of LLM-Generated Text](https://github.com/ahans30/Binoculars) · [ICML Proceedings](https://dl.acm.org/doi/10.5555/3692070.3692768)
- [Beyond Easy Wins: A Text Hardness-Aware Benchmark for LLM-generated Text Detection (arXiv:2507.15286)](https://arxiv.org/pdf/2507.15286)
- [Luminol-AIDetect: Fast Zero-shot MGT Detection (arXiv:2604.25860)](https://arxiv.org/pdf/2604.25860)
- [Alignment Imprint: Zero-Shot AI-Generated Text Detection (arXiv:2604.16923)](https://arxiv.org/html/2604.16923v1)
- [People who frequently use ChatGPT are accurate detectors of AI-generated text (arXiv:2501.15654)](https://arxiv.org/pdf/2501.15654)
- [Why AI-Generated Text Detection Fails: Evidence from Explainable AI (arXiv:2603.23146)](https://arxiv.org/pdf/2603.23146)
- [Large Language Models can be Guided to Evade AI-Generated Text Detection (arXiv:2305.10847)](https://arxiv.org/pdf/2305.10847)
- [Watermark in the Classroom: A Conformal Framework for Adaptive AI Usage Detection (arXiv:2507.23113)](https://arxiv.org/pdf/2507.23113)
- [Benchmarking AI Text Detection: Assessing Detectors Against New Datasets](https://lill.is/pubs/Pudasaini2025.pdf)
- [DejAIvu (arXiv:2502.08821)](https://arxiv.org/html/2502.08821v2) · [repositorio](https://github.com/Noodulz/dejAIvu)
- [VendorBench-100: Cross-Paradigm Benchmark for Deepfake Image Detection (arXiv:2607.06254)](https://arxiv.org/pdf/2607.06254)
- [C2PA Adoption Tracker 2026](https://editorsweblog.org/2026/04/12/c2pa-adoption-tracker-platforms-content-credentials-2026)
- [Why the C2PA Specifications Fall Short (arXiv:2604.24890)](https://arxiv.org/html/2604.24890v1)
- [What Is C2PA? The Standard, Its Metadata and Real Limits](https://truescreen.io/articles/c2pa-standard-history-limitations/)
- [distil-labs/distil-ai-slop-detector](https://github.com/distil-labs/distil-ai-slop-detector)
