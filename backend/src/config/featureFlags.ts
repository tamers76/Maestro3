/**
 * Platform feature flags.
 *
 * LEGACY_STAGES_ENABLED parks the legacy Stage 2-5 pipeline (cognitive node
 * decomposition, adaptive logic, content production, structural assembly).
 * The Maestro Node Engine consumes the approved Stage 1 Layer 6 output
 * directly and supersedes Stages 2-5, so they are disabled by default. They
 * are parked (not deleted) so the flag can re-enable them with no code change:
 * set the env var LEGACY_STAGES_ENABLED=true.
 */
function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export const LEGACY_STAGES_ENABLED = readBooleanEnv('LEGACY_STAGES_ENABLED', false);

/** Stage numbers retired behind the legacy flag (Stage 1 always stays on). */
export const LEGACY_STAGE_NUMBERS: readonly number[] = [2, 3, 4, 5];

export function isLegacyStage(stageNum: number): boolean {
  return LEGACY_STAGE_NUMBERS.includes(stageNum);
}
