# Cambios — ya se puede ver funcionar en un navegador

Base: `d659185` (merge de la PR #1). Cinco commits. Sin push.

```bash
git am 0001-*.patch 0002-*.patch 0003-*.patch 0004-*.patch 0005-*.patch
pnpm install
pnpm test        # 278 en verde
pnpm typecheck   # limpio
pnpm build       # publica las 5 extensiones
```

## Cómo probarlo

1. Chrome → `chrome://extensions` → activa **Modo de desarrollador**.
2. **Cargar descomprimida** → selecciona `chrome_extension/`.
3. Abre cualquier artículo y **pulsa el icono de la extensión**.
4. Pulsa «Analizar esta página». El resumen aparece abajo a la derecha.

`insignia.png` y `popup-claro.png` en este mismo tar son capturas reales,
hechas en Chromium con la extensión cargada.

**El paso 3 no es opcional.** Pulsar el icono es lo que concede `activeTab`;
sin ese gesto la extensión no puede tocar la página. Es el nivel 1 de ADR-009,
y por eso no se declara ningún `content_scripts`: hacerlo pediría permiso de
host en la instalación y dispararía el aviso de «leer y cambiar todos tus datos
en todos los sitios web».

## Qué vas a ver, y qué no

**Vas a ver** el resumen con el número de bloques analizados y su distribución
por bandas. En una página normal dirá «Evidencia insuficiente» para todo.

**Eso no es un fallo.** No hay detector de texto todavía, así que el kernel se
abstiene siempre con `NO_EVIDENCE`. La insignia lo dice explícitamente, porque
callarlo haría pensar que el texto salió limpio cuando lo que pasa es que aún
no hay quien lo examine.

Para ver un veredicto **distinto** hace falta una imagen con credenciales C2PA
—el detector de procedencia sí funciona— o esperar al detector estilométrico.

Dos limitaciones más, conocidas y documentadas en el código:

- Las imágenes de un CDN sin CORS abierto no se pueden descargar desde la
  página y quedan fuera del análisis. Es una consecuencia del nivel 1 de
  permisos, no un error.
- La insignia no resalta pasajes ni se superpone a las imágenes. Eso es el
  motor de overlay, hito S7.

## Qué trae cada commit

1. **IPC tipado y host offscreen** — RPC sobre `Transport` abstracto, cero
   dependencias; documento offscreen con la carrera de arranque de MV3 y la
   caída del puerto resueltas.
2. **Servidor de inferencia y contrato de cable** — impone en código que un
   content script no pueda pedir inferencia; validadores de la frontera.
3. **Entrypoints y build instalable** — arreglados tres fallos previos que lo
   impedían: `--outDir` inexistente en wxt, `default_locale` sin `_locales`, y
   Firefox/Safari construyéndose como MV2.
4. **Arreglo del binario** — `chrome.runtime` serializa como JSON, no con
   structured clone: un `Uint8Array` no sobrevive. Rompía la única modalidad
   con evidencia real. Encontrado cargando la extensión en Chromium, no en los
   tests; el doble de puerto usaba `structuredClone` y lo ocultaba.
5. **S4** — extracción del DOM, insignia en página y popup.

## Decisiones de la S4 que conviene conocer

**Agrupar, no trocear.** El kernel se abstiene por debajo de 150 tokens y un
`<p>` real ronda los 40. Enviar párrafo a párrafo habría producido abstención
en el 100 % de los casos. Se agrupan hermanos contiguos, y el grupo se corta
cuando cambia la naturaleza del contenido: mezclar un artículo con sus
comentarios daría un veredicto sobre algo que no existe, ni lo uno ni lo otro
sino su promedio.

**No se lee lo que el usuario está escribiendo.** `contenteditable`, campos de
formulario y los editores conocidos por host se saltan enteros.

**ADR-008 ya se respeta** en lo irrenunciable: una sola inserción, shadow root
cerrado y `dispose()` que deja la página como estaba. Verificado en Chromium:
0 atributos añadidos al artículo, shadow inaccesible desde la página.

## Lo que sigue roto o ausente

- **`pnpm lint`**: el script es `eslint .` y no hay ni configuración ni
  dependencia. Único punto de `pnpm check` que falla.
- **No hay CI**: no existe `.github/workflows/`.
- **No hay detector de texto** (S4 primera mitad). Necesita corpus para
  calibrar; sin él solo se pueden inventar números.

## Estado frente al MVP

| Hito | Estado |
|---|---|
| S1 · fundamentos y build | build instalable en 5 navegadores; faltan ESLint y CI |
| S2 · contratos del kernel | completo |
| S3 · procedencia | completo, verificado en navegador real |
| S4 · estilometría + content script | **content script completo**; falta el detector estilométrico |
| S5 · RuntimeHost, Workers, ORT | host y cableado completos; faltan Workers, ORT y ModelManager |
| S7 · overlay | insignia mínima; falta el motor real |
| S8 · popup | popup mínimo; faltan Opciones y Dashboard |
