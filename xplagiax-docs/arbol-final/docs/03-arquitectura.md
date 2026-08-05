# 03 · Arquitectura

## 1. Principio rector

> **El kernel de detección no sabe que existe un navegador.**

`@xpx/kernel` es TypeScript puro: sin DOM, sin `chrome.*`, sin `browser.*`, sin `window`. Recibe
contenido normalizado y devuelve evidencia. Todo lo demás son adaptadores.

De esa única restricción se derivan gratis: la API pública (el kernel en Node), el SDK
embebible (el kernel en un bundle), el modo Enterprise (el kernel en un runner on-prem), el
soporte multi-navegador (cinco adaptadores, un núcleo) y la testabilidad real (el 80 % de la
lógica se prueba sin levantar un navegador).

Si una funcionalidad no puede implementarse sin romper esa restricción, la funcionalidad está
mal diseñada.

---

## 2. Monorepo

```
xplagiax/
├── packages/
│   ├── kernel/              # Núcleo puro. Sin DOM, sin APIs de extensión.
│   │   ├── contracts/       #   Tipos e interfaces. Sin implementación.
│   │   ├── evidence/        #   Modelo de evidencia y fusión calibrada
│   │   ├── registry/        #   DetectorRegistry, ciclo de vida de detectores
│   │   ├── scoring/         #   Trust Score, umbrales, abstención
│   │   └── policy/          #   Motor de reglas (umbrales, dominios, acciones)
│   ├── detectors/
│   │   ├── provenance/      # C2PA, IPTC, EXIF, chunks PNG  → Tier 0
│   │   ├── stylometry/      # Heurísticas sin ML (ADR-010)  → Tier 0
│   │   ├── text-onnx/       # Clasificador destilado ONNX   → Tier 1
│   │   ├── image-onnx/      # Clasificador + saliencia      → Tier 1
│   │   └── text-llm/        # Gemma-270M / perplejidad      → Tier 2
│   ├── runtime/             # Abstracción de inferencia (ORT Web, wllama)
│   ├── ipc/                 # RPC tipado con validación de esquema
│   ├── storage/             # Repositorios: settings, historial, caché, modelos
│   ├── ui/                  # Design system. Componentes sin lógica de negocio
│   └── telemetry/           # Métricas anónimas opt-in + error reporting
├── apps/
│   ├── extension/           # Adaptadores por navegador + superficies de UI
│   ├── api/                 # Servicio HTTP que envuelve el kernel (V1.5)
│   └── sdk/                 # Paquete npm embebible (V2)
├── models/                  # Manifiestos y metadatos. Los pesos NO se versionan
├── benchmarks/              # Corpus, arneses de evaluación, informes de calibración
└── docs/
```

Herramientas: **pnpm workspaces + Turborepo**, TypeScript en modo `strict` con
`exactOptionalPropertyTypes` y `noUncheckedIndexedAccess`, ESLint con `eslint-plugin-boundaries`
para **imponer las fronteras del monorepo en CI** (el kernel no puede importar nada de `apps/`;
`detectors/` no puede importar `ui/`). Una regla de arquitectura que no está automatizada no
existe.

Build de la extensión con **WXT** — resuelve MV3 en Chromium, MV3 con event pages en Firefox y
el empaquetado para Safari desde una sola base. Ver [ADR-002](./adr/ADR-002-framework-build.md).

### 2.1 Relación con los directorios por navegador que ya existen en el repo

El repositorio contiene ya `chrome_extension/`, `firefox_extension/`, `edge_extesion/`,
`opera_extension/` y `Safari_extension/`. Esa estructura y la propuesta de monorepo no están en
conflicto: **son capas distintas**.

- `apps/extension/` es el **código fuente único**, con los adaptadores de plataforma aislados en
  `apps/extension/platform/`.
- Los directorios por navegador son **destinos de build**: WXT emite en cada uno el artefacto
  listo para su tienda.

```
apps/extension/  ──(wxt build --browser chrome)──▶  chrome_extension/
                 ──(wxt build --browser firefox)─▶  firefox_extension/
                 ──(wxt build --browser edge)────▶  edge_extesion/
                 ──(wxt build --browser opera)───▶  opera_extension/
                 ──(wxt build --browser safari)──▶  Safari_extension/   + proyecto Xcode
```

Mantener código fuente duplicado por navegador sería el error contrario al que evita todo este
diseño: cinco copias que divergen, cinco calibraciones distintas. Lo que se duplica es el
**artefacto**, no la fuente.

Nota menor: el directorio existente es `edge_extesion` (falta una `n`). Se propone corregirlo a
`edge_extension` antes de que ninguna herramienta dependa de la ruta; después será un cambio con
coste.

---

## 3. Modelo de evidencia

Este es el corazón del producto. Ningún detector devuelve "72 % IA". Devuelve evidencia:

```ts
type Modality = 'text' | 'image' | 'video' | 'audio' | 'document';
type EvidenceKind = 'provenance' | 'watermark' | 'statistical' | 'heuristic' | 'user';

interface Evidence {
  detectorId: string;
  detectorVersion: string;
  kind: EvidenceKind;
  modality: Modality;

  /** Log-likelihood ratio calibrado: log( P(e|generado) / P(e|humano) ).
   *  Positivo apunta a generado, negativo a humano, 0 es no informativo. */
  llr: number;

  /** Fiabilidad de esta evidencia en el contexto actual, en [0,1].
   *  Cae a 0 cuando el detector está fuera de su dominio de validación. */
  reliability: number;

  /** Identificador del conjunto de calibración con el que se produjo el llr. */
  calibrationId: string;

  /** Soporte para XAI: qué hizo que el detector opinara esto. */
  rationale: Rationale[];

  costMs: number;
}
```

### 3.1 Por qué log-likelihood ratio y no probabilidad

Combinar probabilidades por promedio es incorrecto y produce el error clásico del sector: dos
detectores que comparten sesgo se refuerzan y generan un falso positivo con alta confianza. Los
LLR se **suman** (fusión log-lineal ponderada por fiabilidad), lo que hace explícita la
independencia asumida entre fuentes, y permite penalizar detectores correlacionados con una
matriz de correlación estimada offline.

Además, el LLR permite expresar lo que la probabilidad no puede: **evidencia nula**. Un detector
que no sabe devuelve `llr = 0`, no `0.5`.

### 3.2 Asimetría de la procedencia

Codificada como regla dura en la fusión:

- Manifiesto C2PA válido que declara `trainedAlgorithmicMedia` → evidencia dominante,
  `llr` alto, `reliability = 1`. La cadena firmada gana sobre cualquier clasificador.
- Manifiesto C2PA válido de captura de cámara con cadena íntegra → `llr` fuertemente negativo.
- **Ausencia de manifiesto → `llr = 0`.** No es sospechoso. La mayoría de la web legítima no
  tiene credenciales, y las plataformas destruyen metadatos al recodificar.

### 3.3 Fusión y abstención

```
llr_total = Σ ( llr_i × reliability_i × w_i )     w_i de la matriz de decorrelación

banda = clasificar(llr_total, intervalo_conforme)
```

Cuatro bandas, y solo cuatro. Nunca un porcentaje desnudo:

| Banda | Significado en la UI |
|---|---|
| `PROVENANCE_CONFIRMED` | Credencial verificada. Certeza, no estimación |
| `STRONG_SIGNAL` | Múltiples señales independientes concuerdan |
| `WEAK_SIGNAL` | Indicios, insuficientes para afirmar |
| `INSUFFICIENT_EVIDENCE` | **Abstención.** El estado por defecto |

Condiciones de abstención obligatoria, no configurables por el usuario:

- Texto por debajo del mínimo de tokens validado (indicativo: 150 tokens).
- Idioma fuera del conjunto validado para el modelo cargado.
- Intervalo conforme que cruza el umbral de decisión.
- Desacuerdo alto entre detectores independientes con fiabilidad similar.

El "modo estricto / relajado" del brief **mueve el umbral entre `WEAK` y `STRONG`, nunca desactiva
la abstención.** Un usuario no puede configurar el producto para que sea injusto.

---

## 4. Interfaz de detector — la base del sistema de plugins

```ts
interface Detector {
  readonly id: string;
  readonly version: string;
  readonly capabilities: {
    modalities: Modality[];
    tier: 0 | 1 | 2;
    languages: string[] | 'any';
    minInputTokens?: number;
    requiresModel?: ModelRef;
  };

  /** Rechazo barato antes de gastar recursos. */
  canHandle(input: NormalizedInput): boolean;

  warmup(ctx: DetectorContext): Promise<void>;
  score(input: NormalizedInput, ctx: DetectorContext): Promise<Evidence[]>;
  dispose(): Promise<void>;
}
```

Añadir un detector nuevo = publicar un paquete que implemente esta interfaz y registrarlo. Cero
cambios en el núcleo. El marketplace del roadmap es esta interfaz más un manifiesto firmado y un
sandbox de Worker. La arquitectura de plugins no es una fase futura: es la forma en que se
escriben los detectores desde el primer día, incluidos los propios.

---

## 5. Runtime de inferencia

`@xpx/runtime` presenta una fachada única sobre los backends y decide el mejor disponible:

```
InferenceRuntime
├── OrtWebBackend        WebGPU → WASM+SIMD+threads → WASM simple
└── WllamaBackend        GGUF, solo Tier 2, solo cuando el usuario opta
```

Selección en tiempo de ejecución mediante sondeo de capacidades (WebGPU presente,
`crossOriginIsolated`, `SharedArrayBuffer`, núcleos disponibles, memoria del dispositivo), con
degradación silenciosa. El resultado del sondeo se cachea y se expone en el modo desarrollador.

**Regla absoluta: la inferencia jamás corre en el content script.** No se puede garantizar
aislamiento cross-origin en una página de terceros, el hilo principal de esa página pertenece al
usuario, y una fuga de memoria del runtime rompería el sitio del usuario, no el nuestro.

Dónde corre entonces, por navegador:

| Navegador | Host de inferencia |
|---|---|
| Chrome / Edge / Opera | **Offscreen Document** (`chrome.offscreen`), con Workers dedicados |
| Firefox | Event page persistente del background + Workers |
| Safari | Página de extensión oculta + Workers |

Esa divergencia se esconde tras `RuntimeHost`, con una implementación por plataforma. Es la única
parte del sistema donde se permite código específico de navegador, y está aislada en
`apps/extension/platform/`.

---

## 6. Gestión de modelos

Los pesos son **datos**, no código. Se descargan tras la instalación desde un CDN, nunca se
empaquetan. El paquete de la extensión se mantiene por debajo de 10 MB.

```ts
interface ModelManifest {
  id: string;                 // 'text-clf-multiling'
  version: string;            // semver
  format: 'onnx' | 'gguf';
  files: { url: string; sha256: string; bytes: number }[];
  signature: string;          // firma sobre el conjunto de hashes
  calibrationId: string;      // ata el modelo a su curva de calibración
  validatedLanguages: string[];
  minRuntimeVersion: string;
}
```

- Almacenamiento en **OPFS** (Origin Private File System) con Cache API como respaldo.
- Verificación SHA-256 por fichero **y** verificación de firma del manifiesto antes de instanciar.
  Un modelo que no verifica no se carga; no hay modo de omitir la comprobación.
- Actualización diferencial por fichero: solo se descarga lo que cambió.
- `calibrationId` viaja con el modelo. **Un modelo sin su calibración es inutilizable por
  diseño** — impide el fallo silencioso de actualizar pesos y seguir usando umbrales viejos.
- Compatibilidad hacia atrás: se conserva la versión anterior hasta que la nueva supera una
  verificación de arranque. Rollback local automático.

Esto habilita además el A/B testing de modelos y el registro privado de modelos en Enterprise sin
cambios de arquitectura.

---

## 7. Motor de overlay

Requisito del brief: no modificar permanentemente el DOM, todo reversible. Implementación:

- **Un único nodo** insertado en `document.body`: `<xpx-root>` con **shadow root cerrado**. Sin
  estilos globales, sin colisión de CSS, sin exposición a scripts de la página.
- Los resaltados **no envuelven el texto original**. Se usa `Range` + `getClientRects()` para
  calcular geometría, y se dibuja una capa absoluta dentro del shadow root. El DOM del host queda
  intacto; el "subrayado" es una capa, no una etiqueta `<mark>`.
  Alternativa preferente donde esté disponible: **CSS Custom Highlight API**, que resalta rangos
  sin tocar el árbol en absoluto.
- Reposicionamiento con `IntersectionObserver` + `ResizeObserver` + `scheduler.postTask`, nunca
  con listeners de `scroll` sin throttling.
- `dispose()` elimina el único nodo raíz y devuelve la página a su estado exacto.
- Las superposiciones de imagen no reemplazan el `<img>`: se posicionan sobre él y se ocultan si
  el elemento sale del viewport.

Beneficio colateral: sitios que reaccionan a mutaciones del DOM (React, editores, SPAs con
diffing) no se rompen, que es la causa número uno de reseñas de una estrella en extensiones de
esta categoría.

---

## 8. Matriz de compatibilidad entre navegadores

| Capacidad | Chrome / Edge / Opera | Firefox | Safari |
|---|---|---|---|
| Manifest | V3 | V3 (event pages, no service worker) | V3 (estilo Safari) |
| Background | Service worker efímero | Event page | Service worker con límites propios |
| `chrome.offscreen` | **Sí** | No | No |
| `declarativeNetRequest` | Sí | Parcial | Parcial |
| WebGPU | Sí | Progresivo | Progresivo |
| OPFS | Sí | Sí | Sí, con cuotas más agresivas |
| Permisos opcionales en runtime | Sí | Sí | Limitado |
| Distribución | CWS / Edge Add-ons / Opera | AMO | App Store, requiere app contenedora macOS/iOS + Apple Developer Program |
| Revisión | Automática + manual | Manual para código ofuscado | Revisión de App Store |

Consecuencias asumidas:

1. **Safari es el más caro** y no comparte pipeline de publicación. Va en V1.5, no en el MVP.
   Requiere Xcode, app contenedora y cuota anual de desarrollador. Presupuestarlo como proyecto,
   no como *build target*.
2. Firefox no tiene offscreen documents; su host de inferencia es distinto. La abstracción
   `RuntimeHost` existe por esto.
3. Las cuotas de almacenamiento de Safari obligan a que Tier 2 sea opcional también por
   viabilidad técnica, no solo por producto.
4. Opera y Edge consumen el mismo artefacto que Chrome, pero **son tiendas y revisiones
   separadas**: coste de proceso, no de ingeniería.

---

## 9. Presupuesto de rendimiento

Presupuestos, no aspiraciones. Se verifican en CI con Playwright y fallan el build.

| Métrica | Presupuesto |
|---|---|
| Content script, JS inicial | ≤ 15 KB gzip |
| Bloqueo del hilo principal de la página, por tarea | ≤ 8 ms |
| Primer veredicto visible (Tier 0 + Tier 1, p95) | ≤ 800 ms |
| Tier 0 solo | ≤ 5 ms |
| Retraso añadido en LCP de la página | ≤ 0 ms (todo el trabajo en idle) |
| Caída de FPS durante scroll | 0 frames perdidos atribuibles |
| RSS con Tier 1 cargado | ≤ 180 MB |
| RSS con Tier 2 cargado | ≤ 700 MB, y con aviso al usuario |
| Paquete de la extensión | ≤ 10 MB |

Mecanismos: análisis incremental por bloque visible, `IntersectionObserver` como disparador,
caché LRU con clave `sha256(texto normalizado) + versión de modelo + calibrationId`,
cancelación por `AbortSignal` cuando el usuario navega, cola de trabajo con prioridad al viewport
y presupuesto por página que se agota (mejor un análisis parcial que una página lenta).

---

## 10. Almacenamiento

| Dato | Dónde | Por qué |
|---|---|---|
| Ajustes | `storage.sync` | Portable entre dispositivos, tamaño mínimo |
| Historial y estadísticas | IndexedDB (Dexie) | Volumen, consultas, gráficos del dashboard |
| Pesos de modelos | OPFS | Ficheros grandes, acceso por streaming |
| Caché de resultados | IndexedDB con TTL + LRU | Evita recalcular |
| Secretos (licencia Pro) | `storage.session` + `storage.local` cifrado | No debe filtrarse a content scripts |

**El historial guarda hashes y metadatos, nunca el contenido analizado.** Un `sha256` del texto
normalizado permite cachear y deduplicar sin conservar lo que el usuario leyó. El dashboard se
construye sobre agregados. Excepción única: si el usuario guarda explícitamente un informe, se
almacena localmente el extracto de evidencia que él eligió incluir.

---

## 11. IPC

Todos los mensajes entre superficies pasan por `@xpx/ipc`: RPC tipado sobre
`runtime.connect` con validación de esquema en ambos extremos (Zod o Valibot).

- El content script es **no privilegiado**: no puede pedir inferencia arbitraria ni leer el
  historial. Solo puede enviar contenido normalizado del documento en el que vive y recibir
  veredictos para ese documento.
- Todo mensaje entrante se valida antes de tocar lógica de negocio. Una página hostil puede
  intentar hablar con nuestro content script.
- Los canales llevan versión; una versión incompatible degrada en lugar de fallar.

---

## 12. Aplicación de SOLID

| Principio | Dónde se hace visible |
|---|---|
| **S** | Un detector detecta. No renderiza, no persiste, no decide política |
| **O** | Detectores nuevos se añaden registrándolos; el núcleo no cambia |
| **L** | Todo `Detector` es sustituible; el registro solo conoce la interfaz |
| **I** | `contracts/` expone interfaces mínimas por rol, no una fachada gigante |
| **D** | El kernel depende de `InferenceRuntime` y `StorageRepo`, nunca de ORT Web ni de IndexedDB |

Se automatiza con `eslint-plugin-boundaries` y con tests de arquitectura. Los principios que solo
viven en un documento se erosionan en el tercer sprint.
