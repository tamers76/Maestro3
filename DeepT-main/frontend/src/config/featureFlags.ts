/**
 * Frontend feature flags (mirror of the backend flag).
 *
 * LEGACY_STAGES_ENABLED hides the legacy Stage 2-5 UI (Edit Graph, Graph View,
 * Stage 3 Logic, Content tabs and their model-config sections) while the
 * Maestro Node Engine is built on top of Stage 1. Set
 * VITE_LEGACY_STAGES_ENABLED=true to restore the legacy UI without code changes.
 */
export const LEGACY_STAGES_ENABLED =
  (import.meta.env.VITE_LEGACY_STAGES_ENABLED ?? 'false').toString().toLowerCase() === 'true'
