# ADR-002 · WXT como framework de build multi-navegador

## Estado
Propuesto

## Contexto

Cinco navegadores objetivo con tres modelos de background distintos: service worker efímero en
Chromium, event page en Firefox MV3, y el modelo propio de Safari. Cada tienda quiere un artefacto
distinto y un manifiesto con diferencias reales, no cosméticas.

Mantener a mano cinco configuraciones de build y cinco manifiestos es una fuente permanente de
errores que solo aparecen en la tienda, después de la revisión.

## Decisión

Usar **WXT** como framework de build de la extensión. Genera los manifiestos por navegador desde
una definición única, gestiona MV3 en Chromium y MV3 con event pages en Firefox, y produce el
paquete base para el proyecto Safari.

Vite por debajo, lo que da HMR real durante el desarrollo del content script y de las páginas de
extensión.

## Alternativas consideradas

**Vite + `@crxjs/vite-plugin`.** Buena experiencia de desarrollo, pero orientado a Chromium.
Firefox y Safari quedan a mano.

**Plasmo.** Framework completo y capaz. Más opinado sobre estructura de proyecto y sobre React, lo
cual choca con un monorepo cuyo centro de gravedad es un kernel sin interfaz.

**Configuración propia con Vite/Rollup.** Máximo control. También significa mantener nosotros lo
que WXT ya mantiene, en un área que no es nuestra ventaja competitiva.

## Validación externa

[`v81d/extinction`](https://github.com/v81d/extinction), una extensión de detección de contenido
generado con el mismo objetivo de cobertura (Chromium, Firefox y Safari), llegó de forma
independiente a la misma elección: TypeScript sobre WXT con pnpm. No prueba que sea la única
opción válida, pero sí que resuelve este problema concreto en producción.

## Consecuencias

### Positivas
- Un solo origen de verdad para el manifiesto, con diferencias por navegador declaradas.
- HMR en desarrollo, que en extensiones supone una diferencia grande de velocidad.
- Menos superficie de error en el área donde los errores se descubren tarde y caro: la revisión de
  la tienda.

### Negativas
- Dependencia de un framework de terceros en la ruta crítica del build. Mitigación: WXT es una
  capa sobre Vite y el *eject* es viable, aunque costoso.
- Safari sigue necesitando trabajo manual con Xcode y app contenedora. WXT reduce el problema, no
  lo elimina.
- Hay que seguir el ritmo de versiones de WXT frente a los cambios de las plataformas.
