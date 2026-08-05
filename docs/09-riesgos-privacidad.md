# 09 · Riesgos de privacidad

La privacidad es el argumento de venta principal. Eso significa que un solo incidente destruye el
producto entero — no una funcionalidad, el producto. Este documento existe para que no haya
ninguna decisión de privacidad tomada por defecto o por descuido.

---

## 1. Amenaza que se defiende

Una extensión con permiso de host global ve **todo**: correo, banca, historial clínico,
documentos internos, mensajes privados. Es una de las posiciones más privilegiadas del ecosistema
del software de consumo. El mercado de extensiones comprometidas o vendidas a agregadores de datos
existe precisamente por eso.

XplagiaX pide exactamente ese privilegio. La única razón defendible para concederlo es que la
arquitectura haga **imposible**, no improbable, el abuso.

---

## 2. Principios operativos

| # | Principio | Cómo se hace verificable |
|---|---|---|
| 1 | El contenido nunca sale del dispositivo | Sin acceso a red desde el content script; auditoría del código de red |
| 2 | Lo que no se guarda no se puede filtrar | Se persisten hashes y agregados, nunca texto |
| 3 | Los Workers no saben en qué sitio están | La URL no cruza esa frontera. Correlación imposible |
| 4 | Opt-in significa desactivado por defecto | Estado inicial verificado por test |
| 5 | El usuario puede ver el payload exacto | Vista previa de telemetría en Opciones, con datos reales |
| 6 | Borrar es una acción, no un proceso | Un botón, sin retención, sin diálogos disuasorios |

---

## 3. Riesgos y mitigaciones

### P-01 · Fuga de contenido a través de la telemetría · P3 I5

Un campo añadido sin pensar (una URL para depurar, un fragmento de texto en un mensaje de error)
convierte la telemetría anónima en un registro de navegación.

**Mitigación.** Esquema de telemetría cerrado y versionado, con lista blanca de campos. Test en CI
que **falla el build** si aparece un campo fuera de la lista o si un valor coincide con patrones
de URL, correo o texto libre. Los errores se reportan con código y traza, con el mensaje
saneado y sin argumentos. Revisión obligatoria de un segundo ingeniero para cualquier cambio en el
esquema.

### P-02 · Reidentificación por telemetría · P3 I4

Aunque no haya identificador, la combinación de versión, plataforma, idioma, tier y patrón horario
puede singularizar a un usuario.

**Mitigación.** Cohortes en lugar de identificadores (`installBucket` semanal). Agregación de
métricas en ventanas, no eventos individuales. Muestreo probabilístico. Sin timestamp preciso: solo
la ventana. La IP se descarta en el borde antes de persistir, y eso se documenta en la política de
privacidad con el nombre del proveedor.

### P-03 · Fingerprinting de la extensión por parte de los sitios · P4 I3

Un sitio puede detectar la presencia de la extensión —por recursos web accesibles, por el nodo
inyectado, por temporización— y usarla como señal de rastreo. También puede usarla para
discriminar: un sitio que genera contenido con IA podría ocultarlo al detectar la extensión.

**Mitigación.** `web_accessible_resources` mínimo y restringido por `matches`. Nodo raíz con
nombre no adivinable por instalación y **shadow root cerrado**, que impide a la página leer su
contenido. Sin atributos identificativos en el DOM del host. Se acepta que la eliminación total
del fingerprinting no es posible; se minimiza y se documenta como limitación conocida.

### P-04 · Análisis en contextos sensibles · P4 I5

Analizar la página del banco, el portal sanitario o el correo del trabajo, aunque sea localmente,
es indefendible frente al usuario.

**Mitigación.** Lista de exclusión embebida y no desactivable (ver
[`06-modelo-de-permisos.md`](./06-modelo-de-permisos.md#7-exclusiones-no-negociables)). Pausa
automática cuando hay un campo de contraseña con foco. Análisis del correo web y de documentos
solo **bajo demanda explícita**, nunca automático, por muy amplio que sea el permiso concedido.

### P-05 · Historial local como superficie de ataque · P3 I4

Un historial local de páginas analizadas es un objetivo para malware, para el análisis forense de
un dispositivo confiscado, o para alguien con acceso físico.

**Mitigación.** Solo hashes y agregados, nunca texto ni URL completas — el dashboard funciona con
dominios y contadores. Retención por defecto de 90 días. Modo incógnito propio: analizar sin
escribir. Cifrado en reposo del historial con clave derivada de una frase de paso opcional, para
usuarios en riesgo (periodistas, activistas). Purga automática en ventanas de incógnito del
navegador.

### P-06 · Informes compartidos que filtran más de lo previsto · P3 I4

El bucle de crecimiento se apoya en informes compartibles. Un informe puede incluir URL, capturas
o fragmentos que el usuario no pretendía publicar.

**Mitigación.** Vista previa obligatoria antes de compartir, mostrando **exactamente** lo que será
público. Selección granular de qué se incluye. Enlaces con caducidad configurable y revocables.
Por defecto, privado; compartir es siempre una acción deliberada. Nunca se indexa sin
consentimiento (`noindex` por defecto).

### P-07 · Cadena de suministro · P3 I5

Una dependencia comprometida en una extensión con permisos amplios es un escenario de desastre.

**Mitigación.** Dependencias fijadas con lockfile y verificación de integridad. Mínimo número de
dependencias en runtime; cero dependencias externas en el kernel. Builds reproducibles y
publicación de hashes de los artefactos. Escaneo automático en CI. Los pesos y binarios WASM se
sirven desde mirror propio con SHA-256 y firma verificados en cliente. Publicación desde CI con
credenciales de un solo uso, nunca desde un portátil.

---

## 4. Lo que el producto no hará nunca

Compromisos públicos, escritos en la web y en la ficha de las tiendas. Romper cualquiera de ellos
es motivo de crisis, y por eso se escriben antes de tener presión comercial para incumplirlos:

- No enviar contenido de páginas a ningún servidor sin acción explícita del usuario en ese momento.
- No vender, ceder ni compartir datos de usuarios con terceros, en ninguna forma, incluida la
  agregada.
- No incluir publicidad ni redes de afiliación.
- No aceptar pago por rebajar la puntuación de un dominio.
- No permitir a un administrador de empresa activar la exfiltración de contenido de sus empleados.
- No construir la reputación de dominios con la navegación de los usuarios.

---

## 5. Reputación de dominios sin vigilar a nadie

El brief pide un sistema de reputación de dominios basado en la proporción histórica de contenido
detectado como IA. La forma obvia de construirlo —agregando lo que ven los usuarios— es
**vigilancia**, por muy anónima que se declare: convierte a los usuarios en un panel de medición
involuntario y crea exactamente el registro de navegación que el producto promete no crear.

**Diseño alternativo, mismo valor y sin ese coste:**

- Un **rastreador propio** del lado servidor analiza páginas públicas con el mismo kernel.
  Respeta `robots.txt`, se identifica, limita la tasa, y conserva solo señales derivadas.
- La reputación se calcula sobre esa muestra, con **metodología y tamaño muestral publicados**.
- Los editores pueden consultar su puntuación, ver la muestra e impugnarla.
- Los usuarios pueden **contribuir voluntariamente** una URL concreta al corpus, con un clic y
  sabiendo qué hacen. Contribución activa, no pasiva.

Ventaja secundaria: la muestra es reproducible y auditable, lo que hace la reputación defendible
frente a una impugnación legal. La versión basada en telemetría no lo sería.

---

## 6. Aprendizaje federado

Postura del consejo: **es la función de mayor riesgo del roadmap y la de menor retorno
demostrado.** Los gradientes filtran información sobre los datos de entrenamiento; existe
literatura extensa de ataques de inversión de gradientes.

Condiciones sin las cuales no se implementa, todas simultáneas:

1. Privacidad diferencial con presupuesto ε **publicado** y justificado.
2. Agregación segura, de modo que el servidor no vea contribuciones individuales.
3. Auditoría externa independiente antes del despliegue.
4. DPIA completa.
5. Opt-in doble, con explicación en lenguaje llano de qué se comparte y qué puede inferirse.
6. Exclusión automática de cualquier contenido de dominios sensibles.

Si una sola no se cumple, la función no se lanza. La alternativa de menor riesgo, que se
implementa primero, es el **feedback explícito**: el usuario marca un falso positivo y decide si
envía el ejemplo. Consentimiento por acto, no por configuración. Con volumen suficiente, esa señal
mejora la calibración casi tanto y sin ninguno de los seis requisitos anteriores.

---

## 7. Verificabilidad

Prometer privacidad no vale nada sin forma de comprobarla. Compromisos:

- **Código abierto de las partes críticas**: kernel, detectores, capa de red y esquema de
  telemetría. Cualquiera puede auditar qué sale del dispositivo.
- **Builds reproducibles** con hashes publicados, para que el artefacto de la tienda sea
  verificable contra el código.
- **Auditoría de seguridad externa** antes del lanzamiento público, con informe publicado.
- **Warrant canary** y política de transparencia sobre requerimientos legales.
- Un `security.txt` y un proceso de divulgación responsable con plazo de respuesta comprometido.

Esto no es marketing: es la condición para que la afirmación central del producto sea comprobable
por alguien que no confíe en nosotros. Que es, precisamente, el usuario al que apuntamos.
