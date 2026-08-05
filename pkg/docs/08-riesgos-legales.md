> **Aviso.** Este documento es análisis técnico de apoyo elaborado por un equipo de producto,
> no asesoría jurídica. Cada punto debe verificarse con abogado colegiado en cada jurisdicción
> antes de lanzar. Las referencias normativas están fechadas y pueden haber cambiado.

# 08 · Riesgos legales

---

## 1. Difamación y daño reputacional a terceros

**El riesgo principal, y el peor entendido de la categoría.**

El producto emite afirmaciones sobre contenido publicado por terceros identificables: un
periodista, un medio, un autor. Afirmar "este artículo fue generado por IA" cuando no lo fue es
una afirmación de hecho, falsa, sobre una persona o empresa identificable, publicada a través de
nuestro software. En varias jurisdicciones eso es potencialmente difamatorio, y el marco de
responsabilidad de intermediarios protege mal a quien *genera* la afirmación en lugar de
limitarse a alojarla.

Agravantes específicos de este diseño: la "reputación de dominios" agrega esas afirmaciones en un
juicio persistente sobre un medio; y el "Informe exportable" las convierte en un documento con
apariencia pericial.

**Mitigación.**

- Lenguaje de la interfaz revisado por abogado, palabra por palabra. Nunca "es"; siempre
  "las señales analizadas sugieren", con banda e intervalo.
- El estado de abstención se muestra como abstención, no como "probablemente humano".
- Ningún veredicto se presenta como conclusión pericial. Los informes llevan una limitación de
  uso visible y no omisible.
- Procedimiento de reclamación para editores: un canal por el que un medio puede impugnar una
  puntuación, con revisión humana y respuesta con plazo comprometido.
- La reputación de dominios se publica como **distribución de señales observadas**, con
  metodología abierta y muestra citada, no como calificación moral. Y con derecho de réplica.
- Seguro de responsabilidad civil profesional y por errores y omisiones, contratado **antes** del
  lanzamiento público, no después.

**Residual: medio-alto.** Es el riesgo que más justifica el posicionamiento de "evidencia" frente
a "veredicto".

---

## 2. Reglamento Europeo de IA

Las obligaciones de transparencia del artículo 50 entran en vigor en agosto de 2026 y exigen que
las salidas de IA generativa sean identificables, en formato legible por máquina, "efectivo,
interoperable, robusto y fiable", con enfoque multicapa; y que los deployers etiqueten los
deepfakes de forma visible y comprensible sin necesidad de herramientas de detección.

**Lectura para XplagiaX.** El artículo 50 obliga a *proveedores y deployers de IA generativa*.
XplagiaX no genera contenido: lo evalúa. **No es el sujeto obligado del artículo 50.** Esto es una
oportunidad, no una carga: la norma crea la demanda de verificación que el producto atiende, y el
marcado legible por máquina que exige es exactamente la señal que Tier 0 lee.

Lo que sí aplica:

- Si en algún momento el producto usa un componente de IA para generar texto de cara al usuario
  (por ejemplo, resúmenes explicativos redactados por un LLM), ese componente sí queda sujeto a
  transparencia.
- El código de buenas prácticas sobre etiquetado y transparencia publicado por la Comisión es la
  referencia para alinear la terminología del producto con la del regulador.
- **Riesgo de posicionamiento regulatorio:** presentar el producto como herramienta de
  cumplimiento del artículo 50 crearía una expectativa de fiabilidad que la tecnología no puede
  sostener. Se evita esa afirmación comercial de forma explícita.

**Residual: bajo,** con vigilancia normativa continua.

---

## 3. Protección de datos

### 3.1 RGPD y equivalentes

Por diseño, el procesamiento es local y no hay transferencia de contenido. En el análisis
estándar, **no somos responsables del tratamiento del contenido analizado**: nunca lo recibimos.

Puntos donde sí hay tratamiento y hay que documentarlo:

| Tratamiento | Base jurídica | Notas |
|---|---|---|
| Telemetría anónima | Consentimiento (opt-in) | Debe ser anónima de verdad; ver [`09`](./09-riesgos-privacidad.md) |
| Cuenta y facturación Pro | Ejecución de contrato | Procesador de pagos como encargado |
| Informe compartido | Consentimiento explícito por acción | El usuario decide qué incluye |
| Reporte de sitio roto | Consentimiento por acción | Solo dominio y versión |

Obligaciones a cubrir antes del lanzamiento en la UE: registro de actividades de tratamiento,
evaluación de impacto (DPIA) para la telemetría y para cualquier función de aprendizaje federado,
política de privacidad específica de la extensión, y representante en la UE si la entidad
responsable es extracomunitaria.

**Punto abierto sobre la entidad.** El responsable del tratamiento es **XplagiaX LTD**. La
terminación "LTD" apunta a una constitución en Reino Unido o Irlanda, con consecuencias distintas
y relevantes: una entidad irlandesa está dentro de la UE y no necesita representante del artículo
27 del RGPD; una entidad británica está fuera desde el Brexit, se rige por el UK GDPR y **sí
necesita representante en la UE** para dirigirse al mercado europeo. Se requiere confirmar la
jurisdicción de constitución antes de redactar la política de privacidad, porque determina el
régimen aplicable, la autoridad de control competente y el régimen de transferencias
internacionales.

### 3.2 La trampa de la anonimización

Un identificador de instalación estable convierte la telemetría en datos personales por vía de
reidentificación. Un dominio hasheado es reversible por fuerza bruta contra una lista de dominios
conocidos. Ambas cosas están explícitamente prohibidas en el esquema de telemetría, con test en
CI que falla si un campo prohibido aparece.

### 3.3 Aprendizaje federado

La función propuesta en el brief es el mayor riesgo de privacidad del roadmap. Los gradientes
pueden filtrar el contenido de entrenamiento, y hay literatura amplia de ataques de inversión.
Postura del consejo: **no se implementa sin privacidad diferencial con presupuesto ε publicado,
agregación segura, auditoría externa y DPIA.** Y aun así, opt-in doble. Si no se puede hacer así,
no se hace. Detalle en [`09-riesgos-privacidad.md`](./09-riesgos-privacidad.md#6-aprendizaje-federado).

**Residual: bajo** en el diseño actual; **alto** si se implementa federado sin las condiciones.

---

## 4. Uso en contextos de decisión sobre personas

El "modo académico" y el "modo empresa" convierten la salida en insumo de decisiones que afectan
a personas: una acusación de plagio, una sanción laboral. Consecuencias:

- En varias jurisdicciones, decisiones automatizadas con efecto significativo sobre personas están
  reguladas (artículo 22 del RGPD y equivalentes).
- La responsabilidad se traslada parcialmente al cliente institucional, pero no se elimina.

**Mitigación.** El producto **nunca emite un veredicto sobre la autoría de una persona
identificada**. En modo académico produce un informe de señales para una conversación entre
docente y estudiante, con lenguaje diseñado para eso. Los términos de servicio del plan educativo
prohíben expresamente el uso como prueba única para una sanción, y esa prohibición se refuerza en
la propia interfaz, no solo en el contrato.

**Residual: medio.** Se reduce con diseño de interfaz, no con cláusulas.

---

## 5. Licencias de terceros

| Componente | Licencia | Implicación |
|---|---|---|
| `distil-ai-slop-detector` | Apache-2.0 | Permisiva. Requiere atribución y aviso de cambios |
| Pesos Gemma 3 | Términos de uso de Gemma (Google) | **Verificar restricciones de uso comercial y de redistribución.** No es una licencia OSS estándar |
| wllama / llama.cpp | MIT | Permisiva |
| ONNX Runtime Web | MIT | Permisiva |
| DejAIvu | Verificar en el repositorio | Se usa como referencia arquitectónica; si se reutiliza código o pesos, revisar |
| Datasets de entrenamiento | Variable | El riesgo real está aquí: muchos corpus de detección tienen restricción de uso no comercial |

**Acción bloqueante antes de escribir código.** Auditoría de licencias completa, con atención
especial a: (a) los términos de Gemma para redistribución de pesos derivados en un producto
comercial, y (b) la procedencia y licencia de todo dataset usado para entrenar o calibrar. Un
error aquí contamina el producto entero y se descubre en la due diligence de la ronda, que es el
peor momento posible.

Auditoría automatizada de licencias en CI desde el primer commit.

**Residual: bajo si se audita ahora; alto si se pospone.**

---

## 6. Propiedad intelectual del contenido analizado

Analizar contenido públicamente accesible en el navegador del propio usuario, sin copiarlo ni
redistribuirlo, tiene bajo riesgo. Los puntos de atención son:

- Los **informes exportables** sí reproducen fragmentos. Se limita la extensión de las citas y se
  incluye siempre la fuente. Uso encuadrado en cita e investigación.
- El **rastreador propio** para reputación de dominios sí hace copias del lado servidor. Debe
  respetar `robots.txt`, identificarse con un user-agent propio, limitar la tasa y conservar solo
  las señales derivadas, no el contenido. Existe jurisprudencia relevante y variable sobre
  scraping según jurisdicción; requiere revisión legal específica.

**Residual: bajo** para la extensión, **medio** para el rastreador.

---

## 7. Consumidor y publicidad

Reclamos como "detecta contenido IA con 95 % de precisión" son afirmaciones cuantificables sobre
un producto de pago. Si no se sostienen en la práctica, son publicidad engañosa.

Regla de comunicación, aplicable a web, tiendas y material comercial: **toda cifra de rendimiento
va acompañada del conjunto de evaluación, la fecha y las condiciones.** Sin excepciones, sin
asteriscos ilegibles. La página de metodología es pública y se actualiza con cada release.

**Residual: bajo,** si se respeta la regla.

---

## 8. Acciones bloqueantes antes de escribir código

1. Auditoría de licencias de modelos y datasets, con dictamen escrito sobre los términos de Gemma.
2. Revisión legal del lenguaje de la interfaz y de la plantilla de informe.
3. Redacción de política de privacidad, términos de servicio y DPIA de telemetría.
4. Decisión sobre licencia del propio producto y sobre qué partes se abren.
5. Presupuesto y contratación de seguro de responsabilidad civil profesional.
6. Definición del procedimiento de impugnación para editores.

Ninguna de estas seis es opcional, y las seis son más baratas ahora que en cualquier momento
posterior.

---

## Fuentes

- [EU AI Act — Article 50: Transparency Obligations](https://artificialintelligenceact.eu/article/50/)
- [Transparency obligations under Article 50 — Comisión Europea](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act)
- [The EU AI Act's Transparency Rules: A Practical Guide to Article 50](https://artificialintelligenceact.eu/transparency-rules-article-50/)
- [European Commission Publishes Draft Code of Practice on AI Labelling and Transparency — Jones Day](https://www.jonesday.com/en/insights/2026/01/european-commission-publishes-draft-code-of-practice-on-ai-labelling-and-transparency)
- [Transparency obligations for AI-generated content: from principle to practice — HSF Kramer](https://www.hsfkramer.com/notes/ip/2026-03/transparency-obligations-for-ai-generated-content-under-the-eu-ai-act-from-principle-to-practice)
- [What constitutes a Deep Fake? (arXiv:2412.09961)](https://arxiv.org/pdf/2412.09961)
- [The Problem with False Positives: AI Detection Unfairly Accuses Scholars](https://www.tandfonline.com/doi/abs/10.1080/0361526X.2024.2433256)
- [distil-labs/distil-ai-slop-detector — licencia Apache-2.0](https://github.com/distil-labs/distil-ai-slop-detector)
