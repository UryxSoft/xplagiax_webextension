# 13 · Estrategia de crecimiento

Cubre los entregables 18, 19 y 20 del brief: crecimiento, adquisición de usuarios y liderazgo
mundial.

---

## 1. La posición desde la que se compite

Casi toda la categoría vende certeza que no tiene. La posición contraria está libre y es
defendible:

> **El único detector que te dice cuándo no lo sabe.**

Esto no es humildad de marca. Es el argumento que abre las puertas que la categoría cerró: las
universidades no retiraron los detectores porque no necesitaran la señal, sino porque la señal
venía sin garantías y producía acusaciones injustas. Quien llegue con control formal del error y
abstención entra donde los incumbentes fueron expulsados.

Cuatro mensajes, en este orden y sin variar:

1. **Local.** Tu contenido no sale de tu dispositivo. Verificable: el código de red es abierto.
2. **Honesto.** Evidencia con intervalos, y abstención cuando no hay base. Publicamos nuestros
   fallos.
3. **Completo.** Procedencia criptográfica + señales estadísticas + multimodal.
4. **En todas partes.** Cinco navegadores, API y SDK.

---

## 2. Fase 1 · Primeros 10.000 usuarios (meses 0–6)

Objetivo: usuarios que **usen** el producto y hablen de él. La métrica de esta fase es retención
D30, no instalaciones.

**Comunidades donde el problema ya duele**, con contribución antes que promoción:

| Comunidad | Ángulo |
|---|---|
| Hacker News | Lanzamiento técnico. El ángulo que funciona es el post de ingeniería sobre calibración y por qué los detectores fallan, con el producto como consecuencia |
| r/Journalism, r/OSINT, verificadores | La herramienta que no sube tu material a un servidor |
| Comunidades de fotografía | C2PA y procedencia. Público que ya entiende el problema |
| r/Teachers, comunidades docentes | El anti-detector: el que se niega a acusar sin base |
| Product Hunt | Lanzamiento coordinado con V1 |

**Contenido que construye autoridad, no tráfico.** Tres piezas fundacionales, en este orden:

1. *"Por qué los detectores de IA fallan con hablantes no nativos, y qué hicimos al respecto"* —
   con nuestros propios números de equidad, incluidos los malos.
2. *"La procedencia gana a la detección: qué es C2PA y por qué lo priorizamos"*.
3. *"Nuestra metodología de calibración"* — página viva, actualizada en cada release.

La tercera es la más importante y la que menos tráfico traerá. Es la que hace que un periodista,
un investigador o un CTO decida que somos serios.

**El corpus abierto como jugada de autoridad.** Publicar un benchmark abierto de evaluación de
detectores —incluyendo casos difíciles y de equidad— y evaluar en él a los competidores **y a
nosotros mismos, con los resultados malos incluidos**. Quien define el estándar de medida de una
categoría acaba definiendo la categoría. Es la jugada con mejor relación coste/posición
disponible, y solo funciona si somos genuinamente transparentes con nuestros propios fallos.

---

## 3. Fase 2 · A 250.000 (meses 6–18)

**Bucle principal: el Informe de Confianza.** Cada informe exportado en el plan gratuito lleva
marca y enlace, y es un artefacto que existe para ser compartido: en un artículo, en un hilo, en
un canal de Slack. Se instrumenta la atribución de instalaciones a informes desde el día uno,
porque este bucle es la hipótesis H4 del MVP y hay que saber pronto si funciona.

**SEO de intención de producto.** No "qué es la IA generativa". Consultas donde el usuario ya
tiene el problema: *detectar imagen generada por IA*, *verificar si un texto es de ChatGPT*,
*comprobar credenciales C2PA*. Y una herramienta web gratuita —pegar texto, ver el análisis— que
capta esa intención y convierte a instalación.

**Optimización de ficha en cinco tiendas.** Es el canal más infravalorado de la categoría. La
Chrome Web Store envía tráfico de intención altísima y gratis. Se trata como SEO serio:
palabras clave en el título y la descripción, capturas que muestren el producto real, vídeo corto,
gestión activa de reseñas, y actualizaciones frecuentes (que la tienda premia).

**Integraciones que amplían la superficie.** Un bot que analiza enlaces bajo demanda en Slack,
Discord y Telegram. Una acción de GitHub que verifica contenido en pull requests. Cada
integración es a la vez distribución y demostración de la API.

**Prensa con ángulo, no con lanzamiento.** Un lanzamiento de producto no es noticia. Sí lo es un
informe periódico —*Estado del contenido generado en la web*— construido sobre nuestro rastreador
propio con metodología publicada. Es citable, es recurrente, y convierte a la empresa en la fuente
que los medios llaman cuando escriben sobre el tema.

---

## 4. Fase 3 · Capa de infraestructura (meses 18–36)

Aquí el crecimiento deja de ser de usuarios y pasa a ser de **integraciones**.

- **API y SDK** como producto principal. El objetivo es que aparezcamos en la arquitectura de
  otros productos, no solo en el navegador de personas.
- **Alianzas de plataforma.** CMS (WordPress, Ghost), plataformas educativas, herramientas de
  moderación, marketplaces de UGC. Cada una expone la tecnología a un orden de magnitud más de
  contenido.
- **Estándares.** Participación activa en C2PA y en los grupos de trabajo de procedencia. Quien
  está en la mesa donde se escribe el estándar tiene una ventaja que no se compra con marketing.
- **Programa académico.** Acceso gratuito para investigación a cambio de evaluación independiente
  publicada. Genera validación externa, que es la única que convence al comprador institucional.

---

## 5. Métricas por fase

| Fase | Métrica principal | Métrica de contrapeso |
|---|---|---|
| 1 | Retención D30 | Desinstalaciones por rendimiento |
| 2 | Usuarios activos semanales | Ratio de falsos positivos reportados |
| 3 | Integraciones en producción | Disponibilidad de la API |

La métrica de contrapeso existe para impedir que se optimice la principal deteriorando el
producto. Ninguna decisión de crecimiento se aprueba si empeora su contrapeso.

**La métrica que gobierna todo lo demás:** *tasa de falsos positivos reportados por usuarios*. Si
sube, se detiene el crecimiento y se arregla. Un producto de confianza que crece mientras pierde
precisión está construyendo su propia crisis a mayor escala.

---

## 6. Cómo se convierte esto en el líder mundial

Cuatro condiciones. Ninguna es suficiente sola, y las cuatro se refuerzan:

**1 · Ser el estándar de medida.** El benchmark abierto y el informe periódico sobre el estado del
contenido generado convierten a la empresa en el árbitro de la categoría. Los competidores acaban
citando nuestras métricas, que es la posición desde la que se define un mercado.

**2 · Ser la capa que otros integran.** Un usuario se va cuando aparece algo mejor. Una plataforma
que ha integrado el SDK no se va: tiene coste de cambio, contratos y dependencia técnica. El
trayecto de referencia es Stripe, Twilio o Plaid — infraestructura invisible y difícil de
sustituir.

**3 · Tener el foso de datos correcto.** No el contenido de los usuarios, que no tendremos nunca.
El **corpus de calibración**: falsos positivos reportados voluntariamente, contenido etiquetado
por procedencia verificada, muestreo longitudinal del rastreador. Ese corpus mejora cada mes, es
específico de nosotros y no se puede comprar.

**4 · Ser el único en el que se puede confiar.** Código abierto de las partes críticas, builds
reproducibles, auditorías publicadas, metodología pública, y disposición a publicar los propios
fallos. En una categoría cuya reputación está dañada, la confianza es la barrera de entrada más
alta que existe — y la única que un competidor con más capital no puede superar contratando
ingenieros.

La consecuencia práctica: cada decisión que sacrifique confianza por crecimiento a corto plazo
destruye más valor del que crea. Esa es la regla que debe sobrevivir a la primera ronda de
financiación, cuando aparezca la presión para relajarla.
