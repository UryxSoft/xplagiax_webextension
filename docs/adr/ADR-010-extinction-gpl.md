# ADR-010 · Integración de Extinction y el problema de la GPL-3.0

## Estado
**Aceptado con modificación** — el titular decidió incluir Extinction. La ADR recoge la decisión
tomada y el diseño que la hace segura. Sigue requiriendo dictamen legal de confirmación.

> **Revisión.** La versión inicial de esta ADR proponía no incorporar Extinction en absoluto. El
> titular reafirmó la instrucción de incluirlo, como etapa de validación. Se acata. Lo que sigue
> describe cómo se incluye sin que la GPL-3.0 alcance al SDK comercial y sin que un método del
> ~80 % de precisión pueda causar un falso positivo.

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

Extinction se incluye **como etapa de validación**, en un paquete aislado y bajo su propia
licencia. Tres piezas hacen que eso funcione.

### 1 · Aislamiento por dirección de dependencia

```
@xpx/extinction-validator  (GPL-3.0-or-later)
          │  depende de
          ▼
@xpx/kernel                (Apache-2.0)   ← no sabe que el validador existe
          ▲
          │  depende de
@xplagiax/kernel  = SDK comercial          ← no incluye el validador
```

La extensión sí empaqueta el validador y **se distribuye bajo GPL-3.0** con su fuente
correspondiente. Eso es coherente con el compromiso de abrir las partes críticas del producto
(`09-riesgos-privacidad.md` §7). El SDK, que es la vía de negocio a proteger, no lo incluye y
sigue siendo licenciable comercialmente.

La dirección de la dependencia no se confía a la disciplina de nadie: hay tests de arquitectura
en `packages/kernel/test/architecture.test.ts` que fallan el build si el kernel llega a importar
el paquete GPL o si adquiere cualquier dependencia.

### 2 · Monotonía hacia la cautela

El pipeline impone que una etapa de validación solo pueda volver el veredicto **más cauto**:
degradar la banda o forzar la abstención. No existe ninguna acción que eleve la confianza.

Esa es la propiedad que permite incorporar un método con ~80 % de precisión declarada en un
producto cuyo objetivo es una tasa de falsos positivos por debajo del 1 %: **en el peor caso, una
heurística equivocada hace perder una detección; nunca acusa a nadie.** La garantía la impone el
pipeline, no la etapa, y está cubierta por tests.

En la práctica el validador funciona como red de seguridad: cuando el clasificador de Tier 1 grita
"generado" y la heurística ve un texto claramente humano, gana la duda. Hay un test que demuestra
exactamente ese rescate de un falso positivo.

### 3 · Biblioteca de patrones propia y calibración propia

La lista de expresiones regulares **no se copia**: es la aportación más original de Extinction y
la parte más claramente protegible. La nuestra es propia, deliberadamente pequeña, con
puntuaciones bajas, y se calibra contra nuestro corpus de equidad.

Por la misma razón, el umbral de sospecha **no es el 0,65 que Extinction documenta**: ese valor
está calibrado para su biblioteca, que es mucho mayor. Copiarlo sería el error que previene
ADR-006 — un umbral sin su calibración no significa nada. El nuestro sale de la separación medida
con nuestra biblioteca y viaja con su `calibrationId`.

### Procedimiento de implementación limpia

Sigue siendo de obligado cumplimiento para el código que escribimos:

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

**Se contacta con el autor** para explorar una licencia dual. Si concede una excepción o una
licencia permisiva, el paquete puede relicenciarse y el SDK ganaría acceso al validador. Reutilizar
es mejor que reimplementar; simplemente no a costa del modelo de negocio.

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

**Publicar TODO bajo GPL-3.0, incluidos kernel y SDK.** Es la lectura maximalista y la más
sencilla de defender jurídicamente. Rechazada: elimina el SDK comercial, que es la vía de mayor
valor del roadmap. La decisión adoptada conserva la verificabilidad —la extensión, que es lo que
el usuario ejecuta, es GPL y auditable— sin renunciar al negocio.

**No incorporar Extinction en absoluto.** Era la propuesta original de esta ADR. Descartada por
decisión del titular. A cambio, el diseño adoptado limita el daño: aislamiento por dirección de
dependencia y monotonía hacia la cautela.

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
- **La extensión queda bajo GPL-3.0.** Es la consecuencia real de incluir Extinction y hay que
  asumirla con los ojos abiertos: obliga a publicar el fuente correspondiente de la extensión y
  restringe qué código propietario puede acabar dentro de ella. El SDK y el kernel quedan a salvo,
  pero la extensión no.
- Cualquier componente futuro que se quiera mantener cerrado **no puede vivir en la extensión**;
  tendrá que residir en el SDK o en un servicio. Es una restricción permanente de diseño.
- Hay que reimplementar trabajo que ya existe. Semanas de esfuerzo evitables si hubiera licencia
  permisiva.
- El procedimiento de implementación limpia impone disciplina y documentación que ralentizan.
- Riesgo residual: la frontera entre "método" y "expresión" no siempre es nítida, y la
  reimplementación necesita revisión legal. Es un riesgo gestionado, no eliminado.
- Se renuncia a las mejoras futuras del proyecto original, que habría que reimplementar cada vez.
- Nuestra biblioteca de patrones partirá de cero y será peor que la suya durante un tiempo.
