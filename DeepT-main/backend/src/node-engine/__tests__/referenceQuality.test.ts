/**
 * Reference quality + chunking junk-filter tests (Issue 2). Run with: npm test.
 *
 * Pure + hermetic (no DB, no embedding provider): exercises the passage-quality
 * heuristic against the exact junk fixtures from the spec, plus the chunker's
 * junk-line / thin-chunk filtering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  passesCitationQualityGate,
  isJunkPassage,
  isJunkLine,
  isJunkHeading,
  isIndexListingPassage,
  citationQualityFailureReason,
} from '../../services/referenceQuality.service.js';
import { chunkText } from '../../services/referenceChunking.service.js';

// ===========================================================================
// 1. Citation quality gate — junk fails, real prose passes
// ===========================================================================

test('junk fragments fail the citation quality gate', () => {
  for (const junk of ['(CASTLE) 7', '– 52; CICS', '21 21', '42', 'iv', 'xii']) {
    assert.equal(passesCitationQualityGate(junk), false, `expected junk: ${JSON.stringify(junk)}`);
    assert.equal(isJunkPassage(junk), true);
    assert.ok(citationQualityFailureReason(junk), `expected a reason for ${JSON.stringify(junk)}`);
  }
});

test('off-topic prose still PASSES the content gate (topicality is retrieval scoring, not the junk gate)', () => {
  const offTopic = '20 percent of students are choosing to take a day off';
  assert.equal(passesCitationQualityGate(offTopic), true);
  assert.equal(citationQualityFailureReason(offTopic), null);
});

test('a normal academic prose paragraph passes the gate', () => {
  const prose =
    'A contemporary curriculum framework specifies the components that connect intended ' +
    'learning outcomes, assessment, and pedagogy into a coherent architecture for a course.';
  assert.equal(passesCitationQualityGate(prose), true);
});

// ===========================================================================
// 1b. Index / table-of-contents fragment detector (structural; not relevance)
// ===========================================================================

// The real back-of-book index dump that scored ~0.82 hybrid for a curriculum
// query yet is pure structural noise.
const INDEX_DUMP =
  'ive design thinking process 55 Distinctive Schools network 21 diversity: ' +
  'driving forces for learning - 121; student and family early childhood program 28 ' +
  'early college model 19';

test('an index/TOC dump FAILS the citation quality gate', () => {
  assert.equal(isIndexListingPassage(INDEX_DUMP), true);
  assert.equal(passesCitationQualityGate(INDEX_DUMP), false);
  assert.equal(isJunkPassage(INDEX_DUMP), true);
  const reason = citationQualityFailureReason(INDEX_DUMP);
  assert.ok(reason && /index/i.test(reason), `expected an index reason, got: ${reason}`);
});

test('legitimate academic prose with occasional numbers PASSES (not flagged as an index)', () => {
  const proseWithNumbers = [
    // a number at the very start of a sentence
    '20 percent of students choose to take a day off, but most return the next morning.',
    // chapter / section references and a quantifier
    'Chapter 2 discusses how 3 structural components connect outcomes to assessment.',
    // a clustered year range (4-digit numbers are not page numbers)
    'In 2020, 2021, and 2022 enrolment rose across the programme by a small margin each year.',
    // a methods-style sentence with several quantifier numbers
    'The study used 3 groups of 12 students across 5 sites measured at 2 separate time points.',
    // a results-style sentence with numbers glued to verbs/nouns
    'Group 1 scored 85 and group 2 scored 90 while group 3 scored 70 across the tasks.',
  ];
  for (const prose of proseWithNumbers) {
    assert.equal(
      isIndexListingPassage(prose),
      false,
      `prose wrongly flagged as index: ${JSON.stringify(prose)}`
    );
    assert.equal(
      passesCitationQualityGate(prose),
      true,
      `prose wrongly failed the gate: ${JSON.stringify(prose)}`
    );
  }
});

test('chunkText drops an index/TOC listing chunk', () => {
  // Padded to clear the length/word floors so ONLY the index detector can reject it.
  const doc = INDEX_DUMP + ' ' + INDEX_DUMP;
  const chunks = chunkText(doc);
  for (const c of chunks) {
    assert.equal(isIndexListingPassage(c.text), false, `index chunk survived: ${c.text.slice(0, 60)}`);
  }
});

// ===========================================================================
// 2. Line + heading junk detectors
// ===========================================================================

test('isJunkLine catches page numbers, TOC dot-leaders, repeated tokens, fragments', () => {
  assert.equal(isJunkLine('42'), true);
  assert.equal(isJunkLine('Introduction .......... 5'), true);
  assert.equal(isJunkLine('21 21'), true);
  assert.equal(isJunkLine('(CASTLE) 7'), true);
  assert.equal(isJunkLine('– 52; CICS'), true);
  // Real content lines are kept.
  assert.equal(isJunkLine('The framework defines three structural components.'), false);
  assert.equal(isJunkLine(''), false); // blank = separator, not junk
});

test('isJunkHeading keeps legitimate headings but rejects pure noise', () => {
  assert.equal(isJunkHeading('Chapter 4'), false);
  assert.equal(isJunkHeading('3.2 Biodiversity'), false);
  assert.equal(isJunkHeading('42'), true);
  assert.equal(isJunkHeading('iv'), true);
  assert.equal(isJunkHeading('.......... 12'), true);
});

// ===========================================================================
// 3. chunkText drops junk and keeps substantive passages
// ===========================================================================

test('chunkText filters out a junk-only document', () => {
  const junkDoc = ['42', '21 21', '(CASTLE) 7', '– 52; CICS', 'iv'].join('\n\n');
  assert.equal(chunkText(junkDoc).length, 0, 'all-junk document yields no chunks');
});

test('chunkText keeps substantive prose and strips interleaved page-number noise', () => {
  const realParagraph =
    'A contemporary curriculum framework specifies the components that connect intended learning ' +
    'outcomes, assessment, and pedagogy into a coherent architecture. The architecture makes the ' +
    'relationships between outcomes and evidence explicit so that designers can reason about ' +
    'alignment, coverage, and progression across a programme of study in a principled way.';
  const doc = ['7', realParagraph, '21 21', '— 52; CICS'].join('\n\n');
  const chunks = chunkText(doc);
  assert.ok(chunks.length >= 1, 'substantive paragraph survives');
  // No surviving chunk should be one of the junk fragments.
  for (const c of chunks) {
    assert.equal(isJunkPassage(c.text), false, `chunk should be substantive: ${c.text.slice(0, 40)}`);
  }
});
