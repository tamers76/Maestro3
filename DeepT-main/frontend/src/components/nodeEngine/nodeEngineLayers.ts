/**
 * Node Engine layer map — UI DISPLAY + DEVELOPER REFERENCE ONLY.
 *
 * This constant frames the Node Engine as five user-facing layers (mirroring the
 * Course Architect rhythm: each layer is approved before the next unlocks). It is
 * purely a presentation/reference aid for rendering the Node Engine panel and the
 * operational layer cards.
 *
 * It is NOT a rename of any service, function, route, file, DB label, or module
 * and introduces NO behavioural dependency — nothing keys off these values.
 *
 * Two registers are intentionally separated here:
 *  - `label` is the USER-FACING product wording (Node Engine, Layer 1–5).
 *  - `module` (M7–M11) and `specReference` (Build Spec steps/sections) are the
 *    ENGINEERING/spec register, kept for developer clarity only. They should not
 *    be surfaced verbatim to end users unless they fit the design.
 *
 * `active: true` marks the only operational layer in this phase (Layer 1, wired
 * to the M7 node-generation backend). Layers 2–5 are UI placeholders that unlock
 * in sequence once the previous layer is approved — they have NO backend logic
 * (M8/M9/M10/Step 9 arrive in later phases).
 */
export interface NodeEngineLayer {
  layer: number
  label: string
  module: string
  specReference: string
  /** Whether this layer is operational (wired to a backend) in this phase. */
  active: boolean
  /** Short, user-facing description of the layer's job. */
  job: string
  /** The product name of this layer's output artifact. */
  output: string
  /** Why the layer is locked until its precondition is met (user-facing copy). */
  lockReason: string
}

export const NODE_ENGINE_LAYER_MAP: NodeEngineLayer[] = [
  {
    layer: 1,
    label: 'Node Generation',
    module: 'M7',
    specReference: 'Build Spec Step 2',
    active: true,
    job: 'Generate 4–7 governed mastery nodes from an approved Course Architect subtopic.',
    output: 'Node Set Report',
    lockReason: 'Approve at least one subtopic in Course Architect (Layer 6) first.',
  },
  {
    layer: 2,
    label: 'Experience Blueprint',
    module: 'M8',
    specReference: 'Build Spec §8.0',
    active: false,
    job: 'Shape each approved node into a learning experience blueprint.',
    output: 'Experience Blueprint',
    lockReason: 'Approve Layer 1 — Node Generation first.',
  },
  {
    layer: 3,
    label: 'Content Specification',
    module: 'M9',
    specReference: 'Build Spec §8.1',
    active: false,
    job: 'Specify the full content contract for each blueprinted node.',
    output: 'Content Specification',
    lockReason: 'Approve Layer 2 — Experience Blueprint first.',
  },
  {
    layer: 4,
    label: 'Modality Production',
    module: 'M10',
    specReference: 'Build Spec §8.2–§8.14',
    active: false,
    job: 'Produce the learning objects across their chosen modalities.',
    output: 'Produced Learning Objects',
    lockReason: 'Approve Layer 3 — Content Specification first.',
  },
  {
    layer: 5,
    label: 'Validation & Review',
    module: 'M11',
    specReference: 'Build Spec Step 9',
    active: false,
    job: 'Validate produced objects and route flagged items for review.',
    output: 'Validation Report',
    lockReason: 'Approve Layer 4 — Modality Production first.',
  },
]
