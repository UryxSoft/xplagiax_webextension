# ADR-011 · Verificación de firma C2PA y el significado de "confirmado"

## Estado
Propuesto — implementada la verificación de firma; pendiente la cadena de confianza

## Contexto

El detector de procedencia sabía encontrar manifiestos C2PA, pero no comprobarlos. Eso deja un
agujero grave: **una caja JUMBF la incrusta cualquiera.** Un generador de imágenes podría añadir
un manifiesto que declare "capturado con una Leica" y, sin verificación, el producto lo creería.

Peor todavía: sería un ataque dirigido contra nuestra propia regla de diseño. La procedencia es
evidencia dominante en el motor de fusión precisamente porque asumimos que es criptográfica. Si
no se verifica, la señal más fuerte del sistema es también la más fácil de falsificar.

## Decisión

Se implementa la verificación completa de la firma, con parseo propio de cada capa:

| Capa | Módulo | Por qué propio |
|---|---|---|
| CBOR (RFC 8949) | `cbor.ts` | Subconjunto pequeño; una dependencia aquí es superficie de ataque |
| JUMBF (ISO 19566-5) | `jumbf.ts` | Cajas ISO BMFF, cien líneas |
| COSE_Sign1 (RFC 9052) | `cose.ts` | La Sig_structure hay que reconstruirla exacta |
| X.509 (SPKI y validez) | `x509.ts` | Solo dos campos; no es una librería de X.509 |

WebCrypto se **inyecta** como `CryptoProvider`. El paquete no asume navegador ni Node, coherente
con ADR-001.

### Tres estados, no dos

```
unsigned  no hay firma que comprobar
invalid   hay firma y NO cuadra  → señal de MANIPULACIÓN
valid     la firma es criptográficamente correcta
```

`invalid` es el estado que más importa y el que un diseño binario se pierde. No dice nada sobre
si el contenido lo generó una IA: dice que **alguien alteró el fichero después de firmarlo**. Es
la señal más fuerte que produce el sistema, y sustituye al resto de evidencia en lugar de
promediarse con ella.

### `valid` no es `trusted`

Una firma válida prueba que quien firmó posee la clave privada del certificado incrustado. Ese
certificado puede ser autofirmado por cualquiera. Confiar en él exige validar la cadena contra la
lista de confianza de C2PA, que no está implementada.

Mientras eso falte, `trusted` es siempre `false` y el detector **no alcanza `reliability: 1`**,
que es lo único que activa la banda `PROVENANCE_CONFIRMED`. El techo actual es 0,9.

Es la decisión incómoda y la correcta: tenemos verificación criptográfica funcionando y aun así
no anunciamos certeza, porque la certeza requiere saber *quién* firmó, no solo que la firma
cuadra. Hay un test que fija este límite para que nadie lo suba por descuido.

## Alternativas consideradas

**Usar la librería oficial `c2pa-js`.** Correcta y mantenida. Rechazada por ahora: arrastra WASM
y dependencias a la ruta crítica de un Tier 0 cuyo presupuesto es de milisegundos, y el
subconjunto que necesitamos son unos cientos de líneas auditables. Se reevalúa cuando toque
validar cadenas, donde la complejidad sí justifica la dependencia.

**Tratar la presencia de manifiesto como confirmación.** Es lo que haría un producto que quiere
enseñar un sello bonito. Rechazada: convierte la señal más fuerte en la más falsificable.

**Aceptar RS256.** Rechazada: PKCS#1 v1.5 no está en el perfil de C2PA y admitirlo amplía la
superficie sin ganar compatibilidad real.

## Consecuencias

### Positivas
- La procedencia deja de ser falsificable con un editor hexadecimal.
- Se gana la detección de manipulación, que ningún competidor de consumo ofrece.
- Sin dependencias nuevas: el detector sigue siendo Tier 0 y de coste despreciable.
- Los parseadores están endurecidos contra entrada hostil —profundidad, contadores acotados,
  truncado byte a byte— y probados con ello.

### Negativas
- Cuatro parseadores de formatos binarios que mantener. Es código de seguridad y necesita
  revisión externa antes de producción.
- Sin cadena de confianza, `PROVENANCE_CONFIRMED` sigue siendo inalcanzable: la banda existe pero
  todavía no se emite nunca.
- La lista de confianza de C2PA hay que distribuirla y actualizarla, con su propia gestión de
  versiones e integridad. Es trabajo pendiente y no trivial.
