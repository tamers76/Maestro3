/**
 * Structured Visual production output (semantic visual specification).
 * Schema aligns with structured_visual_generation_prompt / schema:structured_visual_object_v1.
 *
 * A structured visual is NOT an image — it is editable structured DATA (elements,
 * relationships, annotations) that a platform renderer draws. The optional
 * `rendering_route` allows a later AI-infographic export without reworking the schema.
 */
import {
  NodeEngineValidationError,
  type GroundingStrength,
} from '../models/nodeEngine.js';

/** The 13 structured visual types (mirrors the prompt's visual_type enum). */
export const STRUCTURED_VISUAL_TYPES = [
  'comparison_table',
  'process_map',
  'concept_map',
  'decision_tree',
  'framework_diagram',
  'criteria_matrix',
  'annotated_example',
  'rubric_map',
  'checklist_visual',
  'timeline',
  'hierarchy',
  'cause_effect_map',
  'infographic',
] as const;
export type StructuredVisualType = (typeof STRUCTURED_VISUAL_TYPES)[number];

/** Editable content-unit types carried by a structured visual. */
export const SEMANTIC_ELEMENT_TYPES = [
  'concept',
  'criterion',
  'step',
  'example',
  'non_example',
  'misconception',
  'correction',
  'evidence',
  'decision_point',
  'rubric_level',
  'checklist_item',
] as const;
export type SemanticElementType = (typeof SEMANTIC_ELEMENT_TYPES)[number];

/** Structured connection types between elements. */
export const RELATIONSHIP_TYPES = [
  'contrasts_with',
  'leads_to',
  'depends_on',
  'supports',
  'violates',
  'maps_to',
  'prepares_for',
  'corrects',
  'exemplifies',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/** Learner-facing annotation types. */
export const ANNOTATION_TYPES = [
  'explanation',
  'warning',
  'misconception_alert',
  'evidence_note',
  'rubric_note',
  'assessment_tip',
] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/** How the visual is produced for review. v1 ships platform_native; ai_infographic is future. */
export const RENDERING_ROUTES = ['platform_native', 'ai_infographic'] as const;
export type RenderingRoute = (typeof RENDERING_ROUTES)[number];

export const EVIDENCE_CHECK_ROLES = [
  'not_evidence_check',
  'supporting_visual',
  'evidence_collection_visual',
] as const;
export type StructuredVisualEvidenceRole = (typeof EVIDENCE_CHECK_ROLES)[number];

/** Element types whose label carries academic meaning that REQUIRES a citation. */
const CITATION_REQUIRED_ELEMENT_TYPES: ReadonlySet<SemanticElementType> = new Set([
  'criterion',
  'rubric_level',
  'evidence',
]);

export interface SemanticElement {
  element_id: string;
  element_type: SemanticElementType;
  label: string;
  description?: string;
  /** Textual citation/passage ref backing this element (when academic). */
  citation?: string;
  importance?: string;
}

export interface SemanticRelationship {
  from_element_id: string;
  to_element_id: string;
  relationship_type: RelationshipType;
  label?: string;
}

export interface SemanticAnnotation {
  annotation_id: string;
  target_element_id: string;
  annotation_type: AnnotationType;
  text: string;
  citation?: string;
}

export interface StructuredVisualContent {
  visual_type: StructuredVisualType;
  /** Display title for the visual (derived from the spec when the LLM omits it). */
  title: string;
  semantic_elements: SemanticElement[];
  relationships: SemanticRelationship[];
  annotations: SemanticAnnotation[];
  layout_intent: string;
  /** Accessible reading sequence — ordered element_ids. */
  reading_order: string[];
  renderer_notes?: string;
  /** Short accessibility label. */
  alt_text: string;
  /** Full academic-meaning text equivalent (mandatory accessibility). */
  text_equivalent: string;
  /**
   * Short student-facing caption (teacher voice + throughline) shown under the
   * visual to help a learner read and understand it. Optional for backward-compat.
   */
  learner_caption?: string;
  grounding_strength: GroundingStrength;
  evidence_check_role?: StructuredVisualEvidenceRole;
  /** Defaults to platform_native; ai_infographic reserved for a later export route. */
  rendering_route: RenderingRoute;
  fidelity_check?: { status: 'passed' | 'needs_review'; notes: string[] };
}

// ===========================================================================
// Parsing helpers (self-contained, defensive — mirrors videoBrief.types.ts)
// ===========================================================================

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
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function assertEnum<T extends string>(
  allowed: readonly T[],
  value: unknown,
  ctx: string
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new NodeEngineValidationError(`${ctx}: expected one of ${allowed.join(' | ')}`);
  }
  return value as T;
}

/** Citation may arrive as a string or as { citation, passage_ref } — normalize to a string. */
function normalizeCitation(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const cit = typeof obj.citation === 'string' ? obj.citation.trim() : '';
    const ref = typeof obj.passage_ref === 'string' ? obj.passage_ref.trim() : '';
    const joined = [cit, ref].filter(Boolean).join(' · ');
    return joined || undefined;
  }
  return undefined;
}

function parseSemanticElement(input: unknown, i: number): SemanticElement {
  const ctx = `semantic_elements[${i}]`;
  const obj = asRecord(input, ctx);
  const element: SemanticElement = {
    element_id: optionalString(obj, 'element_id') ?? `el_${i + 1}`,
    element_type: assertEnum(SEMANTIC_ELEMENT_TYPES, obj.element_type, `${ctx}.element_type`),
    label: requireString(obj, 'label', ctx),
  };
  const description = optionalString(obj, 'description');
  if (description) element.description = description;
  const citation = normalizeCitation(obj.citation);
  if (citation) element.citation = citation;
  const importance = optionalString(obj, 'importance');
  if (importance) element.importance = importance;
  return element;
}

function parseRelationship(input: unknown, i: number): SemanticRelationship {
  const ctx = `relationships[${i}]`;
  const obj = asRecord(input, ctx);
  const rel: SemanticRelationship = {
    from_element_id: requireString(obj, 'from_element_id', ctx),
    to_element_id: requireString(obj, 'to_element_id', ctx),
    relationship_type: assertEnum(RELATIONSHIP_TYPES, obj.relationship_type, `${ctx}.relationship_type`),
  };
  const label = optionalString(obj, 'label');
  if (label) rel.label = label;
  return rel;
}

function parseAnnotation(input: unknown, i: number): SemanticAnnotation {
  const ctx = `annotations[${i}]`;
  const obj = asRecord(input, ctx);
  const ann: SemanticAnnotation = {
    annotation_id: optionalString(obj, 'annotation_id') ?? `an_${i + 1}`,
    target_element_id: requireString(obj, 'target_element_id', ctx),
    annotation_type: assertEnum(ANNOTATION_TYPES, obj.annotation_type, `${ctx}.annotation_type`),
    text: requireString(obj, 'text', ctx),
  };
  const citation = normalizeCitation(obj.citation);
  if (citation) ann.citation = citation;
  return ann;
}

export function parseStructuredVisualContent(input: unknown): StructuredVisualContent {
  const root = asRecord(input, 'StructuredVisualContent');
  const obj = root.content ? asRecord(root.content, 'StructuredVisualContent.content') : root;

  const elementsRaw = obj.semantic_elements;
  if (!Array.isArray(elementsRaw) || elementsRaw.length === 0) {
    throw new NodeEngineValidationError('semantic_elements: required non-empty array');
  }
  const semantic_elements = elementsRaw.map(parseSemanticElement);
  const elementIds = new Set(semantic_elements.map((e) => e.element_id));

  const relationships = Array.isArray(obj.relationships)
    ? obj.relationships.map(parseRelationship)
    : [];

  const annotations = Array.isArray(obj.annotations) ? obj.annotations.map(parseAnnotation) : [];

  const reading_order = Array.isArray(obj.reading_order)
    ? (obj.reading_order as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];

  const gs = obj.grounding_strength;
  const grounding_strength: GroundingStrength =
    gs === 'strong' || gs === 'moderate' || gs === 'weak' ? gs : 'weak';

  const route = obj.rendering_route;
  const rendering_route: RenderingRoute = route === 'ai_infographic' ? 'ai_infographic' : 'platform_native';

  let evidence_check_role: StructuredVisualEvidenceRole | undefined;
  if (typeof obj.evidence_check_role === 'string') {
    const r = obj.evidence_check_role;
    if (r === 'not_evidence_check' || r === 'supporting_visual' || r === 'evidence_collection_visual') {
      evidence_check_role = r;
    }
  }

  let fidelity_check: StructuredVisualContent['fidelity_check'];
  if (obj.fidelity_check && typeof obj.fidelity_check === 'object') {
    const fc = asRecord(obj.fidelity_check, 'fidelity_check');
    fidelity_check = {
      status: fc.status === 'passed' ? 'passed' : 'needs_review',
      notes: Array.isArray(fc.notes)
        ? (fc.notes as unknown[]).filter((n): n is string => typeof n === 'string')
        : [],
    };
  }

  const content: StructuredVisualContent = {
    visual_type: assertEnum(STRUCTURED_VISUAL_TYPES, obj.visual_type, 'visual_type'),
    title: optionalString(obj, 'title') ?? 'Structured visual',
    semantic_elements,
    relationships: relationships.filter(
      (r) => elementIds.has(r.from_element_id) && elementIds.has(r.to_element_id)
    ),
    annotations: annotations.filter((a) => elementIds.has(a.target_element_id)),
    layout_intent: optionalString(obj, 'layout_intent') ?? '',
    reading_order: reading_order.filter((id) => elementIds.has(id)),
    alt_text: requireString(obj, 'alt_text', 'StructuredVisualContent'),
    text_equivalent: requireString(obj, 'text_equivalent', 'StructuredVisualContent'),
    grounding_strength,
    rendering_route,
    ...(optionalString(obj, 'learner_caption') ? { learner_caption: optionalString(obj, 'learner_caption') } : {}),
    ...(optionalString(obj, 'renderer_notes') ? { renderer_notes: optionalString(obj, 'renderer_notes') } : {}),
    ...(evidence_check_role ? { evidence_check_role } : {}),
    ...(fidelity_check ? { fidelity_check } : {}),
  };

  return content;
}

/**
 * Ensure reading_order covers every element, citation coverage is checked, and a
 * fidelity_check is stamped. Pure — no I/O.
 */
export function finalizeStructuredVisual(content: StructuredVisualContent): StructuredVisualContent {
  const elementIds = content.semantic_elements.map((e) => e.element_id);

  // reading_order must list every element exactly once; rebuild deterministically
  // when the LLM omitted ids (append the missing ones in element order).
  const ordered = content.reading_order.filter((id) => elementIds.includes(id));
  for (const id of elementIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }

  const priorNotes = content.fidelity_check?.notes ?? [];
  const notes: string[] = [];

  const missingCitations = content.semantic_elements.filter(
    (e) => CITATION_REQUIRED_ELEMENT_TYPES.has(e.element_type) && !e.citation
  );
  if (missingCitations.length > 0) {
    notes.push(
      `${missingCitations.length} academic element(s) (${missingCitations
        .map((e) => e.element_type)
        .join(', ')}) are missing a citation — add a source before publish.`
    );
  }

  if (content.grounding_strength === 'weak') {
    notes.push('Source grounding is weak — SME review recommended before publish.');
  }

  if (content.semantic_elements.length < 2) {
    notes.push('Only one element — a structured visual usually needs at least two related parts.');
  }

  const mergedNotes = [...priorNotes.filter((n) => !notes.includes(n)), ...notes];
  const needsReview = notes.length > 0 || content.fidelity_check?.status === 'needs_review';

  return {
    ...content,
    reading_order: ordered,
    fidelity_check: {
      status: needsReview ? 'needs_review' : 'passed',
      notes: mergedNotes,
    },
  };
}

/** JSON shape embedded in the user message as output_contract. */
export const STRUCTURED_VISUAL_OUTPUT_CONTRACT = {
  content: {
    visual_type:
      'comparison_table | process_map | concept_map | decision_tree | framework_diagram | criteria_matrix | annotated_example | rubric_map | checklist_visual | timeline | hierarchy | cause_effect_map | infographic',
    title: 'string — short display title for the visual',
    semantic_elements: [
      {
        element_id: 'string — stable id referenced by relationships/annotations/reading_order',
        element_type:
          'concept | criterion | step | example | non_example | misconception | correction | evidence | decision_point | rubric_level | checklist_item',
        label: 'string — short grounded label (no invented academic content)',
        description: 'string — optional detail',
        citation: 'string — REQUIRED for criterion/rubric_level/evidence and any definition/quote',
        importance: 'string — optional (e.g. primary | secondary | supporting)',
      },
    ],
    relationships: [
      {
        from_element_id: 'string',
        to_element_id: 'string',
        relationship_type:
          'contrasts_with | leads_to | depends_on | supports | violates | maps_to | prepares_for | corrects | exemplifies',
        label: 'string — optional',
      },
    ],
    annotations: [
      {
        annotation_id: 'string',
        target_element_id: 'string',
        annotation_type:
          'explanation | warning | misconception_alert | evidence_note | rubric_note | assessment_tip',
        text: 'string',
        citation: 'string — optional',
      },
    ],
    layout_intent: 'string — how the structure should READ (not visual styling)',
    reading_order: ['element_id — ordered accessible reading sequence covering every element'],
    renderer_notes: 'string — optional structural priorities (no colors/fonts/decorative layout)',
    alt_text: 'string — short accessibility label',
    text_equivalent: 'string — full ACADEMIC MEANING of the visual (not just appearance)',
    learner_caption:
      'string — SHORT student-facing caption (1-3 plain sentences) written as a teacher explaining THIS visual to a learner: where to start and how to follow it, how the parts connect (the throughline), and the one key takeaway (plus the misconception to avoid if present). Warm, plain, second person ("Start at...", "Notice that..."). Ground every statement in the visual elements/relationships — no invented content, no fictional characters or plot. Distinct from text_equivalent.',
    grounding_strength: 'strong | moderate | weak',
    evidence_check_role: 'not_evidence_check | supporting_visual | evidence_collection_visual',
    fidelity_check: { status: 'passed | needs_review', notes: ['string'] },
  },
};
