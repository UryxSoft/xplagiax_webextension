# 04 · Diagrama de componentes

## 1. Vista general

```mermaid
graph TB
    subgraph page["Página del usuario (contexto no privilegiado)"]
        CS["Content Script<br/><i>≤15 KB · solo extracción y eventos</i>"]
        OV["Overlay Engine<br/><i>1 nodo · shadow root cerrado</i>"]
        CS --> OV
    end

    subgraph ext["Contexto privilegiado de la extensión"]
        BG["Background<br/>Service Worker / Event Page<br/><i>orquestación, ciclo de vida</i>"]
        HOST["RuntimeHost<br/><i>Offscreen · Event Page · Página oculta</i>"]

        subgraph workers["Web Workers"]
            W1["Worker: texto"]
            W2["Worker: imagen"]
        end

        subgraph ui["Superficies de UI"]
            POP["Popup"]
            OPT["Opciones"]
            DASH["Dashboard"]
            REP["Informes"]
        end
    end

    subgraph kernel["@xpx/kernel — TypeScript puro, sin DOM"]
        REG["DetectorRegistry"]
        FUS["Evidence Fusion<br/><i>LLR · fiabilidad · decorrelación</i>"]
        SCO["Scoring &amp; Abstención<br/><i>bandas · intervalos conformes</i>"]
        POL["Policy Engine<br/><i>reglas de usuario y empresa</i>"]
        REG --> FUS --> SCO --> POL
    end

    subgraph det["Detectores (plugins)"]
        D0A["provenance<br/>C2PA · IPTC · EXIF · PNG"]
        D0B["stylometry<br/>heurísticas sin ML"]
        D1A["text-onnx<br/>clasificador destilado"]
        D1B["image-onnx<br/>clasificación + saliencia"]
        D2["text-llm<br/>Gemma-270M · perplejidad"]
    end

    subgraph infra["Infraestructura"]
        RT["InferenceRuntime<br/><i>ORT Web · wllama</i>"]
        MM["ModelManager<br/><i>OPFS · SHA-256 · firma</i>"]
        ST["Storage<br/><i>sync · IndexedDB · OPFS</i>"]
        TEL["Telemetry &amp; Errors<br/><i>opt-in · sin contenido</i>"]
        FF["Feature Flags"]
    end

    CS -->|"IPC tipado y validado"| BG
    BG --> HOST
    HOST --> W1 & W2
    W1 & W2 --> REG
    REG --> D0A & D0B & D1A & D1B & D2
    D1A & D1B & D2 --> RT
    RT --> MM
    MM --> ST
    POL --> BG
    BG -->|veredicto| CS
    BG --> ui
    ui --> ST
    BG --> TEL
    BG --> FF

    classDef nucleo fill:#1a365d,stroke:#2c5282,color:#fff
    classDef plugin fill:#22543d,stroke:#2f855a,color:#fff
    classDef nopriv fill:#742a2a,stroke:#9b2c2c,color:#fff
    class REG,FUS,SCO,POL nucleo
    class D0A,D0B,D1A,D1B,D2 plugin
    class CS,OV nopriv
```

Lectura del diagrama en una frase: **el contexto rojo no tiene privilegios y no ejecuta modelos;
el contexto azul no sabe qué navegador lo hospeda; el verde es reemplazable sin tocar nada más.**

---

## 2. Responsabilidades y fronteras

| Componente | Hace | **No hace** |
|---|---|---|
| **Content Script** | Extrae bloques de texto e imágenes visibles, normaliza, observa el viewport, pinta el overlay | Inferencia. Acceso al historial. Red. Decisiones de política |
| **Overlay Engine** | Dibuja capas dentro de un shadow root cerrado, reposiciona, limpia | Modificar el DOM del host. Inyectar estilos globales |
| **Background** | Orquesta, enruta IPC, gestiona ciclo de vida, aplica política | Inferencia pesada (delega en RuntimeHost) |
| **RuntimeHost** | Aloja Workers y el runtime de inferencia con vida larga | Lógica de negocio. Conocer detectores concretos |
| **DetectorRegistry** | Descubre, filtra por `canHandle`, planifica por tier y presupuesto | Interpretar resultados |
| **Evidence Fusion** | Combina LLR ponderados por fiabilidad, decorrelaciona | Decidir qué mostrar |
| **Scoring** | Bandas, intervalos conformes, abstención | Formatear texto de UI |
| **Policy Engine** | Reglas de usuario y de empresa: umbrales, dominios, acciones | Persistir. Renderizar |
| **ModelManager** | Descarga, verifica hash y firma, versiona, hace rollback | Ejecutar inferencia |
| **Telemetry** | Métricas anónimas de rendimiento y calidad, opt-in | Ver contenido. Identificar usuarios o URLs |

---

## 3. Grafo de dependencias permitido

```mermaid
graph LR
    APPS["apps/*"] --> UI["packages/ui"]
    APPS --> IPC["packages/ipc"]
    APPS --> STO["packages/storage"]
    APPS --> KER["packages/kernel"]
    DET["packages/detectors/*"] --> KER
    DET --> RUN["packages/runtime"]
    RUN --> KER
    STO --> KER
    UI --> KER
    KER --> NADA["∅ sin dependencias internas"]

    classDef raiz fill:#1a365d,stroke:#2c5282,color:#fff
    class KER,NADA raiz
```

Reglas impuestas por `eslint-plugin-boundaries` y verificadas en CI:

1. `kernel` no importa de ningún otro paquete interno. Cero excepciones.
2. `detectors/*` no importa de `ui`, `storage` ni `apps`.
3. `apps/extension` es el único lugar donde puede aparecer `chrome.*` o `browser.*`.
4. `ui` no importa de `detectors` ni de `runtime`.

Una violación rompe el build. Este es el mecanismo que impide que el monolito reaparezca por
acumulación de atajos.

---

## 4. Máquina de estados del análisis de página

```mermaid
stateDiagram-v2
    [*] --> Inactivo
    Inactivo --> Evaluando: navegación / activación
    Evaluando --> Excluido: dominio en lista negra o sin permiso
    Evaluando --> Tier0: permitido
    Excluido --> [*]

    Tier0 --> Publicando: hay evidencia de procedencia concluyente
    Tier0 --> Tier1: sin conclusión y Tier 1 disponible
    Tier0 --> Abstenido: sin modelo y sin señales

    Tier1 --> Publicando: banda resuelta
    Tier1 --> Abstenido: intervalo cruza el umbral
    Tier1 --> Tier2Ofrecido: usuario Pro y desacuerdo alto

    Tier2Ofrecido --> Tier2: el usuario lo solicita
    Tier2Ofrecido --> Abstenido: sin solicitud
    Tier2 --> Publicando

    Publicando --> Observando
    Abstenido --> Observando
    Observando --> Tier0: contenido nuevo en viewport
    Observando --> Inactivo: se abandona la página

    note right of Abstenido
        Estado de primera clase.
        Se muestra al usuario como
        "evidencia insuficiente",
        nunca como "parece humano".
    end note
```

`Tier2Ofrecido` es deliberado: el motor caro **nunca se dispara solo**. Protege batería, memoria
y la percepción de que la extensión "pesa".

---

## 5. Ciclo de vida de un detector

```mermaid
sequenceDiagram
    participant R as DetectorRegistry
    participant D as Detector
    participant M as ModelManager
    participant RT as InferenceRuntime

    R->>D: canHandle(input)
    D-->>R: true / false
    alt no aplica
        R-->>R: descartar sin coste
    else aplica
        R->>D: warmup(ctx)
        D->>M: ensureModel(ModelRef)
        M->>M: verificar SHA-256 + firma
        alt verificación falla
            M-->>D: error
            D-->>R: reliability = 0
        else verificación correcta
            M-->>D: handle del modelo
            D->>RT: createSession(handle)
            RT-->>D: sesión
        end
        R->>D: score(input, ctx)
        D-->>R: Evidence[]
        Note over R: presupuesto agotado o navegación → AbortSignal
        R->>D: dispose()
    end
```

---

## 6. Superficies de UI

| Superficie | Propósito | Estado en MVP |
|---|---|---|
| **Overlay** | Evidencia en contexto: subrayado, tooltip, capa sobre imagen | Sí |
| **Popup** | Trust Score de la página, switches de texto e imagen, acción rápida | Sí |
| **Opciones** | Sensibilidad, idioma, atajos, tema, listas, modelo, actualizaciones | Sí |
| **Dashboard** | Historial, estadísticas, gráficos, dominios, exportación | Parcial |
| **Informes** | Exportable PDF/JSON con evidencias, para periodismo y peritaje | V1 |
| **Modo desarrollador** | Tiempos de inferencia, LLR por detector, modelo, calibración | Sí, oculto |

El modo desarrollador entra en el MVP a propósito: es el instrumento con el que se depura la
calibración, y su coste es bajo porque los datos ya existen en el objeto `Evidence`.
