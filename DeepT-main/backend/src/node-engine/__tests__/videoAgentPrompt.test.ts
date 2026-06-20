import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileHeyGenAgentPrompt,
  resolveEffectiveRenderStyle,
  validateAgentProduction,
  MODERATE_FRAMING_DIRECTIVE,
  STRICT_FRAMING_DIRECTIVE,
  DEFAULT_STYLE_BLOCK,
} from '../videoAgentPrompt.service.js';
import type { VideoBriefContent } from '../videoBrief.types.js';
import type { VideoSettings } from '../../models/nodeEngine.js';

function sampleBrief(): VideoBriefContent {
  const s1 = 'Welcome. Today we explore the green economy and why it matters.';
  const s2 = 'A green economy improves well-being while reducing environmental risk.';
  const s3 = 'Its core features are sustainability, efficiency, equity, and resilience.';
  const fullScript = [s1, s2, s3].join(' ');
  return {
    academic_coverage: {
      core_message: 'Define the green economy and its core features.',
      required_explanation: 'Green economy balances prosperity and sustainability.',
      must_not_omit: ['sustainability'],
      must_not_add: ['marketing CTAs'],
    },
    narration: {
      video_title: 'Understanding the Green Economy',
      opening_line: s1,
      full_script: fullScript,
      closing_summary: 'Every action counts.',
      script_word_count: fullScript.trim().split(/\s+/).length,
      key_terms: ['green economy', 'sustainability', 'resilience'],
    },
    narrative_flow: [],
    tone: 'Warm and professional',
    visual_direction: 'Use clean motion graphics beside the presenter.',
    what_to_avoid: ['No marketing CTAs', 'No invented statistics'],
    avatar_visibility_rules: {
      keep_avatar_unobstructed: true,
      supporting_graphics_placement: 'beside_avatar',
    },
    transcript: fullScript,
    heygen_prompt_payload: { prompt: '', recommended_mode: 'generate', settings_controlled_outside_prompt: [] },
    grounding_strength: 'strong',
    video_render_style: 'video_agent_produced',
    agent_production: {
      learning_objective: 'Define the green economy.',
      target_audience: 'University students.',
      sections: [
        { section_number: 1, title: 'Introduction', duration_seconds: 30, narration: s1, visual_description: 'Animated globe.', on_screen_text: ['green economy'], transitions: 'Fade in' },
        { section_number: 2, title: 'Definition', duration_seconds: 60, narration: s2, visual_description: 'Garden metaphor.', on_screen_text: ['sustainability'] },
        { section_number: 3, title: 'Features', duration_seconds: 90, narration: s3, visual_description: 'Infographic of features.', on_screen_text: ['resilience'] },
      ],
      production_notes: 'Keep presenter unobstructed.',
      critical_on_screen_text: ['green economy', 'sustainability'],
    },
  };
}

test('resolveEffectiveRenderStyle defaults to video_agent_produced', () => {
  assert.equal(resolveEffectiveRenderStyle(undefined), 'video_agent_produced');
  assert.equal(
    resolveEffectiveRenderStyle({ provider: 'heygen', video_render_style: 'studio_direct' }),
    'studio_direct'
  );
});

test('resolveEffectiveRenderStyle: per-object override wins, inherit falls through', () => {
  const settings: VideoSettings = { provider: 'heygen', video_render_style: 'video_agent_produced' };
  assert.equal(resolveEffectiveRenderStyle(settings, 'studio_direct'), 'studio_direct');
  assert.equal(resolveEffectiveRenderStyle(settings, 'inherit'), 'video_agent_produced');
});

test('compileHeyGenAgentPrompt emits structured script in reference order', () => {
  const prompt = compileHeyGenAgentPrompt(sampleBrief(), {
    provider: 'heygen',
    avatar_id: 'look_1',
    narration_fidelity: 'moderate',
  });
  assert.ok(prompt.includes('--- STRUCTURED SCRIPT ---'));
  assert.ok(prompt.includes('--- END SCRIPT ---'));
  assert.ok(prompt.includes('[Section 1 – Introduction | 30s]'));
  assert.ok(prompt.includes('NARRATION:'));
  assert.ok(prompt.includes('VISUAL:'));
  assert.ok(prompt.includes('ON-SCREEN: green economy'));
  assert.ok(prompt.includes('TRANSITION: Fade in'));
  assert.ok(prompt.includes('CRITICAL ON-SCREEN TEXT'));
  assert.ok(prompt.includes('Learning Objective:'));
  assert.ok(prompt.includes('Target Audience:'));
  // Structured script must appear before the critical on-screen block.
  assert.ok(prompt.indexOf('STRUCTURED SCRIPT') < prompt.indexOf('CRITICAL ON-SCREEN'));
});

test('compileHeyGenAgentPrompt swaps moderate vs strict directive', () => {
  const moderate = compileHeyGenAgentPrompt(sampleBrief(), { provider: 'heygen', narration_fidelity: 'moderate' });
  assert.ok(moderate.includes(MODERATE_FRAMING_DIRECTIVE));
  const strict = compileHeyGenAgentPrompt(sampleBrief(), { provider: 'heygen', narration_fidelity: 'strict' });
  assert.ok(strict.includes(STRICT_FRAMING_DIRECTIVE));
});

test('compileHeyGenAgentPrompt includes default style block only without style_id', () => {
  const noStyle = compileHeyGenAgentPrompt(sampleBrief(), { provider: 'heygen' });
  assert.ok(noStyle.includes(DEFAULT_STYLE_BLOCK));
  const withStyle = compileHeyGenAgentPrompt(sampleBrief(), { provider: 'heygen', style_id: 'style_x' });
  assert.ok(!withStyle.includes(DEFAULT_STYLE_BLOCK));
});

test('compileHeyGenAgentPrompt includes brand block when enabled', () => {
  const branded = compileHeyGenAgentPrompt(sampleBrief(), {
    provider: 'heygen',
    brand_kit: { enabled: true, primaryColor: '#1E40AF', fontFamily: 'Inter' },
  });
  assert.ok(branded.includes('BRAND COLORS'));
  assert.ok(branded.includes('BRAND FONT'));
  const unbranded = compileHeyGenAgentPrompt(sampleBrief(), {
    provider: 'heygen',
    brand_kit: { enabled: false, primaryColor: '#1E40AF' },
  });
  assert.ok(!unbranded.includes('BRAND COLORS'));
});

test('validateAgentProduction passes when section narrations equal full_script', () => {
  const brief = sampleBrief();
  const notes = validateAgentProduction(
    brief.agent_production!,
    brief.narration.full_script,
    brief.narration.key_terms
  );
  assert.deepEqual(notes, []);
});

test('validateAgentProduction flags narration drift', () => {
  const brief = sampleBrief();
  brief.agent_production!.sections[0].narration += ' Studies show 73% improvement.';
  const notes = validateAgentProduction(
    brief.agent_production!,
    brief.narration.full_script,
    brief.narration.key_terms
  );
  assert.ok(notes.some((n) => n.includes('do not match')));
});

test('validateAgentProduction flags untraced on-screen text only under strict fidelity', () => {
  const brief = sampleBrief();
  brief.agent_production!.sections[0].on_screen_text = ['Invented Label 9000'];
  // Cinematic/moderate default: on-screen callouts are allowed, so no flag.
  const moderate = validateAgentProduction(
    brief.agent_production!,
    brief.narration.full_script,
    brief.narration.key_terms
  );
  assert.ok(!moderate.some((n) => n.includes('does not trace')));
  // Strict fidelity: untraced on-screen text is flagged.
  const strict = validateAgentProduction(
    brief.agent_production!,
    brief.narration.full_script,
    brief.narration.key_terms,
    { enforceOnScreenTracing: true }
  );
  assert.ok(strict.some((n) => n.includes('does not trace')));
});
