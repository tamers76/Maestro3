/**
 * Reference Coverage band-resolver tests (Reference Coverage Check). Run: npm test.
 *
 * Pure + hermetic (no DB, no model, no embedding provider): exercises the LOCKED
 * band logic via the extracted pure functions. The Layer-3 judgment is
 * authoritative but bounded by the evidence gate — it can confirm or downgrade,
 * NEVER upgrade past the evidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCoverageBand,
  evidenceGatePasses,
  normalizeVerdict,
  scoreStats,
  clampPercent,
  fallbackShortLabel,
  rollupCoveredBy,
  bandRank,
  bandDirection,
  computeCoverageDelta,
  STRONG_SCORE_MARGIN,
  type CoveragePassage,
} from '../../services/referenceCoverage.service.js';

const THRESHOLDS = { minPassages: 2, distributionMin: 1 };

// ===========================================================================
// 1. Off-topic, HIGH similarity -> judgment downgrades to not_covered
// ===========================================================================

test('off-topic high-similarity CLO downgrades to not_covered (judgment "none" despite passing gate)', () => {
  // The MDLD602 case: ~0.95 similarity, plenty of passages, but the book is
  // off-topic so the judge returns "none". The gate passes; judgment downgrades.
  const gatePassed = evidenceGatePasses({
    supporting_count: 6,
    distinct_sources: 2,
    thresholds: THRESHOLDS,
  });
  assert.equal(gatePassed, true);
  assert.equal(resolveCoverageBand({ evidence_gate_passed: gatePassed, verdict: 'none' }), 'not_covered');
});

// ===========================================================================
// 2. Positive judgment but FAILING evidence gate -> capped at not_covered
// ===========================================================================

test('positive judgment cannot upgrade past a failing evidence gate (capped not_covered)', () => {
  // Too few supporting passages -> gate fails. Even a "covered" verdict is capped,
  // forbidding model-knowledge-as-grounding.
  const gatePassed = evidenceGatePasses({
    supporting_count: 1,
    distinct_sources: 1,
    thresholds: THRESHOLDS,
  });
  assert.equal(gatePassed, false);
  assert.equal(resolveCoverageBand({ evidence_gate_passed: gatePassed, verdict: 'covered' }), 'not_covered');
  assert.equal(resolveCoverageBand({ evidence_gate_passed: gatePassed, verdict: 'partial' }), 'not_covered');
});

// ===========================================================================
// 3. BOTH pass -> well_covered / partial follow the verdict
// ===========================================================================

test('gate pass + verdict maps to the verdict band (covered->well_covered, partial->partial)', () => {
  const gatePassed = evidenceGatePasses({
    supporting_count: 3,
    distinct_sources: 2,
    thresholds: THRESHOLDS,
  });
  assert.equal(gatePassed, true);
  assert.equal(resolveCoverageBand({ evidence_gate_passed: true, verdict: 'covered' }), 'well_covered');
  assert.equal(resolveCoverageBand({ evidence_gate_passed: true, verdict: 'partial' }), 'partial');
  assert.equal(resolveCoverageBand({ evidence_gate_passed: true, verdict: 'none' }), 'not_covered');
});

// ===========================================================================
// 4. Evidence gate edge cases (distribution + min-passages both required)
// ===========================================================================

test('evidence gate requires BOTH min passages AND distribution minimum', () => {
  // Enough passages but all from one source, with distributionMin = 2 -> fails.
  assert.equal(
    evidenceGatePasses({ supporting_count: 5, distinct_sources: 1, thresholds: { minPassages: 2, distributionMin: 2 } }),
    false
  );
  // Spread across enough sources but too few passages -> fails.
  assert.equal(
    evidenceGatePasses({ supporting_count: 1, distinct_sources: 3, thresholds: { minPassages: 2, distributionMin: 1 } }),
    false
  );
  // Both satisfied -> passes.
  assert.equal(
    evidenceGatePasses({ supporting_count: 2, distinct_sources: 2, thresholds: { minPassages: 2, distributionMin: 2 } }),
    true
  );
});

// ===========================================================================
// 5. Verdict normalization is conservative (unknown -> none, never upgrades)
// ===========================================================================

test('normalizeVerdict defaults unknown/garbage to the conservative "none"', () => {
  assert.equal(normalizeVerdict('covered'), 'covered');
  assert.equal(normalizeVerdict('partial'), 'partial');
  assert.equal(normalizeVerdict('none'), 'none');
  assert.equal(normalizeVerdict('strong'), 'none');
  assert.equal(normalizeVerdict(undefined), 'none');
  assert.equal(normalizeVerdict(42), 'none');
});

// ===========================================================================
// 6. scoreStats — top + median over a ranked passage list
// ===========================================================================

test('scoreStats reports top + median fused score (0/0 when empty)', () => {
  assert.deepEqual(scoreStats([]), { top: 0, median: 0 });
  assert.deepEqual(scoreStats([{ final_score: 0.5 }]), { top: 0.5, median: 0.5 });
  // Odd length: median is the middle element.
  assert.deepEqual(scoreStats([{ final_score: 0.9 }, { final_score: 0.5 }, { final_score: 0.1 }]), {
    top: 0.9,
    median: 0.5,
  });
  // Even length: median is the mean of the two middle elements.
  assert.deepEqual(
    scoreStats([{ final_score: 0.8 }, { final_score: 0.6 }, { final_score: 0.4 }, { final_score: 0.2 }]),
    { top: 0.8, median: 0.5 }
  );
});

// ===========================================================================
// 7. clampPercent — integer percentage clamped to [0, 100]
// ===========================================================================

test('clampPercent rounds and clamps to [0, 100]', () => {
  assert.equal(clampPercent(0), 0);
  assert.equal(clampPercent(95.4), 95);
  assert.equal(clampPercent(95.6), 96);
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(150), 100);
  assert.equal(clampPercent(Number.NaN), 0);
});

// ===========================================================================
// 8. fallbackShortLabel — first ~4 words of the statement
// ===========================================================================

test('fallbackShortLabel takes the first ~4 words (collapsing whitespace)', () => {
  assert.equal(
    fallbackShortLabel('Analyze strategic frameworks across competitive markets'),
    'Analyze strategic frameworks across'
  );
  assert.equal(fallbackShortLabel('Digital integration'), 'Digital integration');
  assert.equal(fallbackShortLabel('   spaced    out   words here please   '), 'spaced out words here');
  assert.equal(fallbackShortLabel('   '), 'Untitled CLO');
});

// ===========================================================================
// 9. rollupCoveredBy — group by doc, strength by best score, strong-first
// ===========================================================================

function passage(doc_id: string, score: number, chunk_id = `${doc_id}-${score}`): CoveragePassage {
  return { chunk_id, doc_id, citation: `${doc_id} cite`, text_preview: 'preview', score };
}

test('rollupCoveredBy groups by doc and assigns strength by the doc best score', () => {
  const floor = 0.18; // strong threshold = 0.18 + STRONG_SCORE_MARGIN (0.15) = 0.33
  const titleFor = (id: string) => ({ d1: 'Alpha', d2: 'Bravo' })[id] ?? id;
  const refs = rollupCoveredBy(
    [passage('d2', 0.2), passage('d1', 0.4), passage('d1', 0.25)],
    titleFor,
    floor
  );
  // d1 best=0.40 (>=0.33) -> strong; d2 best=0.20 (<0.33) -> partial. Strong first.
  assert.deepEqual(refs, [
    { doc_id: 'd1', title: 'Alpha', strength: 'strong' },
    { doc_id: 'd2', title: 'Bravo', strength: 'partial' },
  ]);
});

test('rollupCoveredBy is empty with no passages and uses the floor+margin boundary', () => {
  assert.deepEqual(rollupCoveredBy([], () => 'x', 0.18), []);
  const floor = 0.1;
  const atThreshold = floor + STRONG_SCORE_MARGIN; // exactly strong (>=)
  const refs = rollupCoveredBy([passage('d1', atThreshold)], (id) => id, floor);
  assert.equal(refs[0].strength, 'strong');
});

// ===========================================================================
// 10. Coverage delta — band ordering, direction, and per-CLO before/after diff
// ===========================================================================

test('bandRank orders not_covered < partial < well_covered', () => {
  assert.equal(bandRank('not_covered'), 0);
  assert.equal(bandRank('partial'), 1);
  assert.equal(bandRank('well_covered'), 2);
});

test('bandDirection improves/regresses/holds by band ordering', () => {
  assert.equal(bandDirection('not_covered', 'partial'), 'improved');
  assert.equal(bandDirection('partial', 'well_covered'), 'improved');
  assert.equal(bandDirection('not_covered', 'well_covered'), 'improved');
  assert.equal(bandDirection('well_covered', 'partial'), 'regressed');
  assert.equal(bandDirection('partial', 'not_covered'), 'regressed');
  assert.equal(bandDirection('partial', 'partial'), 'unchanged');
});

test('computeCoverageDelta diffs per-CLO bands and counts improved/regressed/unchanged', () => {
  const prev = [
    { clo_id: 'CLO-1', band: 'not_covered' as const },
    { clo_id: 'CLO-2', band: 'well_covered' as const },
    { clo_id: 'CLO-3', band: 'partial' as const },
  ];
  const next = [
    { clo_id: 'CLO-1', band: 'partial' as const }, // improved
    { clo_id: 'CLO-2', band: 'partial' as const }, // regressed
    { clo_id: 'CLO-3', band: 'partial' as const }, // unchanged
    { clo_id: 'CLO-4', band: 'well_covered' as const }, // new -> unchanged baseline
  ];
  const delta = computeCoverageDelta(prev, next);
  assert.equal(delta.improved, 1);
  assert.equal(delta.regressed, 1);
  assert.equal(delta.unchanged, 2);
  assert.deepEqual(
    delta.entries.find((e) => e.clo_id === 'CLO-1'),
    { clo_id: 'CLO-1', from_band: 'not_covered', to_band: 'partial', direction: 'improved' }
  );
  assert.deepEqual(
    delta.entries.find((e) => e.clo_id === 'CLO-4'),
    { clo_id: 'CLO-4', from_band: null, to_band: 'well_covered', direction: 'unchanged' }
  );
});
