# ADR-003 · Los pesos son datos descargables, no código empaquetado

## Estado
Propuesto

## Contexto

Tier 1 pesa unos 48 MB y Tier 2 unos 242 MB (Gemma 3 270M en Q4_K_M). El límite de subida de la
Chrome Web Store es 2 GB, así que empaquetarlos es técnicamente posible.

También hay una restricción crítica: **Manifest V3 prohíbe la ejecución de código remoto.** Toda
la lógica ejecutable debe estar en el paquete. La pregunta es si los pesos de un modelo cuentan
como código.

No lo son. Los pesos son datos que un intérprete empaquetado (ONNX Runtime Web, wllama —ambos
WASM incluidos en el paquete) consume. Esta distinción es la que hace viable toda la arquitectura,
y conviene documentarla explícitamente para el revisor de cada tienda.

## Decisión

Los binarios WASM del runtime **se empaquetan**. Los pesos de los modelos **se descargan** tras la
instalación desde un CDN propio, se verifican y se almacenan en OPFS.

Cada modelo lleva un manifiesto firmado con:
- SHA-256 por fichero,
- firma sobre el conjunto de hashes,
- `calibrationId` que ata el modelo a su curva de calibración,
- lista de idiomas validados,
- versión mínima de runtime.

Un modelo que no verifica hash **y** firma no se instancia. No hay forma de omitir la comprobación,
ni siquiera en desarrollo.

## Alternativas consideradas

**Empaquetar Tier 1 y descargar solo Tier 2.** Tentadora: elimina la fricción de la primera
descarga. Rechazada porque ata las mejoras de modelo al ciclo de revisión de cinco tiendas, que es
justamente lo que hay que evitar (ver [ADR-005](./ADR-005-motor-tier2.md) y el riesgo R-07).

**Empaquetar todo.** Paquete de ~290 MB, revisión lenta en todas las tiendas, actualizaciones
completas por cada cambio de pesos, y una descarga enorme impuesta a todos los usuarios incluidos
los que solo quieren procedencia. Rechazada.

**Servir los modelos desde Hugging Face directamente.** Rechazada: dependencia de disponibilidad
de un tercero en la ruta crítica, sin control sobre integridad ni sobre las cabeceras necesarias.
Se hace mirror propio.

## Consecuencias

### Positivas
- Paquete por debajo de 10 MB. Revisión rápida en las cinco tiendas.
- Un modelo mejor llega a los usuarios en horas, no en semanas.
- El usuario solo descarga lo que va a usar. Tier 0 funciona sin ninguna descarga.
- Habilita A/B testing de modelos, rollback local y registro privado en Enterprise sin cambios de
  arquitectura.
- Actualización diferencial por fichero.

### Negativas
- La primera experiencia con Tier 1 exige una descarga de 48 MB, con su fricción y su tasa de
  abandono. Mitigado porque Tier 0 aporta valor inmediato.
- Hay que operar y pagar un CDN con disponibilidad alta.
- Se añade complejidad real: verificación, reanudación, gestión de cuota, rollback, versionado.
- Requiere explicar la distinción datos/código en el envío a cada tienda. Un revisor puede
  interpretarlo mal y hay que estar preparado para argumentarlo.
