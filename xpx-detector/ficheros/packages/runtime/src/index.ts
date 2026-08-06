export type { ModelDescriptor } from './model.js';
export { SLOP_MODEL } from './model.js';

export type { Label } from './prompt.js';
export {
  AI_LABEL,
  HUMAN_LABEL,
  MAX_CHARS,
  SAMPLING,
  STOP_SEQUENCES,
  buildPrompt,
  parseLabel,
  probabilityFromLogprobs,
} from './prompt.js';

export type {
  Classification,
  CompletionParams,
  CompletionResponse,
  LoadParams,
  TextClassifier,
  WllamaClassifierOptions,
  WllamaLike,
} from './text-classifier.js';
export { WllamaTextClassifier } from './text-classifier.js';
