# ADR-010 · Integración de Extinction y el problema de la GPL-3.0

## Estado
Propuesto — requiere dictamen legal antes de pasar a Aceptado

## Contexto

El brief pide integrar [`v81d/extinction`](https://github.com/v81d/extinction) como segundo motor
de texto. Al examinarlo aparecen dos hechos que el brief no anticipaba.

**Hecho 1 — no es un motor de ML.** Extinction no usa modelos. Su método es heurístico:

- Biblioteca precompilada de expresiones regulares con puntuación por patrón, ponderadas por
  frecuencia: `pattern.score * min(2, sqrt(count)) ^ alphaScale`.
- Análisis de corpus por ventana deslizante: Type-Token Ratio (diversidad léxica) y varianza de
  longitud de frase (*burstiness*), combinados en una puntuación de fluidez.
- Normalización: `alpha / sqrt(corpusLength)`, ajuste por fluidez y transformación sigmoide
  `1 / (1 + e^(-adjustedAlpha))`.
- Umbral de sospecha por defecto: 0,65.

Precisión declarada: ~80–90 % clasificando texto humano y ~80 % detectando texto generado. Los
propios autores advierten que un método basado en regex no puede alcanzar la precisión de uno
basado en ML.

**Hecho 2 — la licencia es GPL-3.0 o posterior.** Es copyleft fuerte. Distribuir un trabajo
derivado obliga a licenciar el conjunto bajo GPL-3.0.

Ese segundo hecho colisiona de frente con el modelo de negocio: el SDK embebible se licencia de
forma comercial y anual a clientes que lo integran en su propio producto
([`10-monetizacion.md`](../10-monetizacion.md#3-api-y-sdk)). Un SDK bajo GPL-3.0 obligaría a esos
clientes a liberar su propio código, lo que lo hace invendible en la práctica.

Y la extensión se distribuye como binario a millones de usuarios: bajo GPL-3.0 habría que ofrecer
el código fuente correspondiente del conjunto, incluido todo aquello que se considere derivado.

## Decisión

**No se incorpora código de Extinction en ninguna parte del producto.**

En su lugar, se implementa un detector `stylometry` propio en Tier 0 a partir del **método
publicado**, no del código. La distinción es la que separa lo lícito de lo que no lo es: las
ideas, algoritmos y fórmulas matemáticas no son objeto de derecho de autor; la expresión concreta
en código sí lo es.

Procedimiento de implementación limpia, de obligado cumplimiento:

1. La especificación del detector se redacta a partir del README público y de la literatura de
   estilometría (TTR, burstiness, normalización sigmoide son técnicas conocidas y anteriores a
   Extinction).
2. Quien implemente **no consulta el código fuente de Extinction**. Se deja constancia por
   escrito.
3. La biblioteca de patrones es propia, construida sobre nuestro corpus de evaluación. **No se
   copia la lista de regex de Extinction**, que sí es expresión protegible y probablemente su
   aportación más original.
4. Se documenta la procedencia de cada decisión de diseño.
5. Revisión legal del resultado antes de publicar.

Se atribuye públicamente a Extinction la inspiración del enfoque, en el README y en la página de
metodología. Es lo correcto y no cuesta nada.

**Además, se contacta con el autor** para explorar una licencia dual. Si concede una excepción de
licencia o una licencia permisiva para nuestro uso, esta ADR se revisa y la integración directa
pasa a ser la opción preferente: reutilizar es mejor que reimplementar.

## Ubicación en la arquitectura

Extinction inspira el detector **Tier 0 `stylometry`**, no el Tier 2. Consecuencias:

- Coste de milisegundos, sin descarga de modelos. Aporta señal desde la instalación.
- Alta independencia estadística frente al clasificador transformer de Tier 1, que es
  exactamente lo que busca la matriz de decorrelación de
  [ADR-006](./ADR-006-evidencia-llr.md).
- **Nunca decide por sí solo.** Con ~80 % de precisión declarada está muy lejos del objetivo de
  FPR ≤ 1 %. Entra como una `Evidence` más, con LLR calibrado y `reliability` propia.
- La ranura de segunda opinión pesada de Tier 2 sigue vacante y se resuelve en
  [ADR-005](./ADR-005-motor-tier2.md) con un detector zero-shot por perplejidad.

## Riesgo específico de las heurísticas por regex

Un detector de patrones léxicos penaliza la escritura formal, regular y de vocabulario común. Es
**el mismo perfil estadístico de un hablante no nativo**, que es la causa documentada del 61,3 %
de falsos positivos del estudio de Stanford.

Por eso este detector queda sujeto al *gate* de equidad como cualquier otro: si su contribución
aumenta la diferencia de FPR entre subgrupos por encima de 2 puntos porcentuales, su
`reliability` se reduce o se desactiva por idioma. La barrera se aplica igual a un detector de
coste cero que a uno de 242 MB.

## Alternativas consideradas

**Integrar el código y publicar todo bajo GPL-3.0.** Coherente con el compromiso de abrir las
partes críticas ([`09-riesgos-privacidad.md`](../09-riesgos-privacidad.md#7-verificabilidad)).
Rechazada: elimina el SDK comercial, que es la vía de mayor valor del roadmap. Abrir el kernel
bajo una licencia permisiva logra la verificabilidad sin renunciar al negocio.

**Aislar Extinction en un proceso separado con comunicación por IPC.** Es el argumento clásico de
"frontera de proceso" para evitar el contagio de la GPL. Rechazada: su solidez jurídica es
discutida, depende de la jurisdicción, y construir el modelo de negocio sobre una interpretación
agresiva de una licencia ajena es un riesgo desproporcionado frente al coste de reimplementar unas
heurísticas.

**Ofrecerlo como plugin opcional GPL que el usuario instala aparte.** Viable en el marketplace de
V2 y sin contagio si la separación es real. Rechazada para V1 por complejidad, y porque las
heurísticas se necesitan en el núcleo de Tier 0.

**Prescindir de la estilometría.** Rechazada: es la señal más barata del sistema y la más
independiente del ML.

## Consecuencias

### Positivas
- El SDK comercial sigue siendo viable. Se protege la vía de mayor valor del roadmap.
- Tier 0 gana un detector rápido y estadísticamente independiente, sin descargas.
- La biblioteca de patrones propia se calibra sobre nuestro corpus, incluidos los casos de
  equidad, en lugar de heredar los sesgos de una lista ajena.
- Se evita una dependencia externa en el núcleo.

### Negativas
- Hay que reimplementar trabajo que ya existe. Semanas de esfuerzo evitables si hubiera licencia
  permisiva.
- El procedimiento de implementación limpia impone disciplina y documentación que ralentizan.
- Riesgo residual: la frontera entre "método" y "expresión" no siempre es nítida, y la
  reimplementación necesita revisión legal. Es un riesgo gestionado, no eliminado.
- Se renuncia a las mejoras futuras del proyecto original, que habría que reimplementar cada vez.
- Nuestra biblioteca de patrones partirá de cero y será peor que la suya durante un tiempo.
