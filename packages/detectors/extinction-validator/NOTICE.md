# NOTICE — @xpx/extinction-validator

Este paquete implementa una etapa de validación heurística siguiendo el método descrito
públicamente por el proyecto **Extinction**:

- Proyecto: [`v81d/extinction`](https://github.com/v81d/extinction)
- Licencia del proyecto original: **GNU General Public License v3.0 o posterior**

## Por qué este paquete está aislado

Extinction se distribuye bajo GPL-3.0, una licencia copyleft fuerte. Para respetarla sin
comprometer el resto del producto, este paquete:

1. **Se licencia bajo GPL-3.0-or-later**, igual que el original.
2. **No es importado por `@xpx/kernel`.** El kernel se mantiene bajo Apache-2.0 y no tiene
   ninguna dependencia sobre este paquete. La relación va en sentido único: este paquete
   depende del kernel, no al revés.
3. **No forma parte del SDK embebible** (`@xplagiax/kernel`), que se licencia de forma
   comercial. Un cliente que integre el SDK no recibe este código y no queda sujeto a la GPL.
4. **Se incluye en la extensión de navegador**, que en consecuencia se distribuye bajo
   GPL-3.0 con su código fuente correspondiente disponible. Esto es coherente con el
   compromiso de abrir las partes críticas del producto documentado en
   `docs/09-riesgos-privacidad.md`.

La dirección de la dependencia es lo que hace que esto funcione. Está impuesta por
configuración de ESLint y verificada en CI, no confiada a la disciplina de nadie.

## Alcance de la validación

Esta etapa **nunca puede provocar un falso positivo.** El pipeline del kernel impone que
las etapas de validación sean monótonas hacia la cautela (ADR-010): pueden degradar un
veredicto o forzar la abstención, jamás elevarlo. En el peor caso, una heurística equivocada
hace perder una detección. Nunca acusa a nadie.

Esa restricción es lo que permite incorporar un método con ~80 % de precisión declarada en un
producto cuyo objetivo es una tasa de falsos positivos por debajo del 1 %.

## Agradecimiento

El enfoque heurístico de Extinction —combinar patrones léxicos con diversidad de tipo-token y
varianza de longitud de frase, normalizado con una sigmoide— es una aportación útil y
pragmática al problema, y funciona sin descargar un solo modelo. Se reconoce y se agradece.
