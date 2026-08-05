export type { AbortSignalLike } from './contracts/abort.js';
export { NEVER_ABORTED } from './contracts/abort.js';

export type {
  Evidence,
  EvidenceKind,
  Modality,
  Rationale,
} from './contracts/evidence.js';
export { nullEvidence } from './contracts/evidence.js';

export type { NormalizedInput } from './contracts/input.js';

export type {
  Detector,
  DetectorCapabilities,
  DetectorContext,
} from './contracts/detector.js';

export type {
  ValidationStage,
  ValidationInput,
  ValidationOutcome,
} from './contracts/validation.js';

export type { Verdict, ValidationTrace } from './contracts/verdict.js';
export { Band, AbstentionReason, isAbstention } from './contracts/verdict.js';

export type {
  CorrelationModel,
  FusionResult,
  EvidenceContribution,
} from './evidence/fusion.js';
export { fuse, computeDisagreement, emptyCorrelationModel } from './evidence/fusion.js';

export type { ScoringPolicy, Sensitivity, BandDecision } from './scoring/bands.js';
export {
  decideBand,
  defaultPolicy,
  applySensitivity,
  downgrade,
  cautionRank,
} from './scoring/bands.js';

export { DetectorRegistry } from './registry/registry.js';

export type { PipelineOptions, AnalyzeOptions } from './pipeline/pipeline.js';
export { Pipeline } from './pipeline/pipeline.js';
