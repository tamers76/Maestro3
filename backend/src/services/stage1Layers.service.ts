import { getStage1LayerConfig, getStage1LayerConfigs } from '../config.js';
import { STAGE1_LAYER_IDS } from '../config/stage1Layers.defaults.js';
import type {
  Stage1LayerConfig,
  Stage1LayerState,
  Stage1LayerStatus,
  StageExecutionMode,
  ExtractedSnapshot,
  CourseContract,
} from '../models/schemas.js';
import * as fileService from './file.service.js';
import {
  parseLayer2Suggestions,
  seedRefinementsFromSuggestions,
  applyApprovedRefinementsToContract,
  assertLayer2ReadyForApproval,
  getCloRefinementContext,
} from './cloRefinements.service.js';
import {
  parseLayer3Suggestions,
  seedRedesignsFromSuggestions,
  applyApprovedRedesignsToContract,
  assertLayer3ReadyForApproval,
  getAssessmentRedesignContext,
} from './assessmentRedesigns.service.js';
import {
  seedWeightingRubricFromOutput,
  assertLayer4ReadyForApproval,
  buildApprovedWeightingRubricContext,
} from './weightingRubric.service.js';
import {
  seedIntegrityFromOutput,
  assertLayer5ReadyForApproval,
  buildApprovedIntegrityContext,
} from './integrityReview.service.js';
import {
  seedSubtopicArchitectureFromOutput,
  assertLayer6ReadyForApproval,
  buildCloTopicsFromArchitecture,
} from './subtopicArchitecture.service.js';
import { buildGroundedContext } from './referenceRetrieval.service.js';
import { runStage1 } from './stage1.service.js';
import { callAI, parseAIJson, getCouncilInfo } from './ai.service.js';
import {
  startStageProgress,
  updateProgress,
  completeStageProgress,
  errorStageProgress,
  type CouncilInfo,
} from './progress.service.js';

export interface LayerStateView extends Stage1LayerState {
  config: Stage1LayerConfig;
  canRun: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canRegenerate: boolean;
}

function buildIntakeSummaryMarkdown(
  snapshot: ExtractedSnapshot,
  contract: CourseContract
): string {
  const clos = contract.course_learning_outcomes
    .map((c) => `- **${c.clo_id}**: ${c.clo_text}`)
    .join('\n');
  const assessments = snapshot.assessments
    .map((a) => `- **${a.name}** (${a.weight}%): ${a.description}`)
    .join('\n');
  const weeks = (snapshot.weekly_plan || [])
    .map((w) => `- Week ${w.week}: ${w.topic}`)
    .join('\n');

  return `# Course Intake Summary

## Course Information
- **Title:** ${snapshot.title}
- **Code:** ${snapshot.course_code}
- **Credits:** ${snapshot.credit_hours}
- **Description:** ${snapshot.description}

## Official Course Learning Outcomes
${clos || '_None extracted_'}

## Assessment Components
${assessments || '_None extracted_'}

## Weekly Plan (source evidence)
${weeks || '_None extracted_'}

## Delivery & Accreditation
- Accreditation tags: ${contract.course_metadata.accreditation_tags?.join(', ') || 'N/A'}
- Assessment strategy: ${contract.assessment_strategy || 'N/A'}

## Initial Risks
Review weekly structure, missing CLO links, and vague assessments before adaptive redesign.
`;
}

function getOrderedConfigs(): Stage1LayerConfig[] {
  return getStage1LayerConfigs();
}

function getPreviousLayer(config: Stage1LayerConfig): Stage1LayerConfig | undefined {
  const configs = getOrderedConfigs();
  return configs.find((c) => c.order === config.order - 1);
}

async function isPreviousLayerApproved(courseCode: string, config: Stage1LayerConfig): Promise<boolean> {
  if (config.order === 1) return true;
  const prev = getPreviousLayer(config);
  if (!prev) return true;
  const state = await fileService.getStage1LayerState(courseCode, prev.id);
  return state?.status === 'approved';
}

async function computeEffectiveStatus(
  courseCode: string,
  config: Stage1LayerConfig,
  stored?: Stage1LayerState | null
): Promise<Stage1LayerStatus> {
  const raw = stored?.status ?? 'not_started';
  if (raw === 'running') return 'running';
  if (config.order > 1 && !(await isPreviousLayerApproved(courseCode, config))) {
    return 'locked';
  }
  return raw;
}

export async function ensureStage1LayerStates(courseCode: string): Promise<Stage1LayerState[]> {
  const configs = getOrderedConfigs();
  const existing = await fileService.getStage1LayersFile(courseCode);
  const states: Stage1LayerState[] = [];

  for (const config of configs) {
    const found = existing?.layers.find((l) => l.layerId === config.id);
    const status = await computeEffectiveStatus(courseCode, config, found);
    states.push({
      layerId: config.id,
      status,
      reportMarkdown: found?.reportMarkdown,
      outputJson: found?.outputJson,
      generatedAt: found?.generatedAt,
      approvedAt: found?.approvedAt,
      editedAt: found?.editedAt,
      error: found?.error,
    });
  }

  if (!existing) {
    await fileService.saveStage1LayersFile(courseCode, {
      layers: states.map((s) => ({ ...s, status: s.status === 'locked' ? 'not_started' : s.status })),
      updatedAt: new Date().toISOString(),
    });
  }

  return states;
}

export async function getLayerStateViews(courseCode: string): Promise<LayerStateView[]> {
  await ensureStage1LayerStates(courseCode);
  const configs = getOrderedConfigs();

  return Promise.all(configs.map(async (config) => {
    const stored = await fileService.getStage1LayerState(courseCode, config.id);
    const status = await computeEffectiveStatus(courseCode, config, stored);
    const canRun =
      status !== 'running' &&
      status !== 'locked' &&
      (await isPreviousLayerApproved(courseCode, config));
    const canApprove =
      config.approvalRequired &&
      (status === 'generated' || status === 'needs_review' || status === 'needs_revision');
    return {
      layerId: config.id,
      status,
      reportMarkdown: stored?.reportMarkdown,
      outputJson: stored?.outputJson,
      generatedAt: stored?.generatedAt,
      approvedAt: stored?.approvedAt,
      editedAt: stored?.editedAt,
      error: stored?.error,
      config,
      canRun,
      canApprove,
      canEdit: config.editEnabled && !!stored?.reportMarkdown,
      canRegenerate: config.regenerateEnabled && canRun,
    };
  }));
}

export async function allStage1LayersApproved(courseCode: string): Promise<boolean> {
  const views = await getLayerStateViews(courseCode);
  return views.length > 0 && views.every((v) => v.status === 'approved');
}

async function buildUpstreamContext(courseCode: string, beforeOrder: number): Promise<string> {
  const configs = getOrderedConfigs().filter((c) => c.order < beforeOrder);
  const parts: string[] = [];

  for (const config of configs) {
    const state = await fileService.getStage1LayerState(courseCode, config.id);
    if (state?.status === 'approved' && state.reportMarkdown) {
      parts.push(`### ${config.productOutput}\n${state.reportMarkdown}`);
    }
  }

  if (beforeOrder > 2) {
    const { refinements } = await getCloRefinementContext(courseCode);
    if (refinements.length) {
      const lines = refinements
        .map((r) => {
          const refined =
            r.sme_decision === 'keep_official'
              ? r.official_clo
              : r.final_clo_for_adaptive_design;
          return `- ${r.clo_id}\n  - Original (reference only): ${r.official_clo}\n  - SME-APPROVED REFINED (align here): ${refined}\n  - SME decision: ${r.sme_decision}`;
        })
        .join('\n');
      parts.unshift(
        `### SME-APPROVED REFINED CLOs (AUTHORITATIVE)\n` +
          `These approved refined CLOs are the single source of truth for CLO alignment. ` +
          `Design all work against the "SME-APPROVED REFINED" wording. ` +
          `The "Original" wording is provided only for the "Original CLO alignment" field and historical reference - do not design against it.\n\n${lines}`
      );
    }
  }

  if (beforeOrder > 3) {
    const { redesigns } = await getAssessmentRedesignContext(courseCode);
    if (redesigns.length) {
      const lines = redesigns
        .map((r) => {
          const f =
            r.sme_decision === 'keep_original'
              ? {
                  title: r.original_assessment.title,
                  required_artifact: '',
                  refined_clo_alignment: [] as string[],
                  fixed_academic_core: '',
                }
              : r.final_assessment_for_maestro;
          const clos = f.refined_clo_alignment.length
            ? f.refined_clo_alignment.join(', ')
            : 'n/a';
          return `- ${r.assessment_id}: ${f.title}\n  - Required artifact: ${f.required_artifact || 'n/a'}\n  - Refined CLO alignment: ${clos}\n  - Fixed academic core: ${f.fixed_academic_core || 'n/a'}`;
        })
        .join('\n');
      parts.unshift(
        `### SME-APPROVED REDESIGNED ASSESSMENTS (AUTHORITATIVE)\n` +
          `These approved redesigned assessments are the single source of truth for assessment work. ` +
          `Build all downstream analysis against these final assessments.\n\n${lines}`
      );
    }
  }

  if (beforeOrder > 4) {
    const weightingRubricContext = await buildApprovedWeightingRubricContext(courseCode);
    if (weightingRubricContext) {
      parts.unshift(weightingRubricContext);
    }
  }

  if (beforeOrder > 5) {
    const integrityContext = await buildApprovedIntegrityContext(courseCode);
    if (integrityContext) {
      parts.unshift(integrityContext);
    }
  }

  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const contract = await fileService.getCourseContract(courseCode);
  if (snapshot) {
    parts.push(
      `### Syllabus evidence (do not copy weekly structure as course design)\n\`\`\`json\n${JSON.stringify(
        {
          title: snapshot.title,
          description: snapshot.description,
          weekly_plan: snapshot.weekly_plan,
          assessments: snapshot.assessments,
          references: snapshot.references,
        },
        null,
        2
      )}\n\`\`\``
    );
  }
  if (contract) {
    parts.push(
      `### Course contract CLOs\n\`\`\`json\n${JSON.stringify(contract.course_learning_outcomes, null, 2)}\n\`\`\``
    );
  }

  return parts.join('\n\n');
}

function extractReportFromResponse(response: string): { markdown: string; json: unknown } {
  try {
    const parsed = parseAIJson<Record<string, unknown>>(response);
    const markdown =
      typeof parsed.report_markdown === 'string'
        ? parsed.report_markdown
        : `# Report\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    return { markdown, json: parsed };
  } catch {
    return { markdown: response, json: { raw: response } };
  }
}

// Layers whose substance should be tightly grounded in the textbook references.
const STRONG_GROUNDING_LAYERS = new Set([
  'layer2-clo-review',
  'layer6-subtopic-architecture',
]);

/**
 * Build a reference-grounding section (retrieved textbook passages + an augmented
 * grounding policy) to append to a layer's prompt. Returns '' when there are no
 * ingested references or retrieval fails — grounding is additive and never blocks.
 */
async function buildGroundingSection(
  courseCode: string,
  config: Stage1LayerConfig
): Promise<string> {
  try {
    // Query from refined CLOs when available, else the extracted contract CLOs.
    const { refinements } = await getCloRefinementContext(courseCode);
    let cloTexts = refinements
      .map((r) =>
        r.sme_decision === 'keep_official'
          ? r.official_clo
          : r.final_clo_for_adaptive_design || r.official_clo
      )
      .filter((t): t is string => !!t && !!t.trim());

    if (cloTexts.length === 0) {
      const contract = await fileService.getCourseContract(courseCode);
      cloTexts = (contract?.course_learning_outcomes ?? [])
        .map((c) => c.clo_text ?? '')
        .filter((t) => !!t.trim());
    }

    const query = cloTexts.join('\n');
    if (!query.trim()) return '';

    const grounded = await buildGroundedContext(courseCode, query, { topN: 8 });
    if (!grounded.promptBlock) return '';

    const policy = STRONG_GROUNDING_LAYERS.has(config.id)
      ? 'GROUNDING POLICY (authoritative): Base the substance of this layer on the reference passages above and cite them inline as [R#]. If a needed point is not supported by the passages, mark it "(not in provided references)". You may add connective explanation, but do not invent facts, definitions, or examples or attribute unsupported claims to the references.'
      : 'GROUNDING POLICY: Use the reference passages above where relevant and cite them as [R#]. Methodological content (assessment design, weighting, integrity) may extend beyond the passages, but do not fabricate textbook content or attribute unsupported claims to the references.';

    return `\n\n---\n\n${grounded.promptBlock}\n\n${policy}`;
  } catch (err) {
    console.warn(
      '[stage1 grounding] skipped:',
      err instanceof Error ? err.message : String(err)
    );
    return '';
  }
}

export async function runStage1Layer(
  courseCode: string,
  layerId: string,
  executionOverride?: StageExecutionMode
): Promise<Stage1LayerState> {
  const config = getStage1LayerConfig(layerId);
  if (!config) {
    throw new Error(`Unknown Stage 1 layer: ${layerId}`);
  }

  if (!(await isPreviousLayerApproved(courseCode, config))) {
    throw new Error(`Layer "${config.name}" is locked until the previous layer is approved`);
  }

  await fileService.updateStage1LayerState(courseCode, layerId, {
    status: 'running',
    error: undefined,
  });

  const councilInfo = getCouncilInfo(1, executionOverride, config);
  const council: CouncilInfo = {
    mode: councilInfo.mode,
    memberCount: councilInfo.memberCount,
    models: councilInfo.models,
    chairmanModel: councilInfo.chairmanModel,
    phase: councilInfo.mode === 'council' ? 'deliberating' : undefined,
  };

  startStageProgress(courseCode, 1, `Stage 1 Layer ${config.order}: ${config.name}`, council);

  try {
    let reportMarkdown: string;
    let outputJson: unknown;

    if (layerId === 'layer1-intake') {
      const snapshot = await fileService.getExtractedSnapshot(courseCode);
      const rawText = snapshot?.raw_text;
      if (!rawText) {
        throw new Error('No syllabus text found. Upload a course first.');
      }

      updateProgress({
        courseCode,
        stage: 1,
        status: 'running',
        step: config.name,
        message: 'Running course intake and syllabus extraction...',
        council,
      });

      const result = await runStage1(rawText, courseCode, executionOverride);
      if (!result.success) {
        throw new Error(result.error || result.message);
      }

      const updatedSnapshot = await fileService.getExtractedSnapshot(courseCode);
      const contract = await fileService.getCourseContract(courseCode);
      if (!updatedSnapshot || !contract) {
        throw new Error('Extraction completed but snapshot/contract missing');
      }

      reportMarkdown = buildIntakeSummaryMarkdown(updatedSnapshot, contract);
      outputJson = {
        snapshot: {
          course_code: updatedSnapshot.course_code,
          title: updatedSnapshot.title,
          credit_hours: updatedSnapshot.credit_hours,
          assessments: updatedSnapshot.assessments,
          weekly_plan: updatedSnapshot.weekly_plan,
        },
        contract: {
          clos: contract.course_learning_outcomes,
          assessment_strategy: contract.assessment_strategy,
        },
      };
    } else {
      const upstream = await buildUpstreamContext(courseCode, config.order);
      const groundingSection = await buildGroundingSection(courseCode, config);
      const userPrompt = `${config.taskPrompt}\n\n---\n\n## Upstream approved outputs and evidence\n\n${upstream}${groundingSection}`;

      updateProgress({
        courseCode,
        stage: 1,
        status: 'running',
        step: config.name,
        message: `Generating ${config.productOutput}...`,
        council,
      });

      const response = await callAI(
        [{ role: 'user', content: userPrompt }],
        1,
        { jsonMode: true, maxTokens: 16384 },
        executionOverride,
        config
      );

      const extracted = extractReportFromResponse(response);
      reportMarkdown = `# ${config.productOutput}\n\n${extracted.markdown}`;
      outputJson = extracted.json;

      if (layerId === 'layer2-clo-review') {
        const contract = await fileService.getCourseContract(courseCode);
        const clos = contract?.course_learning_outcomes ?? [];
        const suggestions = parseLayer2Suggestions(outputJson, clos);
        outputJson = { ...(typeof outputJson === 'object' && outputJson ? outputJson : {}), clos: suggestions };
        await seedRefinementsFromSuggestions(courseCode);
      }

      if (layerId === 'layer3-assessment-redesign') {
        const snapshot = await fileService.getExtractedSnapshot(courseCode);
        const originalAssessments = snapshot?.assessments ?? [];
        const suggestions = parseLayer3Suggestions(outputJson, originalAssessments);
        outputJson = {
          ...(typeof outputJson === 'object' && outputJson ? outputJson : {}),
          assessments: suggestions,
        };
        // Persist outputJson before seeding so the seed captures fresh suggestions
        await fileService.updateStage1LayerState(courseCode, layerId, { outputJson });
        await seedRedesignsFromSuggestions(courseCode);
      }

      if (layerId === 'layer4-weighting-rubric') {
        // Persist raw AI output before seeding so the seed reads fresh suggestions,
        // then build the SME working file from Layer 3 approved finals + AI rubric.
        await fileService.updateStage1LayerState(courseCode, layerId, { outputJson });
        await seedWeightingRubricFromOutput(courseCode);
      }

      if (layerId === 'layer5-integrity-ai') {
        // Persist raw AI output before seeding so the seed reads fresh suggestions,
        // then build the SME working file from Layer 3 finals + Layer 4 weights/rubric.
        await fileService.updateStage1LayerState(courseCode, layerId, { outputJson });
        await seedIntegrityFromOutput(courseCode);
      }

      if (layerId === 'layer6-subtopic-architecture') {
        // Persist raw AI output before seeding so the seed reads fresh subtopics,
        // then build the SME working file from refined CLOs + approved assessments.
        await fileService.updateStage1LayerState(courseCode, layerId, { outputJson });
        await seedSubtopicArchitectureFromOutput(courseCode);
      }
    }

    completeStageProgress(courseCode, 1, `${config.productOutput} generated`);

    return await fileService.updateStage1LayerState(courseCode, layerId, {
      status: 'needs_review',
      reportMarkdown,
      outputJson,
      generatedAt: new Date().toISOString(),
      error: undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorStageProgress(courseCode, 1, message);
    return await fileService.updateStage1LayerState(courseCode, layerId, {
      status: 'blocked',
      error: message,
    });
  }
}

export async function approveStage1Layer(courseCode: string, layerId: string): Promise<Stage1LayerState> {
  const config = getStage1LayerConfig(layerId);
  if (!config) throw new Error(`Unknown layer: ${layerId}`);

  const state = await fileService.getStage1LayerState(courseCode, layerId);
  if (!state?.reportMarkdown) {
    throw new Error('No report to approve. Run the layer first.');
  }

  const updated = await fileService.updateStage1LayerState(courseCode, layerId, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
  });

  if (layerId === 'layer2-clo-review') {
    const { refinements } = await getCloRefinementContext(courseCode);
    assertLayer2ReadyForApproval(refinements);
    await applyApprovedRefinementsToContract(courseCode);
  }

  if (layerId === 'layer3-assessment-redesign') {
    const { redesigns } = await getAssessmentRedesignContext(courseCode);
    assertLayer3ReadyForApproval(redesigns);
    await applyApprovedRedesignsToContract(courseCode);
  }

  if (layerId === 'layer4-weighting-rubric') {
    await assertLayer4ReadyForApproval(courseCode);
  }

  if (layerId === 'layer5-integrity-ai') {
    await assertLayer5ReadyForApproval(courseCode);
  }

  if (layerId === 'layer6-subtopic-architecture') {
    await assertLayer6ReadyForApproval(courseCode);
    await applySubtopicsToSnapshot(courseCode);
    await fileService.updateConfirmations(courseCode, {
      clo_topics_confirmed_at: new Date().toISOString(),
      clo_topics_summary: 'Approved via Stage 1 Layer 6: Self-Paced Subtopic Architecture',
    });
  }

  return updated;
}

export async function rejectStage1Layer(courseCode: string, layerId: string): Promise<Stage1LayerState> {
  return fileService.updateStage1LayerState(courseCode, layerId, {
    status: 'needs_revision',
  });
}

export async function saveStage1LayerOutput(
  courseCode: string,
  layerId: string,
  reportMarkdown: string
): Promise<Stage1LayerState> {
  const config = getStage1LayerConfig(layerId);
  if (!config?.editEnabled) {
    throw new Error('Manual edit is disabled for this layer');
  }

  return fileService.updateStage1LayerState(courseCode, layerId, {
    reportMarkdown,
    editedAt: new Date().toISOString(),
    status: 'needs_review',
  });
}

/**
 * Project the SME-approved Layer 6 subtopic architecture down to the thin
 * `clo_topics` model that Stage 2 still consumes, overwriting any prior topics.
 */
async function applySubtopicsToSnapshot(courseCode: string): Promise<void> {
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  if (!snapshot) return;

  const cloTopics = await buildCloTopicsFromArchitecture(courseCode);
  if (!cloTopics) return;

  await fileService.saveExtractedSnapshot(courseCode, {
    ...snapshot,
    clo_topics: cloTopics,
  });
}

export { STAGE1_LAYER_IDS };
