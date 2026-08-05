# ADR-008 · Overlay sin mutar el DOM del host

## Estado
Propuesto

## Contexto

El brief exige que la extensión no modifique permanentemente el DOM y que todo sea reversible.
Más allá del requisito, hay una razón práctica: **romper sitios web es la causa número uno de
reseñas de una estrella y de desinstalaciones en esta categoría.**

La implementación habitual —envolver los rangos de texto en `<mark>` o `<span>`— rompe:
- React, Vue y cualquier framework con reconciliación de DOM, que detecta nodos inesperados;
- editores de texto enriquecido, donde altera el contenido editable;
- sitios con `MutationObserver` propios;
- selección de texto, copiado y funciones de búsqueda del navegador.

## Decisión

**El DOM del host no se modifica en ningún caso.** La única inserción es un nodo raíz:

```
document.body
  └── <xpx-root-{id-por-instalación}>   ← shadow root CERRADO
        ├── capa de resaltados
        ├── capa de superposiciones de imagen
        └── capa de tooltips
```

**Resaltado de texto sin envolver.** Dos estrategias, por orden de preferencia:

1. **CSS Custom Highlight API** donde esté disponible: resalta objetos `Range` sin tocar el árbol
   en absoluto. Es la solución correcta.
2. **Capa geométrica** como respaldo: `Range.getClientRects()` da la geometría de cada línea, y se
   dibujan rectángulos posicionados en la capa del shadow root. El texto original nunca se toca.

**Superposiciones de imagen.** No se reemplaza ni se envuelve el `<img>`. Se posiciona una capa
sobre su rectángulo y se oculta cuando sale del viewport.

**Reposicionamiento.** `IntersectionObserver` y `ResizeObserver` para invalidar geometría, con
recálculo agrupado en `scheduler.postTask` con prioridad `background`. Nunca listeners de `scroll`
sin agrupación.

**Limpieza.** `dispose()` elimina el nodo raíz y desconecta los observadores. La página queda
exactamente como estaba, sin residuos ni atributos.

## Alternativas consideradas

**Envolver rangos en `<mark>`.** Simple, resaltado perfecto que sigue al texto sin recalcular.
Rechazada: rompe frameworks, editores y la selección del usuario.

**Reemplazar la imagen por un `<canvas>`.** Permitiría dibujar el mapa de saliencia directamente.
Rechazada: cambia el layout, rompe lazy loading, srcset y galerías.

**Iframe superpuesto.** Aislamiento perfecto. Rechazada: coste de rendimiento por overlay y
problemas de gestión de eventos de puntero.

**Shadow root abierto.** Más fácil de depurar. Rechazada: permite a cualquier script de la página
leer nuestro contenido, lo que expone qué se ha marcado y facilita el fingerprinting.

## Consecuencias

### Positivas
- Los sitios no se rompen. Es la mitigación de mayor impacto sobre la métrica que más pesa en la
  retención.
- Reversibilidad total con una llamada.
- Sin colisiones de CSS en ninguna dirección.
- El shadow root cerrado limita el fingerprinting por parte de la página.
- Selección, copiado y búsqueda del navegador siguen funcionando con normalidad.

### Negativas
- **Considerablemente más complejo.** Hay que mantener geometría sincronizada con un documento que
  cambia por debajo.
- Coste de recálculo en páginas con layout muy dinámico. Mitigado con agrupación y con presupuesto
  de trabajo.
- Casos difíciles: texto dentro de otros shadow roots, iframes de terceros, `position: sticky`,
  contenedores con scroll propio, transformaciones CSS. Cada uno necesita tratamiento.
- El respaldo geométrico puede desalinearse momentáneamente durante animaciones.
- Depurar con un shadow root cerrado es más incómodo; se compensa con una utilidad de inspección
  en el modo desarrollador.
