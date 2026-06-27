/**
 * M10 Phase B — Video brief output (HeyGen-ready prompt + structured brief).
 * Schema aligns with video_brief_generation_prompt / schema:video_brief_object_v1.
 */
import {
  NodeEngineValidationError,
  type GroundingStrength,
  type VideoSettings,
} from '../models/nodeEngine.js';
import {
  compileHeyGenAgentPrompt,
  validateAgentProduction,
  INFO_NOTE_PREFIX,
} from './videoAgentPrompt.service.js';

/** Default narration cap (~3 min at normal speaking pace) when no duration is set. */
export const VIDEO_SCRIPT_MAX_WORDS = 420;

/** Spoken pace used to convert a target duration into a word budget. */
export const WORDS_PER_MINUTE = 150;

/** Hard ceiling regardless of duration (cost + attention guardrail). */
export const VIDEO_SCRIPT_ABSOLUTE_MAX_WORDS = 1600;

/**
 * Word budget for a target duration (seconds). Falls back to the 420 default
 * when duration is missing, and is clamped to an absolute ceiling.
 */
export function resolveScriptWordBudget(targetDurationSeconds?: number): number {
  if (!targetDurationSeconds || targetDurationSeconds <= 0) return VIDEO_SCRIPT_MAX_WORDS;
  const budget = Math.round((targetDurationSeconds / 60) * WORDS_PER_MINUTE);
  return Math.min(VIDEO_SCRIPT_ABSOLUTE_MAX_WORDS, Math.max(VIDEO_SCRIPT_MAX_WORDS, budget));
}

export function countScriptWords(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

export interface HeyGenPromptPayload {
  prompt: string;
  recommended_mode: 'generate' | 'chat';
  settings_controlled_outside_prompt: string[];
}

/** Render style stamped on the brief (mirrors VideoSettings.video_render_style). */
export type VideoRenderStyle = 'studio_direct' | 'video_agent_produced';

/** One directed scene for the Video Agent path (mirrors the reference JSON shape). */
export interface VideoAgentSection {
  section_number: number;
  title: string;
  duration_seconds?: number;
  /** Narration slice — concatenation of all sections must equal full_script. */
  narration: string;
  visual_description: string;
  /** On-screen text — approved key terms only, never invented. */
  on_screen_text?: string[];
  transitions?: string;
}

/** Structured scene brief used to compile a HeyGen Video Agent prompt. */
export interface VideoAgentProduction {
  learning_objective: string;
  target_audience: string;
  sections: VideoAgentSection[];
  production_notes: string;
  /** Flat deduped list of strings the agent must render verbatim. */
  critical_on_screen_text: string[];
}

export interface VideoBriefNarration {
  video_title: string;
  opening_line: string;
  full_script: string;
  closing_summary: string;
  /** Populated on finalize — word count of full_script. */
  script_word_count?: number;
  approximate_duration_minutes?: number;
  pacing_notes?: string;
  key_terms?: string[];
}

export interface VideoBriefContent {
  academic_coverage: {
    core_message: string;
    required_explanation: string;
    must_not_omit: string[];
    must_not_add: string[];
  };
  narration: VideoBriefNarration;
  narrative_flow: Array<{ beat_order: number; label: string; purpose: string }>;
  tone: string;
  visual_direction: string;
  what_to_avoid: string[];
  avatar_visibility_rules: {
    keep_avatar_unobstructed: boolean;
    supporting_graphics_placement: 'beside_avatar' | 'cutaway_scene' | 'side_panel';
    caption_safe_zone?: string;
  };
  /** Authoritative transcript — must match narration (accessibility + EC companion). */
  transcript: string;
  heygen_prompt_payload: HeyGenPromptPayload;
  grounding_strength: GroundingStrength;
  fidelity_check?: { status: 'passed' | 'needs_review'; notes: string[] };
  /** Effective render style at brief time (default video_agent_produced). */
  video_render_style?: VideoRenderStyle;
  /** Structured scenes — required when video_render_style is video_agent_produced. */
  agent_production?: VideoAgentProduction;
}

function asRecord(input: unknown, ctx: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new NodeEngineValidationError(`${ctx}: expected object`);
  }
  return input as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new NodeEngineValidationError(`${ctx}.${key}: required non-empty string`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function requireStringArray(obj: Record<string, unknown>, key: string, ctx: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new NodeEngineValidationError(`${ctx}.${key}: required string array`);
  }
  return v.map((item, i) => {
    if (typeof item !== 'string') {
      throw new NodeEngineValidationError(`${ctx}.${key}[${i}]: expected string`);
    }
    return item;
  });
}

export function parseHeyGenPromptPayload(input: unknown): HeyGenPromptPayload {
  const obj = asRecord(input, 'HeyGenPromptPayload');
  const mode = obj.recommended_mode;
  if (mode !== 'generate' && mode !== 'chat') {
    throw new NodeEngineValidationError('HeyGenPromptPayload.recommended_mode: generate | chat');
  }
  return {
    prompt: requireString(obj, 'prompt', 'HeyGenPromptPayload'),
    recommended_mode: mode,
    settings_controlled_outside_prompt: Array.isArray(obj.settings_controlled_outside_prompt)
      ? (obj.settings_controlled_outside_prompt as unknown[]).map((x, i) => {
          if (typeof x !== 'string') {
            throw new NodeEngineValidationError(
              `HeyGenPromptPayload.settings_controlled_outside_prompt[${i}]: string`
            );
          }
          return x;
        })
      : [],
  };
}

export function parseVideoBriefContent(input: unknown): VideoBriefContent {
  const root = asRecord(input, 'VideoBriefContent');
  const obj = root.content ? asRecord(root.content, 'VideoBriefContent.content') : root;

  const coverage = asRecord(obj.academic_coverage ?? {}, 'academic_coverage');
  const narration = asRecord(obj.narration ?? {}, 'narration');
  const avatar = asRecord(obj.avatar_visibility_rules ?? {}, 'avatar_visibility_rules');
  const placement = avatar.supporting_graphics_placement;
  if (
    placement !== 'beside_avatar' &&
    placement !== 'cutaway_scene' &&
    placement !== 'side_panel'
  ) {
    throw new NodeEngineValidationError(
      'avatar_visibility_rules.supporting_graphics_placement: beside_avatar | cutaway_scene | side_panel'
    );
  }

  const flowRaw = obj.narrative_flow;
  const narrative_flow = Array.isArray(flowRaw)
    ? flowRaw.map((item, i) => {
        const beat = asRecord(item, `narrative_flow[${i}]`);
        return {
          beat_order: typeof beat.beat_order === 'number' ? beat.beat_order : i + 1,
          label: requireString(beat, 'label', `narrative_flow[${i}]`),
          purpose: requireString(beat, 'purpose', `narrative_flow[${i}]`),
        };
      })
    : [];

  const gs = obj.grounding_strength;
  const grounding_strength: GroundingStrength =
    gs === 'strong' || gs === 'moderate' || gs === 'weak' ? gs : 'weak';

  const renderStyleRaw = obj.video_render_style;
  const video_render_style: VideoRenderStyle | undefined =
    renderStyleRaw === 'studio_direct' || renderStyleRaw === 'video_agent_produced'
      ? renderStyleRaw
      : undefined;

  const agent_production = obj.agent_production
    ? parseVideoAgentProduction(obj.agent_production)
    : undefined;

  let fidelity_check: VideoBriefContent['fidelity_check'];
  if (obj.fidelity_check && typeof obj.fidelity_check === 'object') {
    const fc = asRecord(obj.fidelity_check, 'fidelity_check');
    const status = fc.status === 'passed' ? 'passed' : 'needs_review';
    fidelity_check = {
      status,
      notes: Array.isArray(fc.notes)
        ? (fc.notes as unknown[]).filter((n): n is string => typeof n === 'string')
        : [],
    };
  }

  return {
    academic_coverage: {
      core_message: requireString(coverage, 'core_message', 'academic_coverage'),
      required_explanation: requireString(coverage, 'required_explanation', 'academic_coverage'),
      must_not_omit: requireStringArray(coverage, 'must_not_omit', 'academic_coverage'),
      must_not_add: requireStringArray(coverage, 'must_not_add', 'academic_coverage'),
    },
    narration: {
      video_title: requireString(narration, 'video_title', 'narration'),
      opening_line: requireString(narration, 'opening_line', 'narration'),
      full_script: requireString(narration, 'full_script', 'narration'),
      closing_summary: requireString(narration, 'closing_summary', 'narration'),
      ...(typeof narration.approximate_duration_minutes === 'number'
        ? { approximate_duration_minutes: narration.approximate_duration_minutes }
        : {}),
      ...(typeof narration.script_word_count === 'number'
        ? { script_word_count: narration.script_word_count }
        : {}),
      ...(optionalString(narration, 'pacing_notes')
        ? { pacing_notes: optionalString(narration, 'pacing_notes') }
        : {}),
      ...(Array.isArray(narration.key_terms)
        ? {
            key_terms: (narration.key_terms as unknown[]).filter(
              (k): k is string => typeof k === 'string'
            ),
          }
        : {}),
    },
    narrative_flow,
    tone: requireString(obj, 'tone', 'VideoBriefContent'),
    visual_direction: requireString(obj, 'visual_direction', 'VideoBriefContent'),
    what_to_avoid: requireStringArray(obj, 'what_to_avoid', 'VideoBriefContent'),
    avatar_visibility_rules: {
      keep_avatar_unobstructed: avatar.keep_avatar_unobstructed !== false,
      supporting_graphics_placement: placement,
      ...(optionalString(avatar, 'caption_safe_zone')
        ? { caption_safe_zone: optionalString(avatar, 'caption_safe_zone') }
        : {}),
    },
    transcript: requireString(obj, 'transcript', 'VideoBriefContent'),
    heygen_prompt_payload: parseHeyGenPromptPayload(obj.heygen_prompt_payload),
    grounding_strength,
    ...(fidelity_check ? { fidelity_check } : {}),
    ...(video_render_style ? { video_render_style } : {}),
    ...(agent_production ? { agent_production } : {}),
  };
}

export function parseVideoAgentProduction(input: unknown): VideoAgentProduction {
  const obj = asRecord(input, 'agent_production');
  const sectionsRaw = obj.sections;
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
    throw new NodeEngineValidationError('agent_production.sections: required non-empty array');
  }
  const sections: VideoAgentSection[] = sectionsRaw.map((raw, i) => {
    const s = asRecord(raw, `agent_production.sections[${i}]`);
    const section: VideoAgentSection = {
      section_number:
        typeof s.section_number === 'number' ? s.section_number : i + 1,
      title: requireString(s, 'title', `agent_production.sections[${i}]`),
      narration: requireString(s, 'narration', `agent_production.sections[${i}]`),
      visual_description: requireString(
        s,
        'visual_description',
        `agent_production.sections[${i}]`
      ),
    };
    if (typeof s.duration_seconds === 'number') {
      section.duration_seconds = s.duration_seconds;
    }
    if (Array.isArray(s.on_screen_text)) {
      section.on_screen_text = (s.on_screen_text as unknown[]).filter(
        (t): t is string => typeof t === 'string'
      );
    }
    const transitions = optionalString(s, 'transitions');
    if (transitions !== undefined) section.transitions = transitions;
    return section;
  });

  const critical_on_screen_text = Array.isArray(obj.critical_on_screen_text)
    ? (obj.critical_on_screen_text as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];

  return {
    learning_objective: requireString(obj, 'learning_objective', 'agent_production'),
    target_audience: requireString(obj, 'target_audience', 'agent_production'),
    sections,
    production_notes: requireString(obj, 'production_notes', 'agent_production'),
    critical_on_screen_text,
  };
}

/** JSON shape sent to the LLM as output_contract (embedded in user message). */
export const VIDEO_BRIEF_OUTPUT_CONTRACT = {
  content: {
    academic_coverage: {
      core_message: 'string',
      required_explanation: 'string',
      must_not_omit: ['string'],
      must_not_add: ['string'],
    },
    narration: {
      video_title: 'string',
      opening_line: 'string',
      full_script: 'string — complete narration; stay within the input word_budget; becomes transcript',
      closing_summary: 'string',
      script_word_count: 'number — words in full_script (must be ≤ word_budget)',
      approximate_duration_minutes: 'optional hint only — match the requested target duration',
      pacing_notes: 'string',
      key_terms: ['string'],
    },
    narrative_flow: [{ beat_order: 1, label: 'string', purpose: 'string' }],
    tone: 'string',
    visual_direction: 'string',
    what_to_avoid: ['string'],
    avatar_visibility_rules: {
      keep_avatar_unobstructed: true,
      supporting_graphics_placement: 'beside_avatar | cutaway_scene | side_panel',
      caption_safe_zone: 'string',
    },
    transcript: 'string — MUST equal full_script verbatim',
    heygen_prompt_payload: {
      prompt: 'string — production prompt pasted into HeyGen',
      recommended_mode: 'generate | chat',
      settings_controlled_outside_prompt: [
        'avatar_id',
        'voice_id',
        'engine',
        'resolution',
        'aspect_ratio',
        'output_format',
      ],
    },
    grounding_strength: 'strong | moderate | weak',
    fidelity_check: { status: 'passed | needs_review', notes: ['string'] },
    video_render_style: 'studio_direct | video_agent_produced (default video_agent_produced)',
    agent_production: {
      _when: 'REQUIRED when video_render_style = video_agent_produced',
      learning_objective: 'string — from academic_coverage.core_message',
      target_audience: 'string',
      sections: [
        {
          section_number: 1,
          title: 'string',
          duration_seconds: 'number — hint only; sum ~= target duration',
          narration:
            'string — slice of full_script; ALL section narrations concatenated MUST equal full_script',
          visual_description:
            'string — VIVID, specific scene (animation/metaphor/split-screen/infographic/B-roll); illustrates narration, invents no academic facts',
          on_screen_text: ['string — titles, bullets, or quotes; academic text must exist in narration/spec'],
          transitions: 'string — e.g. fade from title card, slide, swipe',
        },
      ],
      production_notes: 'string — tone + visual direction + avatar safety',
      critical_on_screen_text: ['string — render verbatim (key terms, approved labels)'],
    },
  },
};

/** Single paste-ready prompt for HeyGen Video Agent (must include verbatim script). */
export function compileHeyGenPrompt(brief: VideoBriefContent): string {
  const { narration, tone, visual_direction, what_to_avoid, avatar_visibility_rules, academic_coverage } =
    brief;
  const wordCount = narration.script_word_count ?? countScriptWords(narration.full_script);

  const keyTermsLine =
    narration.key_terms && narration.key_terms.length > 0
      ? `Show these key terms minimally on screen (max ~12 words per screen): ${narration.key_terms.join(', ')}.`
      : 'On-screen text: key terms only (max ~12 words per screen).';

  const placement = avatar_visibility_rules.supporting_graphics_placement.replace(/_/g, ' ');

  return [
    `Create an educational video titled "${narration.video_title}".`,
    `Script length: ${wordCount} words (Maestro limit: ${VIDEO_SCRIPT_MAX_WORDS} words max — ~3 minutes at normal pace).`,
    '',
    'ACADEMIC CONTENT TO COVER (do not invent facts beyond this):',
    academic_coverage.required_explanation,
    '',
    'NARRATION SCRIPT (the avatar must speak this verbatim — authoritative transcript):',
    narration.full_script.trim(),
    '',
    `Opening: ${narration.opening_line}`,
    `Closing: ${narration.closing_summary}`,
    '',
    'VISUAL DIRECTION:',
    visual_direction,
    `Keep the avatar face and upper body unobstructed. Place supporting graphics in ${placement}.`,
    avatar_visibility_rules.caption_safe_zone
      ? `Caption safe zone: ${avatar_visibility_rules.caption_safe_zone}.`
      : '',
    keyTermsLine,
    '',
    'TONE:',
    tone,
    '',
    'WHAT TO AVOID:',
    ...what_to_avoid.map((item) => `- ${item}`),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function scriptWordCountNotes(wordCount: number, budget: number): string[] {
  if (wordCount > budget) {
    return [
      `Script is ${wordCount} words — exceeds the ${budget}-word budget (~${Math.round(
        (budget / WORDS_PER_MINUTE) * 60
      )}s at normal pace). Shorten or raise the target duration before HeyGen render.`,
    ];
  }
  if (wordCount > budget * 0.9) {
    return [`Script is ${wordCount} words — near the ${budget}-word budget; verify pacing before render.`];
  }
  return [];
}

/**
 * Ensure transcript matches script, word count tracked, agent guardrails enforced,
 * and the HeyGen prompt compiled for the effective render style.
 *
 * `settings` is optional so existing studio_direct callers/tests keep working;
 * pass VideoSettings to compile the Video Agent prompt with avatar/style/brand context.
 */
export function finalizeVideoBrief(
  brief: VideoBriefContent,
  settings?: VideoSettings
): VideoBriefContent {
  const fullScript = brief.narration.full_script.trim();
  const wordCount = countScriptWords(fullScript);
  const wordBudget = resolveScriptWordBudget(settings?.target_duration_seconds);
  const wordNotes = scriptWordCountNotes(wordCount, wordBudget);
  const priorNotes = brief.fidelity_check?.notes ?? [];

  // Style precedence: explicit brief style > settings default > infer from payload.
  // We only treat a brief as agent-produced when it actually carries sections, so
  // existing studio_direct briefs (no style, no agent_production) keep working.
  const renderStyle: VideoRenderStyle =
    brief.video_render_style ??
    settings?.video_render_style ??
    (brief.agent_production ? 'video_agent_produced' : 'studio_direct');

  const agentNotes: string[] = [];
  if (renderStyle === 'video_agent_produced') {
    if (!brief.agent_production) {
      agentNotes.push(
        'video_agent_produced brief is missing agent_production sections — regenerate the brief.'
      );
    } else {
      agentNotes.push(
        ...validateAgentProduction(brief.agent_production, fullScript, brief.narration.key_terms ?? [], {
          // On-screen callouts are encouraged in cinematic/moderate mode; only enforce
          // verbatim key-term tracing under strict fidelity.
          enforceOnScreenTracing: settings?.narration_fidelity === 'strict',
          // Relaxed mode expects script-drift, so its mismatch is reported as info.
          relaxedNarration: settings?.narration_fidelity === 'relaxed',
        })
      );
    }
  }

  const mergedNotes = [
    ...priorNotes.filter((n) => !n.includes('-word')),
    ...wordNotes,
    ...agentNotes,
  ];
  // Informational notes (e.g. expected drift in relaxed narration) are surfaced
  // but must NOT force review on their own.
  const newNotes = mergedNotes.filter((n) => !priorNotes.includes(n));
  const newBlockingNotes = newNotes.filter((n) => !n.startsWith(INFO_NOTE_PREFIX));
  const needsReview =
    wordCount > wordBudget ||
    brief.fidelity_check?.status === 'needs_review' ||
    newBlockingNotes.length > 0;

  const withScript: VideoBriefContent = {
    ...brief,
    video_render_style: renderStyle,
    transcript: fullScript,
    narration: {
      ...brief.narration,
      full_script: fullScript,
      script_word_count: wordCount,
    },
    ...(mergedNotes.length > 0 || brief.fidelity_check
      ? {
          fidelity_check: {
            status: needsReview ? 'needs_review' : 'passed',
            notes: mergedNotes,
          },
        }
      : {}),
  };

  // For the Video Agent path we PREFER the LLM-authored director-level prompt
  // (heygen_prompt_payload.prompt) so the brief that was tuned in the prompt is
  // what HeyGen actually receives. We only trust it when it is substantial AND
  // already contains the verbatim script (so we never ship a placeholder or a
  // script-less prompt). Otherwise we fall back to the server-side compiler.
  const llmPrompt = (brief.heygen_prompt_payload?.prompt ?? '').trim();
  const llmPromptUsable = llmPrompt.length >= 200 && fullScript.length > 0 && llmPrompt.includes(fullScript);

  const prompt =
    renderStyle === 'video_agent_produced'
      ? llmPromptUsable
        ? llmPrompt
        : compileHeyGenAgentPrompt(withScript, settings)
      : compileHeyGenPrompt(withScript);

  return {
    ...withScript,
    heygen_prompt_payload: {
      ...brief.heygen_prompt_payload,
      recommended_mode:
        renderStyle === 'video_agent_produced'
          ? brief.heygen_prompt_payload.recommended_mode ?? 'generate'
          : brief.heygen_prompt_payload.recommended_mode,
      prompt,
    },
  };
}
