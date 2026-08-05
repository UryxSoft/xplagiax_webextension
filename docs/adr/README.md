# Decisiones de arquitectura (ADR)

Cada ADR registra una decisión, su contexto, las alternativas descartadas y sus consecuencias
—incluidas las malas. Un ADR sin consecuencias negativas listadas está incompleto: significa que
no se evaluó de verdad.

| ADR | Decisión | Estado |
|---|---|---|
| [001](./ADR-001-kernel-puro.md) | Kernel puro sin dependencias de navegador | Propuesto |
| [002](./ADR-002-framework-build.md) | WXT como framework de build multi-navegador | Propuesto |
| [003](./ADR-003-modelos-como-datos.md) | Los pesos son datos descargables, no código empaquetado | Propuesto |
| [004](./ADR-004-runtime-inferencia.md) | ONNX Runtime Web como runtime único | Propuesto |
| [005](./ADR-005-motor-tier2.md) | Selección del motor Tier 2 por medición | Propuesto |
| [006](./ADR-006-evidencia-llr.md) | Evidencia como log-likelihood ratio, no probabilidad | Propuesto |
| [007](./ADR-007-abstencion.md) | La abstención es un estado de primera clase | Propuesto |
| [008](./ADR-008-overlay-no-destructivo.md) | Overlay sin mutar el DOM del host | Propuesto |
| [009](./ADR-009-permisos-progresivos.md) | Sin `host_permissions` en la instalación | Propuesto |
| [010](./ADR-010-extinction-gpl.md) | Extinction como etapa de validación aislada bajo GPL-3.0 | Aceptado |
| [011](./ADR-011-verificacion-c2pa.md) | Verificación de firma C2PA; `valid` no es `trusted` | Propuesto |

La arquitectura fue validada por el titular y el desarrollo está en curso. Las ADR en
**Propuesto** siguen siendo revisables: describen decisiones ya implementadas cuyo dictamen final
—legal en el caso de ADR-010, o de cadena de confianza en ADR-011— sigue pendiente.

## Formato

```markdown
# ADR-NNN · Título
## Estado
## Contexto
## Decisión
## Alternativas consideradas
## Consecuencias
### Positivas
### Negativas
```
