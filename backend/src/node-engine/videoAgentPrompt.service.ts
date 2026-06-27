/**
 * HeyGen Video Agent prompt compiler (POST /v3/video-agents).
 *
 * Mirrors the reference prompt-builder section order but enforces Maestro's
 * academic guardrails: the structured scenes come from the grounded brief,
 * on-screen text is verbatim-only, and the narration fidelity directive
 * (moderate vs strict) controls how much the agent may rephrase.
 */
import type { VideoSettings } from '../models/nodeEngine.js';
import {
  countScriptWords,
  type VideoAgentProduction,
  type VideoAgentSection,
  type VideoBriefContent,
} from './videoBrief.types.js';

export const DEFAULT_TARGET_DURATION_SECONDS = 180;

/** Moderate fidelity — natural delivery without contaminating academic content. */
export const MODERATE_FRAMING_DIRECTIVE =
  'The section NARRATION carries approved academic content. You may add brief ' +
  'transitions and natural connective phrasing for spoken delivery, but you must ' +
  'NOT add facts, examples, definitions, statistics, names, or quotations that are ' +
  'not present in the narration, and you must NOT omit any required point. Do not ' +
  'pad with silence or pauses.';

/** Strict fidelity — deliver narration verbatim. */
export const STRICT_FRAMING_DIRECTIVE =
  'Deliver each section NARRATION verbatim. Do not rephrase, expand, summarize, or ' +
  'reorder the academic content. On-screen text must match the provided items exactly.';

/** Relaxed fidelity — creative delivery with grounded, illustrative analogies. */
export const RELAXED_FRAMING_DIRECTIVE =
  'The section NARRATION carries approved academic content. Deliver it in an engaging, ' +
  'conversational, story-driven way: you MAY rephrase freely and add hooks, transitions, ' +
  'and clarifying EVERYDAY ANALOGIES or illustrations that make ideas easier to grasp. You ' +
  'must NOT introduce new academic facts, definitions, statistics, dates, names, or ' +
  'quotations beyond the approved content, must NOT contradict or omit any required point, ' +
  'and any analogy must read as clearly illustrative (never as a course fact). Keep ' +
  'everything accurate and grounded.';

/** Prefix marking a non-blocking, informational fidelity note (does not force review). */
export const INFO_NOTE_PREFIX = 'INFO: ';

export const DEFAULT_STYLE_BLOCK =
  'Use vibrant, modern educational motion-design. Build full-screen animated scenes for each ' +
  'section — illustrated metaphors, split-screen comparisons, animated infographics, icon ' +
  'systems, data visualizations, and contextual B-roll — not a static talking head. Reinforce ' +
  'each beat with bold on-screen titles, bullet callouts, and pull-quotes. Include an animated ' +
  'intro title card, clear chapter breaks between sections, and an outro. Keep motion purposeful ' +
  'and smooth; every visual should illustrate the narration, never distract from it.';

/** Cinematic scene-composition directive injected for the Produced path. */
export const VISUAL_COMPOSITION_DIRECTIVE =
  'VISUAL COMPOSITION: Treat each section as its own distinct scene with a unique visual ' +
  'treatment driven by that section\u2019s VISUAL description. Prefer full-screen animation, ' +
  'motion graphics, metaphors, split-screens, and infographics over a centered talking head. ' +
  'Vary the visuals across sections so the video feels produced and dynamic. Use on-screen text ' +
  '(titles, short bullet lists, quotes) to anchor key points, and smooth transitions between scenes.';

export type RenderStyleOverride = 'studio_direct' | 'video_agent_produced' | 'inherit';

/**
 * Resolve the effective render style for an object:
 * per-object override (unless "inherit") wins over the course-wide settings default,
 * which falls back to video_agent_produced (Produced).
 */
export function resolveEffectiveRenderStyle(
  settings: VideoSettings | undefined,
  objectOverride?: RenderStyleOverride
): 'studio_direct' | 'video_agent_produced' {
  if (objectOverride && objectOverride !== 'inherit') return objectOverride;
  return settings?.video_render_style ?? 'video_agent_produced';
}

function framingDirective(settings: VideoSettings): string {
  const custom = settings.agent_prompt_templates?.scriptFramingDirective?.trim();
  if (custom) return custom;
  switch (settings.narration_fidelity) {
    case 'strict':
      return STRICT_FRAMING_DIRECTIVE;
    case 'relaxed':
      return RELAXED_FRAMING_DIRECTIVE;
    default:
      return MODERATE_FRAMING_DIRECTIVE;
  }
}

function renderSection(section: VideoAgentSection): string {
  const durationSuffix =
    typeof section.duration_seconds === 'number' && section.duration_seconds > 0
      ? ` | ${section.duration_seconds}s`
      : '';
  const lines = [`[Section ${section.section_number} – ${section.title}${durationSuffix}]`];
  lines.push(`NARRATION: ${section.narration.trim()}`);
  if (section.visual_description?.trim()) {
    lines.push(`VISUAL: ${section.visual_description.trim()}`);
  }
  if (section.on_screen_text && section.on_screen_text.length > 0) {
    lines.push(`ON-SCREEN: ${section.on_screen_text.join(' / ')}`);
  }
  if (section.transitions?.trim()) {
    lines.push(`TRANSITION: ${section.transitions.trim()}`);
  }
  return lines.join('\n');
}

function renderStructuredScript(production: VideoAgentProduction): string {
  const contextLines: string[] = [];
  if (production.learning_objective?.trim()) {
    contextLines.push(`Learning Objective: ${production.learning_objective.trim()}`);
  }
  if (production.target_audience?.trim()) {
    contextLines.push(`Target Audience: ${production.target_audience.trim()}`);
  }
  const sectionBlocks = production.sections.map(renderSection);
  const body = [contextLines.join('\n'), ...sectionBlocks].filter((b) => b.trim()).join('\n\n');
  return `--- STRUCTURED SCRIPT ---\n${body}\n--- END SCRIPT ---`;
}

function brandBlock(settings: VideoSettings): string | null {
  const kit = settings.brand_kit;
  if (!kit?.enabled) return null;
  const lines: string[] = [];
  const palette = [kit.primaryColor, kit.secondaryColor, kit.accentColor]
    .filter((c): c is string => !!c && c.trim().length > 0)
    .join(', ');
  if (palette) {
    lines.push(`BRAND COLORS: Use ${palette} as the core palette for on-screen graphics.`);
  }
  if (kit.fontFamily?.trim()) {
    lines.push(`BRAND FONT: Use the ${kit.fontFamily.trim()} font family for all on-screen text.`);
  }
  if (kit.mediaTypeGuidance?.trim()) {
    lines.push(`MEDIA TYPES: ${kit.mediaTypeGuidance.trim()}`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Compile a single Video Agent prompt from a produced brief + render settings.
 * Throws nothing — callers should have validated agent_production beforehand.
 */
export function compileHeyGenAgentPrompt(
  brief: VideoBriefContent,
  settings: VideoSettings = { provider: 'heygen' }
): string {
  const production = brief.agent_production;
  if (!production) {
    // Defensive fallback — should not happen for video_agent_produced briefs.
    return compileFallbackPrompt(brief);
  }

  const hasAvatar = !!settings.avatar_id?.trim() || (settings.avatar_rotation_pool?.length ?? 0) > 0;
  const targetDuration =
    settings.target_duration_seconds && settings.target_duration_seconds > 0
      ? settings.target_duration_seconds
      : DEFAULT_TARGET_DURATION_SECONDS;
  const wordCount = brief.narration.script_word_count ?? countScriptWords(brief.narration.full_script);

  const presenterLine = hasAvatar
    ? 'PRESENTER: Open and close the video with the selected presenter on camera. During the body, ' +
      'narrate as voice-over while full-screen animated scenes play, cutting back to the presenter ' +
      'only for emphasis. When the presenter is on camera, keep their face and upper body unobstructed.'
    : 'Voice-over narration only (no on-camera presenter) — carry the whole video with animated scenes.';

  const parts: Array<string | null> = [
    `Create an engaging, produced educational video titled "${brief.narration.video_title}".`,
    `Target duration: about ${targetDuration} seconds (~${wordCount} words of narration).`,
    brief.tone?.trim() ? `Tone: ${brief.tone.trim()}.` : null,
    renderStructuredScript(production),
    production.production_notes?.trim() ? `Production Notes: ${production.production_notes.trim()}` : null,
    production.critical_on_screen_text.length > 0
      ? [
          'CRITICAL ON-SCREEN TEXT (render these exactly as written, do not rephrase):',
          ...production.critical_on_screen_text.map((item) => `- ${item}`),
        ].join('\n')
      : null,
    framingDirective(settings),
    VISUAL_COMPOSITION_DIRECTIVE,
    presenterLine,
    [
      'WHAT TO AVOID:',
      ...brief.what_to_avoid.map((item) => `- ${item}`),
    ].join('\n'),
    settings.style_id?.trim()
      ? null
      : settings.agent_prompt_templates?.defaultStyleBlock?.trim() || DEFAULT_STYLE_BLOCK,
    brandBlock(settings),
  ];

  return parts.filter((p): p is string => !!p && p.trim().length > 0).join('\n\n');
}

function compileFallbackPrompt(brief: VideoBriefContent): string {
  return [
    `Create an educational video titled "${brief.narration.video_title}".`,
    'NARRATION (deliver faithfully; do not add unsupported facts):',
    brief.narration.full_script.trim(),
    `Tone: ${brief.tone}.`,
  ].join('\n\n');
}

/** Normalize text for narration-vs-sections comparison (whitespace + markdown emphasis). */
export function normalizeNarrationForCompare(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Validate a Video Agent production block against Maestro guardrails.
 * Returns fidelity notes (empty = clean); does not throw on soft issues.
 */
export interface ValidateAgentProductionOptions {
  /** Strict fidelity: every on-screen text item must trace to an approved key term. */
  enforceOnScreenTracing?: boolean;
  /** Max sections allowed (defaults to 6; raise for longer/cinematic videos). */
  maxSections?: number;
  /** Relaxed fidelity: script-drift is expected, so report it as info, not a flag. */
  relaxedNarration?: boolean;
}

export function validateAgentProduction(
  production: VideoAgentProduction,
  fullScript: string,
  keyTerms: string[] = [],
  options: ValidateAgentProductionOptions = {}
): string[] {
  const notes: string[] = [];
  const maxSections = options.maxSections ?? 8;

  if (production.sections.length < 3 || production.sections.length > maxSections) {
    notes.push(
      `agent_production has ${production.sections.length} sections — expected 3 to ${maxSections} for a course video.`
    );
  }

  const sectionsConcat = normalizeNarrationForCompare(
    production.sections.map((s) => s.narration).join(' ')
  );
  const scriptNorm = normalizeNarrationForCompare(fullScript);
  if (sectionsConcat !== scriptNorm) {
    notes.push(
      options.relaxedNarration
        ? `${INFO_NOTE_PREFIX}Relaxed narration: spoken delivery differs from the approved script ` +
          '(expected in relaxed mode — confirm any analogies stay illustrative and add no new academic facts).'
        : 'Section narrations do not match narration.full_script verbatim — review for academic drift.'
    );
  }

  // On-screen callouts (titles, bullet lists, quotes) are encouraged in cinematic mode;
  // only flag untraced items when strict fidelity is requested.
  if (options.enforceOnScreenTracing && keyTerms.length > 0) {
    const approved = keyTerms.map((t) => normalizeNarrationForCompare(t));
    for (const section of production.sections) {
      for (const item of section.on_screen_text ?? []) {
        const norm = normalizeNarrationForCompare(item);
        const traced = approved.some((t) => norm.includes(t) || t.includes(norm));
        if (!traced && norm.length > 0) {
          notes.push(
            `On-screen text "${item}" (section ${section.section_number}) does not trace to an approved key term.`
          );
        }
      }
    }
  }

  return notes;
}
