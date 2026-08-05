# ADR-006 · Evidencia como log-likelihood ratio, no probabilidad

## Estado
Propuesto

## Contexto

El sistema combina señales heterogéneas: una firma criptográfica C2PA, un clasificador
supervisado, un detector zero-shot, heurísticas estilométricas y feedback del usuario. Hay que
fusionarlas en un veredicto.

La forma intuitiva —que cada detector devuelva una probabilidad y promediarlas, con o sin pesos—
tiene dos defectos que producen exactamente los fallos que hunden a esta categoría:

1. **Refuerzo de sesgos compartidos.** Dos detectores entrenados con corpus parecidos se equivocan
   en los mismos casos. Al promediar, dos errores correlacionados producen un falso positivo con
   alta confianza aparente. Es el mecanismo por el que un texto de un hablante no nativo acaba
   marcado con un 89 %.
2. **No se puede expresar "no lo sé".** Un `0.5` es ambiguo: puede significar "hay evidencia
   equilibrada en ambos sentidos" o "no tengo ninguna información". Son estados radicalmente
   distintos y el sistema necesita distinguirlos.

## Decisión

Cada detector devuelve un **log-likelihood ratio calibrado**:

```
llr = log( P(evidencia | generado) / P(evidencia | humano) )
```

Positivo apunta a generado, negativo a humano, **cero significa no informativo**.

Cada `Evidence` lleva además:
- `reliability ∈ [0,1]` — fiabilidad en el contexto actual; cae a 0 fuera del dominio de
  validación (idioma no soportado, texto demasiado corto).
- `calibrationId` — el conjunto de calibración que produjo ese LLR. Un LLR sin su calibración es
  un número sin significado.

Fusión log-lineal con decorrelación:

```
llr_total = Σ ( llr_i × reliability_i × w_i )
```

donde `w_i` procede de una matriz de correlación de errores estimada offline sobre el corpus de
evaluación. Detectores que se equivocan juntos reciben peso conjunto reducido.

**Asimetría de procedencia**, codificada como regla dura: un manifiesto C2PA válido produce un LLR
dominante con `reliability = 1`; la **ausencia** de manifiesto produce `llr = 0`, nunca un valor
positivo. La mayor parte de la web legítima no tiene credenciales y las plataformas destruyen
metadatos al recodificar.

## Alternativas consideradas

**Promedio ponderado de probabilidades.** Simple y comprensible. Rechazada por los dos defectos
descritos, que no son teóricos sino la causa documentada de los falsos positivos de la categoría.

**Voto por mayoría.** Robusto frente a un detector defectuoso, pero descarta información de
magnitud y no permite abstención.

**Dempster-Shafer completo.** Modela explícitamente la masa de "desconocido", que encaja
conceptualmente muy bien. Rechazada por complejidad de implementación y de explicación al usuario;
la combinación de LLR más `reliability` captura la mayor parte del beneficio.

**Meta-clasificador entrenado sobre las salidas.** Potencialmente más preciso. Rechazada para V1:
añade un modelo más que calibrar y mantener, y destruye la explicabilidad, que es requisito del
producto. Reevaluable en V2.

## Consecuencias

### Positivas
- La independencia entre fuentes es explícita y se puede corregir con la matriz de decorrelación.
- "No lo sé" es representable (`llr = 0`), que es la base de la abstención
  ([ADR-007](./ADR-007-abstencion.md)).
- Los LLR se suman, lo que hace la fusión trivial de auditar y de explicar en el modo desarrollador.
- La contribución de cada detector al total es directamente legible: es la base de la
  explicabilidad y del botón "¿Por qué?".
- Añadir un detector no obliga a recalibrar los demás.

### Negativas
- Cada detector necesita calibración para producir LLR válidos. No basta con la salida cruda de un
  clasificador; hay que ajustar una curva sobre un conjunto de validación.
- La matriz de correlación exige un corpus de evaluación suficiente y se re-estima con cada cambio
  de modelo.
- Los LLR no se muestran al usuario: hay que traducirlos a bandas comprensibles, lo que añade una
  capa de presentación.
- Es más difícil de explicar internamente que "promediamos las probabilidades", y habrá presión
  recurrente para simplificarlo.
