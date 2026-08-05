# ADR-001 · Kernel puro sin dependencias de navegador

## Estado
Propuesto

## Contexto

El roadmap incluye extensión, API pública, SDK embebible, runner Enterprise on-prem y app móvil.
Son cinco entornos de ejecución distintos sobre la misma lógica de detección.

El patrón habitual —construir primero la extensión y extraer una librería después— falla de forma
predecible: para cuando se intenta extraer, la lógica de detección ya depende de `chrome.storage`,
de `document`, de tipos del DOM y del ciclo de vida del service worker. La extracción se convierte
en reescritura, se pospone, y los productos de plataforma nunca llegan.

## Decisión

`packages/kernel` es TypeScript puro. **No importa `chrome.*`, `browser.*`, `window`, `document`,
ni ningún tipo del DOM.** Sus únicas dependencias son interfaces que él mismo define
(`InferenceRuntime`, `StorageRepo`, `Clock`, `Logger`), inyectadas por el llamante.

La regla se impone con `eslint-plugin-boundaries` y con una comprobación de CI que compila el
kernel con `lib: ["ES2022"]`, **sin `DOM`**. Si alguien usa un tipo del DOM, no compila.

## Alternativas consideradas

**Extraer la librería después.** Rechazada: es el fallo predecible descrito arriba.

**Kernel con adaptadores opcionales dentro del propio paquete.** Rechazada: los adaptadores
arrastran tipos de plataforma a la superficie pública y la restricción se erosiona en semanas.

**Un paquete por entorno con lógica duplicada.** Rechazada: cinco copias de la lógica de fusión y
calibración divergen de inmediato, y la calibración es precisamente lo que no puede divergir.

## Consecuencias

### Positivas
- API, SDK, Enterprise y móvil son trabajo de envoltura, no de reescritura.
- El 80 % de la lógica se prueba con Vitest sin levantar un navegador. CI rápido.
- La calibración es idéntica en todos los entornos por construcción, lo cual es un requisito del
  producto, no una comodidad.
- La inversión de dependencias deja de ser aspiracional: está impuesta por el compilador.

### Negativas
- Más ceremonia inicial. Operaciones que serían una línea con `chrome.storage` exigen definir una
  interfaz y una implementación.
- Los desarrolladores acostumbrados a llamar a las APIs de extensión desde cualquier sitio
  encontrarán la restricción molesta durante las primeras semanas.
- Algunas optimizaciones específicas de plataforma quedan fuera del kernel y hay que exponerlas
  por la interfaz, lo cual las hace más verbosas.
