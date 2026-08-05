# Cambios — del kernel a una extensión que carga en un navegador real

Base: `d659185` (merge de la PR #1). Cuatro commits. Sin push.

```bash
git am 0001-*.patch 0002-*.patch 0003-*.patch 0004-*.patch
pnpm install
pnpm test        # 248 en verde
pnpm typecheck   # limpio
pnpm build       # publica las 5 extensiones
```

Luego, en Chrome: `chrome://extensions` → modo desarrollador → **Cargar
descomprimida** → apunta a `chrome_extension/`.

---

## ¿Se puede probar ya en un navegador? Sí y no

**Sí carga**, y lo he verificado en Chromium real, no de palabra:

```
✓ el service worker se registra
✓ el manifiesto es MV3
✓ los textos se resuelven desde _locales
✓ sin host_permissions en la instalación
✓ el documento offscreen arranca
✓ el texto recorre service worker → offscreen → kernel
✓ sin detector de texto, el kernel se abstiene
✓ los bytes crudos sobreviven al puerto (regresión base64)
✓ una imagen sin credenciales no se vuelve sospechosa
```

Esa prueba está en el repositorio: `apps/extension/e2e/smoke.mjs`, con
`pnpm --filter @xpx/extension test:e2e`.

**Pero no vas a ver nada.** No hay content script, ni popup, ni overlay. La
extensión carga, el service worker arranca y se queda esperando una petición
que nadie hace. Para observarla hoy hay que inspeccionar el service worker
desde `chrome://extensions` y hablar con el puerto a mano, que es exactamente
lo que hace el smoke test.

Faltan tres piezas para que sea observable:

1. **Content script** — extraer bloques del DOM y pedir el análisis (hito S4).
2. **Overlay** — pintar el resultado en shadow root cerrado (S7).
3. **Popup** — el Trust Score y los dos switches (S8).

---

## El fallo que solo apareció en el navegador

Merece contarse porque cambia cómo hay que probar esto.

`chrome.runtime` **serializa los mensajes como JSON**, no con structured clone.
Un `Uint8Array` no sobrevive: llega al otro extremo como `{"0":137,"1":80,…}`.
El validador lo rechazaba correctamente, así que la única modalidad que hoy
produce evidencia real —la procedencia, que necesita los bytes crudos— estaba
rota de punta a punta. El texto sí funcionaba, que es lo que lo hacía difícil
de ver.

El doble de puerto de los tests usaba `structuredClone`, que **sí** preserva los
tipados, y por eso lo ocultaba. Un doble siempre es una hipótesis sobre el
navegador, y esa era falsa. Ahora serializa por JSON, igual que Chrome, y el
binario viaja en base64 con `toWire`/`fromWire` en las fronteras.

Del mismo tirón salió un segundo fallo: `portTransport` reconocía lo que debía
propagar y se tragaba el resto, con lo que una carga circular acababa como
petición que jamás vuelve — justo lo que ese `catch` pretendía evitar. Ahora
reconoce lo benigno (puerto caído) y deja salir lo desconocido.

---

## Lo que sigue sin existir, y conviene no olvidarlo

**No hay detector de texto.** El registro planea cero detectores para texto, así
que el kernel se abstiene siempre con `NO_EVIDENCE`. Está fijado por test a
propósito. Es la respuesta correcta mientras no haya un detector calibrado —un
llr sin su conjunto de calibración no significa nada— pero significa que hoy la
extensión no detecta texto generado. Las imágenes sí dan evidencia real por
procedencia.

**`pnpm lint` sigue roto**, de antes: el script es `eslint .` y no hay ni
configuración de ESLint ni la dependencia. Es el único punto de `pnpm check`
que no pasa.

**No hay CI.** No existe `.github/workflows/`.

---

## Estado frente al plan del MVP

| Hito | Estado |
|---|---|
| S1 · fundamentos y build | build instalable en 5 navegadores; faltan ESLint y CI |
| S2 · contratos del kernel | completo |
| S3 · procedencia | completo, y verificado en navegador real |
| S4 · estilometría + content script | normalización lista; **faltan el detector y la extracción del DOM** |
| S5 · RuntimeHost, Workers, ORT | host y cableado completos; faltan Workers, ORT y ModelManager |
| S6–S10 | sin empezar |

## Siguiente paso recomendado

El **content script** (S4, segunda mitad): extracción de bloques visibles,
normalización —ya escrita— y petición por el canal `analyze`. Es lo más barato
que convierte «carga pero no se ve nada» en «se ve funcionar», y no depende de
tener detector de texto: sobre imágenes ya daría veredictos reales.
