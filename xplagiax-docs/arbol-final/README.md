# XplagiaX — Capa de Confianza de Contenido para la Web

> Extensión multi-navegador y plataforma para evaluar **la procedencia y el origen** del contenido
> (texto, imagen, vídeo) que un usuario encuentra en la web. Procesamiento local por defecto.
> Ningún contenido del usuario sale del dispositivo sin consentimiento explícito.

**Estado actual: fase de diseño. No hay código de aplicación todavía — por decisión explícita.**
La arquitectura debe validarse antes de escribir la primera línea de producto.

---

## Índice de documentación

Toda la investigación y el diseño viven en [`docs/`](./docs). Los 20 entregables solicitados
están mapeados aquí para trazabilidad:

| #  | Entregable                          | Documento |
|----|-------------------------------------|-----------|
| 0  | Resumen ejecutivo y tesis           | [`docs/00-resumen-ejecutivo.md`](./docs/00-resumen-ejecutivo.md) |
| 1  | Estado del arte                     | [`docs/01-estado-del-arte.md`](./docs/01-estado-del-arte.md) |
| 2  | Benchmark de competidores           | [`docs/02-benchmark-competidores.md`](./docs/02-benchmark-competidores.md) |
| 3  | Arquitectura completa               | [`docs/03-arquitectura.md`](./docs/03-arquitectura.md) |
| 4  | Diagrama de componentes             | [`docs/04-diagrama-componentes.md`](./docs/04-diagrama-componentes.md) |
| 5  | Flujo de datos                      | [`docs/05-flujo-de-datos.md`](./docs/05-flujo-de-datos.md) |
| 6  | Modelo de permisos                  | [`docs/06-modelo-de-permisos.md`](./docs/06-modelo-de-permisos.md) |
| 7  | Riesgos técnicos                    | [`docs/07-riesgos-tecnicos.md`](./docs/07-riesgos-tecnicos.md) |
| 8  | Riesgos legales                     | [`docs/08-riesgos-legales.md`](./docs/08-riesgos-legales.md) |
| 9  | Riesgos de privacidad               | [`docs/09-riesgos-privacidad.md`](./docs/09-riesgos-privacidad.md) |
| 10 | Estrategia de monetización          | [`docs/10-monetizacion.md`](./docs/10-monetizacion.md) |
| 11 | MVP                                 | [`docs/11-mvp.md`](./docs/11-mvp.md) |
| 12–17 | Roadmaps V1, V2, Enterprise, Mobile, API, SDK | [`docs/12-roadmap.md`](./docs/12-roadmap.md) |
| 18–20 | Crecimiento, adquisición, liderazgo de mercado | [`docs/13-estrategia-crecimiento.md`](./docs/13-estrategia-crecimiento.md) |
| —  | Criterios de éxito medibles         | [`docs/14-criterios-de-exito.md`](./docs/14-criterios-de-exito.md) |
| —  | Decisiones de arquitectura (ADR)    | [`docs/adr/`](./docs/adr) |

**Empieza por [`docs/00-resumen-ejecutivo.md`](./docs/00-resumen-ejecutivo.md).** Contiene la
tesis del producto y las tres objeciones que cambian el diseño respecto al brief original.

---

## La tesis en una frase

Vender veredictos de "esto lo escribió una IA" es un negocio comoditizado, científicamente frágil
y legalmente expuesto. Vender **procedencia verificable + evidencia calibrada con abstención
honesta** es una capa de infraestructura defendible. XplagiaX se construye sobre lo segundo.

## Alcance de navegadores

Chrome · Edge · Opera (Chromium MV3) · Firefox (MV3 con event pages) · Safari (Web Extension
sobre app contenedora). Las diferencias reales entre plataformas están documentadas en
[`docs/03-arquitectura.md`](./docs/03-arquitectura.md#8-matriz-de-compatibilidad-entre-navegadores)
— no son cosméticas y condicionan el diseño del runtime.

## Titularidad y licencia

Producto de **XplagiaX LTD** (Canadá) — [xplagiax.ca](https://xplagiax.ca).

Licencia pendiente de decisión (ver
[`docs/08-riesgos-legales.md`](./docs/08-riesgos-legales.md#5-licencias-de-terceros)).
Dos restricciones de terceros la condicionan: los términos de Gemma para redistribuir pesos
derivados, y la GPL-3.0 de Extinction, que impide integrar su código sin contagiar todo el
producto ([ADR-010](./docs/adr/ADR-010-extinction-gpl.md)).

## Atribuciones

El diseño se apoya en el trabajo público de:

- [`distil-labs/distil-ai-slop-detector`](https://github.com/distil-labs/distil-ai-slop-detector) (Apache-2.0) — motor Tier 2.
- [`Noodulz/dejAIvu`](https://github.com/Noodulz/dejAIvu) — enfoque de saliencia y explicabilidad en imagen.
- [`v81d/extinction`](https://github.com/v81d/extinction) (GPL-3.0) — inspiración del método
  estilométrico de Tier 0. Su código no se incorpora; ver
  [ADR-010](./docs/adr/ADR-010-extinction-gpl.md).
