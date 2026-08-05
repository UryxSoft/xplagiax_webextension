# ADR-009 · Sin `host_permissions` en la instalación

## Estado
Propuesto

## Contexto

Para analizar automáticamente las páginas que visita el usuario —requisito explícito del brief—
hace falta permiso de host amplio. Pedirlo en la instalación es lo simple: el código se
simplifica, el análisis funciona desde el primer segundo.

También produce el aviso más agresivo del ecosistema: *"Leer y cambiar todos tus datos en todos
los sitios web"*, mostrado justo antes de instalar, en un producto cuyo argumento central es la
privacidad. La contradicción es visible para el usuario en el peor momento posible, y además
dispara revisión manual prolongada en las cinco tiendas.

## Decisión

**Cero `host_permissions` en el manifiesto.** Escalada progresiva en tres niveles:

| Nivel | Concesión | Gesto | Resultado |
|---|---|---|---|
| 1 | Ninguna persistente | Pulsar el icono | `activeTab`: esta pestaña, esta vez |
| 2 | Un origen | "Analizar siempre este sitio" | Automático en ese dominio |
| 3 | Global | Interruptor en Opciones, con explicación | Automático en toda la web |

`optional_host_permissions` declara `http://*/*` y `https://*/*`, solicitados con
`permissions.request()` desde un gesto del usuario. Nunca de forma programática al arrancar.

El nivel 1 es el estado inicial **y es un producto completo por sí mismo**. El análisis automático
que pide el brief se alcanza en los niveles 2 y 3, cuando el usuario ya ha comprobado que la
herramienta le sirve.

La sugerencia de pasar a global aparece **una sola vez**, tras autorizar tres sitios. Si se
rechaza, no vuelve.

## Alternativas consideradas

**Pedir `<all_urls>` en la instalación.** Lo que hace casi toda la categoría. Rechazada: contradice
el posicionamiento, empeora la conversión de instalación y ralentiza la revisión en las tiendas.

**Solo `activeTab`, sin escalada.** Máxima privacidad. Rechazada: elimina el análisis automático,
que es un requisito del brief y una parte real del valor.

**Lista predefinida de dominios frecuentes.** Rechazada: arbitraria, difícil de justificar ante un
revisor, y con un aviso de instalación igualmente largo.

## Consecuencias

### Positivas
- Aviso de instalación mínimo. Es una ventaja de conversión medible, no solo una postura ética.
- Revisión más rápida y con menos fricción en las cinco tiendas (mitigación principal del riesgo
  R-06).
- El permiso se concede cuando el usuario ya entiende para qué sirve, que es cuando el
  consentimiento significa algo.
- La afirmación de privacidad se vuelve verificable desde el propio manifiesto: cualquiera puede
  comprobar qué pedimos.

### Negativas
- Código más complejo: hay que gestionar tres estados de permiso, inyección programática con
  `scripting`, y revocación en cualquier momento.
- El usuario tarda más en llegar a la experiencia completa; parte no llegará nunca al nivel 3.
- Safari tiene un modelo de permisos menos granular y no admite bien la escalada intermedia; se
  acepta una experiencia degradada allí antes que rebajar el modelo en las otras cuatro
  plataformas.
- Hay que instrumentar y vigilar la tasa de escalada, que se convierte en una métrica de producto
  de primer orden.
