/**
 * Reference Source Suggestion pure-helper tests (Phase C). Run: npm test.
 *
 * Pure + hermetic (no DB, no model, no network): exercises the parsing + the
 * "reuse-existing" guardrail (existing-title filtering) used by the AI
 * source-suggestion flow. AI PROPOSES, SME APPROVES — these helpers never ingest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSuggestions,
  filterOutExisting,
  normalizeTitle,
  coerceSourceType,
  buildSuggestionUserPrompt,
  type CoverageSourceSuggestion,
} from '../../services/referenceSourceSuggestion.service.js';

// ===========================================================================
// 1. coerceSourceType — only the three valid types, default 'other'
// ===========================================================================

test('coerceSourceType keeps valid types and defaults unknowns to "other"', () => {
  assert.equal(coerceSourceType('textbook_chapter'), 'textbook_chapter');
  assert.equal(coerceSourceType('paper'), 'paper');
  assert.equal(coerceSourceType('other'), 'other');
  assert.equal(coerceSourceType('book'), 'other');
  assert.equal(coerceSourceType(undefined), 'other');
  assert.equal(coerceSourceType(42), 'other');
});

// ===========================================================================
// 2. normalizeTitle — lowercase, strip punctuation, collapse whitespace
// ===========================================================================

test('normalizeTitle is tolerant of case / punctuation / spacing', () => {
  assert.equal(
    normalizeTitle('Understanding by Design, 2nd Ed.'),
    'understanding by design 2nd ed'
  );
  assert.equal(
    normalizeTitle('  Understanding   by   Design  '),
    'understanding by design'
  );
  assert.equal(normalizeTitle('Understanding by Design'), normalizeTitle('understanding by design!'));
});

// ===========================================================================
// 3. parseSuggestions — bare array, wrapped object, fences, malformed entries
// ===========================================================================

test('parseSuggestions parses a bare JSON array and trims fields', () => {
  const raw = JSON.stringify([
    { title: ' A Theory ', url: ' https://x/a ', why: ' closes gap ', source_type: 'paper' },
  ]);
  assert.deepEqual(parseSuggestions(raw), [
    { title: 'A Theory', url: 'https://x/a', why: 'closes gap', source_type: 'paper' },
  ]);
});

test('parseSuggestions accepts a { suggestions: [...] } wrapper and code fences', () => {
  const raw =
    '```json\n{ "suggestions": [ { "title": "T", "url": "https://x", "why": "w", "source_type": "textbook_chapter" } ] }\n```';
  assert.deepEqual(parseSuggestions(raw), [
    { title: 'T', url: 'https://x', why: 'w', source_type: 'textbook_chapter' },
  ]);
});

test('parseSuggestions drops entries missing a title or url, and bad json -> []', () => {
  const raw = JSON.stringify([
    { title: 'Keep', url: 'https://x', why: 'ok' },
    { title: '', url: 'https://y' }, // no title
    { title: 'NoUrl', url: '' }, // no url
    { url: 'https://z' }, // no title
  ]);
  const out = parseSuggestions(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Keep');
  assert.equal(out[0].source_type, 'other'); // defaulted
  assert.deepEqual(parseSuggestions('not json at all'), []);
});

// ===========================================================================
// 4. filterOutExisting — the reuse-existing guardrail + dedupe
// ===========================================================================

function sug(title: string, url = `https://x/${title}`): CoverageSourceSuggestion {
  return { title, url, why: 'w', source_type: 'other' };
}

test('filterOutExisting removes suggestions already in the corpus (case/punct tolerant)', () => {
  const suggestions = [sug('Understanding by Design'), sug('A New Source')];
  const existing = ['understanding by design!!']; // same title, different formatting
  const out = filterOutExisting(suggestions, existing);
  assert.deepEqual(out.map((s) => s.title), ['A New Source']);
});

test('filterOutExisting de-duplicates within the proposed list by normalized title', () => {
  const suggestions = [sug('Leadership 101'), sug('leadership 101'), sug('Other Book')];
  const out = filterOutExisting(suggestions, []);
  assert.deepEqual(out.map((s) => s.title), ['Leadership 101', 'Other Book']);
});

// ===========================================================================
// 5. buildSuggestionUserPrompt — includes CLO, gaps, and existing titles
// ===========================================================================

test('buildSuggestionUserPrompt embeds the gap and the existing corpus titles', () => {
  const prompt = buildSuggestionUserPrompt({
    cloId: 'CLO-4',
    shortLabel: 'Digital integration',
    statement: 'Integrate digital tools into curriculum design.',
    rationale: 'No passages teach digital integration.',
    gaps: ['Digital tool selection', 'Integration frameworks'],
    existingTitles: ['Understanding by Design'],
  });
  assert.ok(prompt.includes('CLO-4'));
  assert.ok(prompt.includes('Integrate digital tools'));
  assert.ok(prompt.includes('Digital tool selection'));
  assert.ok(prompt.includes('Understanding by Design'));
  assert.ok(prompt.includes('do NOT re-propose'));
});
