/**
 * Default seed for the Reference Coverage thresholds (Reference Coverage Check).
 *
 * These tune the per-CLO EVIDENCE GATE that sets the ceiling on each coverage
 * band. They are deliberately conservative so the gate forbids
 * model-knowledge-as-grounding: a CLO can only reach "Well covered / Partial"
 * when real, on-topic, multi-source passages exist in the uploaded corpus.
 *
 *  - `relevanceFloor` reuses the fused-score scale of hybrid retrieval (see
 *    DEFAULT_SCOPED_MIN_SCORE in referenceRetrieval.service.ts). A passage must
 *    clear it to count as supporting evidence.
 *  - `minPassages` / `distributionMin` require enough, sufficiently-spread
 *    passages before the gate opens.
 */
import type { ReferenceCoverageThresholds } from '../models/nodeEngine.js';

export const defaultReferenceCoverageThresholds: ReferenceCoverageThresholds = {
  topK: 8,
  relevanceFloor: 0.18,
  minPassages: 2,
  distributionMin: 1,
};
