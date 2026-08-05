# Artefacto de build — Microsoft Edge

**Este directorio no contiene código fuente.** Es el destino del build.

El código vive en `apps/extension/`, una sola base para los cinco navegadores.
Lo específico de cada plataforma está aislado en `apps/extension/src/platform/`,
detrás de la interfaz `RuntimeHost`.

## Generar el contenido de este directorio

```bash
pnpm --filter @xpx/extension build:edge
```

## Por qué no hay una versión distinta por navegador

Mantener cinco copias del código produciría cinco bases que divergen y, lo que
importa más, **cinco calibraciones distintas**. La calibración es la propuesta de
valor del producto: no puede variar según el navegador que use la persona.

Lo que se duplica es el artefacto, no la fuente. Ver
[`docs/03-arquitectura.md`](../docs/03-arquitectura.md#21-relación-con-los-directorios-por-navegador-que-ya-existen-en-el-repo).
