# 14 · Criterios de éxito

Los ocho criterios del brief, convertidos en umbrales medibles. Un criterio sin número no es un
criterio: es una intención.

---

## 1 · Experiencia de usuario

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Retención D30 | ≥ 25 % | Cohortes de instalación |
| Tiempo hasta el primer valor | ≤ 10 s tras instalar | Tier 0 funciona sin descargar nada |
| Desinstalaciones por rendimiento | ≤ 5 % de las desinstalaciones | Encuesta de desinstalación |
| Sitios rotos reportados | ≤ 0,1 % de sesiones | Canal de reporte integrado |
| Comprensión del estado de abstención | ≥ 80 % lo interpretan bien | Pruebas de usabilidad, 5 usuarios por release |
| Accesibilidad | WCAG 2.2 AA | Auditoría automática + manual con lector de pantalla |

La quinta métrica es inusual y es la más importante. Si el usuario lee "evidencia insuficiente"
como "es humano", el producto miente aunque el motor sea correcto.

---

## 2 · Precisión y errores

| Métrica | Objetivo | Notas |
|---|---|---|
| FPR con abstención activa | ≤ 1 % | Corpus humano multilingüe |
| Δ FPR entre subgrupos nativo / no nativo | ≤ 2 pp | **Gate de release.** Bloquea la publicación |
| ECE (error de calibración esperado) | ≤ 0,05 | Más importante que el AUC |
| Tasa de abstención | Publicada, no minimizada | Una abstención alta es honestidad, no un fallo |
| Recall en `STRONG_SIGNAL` | ≥ 70 % | Secundario frente al FPR |
| Precisión de procedencia | ≥ 99,9 % | Es criptografía; un fallo aquí es un bug |

**Asimetría deliberada:** un falso positivo daña a una persona, un falso negativo solo pierde una
detección. Toda la operación del umbral está sesgada en esa dirección, y no es configurable por el
usuario.

### Corpus de evaluación

| Conjunto | Contenido | Uso |
|---|---|---|
| `human-multiling` | Texto humano en 5 idiomas, incluidos no nativos | FPR y equidad |
| `generated-current` | Salidas de los generadores vigentes | Recall |
| `hard-negatives` | Técnico, traducido, muy editado, formal | Robustez |
| `hybrid` | Escrito por humano y editado con IA, y al revés | El caso mayoritario real |
| `paraphrased` | Generado y luego parafraseado | Evasión |
| `provenance` | Con y sin credenciales C2PA | Tier 0 |

El conjunto `hybrid` es el que más importa y el que casi nadie evalúa: la mayor parte del
contenido real de 2026 no es puramente humano ni puramente generado. Un detector binario evaluado
solo con extremos reporta cifras que no significan nada.

---

## 3 · Rendimiento

| Métrica | Objetivo | Gate de CI |
|---|---|---|
| Primer veredicto, p95 | ≤ 800 ms | Sí |
| Tier 0 solo | ≤ 5 ms | Sí |
| Bloqueo del hilo principal por tarea | ≤ 8 ms | Sí |
| Frames perdidos en scroll | 0 atribuibles | Sí, 20 sitios |
| RSS con Tier 1 | ≤ 180 MB | Sí |
| RSS con Tier 2 | ≤ 700 MB | Aviso al usuario |
| Impacto en LCP | 0 ms | Sí |
| Paquete de la extensión | ≤ 10 MB | Sí |
| JS del content script | ≤ 15 KB gzip | Sí |

Todos son *gates* de CI. Una regresión de rendimiento rompe el build igual que un test que falla.
Los presupuestos que se añaden tarde nunca se recuperan.

---

## 4 · Privacidad y cumplimiento

| Criterio | Verificación |
|---|---|
| Cero contenido enviado sin acción explícita | Auditoría de código de red + test de CI |
| Telemetría sin campos prohibidos | Test que falla el build |
| Sin `host_permissions` en la instalación | Test del manifiesto |
| Content script sin acceso a red | Test de arquitectura |
| Borrado completo en una acción | Test E2E |
| DPIA completada | Antes del lanzamiento en la UE |
| Auditoría externa publicada | Antes de V1 |
| Builds reproducibles | Hashes publicados por release |

---

## 5 · Mantenibilidad

| Métrica | Objetivo |
|---|---|
| Cobertura de tests del kernel | ≥ 90 % |
| Cobertura global | ≥ 75 % |
| Violaciones de fronteras del monorepo | 0, impuesto en CI |
| `any` en TypeScript | 0 fuera de `.d.ts` de terceros |
| Añadir un detector nuevo | ≤ 1 día, sin tocar el núcleo |
| Publicar un modelo nuevo | ≤ 4 h, sin publicar en tiendas |
| Tiempo de CI | ≤ 10 min para el pipeline de PR |

La penúltima es la que mide si la arquitectura funciona de verdad: si actualizar un modelo exige
pasar por la revisión de cinco tiendas, el diseño ha fallado.

---

## 6 · Escalabilidad

| Dimensión | Objetivo |
|---|---|
| Usuarios concurrentes | Sin límite: la inferencia es local |
| CDN de modelos | 10 M de descargas al mes sin degradación |
| API, p95 | ≤ 400 ms para texto Tier 1 |
| Disponibilidad de API | 99,9 % |
| Coste de infraestructura por usuario activo | ≤ 0,02 USD/mes |

La última cifra es la ventaja estructural del producto. Un competidor en la nube paga inferencia
por análisis; nosotros pagamos ancho de banda una vez por modelo y usuario.

---

## 7 · Monetización

| Métrica | Objetivo año 1 | Año 2 |
|---|---|---|
| Instalaciones activas | 100.000 | 500.000 |
| Conversión a Pro | 1,5 % | 2 % |
| Churn mensual de Pro | ≤ 5 % | ≤ 3 % |
| ARR | 250.000 USD | 6 M USD |
| Margen bruto | ≥ 85 % | ≥ 90 % |
| Clientes de API | 5 | 50 |
| Contratos Enterprise | 1 | 12 |
| NDR | — | ≥ 110 % |

---

## 8 · Ventaja competitiva

Difícil de cuantificar, pero no imposible. Indicadores de que el foso existe:

| Indicador | Señal de éxito |
|---|---|
| Citas del benchmark abierto | ≥ 10 citas académicas o de prensa en año 2 |
| Competidores que publican calibración | Que empiecen a hacerlo. Significa que definimos el estándar |
| Integraciones de SDK en producción | ≥ 5 en año 2 |
| Tamaño del corpus de calibración | Creciente cada mes, con contribución voluntaria |
| Participación en estándares | Miembro activo de C2PA |
| Cobertura de idiomas validados | 5 en V1, 12 en V2 |
| Menciones espontáneas como "el detector honesto" | Cualitativo, seguimiento mensual |

---

## 9 · Cuadro de mando

**Semanal:** retención D7/D30 · reportes de falso positivo · frames perdidos p95 · sitios rotos ·
crashes.

**Por release:** todos los *gates* de CI · ECE y FPR · Δ FPR entre subgrupos · tasa de abstención ·
tamaño del paquete.

**Mensual:** ARR y conversión · churn · clientes de API · tamaño del corpus · cobertura de
idiomas.

**Trimestral:** auditoría de privacidad · revisión del benchmark competitivo · revisión de las
puertas del roadmap.

---

## 10 · Condiciones de parada

Situaciones en las que **se detiene el desarrollo de funcionalidades** hasta resolver:

1. Δ FPR entre subgrupos supera 2 pp → riesgo de daño a personas.
2. Frames perdidos atribuibles distintos de cero en los sitios de prueba → el producto está
   rompiendo la web.
3. Cualquier campo prohibido detectado en telemetría → incidente de privacidad, con notificación
   pública.
4. Reportes de falso positivo creciendo dos meses seguidos → el motor se está degradando.
5. ECE por encima de 0,10 → las cifras que mostramos no significan lo que decimos.

Estas cinco condiciones se escriben ahora, antes de que exista presión comercial para ignorarlas.
Ese es el único momento en que se pueden escribir con honestidad.
