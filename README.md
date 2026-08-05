# XplagiaX — Capa de Confianza de Contenido para la Web

> Extensión multi-navegador y plataforma para evaluar **la procedencia y el origen** del contenido
> (texto, imagen, vídeo) que un usuario encuentra en la web. Procesamiento local por defecto.
> Ningún contenido del usuario sale del dispositivo sin consentimiento explícito.

**Estado: arquitectura validada, desarrollo iniciado.** El kernel está implementado y probado.

```bash
pnpm install
pnpm test        # 118 tests
pnpm typecheck
```

## Estructura del código

```
packages/
  kernel/                          Apache-2.0 · TypeScript puro, sin DOM, cero dependencias
    contracts/                       Evidence, Detector, ValidationStage, Verdict
    evidence/fusion.ts               fusión log-lineal con decorrelación
    scoring/bands.ts                 bandas, umbrales y abstención
    registry/ · pipeline/            registro y orquestación
  detectors/
    provenance/                    Apache-2.0 · Tier 0 · sin modelos
      containers · indicators        JPEG, PNG, WebP · C2PA, IPTC, EXIF
      cbor · jumbf · cose · x509     verificación de firma, parseo propio
    extinction-validator/          GPL-3.0 · AISLADO. Etapa de validación heurística
apps/
  extension/                       GPL-3.0 · un fuente, cinco artefactos
    src/platform/                    único lugar con código específico de navegador
chrome_extension/  firefox_extension/  edge_extesion/
opera_extension/   Safari_extension/   ← destinos de build, no código fuente
```

Las reglas de arquitectura no están solo escritas: `packages/kernel/test/architecture.test.ts`
falla el build si el kernel importa algo, si toca una API de navegador, o si la frontera de
licencia con el paquete GPL se rompe.

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

La licencia no es única por decisión de diseño, y la frontera está verificada en CI:

| Componente | Licencia | Motivo |
|---|---|---|
| `@xpx/kernel`, `@xpx/provenance` | Apache-2.0 | Base del SDK comercial. Cero dependencias |
| `@xpx/extinction-validator` | GPL-3.0-or-later | Respeta la licencia del proyecto original |
| Extensión de navegador | GPL-3.0-or-later | Empaqueta el validador |

Pendiente: los términos de Gemma para redistribuir pesos derivados
([`docs/08-riesgos-legales.md`](./docs/08-riesgos-legales.md#5-licencias-de-terceros)).

## Atribuciones

El diseño se apoya en el trabajo público de:

- [`distil-labs/distil-ai-slop-detector`](https://github.com/distil-labs/distil-ai-slop-detector) (Apache-2.0) — motor Tier 2.
- [`Noodulz/dejAIvu`](https://github.com/Noodulz/dejAIvu) — enfoque de saliencia y explicabilidad en imagen.
- [`v81d/extinction`](https://github.com/v81d/extinction) (GPL-3.0) — método estilométrico de la
  etapa de validación, en `packages/detectors/extinction-validator`. Ese paquete es GPL-3.0 y está
  aislado: el kernel no lo importa y el SDK no lo incluye. La extensión sí, y por eso **la
  extensión se distribuye bajo GPL-3.0**. Ver [ADR-010](./docs/adr/ADR-010-extinction-gpl.md) y
  su [NOTICE](./packages/detectors/extinction-validator/NOTICE.md).
