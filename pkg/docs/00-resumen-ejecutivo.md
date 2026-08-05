# 00 · Resumen ejecutivo

## 1. Qué se pidió y qué recomienda el consejo

El brief pide la mejor plataforma del mundo para identificar contenido generado por IA, con
potencial de valoración superior a mil millones de dólares. El consejo acepta el objetivo y
entrega el diseño completo. Pero antes de la arquitectura hay tres objeciones que **cambian
decisiones de producto**, no solo de implementación. Ignorarlas produciría un producto que
funciona en demo y se rompe en el mercado.

---

## 2. Tres objeciones que cambian el diseño

### Objeción 1 — La detección de texto IA no es lo bastante fiable para vender veredictos

Esto no es una opinión sino el consenso de la evidencia disponible:

- Un estudio de Stanford encontró **61,3 % de falsos positivos** en ensayos TOEFL escritos por
  hablantes no nativos de inglés; el 97,8 % fue marcado por al menos uno de los siete detectores
  evaluados. En textos de nativos, la tasa era cercana a cero.
- El mayor estudio independiente conocido evaluó 14 herramientas y **ninguna superó el 80 % de
  exactitud** en condiciones realistas.
- Vanderbilt desactivó el detector de Turnitin en 2023. Le siguieron Yale, UCLA, UC Berkeley,
  UC San Diego, Waterloo y Michigan State, entre otras. En 2026 varias universidades del Reino
  Unido han retirado estas herramientas por precisión y sesgo.
- Las cifras de exactitud que publican los proyectos abiertos (incluido el ~95 % de
  `distil-ai-slop-detector`) son **exactitud en su conjunto de test**, no en la distribución
  abierta de la web. La caída al mundo real es la norma, no la excepción.

**Consecuencia de diseño.** El producto nunca emite una acusación binaria. Emite *evidencia
calibrada con capacidad de abstención*: cuando la confianza no alcanza el umbral, el veredicto
literal es "evidencia insuficiente", no "probablemente humano". La calibración (ECE) se mide y
se publica junto a la exactitud. El motor se **niega a puntuar** en idiomas y dominios donde no
está validado. Esto convierte el mayor riesgo del sector en el diferenciador del producto:
somos el detector que sabe cuándo callarse.

### Objeción 2 — La procedencia criptográfica está ganando, y llega antes que la detección perfecta

Mientras la detección estadística se estanca, la infraestructura de procedencia se ha
consolidado. C2PA superó los 6.000 miembros y afiliados en enero de 2026. Firman en captura
Leica, Sony, Nikon, Canon y Samsung; Apple y Google Pixel lo han anunciado. X muestra
credenciales desde marzo de 2026, TikTok etiqueta con C2PA, y Google está desplegando
verificación en Gemini, Search y superficies de Chrome. El artículo 50 del Reglamento Europeo
de IA entra en vigor en agosto de 2026 y exige marcado legible por máquina.

C2PA no detecta deepfakes: registra historia verificable. Y su cadena se rompe cuando las
plataformas eliminan metadatos al subir y recodificar. Es decir: **procedencia y detección son
complementarias y ambas están incompletas.** Quien combine las dos con una fusión de evidencia
honesta ocupa la posición defendible.

**Consecuencia de diseño.** La procedencia es evidencia *dura* y domina la puntuación. La
detección estadística es evidencia *blanda*. El orden importa y está codificado en el motor de
fusión, no en la interfaz.

### Objeción 3 — Un modelo de 270 MB no puede ser el motor por defecto

`distil-ai-slop-detector` (Apache-2.0, Gemma 3 270M cuantizado Q4_K_M, ~242 MB, runtime wllama
sobre WebAssembly, 0,5–2 s por consulta) es un proyecto excelente y es el motor profundo
correcto. No es el motor por defecto:

- 0,5–2 s por consulta hace imposible el objetivo de primer análisis por debajo de 1 segundo si
  una página tiene 40 bloques de texto.
- La política MV3 prohíbe código remoto, pero **los pesos son datos, no código**: se descargan
  tras la instalación y se cachean. Esto es viable, pero significa que el primer uso exige una
  descarga de 242 MB. Eso mata la activación en un producto de consumo si es obligatorio.
- El límite de subida de la Chrome Web Store es 2 GB, así que empaquetarlo es técnicamente
  posible y estratégicamente terrible.

**Consecuencia de diseño.** Escalera de motores en tres niveles (Tier 0 / 1 / 2). El objetivo de
"< 1 s" se cumple con Tier 0 + Tier 1. Tier 2 es bajo demanda y descarga opcional.

---

## 3. Reposicionamiento: de detector a capa de confianza

| Brief original | Posicionamiento del consejo |
|---|---|
| Extensión que detecta contenido IA | Capa de confianza de contenido para la web |
| Veredicto: "78 % IA" | Evidencia: procedencia verificada + señales estadísticas + abstención |
| Compite con GPTZero / Originality | Compite por ser la capa que otros integran (API/SDK) |
| Valor = exactitud del clasificador | Valor = calibración, cobertura multimodal, distribución y confianza |

El clasificador es reemplazable y se comoditiza cada seis meses. Lo que no se comoditiza:
la calibración auditada, la fusión multimodal, la distribución en cinco navegadores, el corpus
de reputación de dominios construido con telemetría anónima agregada, y la posición de capa de
infraestructura vía API y SDK.

---

## 4. Arquitectura en una imagen mental

Un **kernel de detección** en TypeScript puro, sin dependencias del DOM ni de las APIs de
extensión, que recibe contenido normalizado y devuelve objetos `Evidence`. Ese kernel corre
igual dentro de un Web Worker de la extensión, dentro de Node para la API pública, o embebido en
la app de un tercero vía SDK. Todo lo demás — content scripts, overlay, popup, service worker,
almacenamiento — son *adaptadores* alrededor de ese núcleo.

Esa única decisión es la que hace que los roadmaps de API, SDK, Enterprise y Mobile no requieran
reescrituras. Detalle completo en [`03-arquitectura.md`](./03-arquitectura.md).

---

## 5. Escalera de motores

| Nivel | Qué hace | Latencia objetivo | Coste | Activación |
|---|---|---|---|---|
| **Tier 0** | C2PA / IPTC / EXIF / SynthID donde sea legible, heurísticas estilométricas, señales de DOM | < 5 ms | 0 MB | Siempre |
| **Tier 1** | Clasificador transformer destilado ONNX int8 (~30–60 MB) en Worker | < 100 ms por bloque | ~50 MB | Por defecto, descarga tras instalar |
| **Tier 2** | Gemma 3 270M Q4 vía wllama, o cross-perplexity estilo Binoculars con dos LM pequeños | 0,5–2 s | ~242 MB | Opt-in explícito, bajo demanda |

Binoculars (ICML 2024) es la referencia zero-shot: compara la perplejidad de un texto entre un
modelo observador y uno ejecutor, es insensible a la longitud de entrada y generaliza bien entre
dominios con modelos de ~1 B. Fast-DetectGPT usa curvatura de probabilidad condicional, necesita
un solo modelo y es dos órdenes de magnitud más rápido que DetectGPT. Ambos son candidatos
válidos para Tier 2; la elección se resuelve con el banco de pruebas descrito en
[`14-criterios-de-exito.md`](./14-criterios-de-exito.md).

---

## 6. Qué construimos primero

MVP de 10 semanas, Chrome y Edge, texto Tier 0 + Tier 1, procedencia de imagen vía C2PA, overlay
no destructivo, popup, opciones e historial local. Fuera del MVP: vídeo, PDF, aprendizaje
federado, marketplace, modo empresa. Detalle en [`11-mvp.md`](./11-mvp.md).

---

## 7. Monetización resumida

Free (útil de verdad, no lisiado) → Pro 9 USD/mes (Tier 2, informes, motor de reglas, historial
ilimitado) → Teams → Enterprise (política corporativa, SSO, auditoría, registro de modelos
on-prem) → API y SDK con precio por uso. El bucle viral es el **Informe de Confianza
compartible**: cada informe exportado es una landing pública con marca. Detalle en
[`10-monetizacion.md`](./10-monetizacion.md).

---

## 8. La condición de honestidad

Este producto solo tiene derecho a existir si es más honesto que la categoría en la que entra.
Cada afirmación de la interfaz debe ser defendible ante un usuario acusado injustamente. La
regla del consejo, no negociable:

> Nunca mostrar un número sin su intervalo de confianza, nunca acusar sin evidencia dura, y
> abstenerse siempre que el modelo esté fuera de su dominio de validación.

Si esa regla reduce la conversión, se acepta la reducción.

---

## Fuentes

- [Binoculars — Zero-Shot Detection of LLM-Generated Text (ICML 2024)](https://github.com/ahans30/Binoculars)
- [Spotting LLMs with Binoculars — ICML Proceedings](https://dl.acm.org/doi/10.5555/3692070.3692768)
- [distil-labs/distil-ai-slop-detector](https://github.com/distil-labs/distil-ai-slop-detector)
- [distil-labs/distil-ai-slop-detector-gemma — Hugging Face](https://huggingface.co/distil-labs/distil-ai-slop-detector-gemma)
- [DejAIvu — Identifying and Explaining AI Art on the Web in Real-Time with Saliency Maps (arXiv:2502.08821)](https://arxiv.org/abs/2502.08821)
- [Noodulz/dejAIvu](https://github.com/Noodulz/dejAIvu)
- [The Problem with False Positives: AI Detection Unfairly Accuses Scholars](https://www.tandfonline.com/doi/abs/10.1080/0361526X.2024.2433256)
- [Contra generative AI detection in higher education assessments (arXiv:2312.05241)](https://arxiv.org/pdf/2312.05241)
- [AI Detection Tools Are Biased Against International Students](https://gradpilot.com/news/international-students-ai-detection-bias)
- [UK universities drop AI detection tools over accuracy fears](https://www.resultsense.com/news/2026-07-24-uk-universities-drop-ai-detection/)
- [C2PA Adoption Tracker 2026 — Editors Weblog](https://editorsweblog.org/2026/04/12/c2pa-adoption-tracker-platforms-content-credentials-2026)
- [C2PA Adoption in 2026: Hardware Platforms and Verification Reality](https://www.softwareseni.com/c2pa-adoption-in-2026-hardware-platforms-and-verification-reality/)
- [Verifying Provenance of Digital Media: Why the C2PA Specifications Fall Short (arXiv:2604.24890)](https://arxiv.org/html/2604.24890v1)
- [EU AI Act Article 50 — Transparency Obligations](https://artificialintelligenceact.eu/article/50/)
- [Transparency obligations under Article 50 — European Commission](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
- [Publish in the Chrome Web Store — límite de 2 GB por paquete](https://developer.chrome.com/docs/webstore/publish)
