import puppeteer from 'puppeteer';
import { marked } from 'marked';
import HTMLtoDOCX from 'html-to-docx';
import archiver from 'archiver';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import { startStageProgress, updateProgress, completeStageProgress, errorStageProgress, type CouncilInfo } from './progress.service.js';
import type {
  StageResult, LearningNode, CLO, StageExecutionMode,
  Stage4NodeContent, VideoScript, NodeAssessment,
  CourseRubric, WorkloadMap, Course
} from '../models/schemas.js';
import type { CompiledDocType, CompiledDocFormat } from './file.service.js';

// ============================================================================
// HELPERS
// ============================================================================

// Topological sort for node ordering
function topologicalSort(nodes: LearningNode[]): LearningNode[] {
  const nodeMap = new Map<string, LearningNode>();
  const visited = new Set<string>();
  const result: LearningNode[] = [];

  for (const node of nodes) {
    nodeMap.set(node.node_id, node);
  }

  function visit(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return;

    // Visit prerequisites first
    for (const prereqId of node.prerequisite_nodes || []) {
      visit(prereqId);
    }

    result.push(node);
  }

  for (const node of nodes) {
    visit(node.node_id);
  }

  return result;
}

// Group nodes by CLO
function groupNodesByCLO(nodes: LearningNode[]): Map<string, LearningNode[]> {
  const groups = new Map<string, LearningNode[]>();

  for (const node of nodes) {
    const existing = groups.get(node.clo_id) || [];
    existing.push(node);
    groups.set(node.clo_id, existing);
  }

  // Sort nodes within each group
  for (const [cloId, cloNodes] of groups) {
    groups.set(cloId, topologicalSort(cloNodes));
  }

  return groups;
}

// ============================================================================
// SHARED STYLES (used by both PDF and DOCX pipelines)
// ============================================================================

const DOCUMENT_CSS = `
    @page {
      margin: 2cm;
      size: A4;
    }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    h1 {
      color: #1a365d;
      border-bottom: 3px solid #2c5282;
      padding-bottom: 10px;
      page-break-before: always;
    }
    h1:first-of-type {
      page-break-before: avoid;
    }
    h2 {
      color: #2c5282;
      margin-top: 30px;
    }
    h3 {
      color: #3182ce;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
    }
    pre {
      background: #1a202c;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
      color: inherit;
    }
    blockquote {
      border-left: 4px solid #2c5282;
      margin: 20px 0;
      padding-left: 20px;
      color: #4a5568;
      font-style: italic;
    }
    ul, ol {
      margin: 15px 0;
      padding-left: 30px;
    }
    li {
      margin: 8px 0;
    }
    hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 40px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 12px;
      text-align: left;
    }
    th {
      background: #f7fafc;
    }
    .page-break {
      page-break-after: always;
    }`;

function wrapHtml(title: string, htmlContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${DOCUMENT_CSS}</style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
}

// ============================================================================
// MARKDOWN BUILDERS — One per document type
// ============================================================================

interface MarkdownBuildContext {
  course: Course;
  clos: CLO[];
  cloMap: Map<string, CLO>;
  nodesByCLO: Map<string, LearningNode[]>;
  nodeContents: Map<string, string>;
  allVideoScripts: VideoScript[];
  allAssessments: NodeAssessment[];
  rubric: CourseRubric | null;
  workloadMap: WorkloadMap | null;
}

/**
 * 1. Main Course — full course book with chapters only.
 *    No appendices (no rubric, workload, video scripts, or assessments).
 */
function buildMainCourseMarkdown(ctx: MarkdownBuildContext): string {
  let md = `# ${ctx.course.title}\n\n`;
  md += `**Course Code:** ${ctx.course.course_code}\n\n`;
  md += `**Credits:** ${ctx.course.credit_hours}\n\n`;
  md += `${ctx.course.description}\n\n`;
  md += `---\n\n`;

  // CLOs list
  md += `# Course Learning Outcomes\n\n`;
  ctx.clos.forEach((clo, i) => {
    md += `${i + 1}. **${clo.clo_text}** (Bloom: ${clo.bloom_level}, ${clo.knowledge_type})\n`;
  });
  md += '\n---\n\n';

  // TOC
  md += `# Table of Contents\n\n`;
  let chapterNum = 1;
  for (const [cloId, cloNodes] of ctx.nodesByCLO) {
    const clo = ctx.cloMap.get(cloId);
    md += `## Chapter ${chapterNum}: ${clo?.clo_text?.substring(0, 60) || cloId}...\n\n`;
    for (const node of cloNodes) {
      md += `- ${node.learning_intent}\n`;
    }
    md += '\n';
    chapterNum++;
  }
  md += `---\n\n`;

  // Chapters
  chapterNum = 1;
  for (const [cloId, cloNodes] of ctx.nodesByCLO) {
    const clo = ctx.cloMap.get(cloId);

    md += `# Chapter ${chapterNum}: ${clo?.clo_text || cloId}\n\n`;
    if (clo) {
      md += `**Bloom Level:** ${clo.bloom_level}\n\n`;
      md += `**Knowledge Type:** ${clo.knowledge_type}\n\n`;
      md += `---\n\n`;
    }

    for (const node of cloNodes) {
      const content = ctx.nodeContents.get(node.node_id);
      if (content) {
        md += content;
        md += '\n\n---\n\n';
      } else {
        md += `## ${node.learning_intent}\n\n`;
        md += `*Content not generated for this node.*\n\n---\n\n`;
      }
    }
    chapterNum++;
  }

  return md;
}

/**
 * 2. Content Only — per-node instructional markdown, organized by CLO.
 *    No course metadata, rubric, workload, assessments, or video scripts.
 */
function buildContentOnlyMarkdown(ctx: MarkdownBuildContext): string {
  let md = `# ${ctx.course.title} — Instructional Content\n\n`;
  md += `**Course Code:** ${ctx.course.course_code}\n\n`;
  md += `---\n\n`;

  let chapterNum = 1;
  for (const [cloId, cloNodes] of ctx.nodesByCLO) {
    const clo = ctx.cloMap.get(cloId);

    md += `# ${chapterNum}. ${clo?.clo_text || cloId}\n\n`;

    for (const node of cloNodes) {
      const content = ctx.nodeContents.get(node.node_id);
      if (content) {
        md += content;
        md += '\n\n---\n\n';
      } else {
        md += `## ${node.learning_intent}\n\n`;
        md += `*Content not generated for this node.*\n\n---\n\n`;
      }
    }
    chapterNum++;
  }

  return md;
}

/**
 * 3. Video Scripts — all video scripts compiled into one document.
 */
function buildVideoScriptsMarkdown(ctx: MarkdownBuildContext): string {
  let md = `# ${ctx.course.title} — Video Scripts\n\n`;
  md += `**Course Code:** ${ctx.course.course_code}\n\n`;
  md += `**Total Scripts:** ${ctx.allVideoScripts.length}\n\n`;
  md += `---\n\n`;

  if (ctx.allVideoScripts.length === 0) {
    md += `*No video scripts generated for this course.*\n\n`;
    return md;
  }

  for (const script of ctx.allVideoScripts) {
    md += `# ${script.title}\n\n`;
    md += `**Node:** ${script.node_id}\n\n`;
    md += `**Duration:** ${script.duration_minutes} minutes\n\n`;
    md += `**Script Type:** ${script.script_type}\n\n`;
    md += `**Learning Objective:** ${script.learning_objective}\n\n`;
    md += `**Target Audience:** ${script.target_audience}\n\n`;
    md += `## Script Sections\n\n`;
    for (const section of script.sections) {
      md += `### Section ${section.section_number}: ${section.title}\n\n`;
      md += `**Duration:** ${section.duration_seconds} seconds\n\n`;
      md += `**Narration:**\n${section.narration}\n\n`;
      md += `**Visual Description:**\n${section.visual_description}\n\n`;
      if (section.on_screen_text) {
        md += `**On-Screen Text:**\n${section.on_screen_text}\n\n`;
      }
    }
    if (script.production_notes) {
      md += `## Production Notes\n\n${script.production_notes}\n\n`;
    }
    md += `---\n\n`;
  }

  return md;
}

/**
 * 4. Assessments — all assessments compiled, grouped by type.
 */
function buildAssessmentsMarkdown(ctx: MarkdownBuildContext): string {
  let md = `# ${ctx.course.title} — Assessments\n\n`;
  md += `**Course Code:** ${ctx.course.course_code}\n\n`;
  md += `**Total Assessments:** ${ctx.allAssessments.length}\n\n`;
  md += `---\n\n`;

  if (ctx.allAssessments.length === 0) {
    md += `*No assessments generated for this course.*\n\n`;
    return md;
  }

  // Group assessments by type
  const assessmentsByType = new Map<string, NodeAssessment[]>();
  for (const assessment of ctx.allAssessments) {
    const type = assessment.assessment_type;
    if (!assessmentsByType.has(type)) assessmentsByType.set(type, []);
    assessmentsByType.get(type)!.push(assessment);
  }

  for (const [type, assessments] of assessmentsByType) {
    md += `# ${type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Assessments\n\n`;
    for (const assessment of assessments) {
      md += `## ${assessment.title}\n\n`;
      md += `**Node:** ${assessment.node_id}\n\n`;
      md += `**Description:** ${assessment.description}\n\n`;
      md += `**Pass Threshold:** ${assessment.pass_threshold}%\n\n`;
      if (assessment.time_limit_minutes) {
        md += `**Time Limit:** ${assessment.time_limit_minutes} minutes\n\n`;
      }
      md += `**Instructions:** ${assessment.instructions}\n\n`;
      md += `### Questions\n\n`;
      for (const q of assessment.questions) {
        md += `**Q${q.question_id}** (${q.question_type}, ${q.points} pts, ${q.bloom_level})\n\n`;
        md += `${q.question_text}\n\n`;
        if (q.options) {
          for (const opt of q.options) {
            md += `- ${opt}\n`;
          }
          md += '\n';
        }
        if (q.correct_answer) {
          md += `**Answer:** ${q.correct_answer}\n\n`;
        }
        if (q.rubric_criteria) {
          md += `**Rubric:** ${q.rubric_criteria}\n\n`;
        }
      }
      md += `---\n\n`;
    }
  }

  return md;
}

/**
 * 5. Combined — everything in one document (same as old behavior).
 */
function buildCombinedMarkdown(ctx: MarkdownBuildContext): string {
  let md = `# ${ctx.course.title}\n\n`;
  md += `**Course Code:** ${ctx.course.course_code}\n\n`;
  md += `**Credits:** ${ctx.course.credit_hours}\n\n`;
  md += `${ctx.course.description}\n\n`;
  md += `---\n\n`;

  // TOC
  md += `# Table of Contents\n\n`;
  let chapterNum = 1;
  for (const [cloId, cloNodes] of ctx.nodesByCLO) {
    const clo = ctx.cloMap.get(cloId);
    md += `## Chapter ${chapterNum}: ${clo?.clo_text?.substring(0, 60) || cloId}...\n\n`;
    for (const node of cloNodes) {
      md += `- ${node.learning_intent}\n`;
    }
    md += '\n';
    chapterNum++;
  }
  md += `## Appendix A: Video Scripts\n\n`;
  md += `## Appendix B: Assessments\n\n`;
  md += `## Appendix C: Course Rubric\n\n`;
  md += `## Appendix D: Workload Analysis\n\n`;
  md += `---\n\n`;

  // Chapters
  chapterNum = 1;
  for (const [cloId, cloNodes] of ctx.nodesByCLO) {
    const clo = ctx.cloMap.get(cloId);
    md += `# Chapter ${chapterNum}: ${clo?.clo_text || cloId}\n\n`;
    if (clo) {
      md += `**Bloom Level:** ${clo.bloom_level}\n\n`;
      md += `**Knowledge Type:** ${clo.knowledge_type}\n\n`;
      md += `---\n\n`;
    }

    for (const node of cloNodes) {
      const content = ctx.nodeContents.get(node.node_id);
      if (content) {
        md += content;
        md += '\n\n---\n\n';
      } else {
        md += `## ${node.learning_intent}\n\n`;
        md += `*Content not generated for this node.*\n\n---\n\n`;
      }
    }
    chapterNum++;
  }

  // Appendix A: Video Scripts
  md += `# Appendix A: Video Scripts\n\n`;
  if (ctx.allVideoScripts.length > 0) {
    for (const script of ctx.allVideoScripts) {
      md += `## ${script.title}\n\n`;
      md += `**Node:** ${script.node_id}\n\n`;
      md += `**Duration:** ${script.duration_minutes} minutes\n\n`;
      md += `**Script Type:** ${script.script_type}\n\n`;
      md += `**Learning Objective:** ${script.learning_objective}\n\n`;
      md += `**Target Audience:** ${script.target_audience}\n\n`;
      md += `### Script Sections\n\n`;
      for (const section of script.sections) {
        md += `#### Section ${section.section_number}: ${section.title}\n\n`;
        md += `**Duration:** ${section.duration_seconds} seconds\n\n`;
        md += `**Narration:**\n${section.narration}\n\n`;
        md += `**Visual Description:**\n${section.visual_description}\n\n`;
        if (section.on_screen_text) {
          md += `**On-Screen Text:**\n${section.on_screen_text}\n\n`;
        }
      }
      if (script.production_notes) {
        md += `### Production Notes\n\n${script.production_notes}\n\n`;
      }
      md += `---\n\n`;
    }
  } else {
    md += `*No video scripts generated for this course.*\n\n`;
  }

  // Appendix B: Assessments
  md += `# Appendix B: Assessments\n\n`;
  if (ctx.allAssessments.length > 0) {
    const assessmentsByType = new Map<string, NodeAssessment[]>();
    for (const assessment of ctx.allAssessments) {
      const type = assessment.assessment_type;
      if (!assessmentsByType.has(type)) assessmentsByType.set(type, []);
      assessmentsByType.get(type)!.push(assessment);
    }

    for (const [type, assessments] of assessmentsByType) {
      md += `## ${type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Assessments\n\n`;
      for (const assessment of assessments) {
        md += `### ${assessment.title}\n\n`;
        md += `**Node:** ${assessment.node_id}\n\n`;
        md += `**Description:** ${assessment.description}\n\n`;
        md += `**Pass Threshold:** ${assessment.pass_threshold}%\n\n`;
        if (assessment.time_limit_minutes) {
          md += `**Time Limit:** ${assessment.time_limit_minutes} minutes\n\n`;
        }
        md += `**Instructions:** ${assessment.instructions}\n\n`;
        md += `#### Questions\n\n`;
        for (const q of assessment.questions) {
          md += `**Q${q.question_id}** (${q.question_type}, ${q.points} pts, ${q.bloom_level})\n\n`;
          md += `${q.question_text}\n\n`;
          if (q.options) {
            for (const opt of q.options) {
              md += `- ${opt}\n`;
            }
            md += '\n';
          }
          if (q.correct_answer) {
            md += `**Answer:** ${q.correct_answer}\n\n`;
          }
          if (q.rubric_criteria) {
            md += `**Rubric:** ${q.rubric_criteria}\n\n`;
          }
        }
        md += `---\n\n`;
      }
    }
  } else {
    md += `*No assessments generated for this course.*\n\n`;
  }

  // Appendix C: Course Rubric
  md += `# Appendix C: Course Rubric\n\n`;
  md += buildRubricBody(ctx.rubric);

  // Appendix D: Workload Analysis
  md += `# Appendix D: Workload Analysis\n\n`;
  md += buildWorkloadBody(ctx.workloadMap, ctx.course.course_code);

  return md;
}

// ============================================================================
// SHARED MARKDOWN FRAGMENTS
// ============================================================================

function buildRubricSection(rubric: CourseRubric | null): string {
  let md = `# Appendix A: Course Rubric\n\n`;
  md += buildRubricBody(rubric);
  return md;
}

function buildRubricBody(rubric: CourseRubric | null): string {
  if (!rubric) return `*No rubric generated for this course.*\n\n`;

  let md = `## ${rubric.title}\n\n`;
  md += `### CLO Criteria\n\n`;
  for (const cloCrit of rubric.clo_criteria) {
    md += `#### ${cloCrit.clo_id}: ${cloCrit.clo_text}\n\n`;
    md += `**Bloom Level:** ${cloCrit.bloom_level}\n\n`;
    for (const criterion of cloCrit.criteria) {
      md += `**${criterion.description}** (Weight: ${criterion.weight}%)\n\n`;
      md += `| Level | Label | Description | Points |\n`;
      md += `|-------|-------|-------------|--------|\n`;
      for (const level of criterion.levels) {
        md += `| ${level.level} | ${level.label} | ${level.description} | ${level.points} |\n`;
      }
      md += '\n';
    }
  }
  md += `### Grading Scale\n\n`;
  md += `| Grade | Range | Description |\n`;
  md += `|-------|-------|-------------|\n`;
  for (const grade of rubric.grading_scale) {
    md += `| ${grade.grade} | ${grade.min_percentage}-${grade.max_percentage}% | ${grade.description} |\n`;
  }
  md += '\n';
  md += `### Assessment Weights\n\n`;
  md += `- Pre-Knowledge: ${rubric.assessment_weights.pre_knowledge}%\n`;
  md += `- Formative: ${rubric.assessment_weights.formative}%\n`;
  md += `- Mastery: ${rubric.assessment_weights.mastery}%\n\n`;
  md += `### Marking Guide\n\n${rubric.marking_guide}\n\n`;
  md += `### Learner Instructions\n\n${rubric.learner_instructions}\n\n`;
  return md;
}

function buildWorkloadSection(workloadMap: WorkloadMap | null, courseCode: string): string {
  let md = `# Appendix B: Workload Analysis\n\n`;
  md += buildWorkloadBody(workloadMap, courseCode);
  return md;
}

function buildWorkloadBody(workloadMap: WorkloadMap | null, _courseCode: string): string {
  if (!workloadMap) return `*No workload analysis generated for this course.*\n\n`;

  let md = `## Summary\n\n`;
  md += `- **Total Content Hours:** ${workloadMap.total_content_hours}\n`;
  md += `- **Total Assessment Hours:** ${workloadMap.total_assessment_hours}\n`;
  md += `- **Total Hours:** ${workloadMap.total_hours}\n`;
  md += `- **Credit Hours:** ${workloadMap.credit_hours}\n`;
  md += `- **Expected Hours:** ${workloadMap.expected_hours} (${workloadMap.hours_per_credit} hours/credit)\n`;
  md += `- **Alignment Status:** ${workloadMap.alignment_status}\n`;
  md += `- **Deviation:** ${workloadMap.deviation_percentage}% (${workloadMap.deviation_hours} hours)\n\n`;

  if (workloadMap.validation_notes && workloadMap.validation_notes.length > 0) {
    md += `### Validation Notes\n\n`;
    for (const note of workloadMap.validation_notes) {
      md += `- ${note}\n`;
    }
    md += '\n';
  }

  md += `## Weekly Workload\n\n`;
  md += `| Week | Topic | CLOs | Nodes | Hours | Balanced |\n`;
  md += `|------|-------|------|-------|-------|----------|\n`;
  for (const week of workloadMap.weekly_workload) {
    md += `| ${week.week} | ${week.topic} | ${week.clo_ids.join(', ')} | ${week.node_count} | ${week.total_time_hours} | ${week.is_balanced ? 'Yes' : 'No'} |\n`;
  }
  md += '\n';

  md += `## Node Workload Details\n\n`;
  md += `| Node | Type | Content | Video | Assessment | Practice | Total |\n`;
  md += `|------|------|---------|-------|------------|----------|-------|\n`;
  for (const node of workloadMap.nodes) {
    md += `| ${node.node_id} | ${node.node_type} | ${node.content_time_minutes}m | ${node.video_time_minutes}m | ${node.assessment_time_minutes}m | ${node.practice_time_minutes}m | ${node.total_time_minutes}m |\n`;
  }
  md += '\n';

  return md;
}

// ============================================================================
// RENDER PIPELINE — Markdown -> HTML -> PDF + DOCX
// ============================================================================

interface DocumentSpec {
  docType: CompiledDocType;
  label: string;         // Human-readable label for progress messages
  markdown: string;
}

/**
 * Render multiple documents to PDF and DOCX, saving each to compiled/.
 * Uses a single Puppeteer browser instance for all PDFs.
 */
async function renderDocuments(
  courseCode: string,
  courseTitle: string,
  documents: DocumentSpec[],
  council: CouncilInfo
): Promise<{ docType: CompiledDocType; format: CompiledDocFormat; path: string }[]> {
  const results: { docType: CompiledDocType; format: CompiledDocFormat; path: string }[] = [];

  // Phase 1: Convert all markdown -> styled HTML
  const htmlDocs: { docType: CompiledDocType; label: string; html: string }[] = [];

  for (const doc of documents) {
    const htmlContent = await marked(doc.markdown);
    const styledHtml = wrapHtml(courseTitle, htmlContent);
    htmlDocs.push({ docType: doc.docType, label: doc.label, html: styledHtml });
  }

  // Phase 2: Generate all PDFs with a single Puppeteer browser
  updateProgress({
    courseCode,
    stage: 5,
    status: 'running',
    step: 'Generating PDFs',
    message: `Opening PDF renderer for ${htmlDocs.length} documents...`,
    council
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    for (const doc of htmlDocs) {
      updateProgress({
        courseCode,
        stage: 5,
        status: 'running',
        step: 'Generating PDFs',
        message: `Rendering ${doc.label} PDF...`,
        council
      });

      const page = await browser.newPage();
      await page.setContent(doc.html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' }
      });

      await page.close();

      const path = fileService.saveCompiledDocument(courseCode, doc.docType, 'pdf', Buffer.from(pdfBuffer));
      results.push({ docType: doc.docType, format: 'pdf', path });
      console.log(`  Stage 5: Saved ${doc.docType}.pdf`);
    }
  } finally {
    await browser.close();
  }

  // Also save the combined PDF with the legacy name for backward compatibility
  const combinedDoc = htmlDocs.find(d => d.docType === 'combined');
  if (combinedDoc) {
    const combinedBuf = fileService.getCompiledDocument(courseCode, 'combined', 'pdf');
    if (combinedBuf) {
      fileService.saveCompiledPDF(courseCode, combinedBuf);
    }
  }

  // Phase 3: Generate all DOCX files
  for (const doc of htmlDocs) {
    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Generating Word documents',
      message: `Rendering ${doc.label} DOCX...`,
      council
    });

    try {
      const docxBuffer = await HTMLtoDOCX(doc.html, null, {
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });

      // HTMLtoDOCX may return a Buffer or ArrayBuffer
      const buf = Buffer.isBuffer(docxBuffer) ? docxBuffer : Buffer.from(docxBuffer as ArrayBuffer);
      const path = fileService.saveCompiledDocument(courseCode, doc.docType, 'docx', buf);
      results.push({ docType: doc.docType, format: 'docx', path });
      console.log(`  Stage 5: Saved ${doc.docType}.docx`);
    } catch (docxErr) {
      console.error(`  Stage 5: DOCX generation failed for ${doc.docType}:`, docxErr);
      // Non-fatal — PDFs are the primary output
    }
  }

  return results;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

// Note: Stage 5 doesn't use AI - it assembles existing content into documents
// The executionOverride parameter is included for API consistency but is not used
export async function runStage5(courseCode: string, _executionOverride?: StageExecutionMode): Promise<StageResult> {
  try {
    console.log('Stage 5: Starting assembly and export for', courseCode);

    const council: CouncilInfo = {
      mode: 'single',
      memberCount: 1,
      models: ['Assembly Engine'],
      chairmanModel: 'Assembly Engine'
    };

    startStageProgress(courseCode, 5, 'Initializing assembly', council);

    // ----------------------------------------------------------------
    // Load all data
    // ----------------------------------------------------------------
    const course = await neo4j.getCourse(courseCode);
    if (!course) throw new Error('Course not found');

    const clos = await neo4j.getCLOs(courseCode);
    const nodes = await neo4j.getLearningNodes(courseCode);

    if (nodes.length === 0) {
      throw new Error('No learning nodes found. Please run Stage 2 first.');
    }

    // Get all node content from Stage 4
    const nodeContents = fileService.getAllStage4InstructionalContents(courseCode);

    // Fall back to old location if Stage 4 content not found
    if (nodeContents.size === 0) {
      const legacyContents = fileService.getAllNodeContents(courseCode);
      if (legacyContents.size === 0) {
        throw new Error('No node content found. Please run Stage 4 first.');
      }
      for (const [nodeId, content] of legacyContents) {
        nodeContents.set(nodeId, content);
      }
    }

    // Get all Stage 4 content packs for video scripts and assessments
    const allContentPacks = new Map<string, Stage4NodeContent>();
    const allVideoScripts: VideoScript[] = [];
    const allAssessments: NodeAssessment[] = [];

    for (const node of nodes) {
      const contentPack = fileService.getStage4NodeContent(courseCode, node.node_id);
      if (contentPack) {
        allContentPacks.set(node.node_id, contentPack);
        if (contentPack.video_script) {
          allVideoScripts.push(contentPack.video_script);
        }
        if (contentPack.assessments) {
          allAssessments.push(...contentPack.assessments);
        }
      }
    }

    // Get rubric and workload map
    const rubric = fileService.getStage4Rubric(courseCode);
    const workloadMap = fileService.getStage4WorkloadMap(courseCode);

    console.log(`Stage 5: Loaded ${nodeContents.size} node contents, ${allVideoScripts.length} video scripts, ${allAssessments.length} assessments`);

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Assembling content',
      message: `Assembling ${nodeContents.size} node contents, ${allVideoScripts.length} video scripts, ${allAssessments.length} assessments...`,
      council
    });

    // ----------------------------------------------------------------
    // Build context and documents
    // ----------------------------------------------------------------
    const nodesByCLO = groupNodesByCLO(nodes);

    const cloMap = new Map<string, CLO>();
    for (const clo of clos) {
      cloMap.set(clo.clo_id, clo);
    }

    const ctx: MarkdownBuildContext = {
      course,
      clos,
      cloMap,
      nodesByCLO,
      nodeContents,
      allVideoScripts,
      allAssessments,
      rubric,
      workloadMap
    };

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Building documents',
      message: 'Building 5 document markdown sources...',
      council
    });

    const documents: DocumentSpec[] = [
      { docType: 'main-course', label: 'Main Course', markdown: buildMainCourseMarkdown(ctx) },
      { docType: 'content', label: 'Content', markdown: buildContentOnlyMarkdown(ctx) },
      { docType: 'video-scripts', label: 'Video Scripts', markdown: buildVideoScriptsMarkdown(ctx) },
      { docType: 'assessments', label: 'Assessments', markdown: buildAssessmentsMarkdown(ctx) },
      { docType: 'combined', label: 'Combined', markdown: buildCombinedMarkdown(ctx) },
    ];

    // ----------------------------------------------------------------
    // Render all documents (PDF + DOCX)
    // ----------------------------------------------------------------
    const renderedDocs = await renderDocuments(courseCode, course.title, documents, council);

    // ----------------------------------------------------------------
    // Update course stage
    // ----------------------------------------------------------------
    await neo4j.updateCourseStage(courseCode, 5);

    const pdfCount = renderedDocs.filter(d => d.format === 'pdf').length;
    const docxCount = renderedDocs.filter(d => d.format === 'docx').length;
    const summaryMsg = `Assembled ${nodeContents.size} nodes, ${allVideoScripts.length} video scripts, ${allAssessments.length} assessments into ${pdfCount} PDFs and ${docxCount} DOCX files`;

    console.log('Stage 5: Complete');
    completeStageProgress(courseCode, 5, summaryMsg);

    return {
      success: true,
      stage: 5,
      message: summaryMsg,
      data: {
        course_code: courseCode,
        node_count: nodeContents.size,
        chapter_count: nodesByCLO.size,
        video_script_count: allVideoScripts.length,
        assessment_count: allAssessments.length,
        has_rubric: !!rubric,
        has_workload_map: !!workloadMap,
        documents: renderedDocs.map(d => ({
          docType: d.docType,
          format: d.format
        }))
      }
    };
  } catch (error) {
    console.error('Stage 5 Error:', error);
    errorStageProgress(courseCode, 5, error instanceof Error ? error.message : String(error));
    return {
      success: false,
      stage: 5,
      message: 'Failed to complete Stage 5',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================================================
// ZIP ARCHIVE — Updated to include all compiled documents
// ============================================================================

export async function createCourseZip(courseCode: string): Promise<string> {
  const nodeContents = fileService.getAllStage4InstructionalContents(courseCode);
  const course = await neo4j.getCourse(courseCode);
  const clos = await neo4j.getCLOs(courseCode);
  const nodes = await neo4j.getLearningNodes(courseCode);
  const contract = fileService.getCourseContract(courseCode);

  // Get Stage 4 content
  const rubric = fileService.getStage4Rubric(courseCode);
  const workloadMap = fileService.getStage4WorkloadMap(courseCode);
  const learnerInstructions = fileService.getStage4LearnerInstructions(courseCode);

  // Collect all video scripts and assessments
  const allVideoScripts: VideoScript[] = [];
  const allAssessments: NodeAssessment[] = [];
  const contentPacks: Stage4NodeContent[] = [];

  for (const node of nodes) {
    const contentPack = fileService.getStage4NodeContent(courseCode, node.node_id);
    if (contentPack) {
      contentPacks.push(contentPack);
      if (contentPack.video_script) {
        allVideoScripts.push(contentPack.video_script);
      }
      if (contentPack.assessments) {
        allAssessments.push(...contentPack.assessments);
      }
    }
  }

  const outputDir = join(process.cwd(), '..', 'data', 'courses', courseCode, 'compiled');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const zipPath = join(outputDir, `${courseCode}-complete.zip`);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);

    // Add course metadata
    const courseInfo = {
      course_code: course?.course_code,
      title: course?.title,
      description: course?.description,
      credit_hours: course?.credit_hours,
      clo_count: clos.length,
      node_count: nodes.length,
      video_script_count: allVideoScripts.length,
      assessment_count: allAssessments.length,
      has_rubric: !!rubric,
      has_workload_map: !!workloadMap,
      exported_at: new Date().toISOString()
    };
    archive.append(JSON.stringify(courseInfo, null, 2), { name: 'course-info.json' });

    // Add course contract
    if (contract) {
      archive.append(JSON.stringify(contract, null, 2), { name: 'course-contract.json' });
    }

    // Add CLOs
    archive.append(JSON.stringify(clos, null, 2), { name: 'clos.json' });

    // Add learning nodes
    archive.append(JSON.stringify(nodes, null, 2), { name: 'learning-nodes.json' });

    // Add individual markdown files in a folder
    for (const [nodeId, content] of nodeContents) {
      archive.append(content, { name: `content/${nodeId}.md` });
    }

    // Add content packs as JSON
    for (const pack of contentPacks) {
      archive.append(JSON.stringify(pack, null, 2), { name: `content-packs/${pack.node_id}.json` });
    }

    // Add video scripts
    if (allVideoScripts.length > 0) {
      archive.append(JSON.stringify(allVideoScripts, null, 2), { name: 'video-scripts/all-scripts.json' });
      for (const script of allVideoScripts) {
        archive.append(JSON.stringify(script, null, 2), { name: `video-scripts/${script.node_id}.json` });
        let scriptMd = `# ${script.title}\n\n`;
        scriptMd += `**Node:** ${script.node_id}\n`;
        scriptMd += `**Duration:** ${script.duration_minutes} minutes\n`;
        scriptMd += `**Type:** ${script.script_type}\n\n`;
        scriptMd += `## Learning Objective\n${script.learning_objective}\n\n`;
        scriptMd += `## Target Audience\n${script.target_audience}\n\n`;
        scriptMd += `## Script\n\n`;
        for (const section of script.sections) {
          scriptMd += `### Section ${section.section_number}: ${section.title} (${section.duration_seconds}s)\n\n`;
          scriptMd += `**Narration:**\n${section.narration}\n\n`;
          scriptMd += `**Visuals:**\n${section.visual_description}\n\n`;
          if (section.on_screen_text) {
            scriptMd += `**On-Screen Text:**\n${section.on_screen_text}\n\n`;
          }
        }
        if (script.production_notes) {
          scriptMd += `## Production Notes\n${script.production_notes}\n`;
        }
        archive.append(scriptMd, { name: `video-scripts/${script.node_id}.md` });
      }
    }

    // Add assessments
    if (allAssessments.length > 0) {
      archive.append(JSON.stringify(allAssessments, null, 2), { name: 'assessments/all-assessments.json' });

      const byType = new Map<string, NodeAssessment[]>();
      for (const assessment of allAssessments) {
        const type = assessment.assessment_type;
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type)!.push(assessment);
      }

      for (const [type, assessments] of byType) {
        archive.append(JSON.stringify(assessments, null, 2), { name: `assessments/${type}.json` });
      }

      for (const assessment of allAssessments) {
        archive.append(JSON.stringify(assessment, null, 2), { name: `assessments/by-node/${assessment.node_id}-${assessment.assessment_type}.json` });
      }
    }

    // Add rubric
    if (rubric) {
      archive.append(JSON.stringify(rubric, null, 2), { name: 'rubric/course-rubric.json' });
      let rubricMd = `# ${rubric.title}\n\n`;
      rubricMd += `## CLO Criteria\n\n`;
      for (const crit of rubric.clo_criteria) {
        rubricMd += `### ${crit.clo_id}: ${crit.clo_text}\n`;
        rubricMd += `**Bloom Level:** ${crit.bloom_level}\n\n`;
        for (const c of crit.criteria) {
          rubricMd += `#### ${c.description} (${c.weight}%)\n\n`;
          rubricMd += `| Level | Label | Description | Points |\n`;
          rubricMd += `|-------|-------|-------------|--------|\n`;
          for (const lvl of c.levels) {
            rubricMd += `| ${lvl.level} | ${lvl.label} | ${lvl.description} | ${lvl.points} |\n`;
          }
          rubricMd += '\n';
        }
      }
      rubricMd += `## Grading Scale\n\n`;
      rubricMd += `| Grade | Min | Max | Description |\n`;
      rubricMd += `|-------|-----|-----|-------------|\n`;
      for (const g of rubric.grading_scale) {
        rubricMd += `| ${g.grade} | ${g.min_percentage}% | ${g.max_percentage}% | ${g.description} |\n`;
      }
      rubricMd += `\n## Assessment Weights\n`;
      rubricMd += `- Pre-Knowledge: ${rubric.assessment_weights.pre_knowledge}%\n`;
      rubricMd += `- Formative: ${rubric.assessment_weights.formative}%\n`;
      rubricMd += `- Mastery: ${rubric.assessment_weights.mastery}%\n\n`;
      rubricMd += `## Marking Guide\n${rubric.marking_guide}\n\n`;
      rubricMd += `## Learner Instructions\n${rubric.learner_instructions}\n`;
      archive.append(rubricMd, { name: 'rubric/course-rubric.md' });
    }

    // Add workload map
    if (workloadMap) {
      archive.append(JSON.stringify(workloadMap, null, 2), { name: 'workload/workload-map.json' });
      let workloadMd = `# Workload Analysis: ${courseCode}\n\n`;
      workloadMd += `## Summary\n\n`;
      workloadMd += `| Metric | Value |\n`;
      workloadMd += `|--------|-------|\n`;
      workloadMd += `| Total Content Hours | ${workloadMap.total_content_hours} |\n`;
      workloadMd += `| Total Assessment Hours | ${workloadMap.total_assessment_hours} |\n`;
      workloadMd += `| Total Hours | ${workloadMap.total_hours} |\n`;
      workloadMd += `| Credit Hours | ${workloadMap.credit_hours} |\n`;
      workloadMd += `| Expected Hours | ${workloadMap.expected_hours} |\n`;
      workloadMd += `| Alignment Status | ${workloadMap.alignment_status} |\n`;
      workloadMd += `| Deviation | ${workloadMap.deviation_percentage}% (${workloadMap.deviation_hours}h) |\n\n`;
      if (workloadMap.validation_notes?.length) {
        workloadMd += `## Validation Notes\n\n`;
        for (const note of workloadMap.validation_notes) {
          workloadMd += `- ${note}\n`;
        }
        workloadMd += '\n';
      }
      workloadMd += `## Weekly Workload\n\n`;
      workloadMd += `| Week | Topic | Hours | Balanced |\n`;
      workloadMd += `|------|-------|-------|----------|\n`;
      for (const w of workloadMap.weekly_workload) {
        workloadMd += `| ${w.week} | ${w.topic} | ${w.total_time_hours} | ${w.is_balanced ? 'Yes' : 'No'} |\n`;
      }
      workloadMd += '\n## Node Details\n\n';
      workloadMd += `| Node | Type | Total Minutes |\n`;
      workloadMd += `|------|------|---------------|\n`;
      for (const n of workloadMap.nodes) {
        workloadMd += `| ${n.node_id} | ${n.node_type} | ${n.total_time_minutes} |\n`;
      }
      archive.append(workloadMd, { name: 'workload/workload-map.md' });
    }

    // Add learner instructions
    if (learnerInstructions) {
      archive.append(learnerInstructions, { name: 'learner-instructions.md' });
    }

    // Add a combined markdown file
    let combined = `# ${course?.title || courseCode}\n\n`;
    combined += `**Course Code:** ${course?.course_code}\n`;
    combined += `**Credits:** ${course?.credit_hours}\n\n`;
    combined += `${course?.description}\n\n`;
    combined += `---\n\n`;
    combined += `## Course Learning Outcomes\n\n`;
    clos.forEach((clo, i) => {
      combined += `${i + 1}. ${clo.clo_text}\n`;
    });
    combined += `\n---\n\n`;
    combined += `## Content\n\n`;
    for (const [_nodeId, content] of nodeContents) {
      combined += content + '\n\n---\n\n';
    }
    archive.append(combined, { name: 'complete-course.md' });

    // Add all compiled documents (PDFs and DOCX files)
    const compiledDocs = fileService.listCompiledDocuments(courseCode);
    for (const doc of compiledDocs) {
      const buf = fileService.getCompiledDocument(courseCode, doc.docType, doc.format);
      if (buf) {
        archive.append(buf, { name: `documents/${courseCode}-${doc.docType}.${doc.format}` });
      }
    }

    // Add a README
    const docList = compiledDocs.map(d => `- **documents/${courseCode}-${d.docType}.${d.format}** - ${d.docType} (${d.format.toUpperCase()})`).join('\n');
    const readme = `# ${course?.title || courseCode}

## Contents

This ZIP archive contains the complete course materials:

### Compiled Documents
${docList || '*(no compiled documents found)*'}

### Core Materials
- **course-info.json** - Course metadata and export information
- **course-contract.json** - Course contract with CLO analysis
- **clos.json** - All Course Learning Outcomes
- **learning-nodes.json** - All learning nodes with adaptive logic
- **complete-course.md** - Combined markdown with all content
- **learner-instructions.md** - Instructions for learners

### Content
- **content/** - Individual markdown files for each learning node
- **content-packs/** - Full content packs (JSON) with all node data

### Video Scripts (${allVideoScripts.length} scripts)
- **video-scripts/all-scripts.json** - All video scripts in one file
- **video-scripts/*.json** - Individual script JSON files
- **video-scripts/*.md** - Readable markdown versions

### Assessments (${allAssessments.length} assessments)
- **assessments/all-assessments.json** - All assessments in one file
- **assessments/{type}.json** - Assessments grouped by type
- **assessments/by-node/** - Individual assessment files

### Rubric
- **rubric/course-rubric.json** - Course rubric data
- **rubric/course-rubric.md** - Readable markdown version

### Workload Analysis
- **workload/workload-map.json** - Workload analysis data
- **workload/workload-map.md** - Readable markdown version

## Generated by
Adaptive Curriculum Intelligence System
Exported on: ${new Date().toLocaleString()}
`;
    archive.append(readme, { name: 'README.md' });

    archive.finalize();
  });
}

// Legacy function name for backward compatibility
export const createMarkdownZip = createCourseZip;
