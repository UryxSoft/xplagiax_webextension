/**
 * Construcción del prompt e interpretación de la salida.
 *
 * Se aísla del resto porque es la parte que hay que replicar EXACTAMENTE como
 * la usaron los autores del modelo. Un modelo destilado se entrena contra un
 * formato concreto; cambiar el prompt cambia el comportamiento sin avisar, y no
 * hay forma de notarlo salvo midiendo. Todo lo de aquí sale de `offscreen.js`
 * del repositorio original (Apache-2.0).
 */

export const AI_LABEL = 'ai_generated';
export const HUMAN_LABEL = 'human_written';

/**
 * Límite del texto enviado al modelo.
 *
 * 1500 caracteres es lo que usa el original. No es un valor arbitrario que
 * convenga "mejorar": el modelo se entrenó y evaluó con fragmentos de ese
 * orden, y alargarlo lo saca de su distribución.
 */
export const MAX_CHARS = 1500;

/** Formato de turnos de Gemma. Los delimitadores no son decorativos. */
export function buildPrompt(text: string): string {
  const fragment = text.slice(0, MAX_CHARS);
  return `<start_of_turn>user
Classify this text as exactly 'ai_generated' or 'human_written':

"${fragment}"

Respond with ONLY one of these two words: ai_generated or human_written
<end_of_turn>
<start_of_turn>model
`;
}

/**
 * Muestreo determinista. Un detector que devuelve veredictos distintos para el
 * mismo texto no es auditable, así que la temperatura es 0 y no se expone como
 * opción.
 */
export const SAMPLING = {
  temperature: 0,
  top_k: 1,
  top_p: 1,
  repeat_penalty: 1.1,
} as const;

export const STOP_SEQUENCES: readonly string[] = [
  '<end_of_turn>',
  '<start_of_turn>',
  '\n',
  '.',
  ' ',
];

export type Label = 'ai_generated' | 'human_written' | 'uncertain';

/**
 * Interpreta el texto generado. El modelo casi siempre responde con la etiqueta
 * exacta, pero "casi siempre" no es "siempre": cuando no se reconoce, la
 * respuesta es `uncertain`, que aguas arriba se traduce en abstención. Inventar
 * una etiqueta por defecto sería fabricar evidencia.
 */
export function parseLabel(raw: string): Label {
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes(AI_LABEL) || normalized.startsWith('ai')) return AI_LABEL;
  if (normalized.includes(HUMAN_LABEL) || normalized.startsWith('human')) return HUMAN_LABEL;
  return 'uncertain';
}

/**
 * Probabilidad de "generado por IA" a partir de las log-probabilidades del
 * primer token generado.
 *
 * Esto es lo que el original no hace: se limita a la etiqueta y comenta
 * explícitamente que no quiere inventar puntuaciones de confianza. Tiene razón
 * en no inventarlas — pero sí existe una señal real que no está usando. El
 * primer token decide entre "ai" y "human", y su distribución es una medida
 * genuina de cuán cerca estuvo la decisión.
 *
 * Se normaliza sobre los dos candidatos en lugar de sobre el vocabulario
 * entero, porque lo que interesa es la decisión binaria condicionada a que el
 * modelo responda con una de las dos etiquetas.
 *
 * Devuelve `undefined` si la salida no permite decidir: sin logprobs, o con los
 * dos candidatos ausentes del top-k. Ese `undefined` es información, no un
 * fallo, y quien llama debe degradar a la etiqueta.
 */
export function probabilityFromLogprobs(
  topLogprobs: Readonly<Record<string, number>> | undefined,
): number | undefined {
  if (topLogprobs === undefined) return undefined;

  let aiMass = 0;
  let humanMass = 0;
  for (const [token, logprob] of Object.entries(topLogprobs)) {
    const t = token.toLowerCase().trim();
    if (t.length === 0) continue;
    // El primer token de "ai_generated" puede llegar troceado ("ai", "_ai"...).
    if (t.startsWith('ai') || t.startsWith('_ai')) aiMass += Math.exp(logprob);
    else if (t.startsWith('hum') || t.startsWith('_hum')) humanMass += Math.exp(logprob);
  }

  const total = aiMass + humanMass;
  if (total <= 0) return undefined;
  return aiMass / total;
}
