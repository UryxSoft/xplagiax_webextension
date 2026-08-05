# 11 · MVP

## 1. Hipótesis que el MVP debe validar

El MVP no existe para tener funcionalidades. Existe para responder cuatro preguntas, y todo lo que
no ayude a responderlas está fuera:

| # | Hipótesis | Cómo se mide |
|---|---|---|
| H1 | Un análisis local que se abstiene cuando no sabe genera **más** confianza que un porcentaje seguro y falso | Retención D30 y proporción de usuarios que dicen confiar en la herramienta |
| H2 | El coste de rendimiento es aceptable en la web real | 0 frames perdidos atribuibles en 20 sitios de prueba; desinstalaciones por lentitud < 5 % |
| H3 | La procedencia (Tier 0) aporta valor por sí sola, antes de cualquier modelo | % de sesiones con veredicto útil sin Tier 1 descargado |
| H4 | El informe exportable genera propagación | Informes exportados por usuario activo; instalaciones atribuidas a informes |

H3 es la más importante y la más barata de comprobar. Si la procedencia sola ya es útil, el
producto tiene un camino que no depende de que la detección estadística mejore.

---

## 2. Alcance

### Dentro

**Plataformas.** Chrome y Edge. Un solo artefacto Chromium, dos tiendas.

**Detección de texto.**
- Tier 0: heurísticas estilométricas, señales estructurales del DOM, etiquetas de plataforma.
- Tier 1: clasificador destilado ONNX int8, descarga opcional de ~48 MB, en Worker.
- Fusión de evidencia con LLR, bandas y abstención completa.
- Idiomas validados en el lanzamiento: **inglés y español**. En cualquier otro, abstención
  automática y mensaje explícito. Preferimos cubrir dos idiomas bien a diez mal.

**Detección de imagen.**
- Tier 0 completo: C2PA, IPTC `digitalSourceType`, EXIF, chunks PNG.
- **Sin clasificador de imagen en el MVP.** Solo procedencia. Es la mitad del trabajo, el 80 % de
  la fiabilidad, y valida H3 de forma limpia.

**Interfaz.**
- Overlay no destructivo: capa en shadow root cerrado, tooltip con banda, intervalo, modelo y
  botón "¿Por qué?".
- Popup: Trust Score de la página, dos switches (texto/imagen), acción de análisis, excluir sitio.
- Opciones: sensibilidad (mueve el umbral entre bandas, no desactiva la abstención), tema,
  idioma de la interfaz, listas de exclusión, gestión de modelos, atajos, borrar datos.
- Dashboard básico: páginas analizadas, distribución de bandas, dominios más frecuentes, 7 días.
- Informe exportable en JSON y PDF, con marca.
- Modo desarrollador oculto: LLR por detector, tiempos, modelo y `calibrationId`.

**Fundamentos.**
- Monorepo con las fronteras impuestas en CI.
- Permisos mínimos con escalada progresiva.
- Gestor de modelos con verificación de hash y firma.
- Telemetría opt-in, desactivada por defecto, con vista previa del payload.
- Arnés de benchmark y informe de calibración generado en cada release.
- E2E en Chromium y presupuestos de rendimiento como *gates* de CI.

### Fuera, explícitamente

Vídeo · PDF y documentos · correo web y redes sociales · clasificador de imagen · saliency maps ·
Firefox · Safari · Opera · aprendizaje federado · marketplace de plugins · API pública · SDK ·
modo empresa · reputación de dominios · timeline de cambios · detección multimodal cruzada ·
alertas en tiempo real · mapa de calor de página · cuentas y pagos.

**Sin cuentas ni pagos en el MVP.** El monedero llega cuando la retención esté probada. Cobrar
antes de saber si la gente vuelve es optimizar la métrica equivocada.

---

## 3. Plan de 10 semanas

| Semana | Entregable | Criterio de salida |
|---|---|---|
| **0** | Bloqueantes legales: auditoría de licencias, dictamen sobre términos de Gemma, revisión del lenguaje de la interfaz | Dictamen escrito. Sin esto no se escribe código |
| **1** | Monorepo, TS estricto, ESLint con fronteras, CI, WXT, esqueleto de las 5 superficies | `pnpm build` produce extensión instalable; CI verde |
| **2** | Contratos del kernel: `Evidence`, `Detector`, registro, fusión, bandas, abstención | Kernel al 100 % testeado sin navegador |
| **3** | Detector de procedencia (C2PA, IPTC, EXIF, PNG) | Corpus de 200 imágenes con y sin credenciales clasificado correctamente |
| **4** | Detector estilométrico + extracción y normalización en content script | Tier 0 completo en < 5 ms sobre artículo largo |
| **5** | `RuntimeHost` con offscreen + Workers + ORT Web; `ModelManager` con verificación | Modelo descargado, verificado y ejecutando en Worker |
| **6** | Detector de texto Tier 1 + integración de la fusión | Primer veredicto p95 < 800 ms |
| **7** | Motor de overlay | 0 mutaciones del DOM del host; 20 sitios sin romperse; `dispose()` limpio |
| **8** | Popup, Opciones, Dashboard, modo desarrollador | Recorridos completos, accesibles con teclado |
| **9** | Benchmark, calibración, informe de equidad, exportación de informes | ECE y FPR dentro de objetivo; *gate* de equidad superado |
| **10** | Pulido, E2E, presupuestos de rendimiento, envío a tiendas | Enviado a CWS y Edge Add-ons |

La semana 0 no es burocracia. Un problema de licencia en los pesos de Gemma descubierto en la
semana 8 invalida el trabajo de las semanas 5 a 7.

---

## 4. Equipo mínimo

| Rol | Dedicación | Motivo |
|---|---|---|
| Ingeniero de extensiones sénior | 1,0 | Multi-navegador, permisos, overlay |
| Ingeniero de ML en el navegador | 1,0 | ORT Web, cuantización, gestión de modelos |
| Investigador de ML / calibración | 0,5 | Corpus, calibración, equidad. **No es opcional** |
| Diseñador de producto | 0,5 | Es un producto de confianza; la interfaz es el producto |
| Asesor legal | 0,2 | Semana 0 y revisión de textos |

Cinco personas equivalentes a 3,2 dedicaciones completas durante 10 semanas. El rol de
calibración es el que más tentación hay de recortar y el único que no se puede recortar: sin él,
el producto es otro detector sin garantías y pierde su única ventaja.

---

## 5. Criterios de lanzamiento

Todos deben cumplirse. No hay excepciones por calendario.

**Calidad de detección**
- FPR ≤ 1 % en el corpus humano multilingüe, con abstención activa.
- Diferencia de FPR entre subgrupos nativo/no nativo ≤ 2 puntos porcentuales.
- ECE ≤ 0,05 en el conjunto de validación.
- Tasa de abstención publicada y explicada, no escondida.

**Rendimiento**
- Primer veredicto p95 ≤ 800 ms; Tier 0 ≤ 5 ms.
- 0 frames perdidos atribuibles durante scroll en los 20 sitios de prueba.
- RSS ≤ 180 MB con Tier 1 cargado.
- Paquete ≤ 10 MB.

**Privacidad y seguridad**
- Test de CI que verifica que ningún campo prohibido puede salir en la telemetría.
- Auditoría de que el content script no tiene acceso a red.
- Sin `host_permissions` en la instalación.
- Revisión de seguridad interna completada.

**Producto**
- Los 20 sitios de prueba funcionan sin romperse.
- Recorridos completos navegables solo con teclado; contraste AA; overlay compatible con lectores
  de pantalla.
- Textos legales revisados.
- El estado de abstención se muestra correctamente y se entiende en pruebas con 5 usuarios.

---

## 6. Los 20 sitios de prueba

Elegidos por cobertura de patrones difíciles, no por popularidad:

Medios (NYT, El País, BBC) · Blogs (Substack, Medium, WordPress) · Social (X, Reddit, LinkedIn) ·
Documentación (MDN, docs de GitHub) · Comercio (Amazon con reseñas) · SPAs con diffing agresivo
(Notion, Linear) · Editores (Google Docs — debe **pausarse**, no analizar) · Contenido generado
(granjas de contenido SEO conocidas) · Galerías (Unsplash, Pinterest) · Sitio con CSP estricta.

Se ejecutan en CI en cada PR. Un sitio roto es un bloqueante de release, no un *issue* para
después.

---

## 7. Qué se aprende y qué se hace después

| Resultado | Interpretación | Siguiente movimiento |
|---|---|---|
| H3 se confirma con fuerza | La procedencia sola vende | Doblar apuesta en C2PA, adelantar el vertical de periodismo y verificación |
| H1 se confirma | La honestidad es diferenciador real | Liderar la comunicación con la crítica a la categoría; abrir el vertical educativo |
| H2 falla | Problema existencial | Congelar funcionalidades hasta resolverlo. Nada importa si la web va lenta |
| H4 falla | El bucle viral no funciona | Replantear crecimiento hacia distribución en tiendas y contenido, no hacia producto |

Si H1 y H3 se confirman y H2 se sostiene, hay producto. El resto del roadmap
([`12-roadmap.md`](./12-roadmap.md)) asume ese escenario y se reordena si no ocurre.
