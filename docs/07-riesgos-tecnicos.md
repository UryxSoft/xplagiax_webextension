# 07 · Riesgos técnicos

Escala: **P** probabilidad, **I** impacto, ambos 1–5. Ordenado por P×I.

---

## R-01 · La exactitud del detector no sobrevive al mundo real · P5 I5

**Riesgo.** El modelo alcanza ~95 % en su conjunto de test y cae muy por debajo en la
distribución abierta de la web: dominios no vistos, generadores nuevos, texto parafraseado,
traducciones automáticas, contenido híbrido humano-IA (que es ya el caso mayoritario).

Es el riesgo número uno y **no tiene solución técnica completa**. Solo mitigación honesta.

**Mitigación.**
- Abstención obligatoria como estado por defecto, no como excepción.
- Predicción conforme para dar garantía de cobertura sobre la tasa de error, en lugar de una
  puntuación sin respaldo estadístico.
- Corpus de evaluación propio con *hard negatives*: texto de no nativos, escritura técnica,
  traducciones, texto editado por humanos a partir de un borrador de IA.
- Publicar la matriz de rendimiento por idioma y dominio, incluidas las celdas malas.
- Recalibración periódica desacoplada del reentrenamiento: `calibrationId` versionado aparte.

**Riesgo residual: alto y permanente.** Se gestiona con posicionamiento (evidencia, no
veredicto), no con ingeniería. Cualquier plan que asuma resolverlo es un plan defectuoso.

---

## R-02 · Sesgo contra hablantes no nativos · P5 I5

**Riesgo.** Reproducir el resultado de Stanford: 61,3 % de falsos positivos en textos de no
nativos. Además del daño a personas, es un riesgo existencial de reputación y un vector de
demanda.

**Mitigación.**
- Detección de idioma y de perfil de escritura **antes** de puntuar. Fuera del conjunto validado,
  abstención automática.
- Métrica de equidad como *gate* de release: la diferencia de FPR entre subgrupos (nativo /
  no nativo, por idioma) debe estar por debajo de un umbral fijado; si no, no se publica.
- Conjunto de evaluación específico de equidad, mantenido y ampliado, con revisión externa.
- El producto nunca emite un veredicto sobre la *autoría de una persona identificada*. Evalúa
  contenido, no personas. En modo académico esto es explícito en la interfaz.

**Riesgo residual: medio.** La mitigación funciona pero requiere disciplina sostenida de release.

---

## R-03 · Rendimiento: la extensión ralentiza la web · P4 I5

**Riesgo.** Es la causa principal de desinstalación en esta categoría. El coste es acumulativo:
extracción del DOM, decodificación de imágenes, inferencia, reposicionamiento del overlay.

**Mitigación.**
- Presupuestos numéricos verificados en CI (ver [`03-arquitectura.md`](./03-arquitectura.md#9-presupuesto-de-rendimiento)).
- Cero inferencia en el hilo principal de la página. Cero inferencia en el content script.
- `IntersectionObserver` como disparador; nada fuera del viewport.
- `scheduler.postTask` con prioridad `background` y `requestIdleCallback`.
- Presupuesto por página que se agota: análisis parcial antes que página lenta.
- Interruptor de emergencia: si se detecta contención, la extensión se autolimita y lo dice.
- Suite Playwright que mide FPS durante scroll en 20 sitios reales y falla el build ante
  regresión.

**Riesgo residual: bajo,** si los presupuestos se mantienen en CI desde el primer commit. Si se
añaden después, no se recuperan nunca.

---

## R-04 · Fragmentación entre navegadores · P4 I4

**Riesgo.** Cinco navegadores, tres modelos de background distintos, WebGPU desigual, cuotas de
almacenamiento distintas, `offscreen` solo en Chromium, y Safari con un ciclo de publicación
completamente ajeno.

**Mitigación.**
- Abstracción `RuntimeHost` con una implementación por plataforma, aislada en
  `apps/extension/platform/`. Es el único lugar con código específico de navegador.
- WXT para el build multi-target.
- Matriz E2E en CI: Chromium y Firefox en cada PR; Safari en nightly sobre runner macOS.
- Safari fuera del MVP, presupuestado como proyecto propio con Xcode y cuota de desarrollador.

**Riesgo residual: medio.** Safari seguirá siendo caro; se acepta.

---

## R-05 · Coste y fricción de descargar modelos · P4 I4

**Riesgo.** 48 MB en Tier 1 y 242 MB en Tier 2. La descarga falla, se interrumpe, agota la cuota
de almacenamiento o simplemente hace que el usuario abandone durante el onboarding.

**Mitigación.**
- El producto **es útil sin ningún modelo**: Tier 0 (procedencia, metadatos, heurísticas) funciona
  al instante tras instalar. El primer valor no depende de una descarga.
- Descarga reanudable por trozos, con progreso, cancelable.
- Tamaño anunciado antes de empezar. Nunca descarga silenciosa.
- Verificación SHA-256 por fichero y firma del manifiesto; fallo → purga, sin estado a medias.
- Gestión de cuota: comprobar espacio disponible antes; en Safari, avisar de la cuota agresiva.
- Purga de modelos desde Opciones con espacio recuperado a la vista.

**Riesgo residual: bajo.**

---

## R-06 · Rechazo o retirada en las tiendas · P3 I5

**Riesgo.** Cinco procesos de revisión independientes. Causas típicas: permisos amplios sin
justificar, código remoto, ofuscación, descripción no coincidente con la funcionalidad,
recolección de datos no declarada.

**Mitigación.**
- Permisos mínimos en instalación (ver [`06-modelo-de-permisos.md`](./06-modelo-de-permisos.md)).
  Es la mitigación de mayor impacto.
- Los pesos son datos, no código; los binarios WASM se empaquetan. No se ejecuta código remoto en
  ningún escenario. Documentado explícitamente para el revisor.
- Sin ofuscación. Source maps disponibles para revisión.
- Declaración de uso de datos coherente con el código; auditada antes de cada envío.
- Publicación escalonada por tienda: Chrome primero, resto después de superar revisión.
- Plan de contingencia: canal de distribución directa (CRX autoalojado para empresas, XPI firmado
  en AMO) si una tienda retira el producto.

**Riesgo residual: medio.** No es controlable al 100 %; se reduce la superficie.

---

## R-07 · Deuda de rotación de modelos · P4 I3

**Riesgo.** Aparece un generador nuevo, el detector se degrada, y no hay forma de reaccionar sin
publicar una versión nueva en cinco tiendas y esperar la revisión.

**Mitigación.**
- Actualización de modelos **desacoplada del ciclo de la tienda**: son datos verificados por
  firma, no código. Un modelo mejor llega en horas, no en semanas.
- Feature flags con despliegue por porcentaje para probar un modelo nuevo en una fracción de
  usuarios antes de generalizarlo.
- Rollback local automático si el modelo nuevo falla la verificación de arranque.
- Monitorización de deriva mediante distribución de bandas agregada de la telemetría opt-in: un
  cambio brusco en la proporción de bandas indica degradación sin necesidad de ver contenido.

**Riesgo residual: bajo.** Esta es una de las ventajas estructurales del diseño.

---

## R-08 · Sitios que se rompen por interferencia del overlay · P3 I4

**Riesgo.** SPAs con diffing de DOM, editores de texto enriquecido, canvas a pantalla completa,
sitios con CSP estricta o con `MutationObserver` propios.

**Mitigación.**
- Nunca se envuelve el texto original. `Range` + capa absoluta, o CSS Custom Highlight API donde
  esté disponible.
- Un solo nodo raíz con shadow root cerrado.
- Lista de compatibilidad para sitios conocidos que requieren tratamiento especial, entregada como
  dato actualizable, no como código.
- Botón de pánico: "desactivar en este sitio", visible en el popup, un clic.
- Canal de reporte de sitio roto integrado, que **no envía contenido**, solo el dominio y la
  versión, y solo si el usuario lo pulsa.

**Riesgo residual: medio.** Inevitable en cierta medida; lo que importa es la velocidad de
reacción.

---

## R-09 · Memoria en Tier 2 · P3 I4

**Riesgo.** Un modelo Q4 de 242 MB en disco consume bastante más en memoria durante la
inferencia. En equipos modestos compite con la propia página y puede provocar que el navegador
mate la pestaña.

**Mitigación.**
- Tier 2 estrictamente opt-in y bajo demanda; nunca se dispara solo.
- Sondeo de `navigator.deviceMemory` y de núcleos; en dispositivos por debajo del umbral, Tier 2
  no se ofrece.
- Descarga del modelo de memoria tras un periodo de inactividad configurable.
- Aviso explícito de consumo antes de la primera activación.
- Tope de tokens por consulta con truncado documentado, no silencioso.

**Riesgo residual: bajo,** dado que es opcional por diseño.

---

## R-10 · Evasión adversaria · P4 I2

**Riesgo.** Existe literatura demostrando que se puede guiar a un LLM para evadir detección, y las
herramientas de "humanización" son un mercado activo. La paráfrasis destruye tanto las señales
estadísticas como las marcas de agua.

**Mitigación.** Aceptación parcial y honesta. La procedencia criptográfica no se evade
parafraseando (se pierde, que es distinto y detectable como ausencia de cadena). La detección de
múltiples señales independientes eleva el coste de la evasión. Pero **no se promete robustez
adversaria**, ni en la interfaz ni en el material comercial.

**Riesgo residual: alto y aceptado.** Un producto que prometa lo contrario está mintiendo.

---

## R-11 · Dependencia de proyectos de terceros · P3 I2

**Riesgo.** `distil-ai-slop-detector` (Apache-2.0), wllama, ORT Web y los pesos de los modelos son
dependencias externas que pueden quedar sin mantenimiento o cambiar de licencia.

**Mitigación.** Interfaz `Detector` que hace a cualquier motor reemplazable en un día. Mirror
propio de pesos y binarios WASM con verificación de integridad. Auditoría de licencias en CI.
Ninguna dependencia externa en el kernel.

**Riesgo residual: bajo.**

---

## Resumen

| ID | Riesgo | P | I | P×I | Residual |
|---|---|---|---|---|---|
| R-01 | Exactitud en el mundo real | 5 | 5 | 25 | **Alto, permanente** |
| R-02 | Sesgo contra no nativos | 5 | 5 | 25 | Medio |
| R-03 | Rendimiento | 4 | 5 | 20 | Bajo |
| R-04 | Fragmentación de navegadores | 4 | 4 | 16 | Medio |
| R-05 | Descarga de modelos | 4 | 4 | 16 | Bajo |
| R-06 | Rechazo en tiendas | 3 | 5 | 15 | Medio |
| R-07 | Rotación de modelos | 4 | 3 | 12 | Bajo |
| R-08 | Sitios rotos | 3 | 4 | 12 | Medio |
| R-09 | Memoria en Tier 2 | 3 | 4 | 12 | Bajo |
| R-10 | Evasión adversaria | 4 | 2 | 8 | **Alto, aceptado** |
| R-11 | Dependencias de terceros | 3 | 2 | 6 | Bajo |

Los dos riesgos con residual alto (R-01 y R-10) comparten la misma respuesta: **no se resuelven
con ingeniería, se gestionan con honestidad de producto.** Esa es la razón de que el
posicionamiento sea "capa de evidencia" y no "detector".
