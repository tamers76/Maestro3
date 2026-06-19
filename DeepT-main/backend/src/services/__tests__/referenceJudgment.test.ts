/**
 * Hermetic tests for shared reference passage judgment helpers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVerdict,
  buildJudgmentUserPrompt,
} from '../referenceJudgment.service.js';

test('normalizeVerdict accepts only covered | partial | none', () => {
  assert.equal(normalizeVerdict('covered'), 'covered');
  assert.equal(normalizeVerdict('partial'), 'partial');
  assert.equal(normalizeVerdict('none'), 'none');
  assert.equal(normalizeVerdict('strong'), 'none');
  assert.equal(normalizeVerdict(undefined), 'none');
});

test('buildJudgmentUserPrompt lists passages with indices for the judge', () => {
  const prompt = buildJudgmentUserPrompt('KNOWLEDGE COMPONENT', 'Explain backward design', [
    { citation: 'Wiggins Ch.1', text_preview: 'Begin with the end in mind.' },
    { citation: 'Leadership anecdote', text_preview: 'A CEO once said…' },
  ]);
  assert.match(prompt, /KNOWLEDGE COMPONENT/);
  assert.match(prompt, /Explain backward design/);
  assert.match(prompt, /\[0\] \(Wiggins Ch\.1\)/);
  assert.match(prompt, /\[1\] \(Leadership anecdote\)/);
  assert.match(prompt, /judge ONLY from these/i);
});

test('buildJudgmentUserPrompt handles empty retrieval', () => {
  const prompt = buildJudgmentUserPrompt('CLO', 'CLO statement', []);
  assert.match(prompt, /no passages retrieved/i);
});
