# ADR-007 · La abstención es un estado de primera clase

## Estado
Propuesto

## Contexto

Los detectores de la categoría siempre responden. Ante un texto de 40 palabras en un idioma que el
modelo apenas vio, devuelven "23 % IA" con la misma presentación que ante un artículo de 3.000
palabras en inglés. El usuario no tiene forma de distinguir un resultado fundado de uno inventado.

Esto es el origen del daño documentado: 61,3 % de falsos positivos en ensayos TOEFL de hablantes
no nativos, universidades retirando las herramientas, personas acusadas injustamente. El fallo no
está solo en el modelo: está en un diseño que **no permite al sistema decir que no sabe**.

## Decisión

`INSUFFICIENT_EVIDENCE` es un veredicto de primera clase, no un error ni un caso límite. Es el
**estado por defecto** del que hay que salir con evidencia.

Cuatro bandas, y nunca un porcentaje desnudo:

| Banda | Significado |
|---|---|
| `PROVENANCE_CONFIRMED` | Credencial criptográfica verificada. Certeza |
| `STRONG_SIGNAL` | Varias señales independientes concuerdan |
| `WEAK_SIGNAL` | Indicios insuficientes para afirmar |
| `INSUFFICIENT_EVIDENCE` | Abstención |

Condiciones de abstención obligatoria, **no configurables por el usuario ni por el administrador
de una organización**:

1. Texto por debajo del mínimo de tokens validado (indicativo: 150).
2. Idioma fuera del conjunto validado para el modelo cargado.
3. El intervalo de predicción conforme cruza el umbral de decisión.
4. Desacuerdo alto entre detectores independientes de fiabilidad similar.

El ajuste de "sensibilidad" y los modos "estricto" y "relajado" del brief **mueven el umbral entre
`WEAK_SIGNAL` y `STRONG_SIGNAL`. No desactivan la abstención.** No existe una configuración que
permita al producto ser injusto.

## Reglas de presentación

- `INSUFFICIENT_EVIDENCE` se muestra como *"No hay evidencia suficiente para evaluar este
  contenido"*, con el motivo concreto. **Nunca como "probablemente humano"**: son afirmaciones
  distintas y confundirlas es el fallo que se está corrigiendo.
- La tasa de abstención se publica en la página de metodología. Una abstención alta es honestidad
  medida, no una deficiencia que ocultar.
- Que el usuario entienda correctamente este estado es un criterio de lanzamiento verificado en
  pruebas de usabilidad ([`14-criterios-de-exito.md`](../14-criterios-de-exito.md#1--experiencia-de-usuario)).

## Alternativas consideradas

**Siempre dar un número, con un indicador de confianza aparte.** Es lo que hace la categoría.
Rechazada: la evidencia muestra que los usuarios leen el número e ignoran el indicador. El número
es el mensaje.

**Umbral configurable sin mínimo.** Rechazada: permitiría a un cliente institucional configurar el
producto para acusar con poca base, que es precisamente el uso que hay que impedir.

**Abstención solo por longitud.** Insuficiente: el idioma y el desacuerdo entre detectores son
causas igual de importantes.

## Consecuencias

### Positivas
- Es el diferenciador central del producto y el argumento que abre el mercado educativo, del que
  los incumbentes fueron expulsados.
- Reduce de forma directa el riesgo de difamación y el daño a personas.
- Convierte la limitación científica de la categoría en una característica honesta.
- Da un marco para crecer: cada idioma o dominio validado reduce la abstención de forma medible y
  publicable.

### Negativas
- Un porcentaje de usuarios verá "no lo sé" y percibirá el producto como inferior a uno que
  siempre responde. **Se acepta esa pérdida**, y hay que decírselo al equipo comercial antes de
  que la descubra en una demo.
- Complica la comunicación: es más difícil vender "a veces no te lo digo" que "detecta IA".
- Requiere trabajo de diseño considerable para que la abstención se lea como rigor y no como
  fallo.
- Presión interna recurrente para relajarlo cuando la conversión baje. Por eso está en una ADR y
  no en una opción de configuración.
