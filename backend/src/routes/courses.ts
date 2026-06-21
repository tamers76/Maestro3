import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as neo4j from '../services/curriculumStore.service.js';
import * as fileService from '../services/file.service.js';
import { extractTextFromBuffer } from '../services/extraction.service.js';
import { runStage1, runStage1FromForm } from '../services/stage1.service.js';
import { runStage2 } from '../services/stage2.service.js';
import { runStage3 } from '../services/stage3.service.js';
import { 
  runStage4, 
  getStage4CheckpointStatus, 
  getStage4Errors, 
  clearStage4Errors,
  getStage4ContentPack,
  getStage4NodeContent,
  getStage4WorkloadMap,
  getStage4Rubric,
  getStage4LearnerInstructions,
  getNodeAssessments,
  getNodeVideoScript,
  getStage4ModalityPlan,
  getStage4InstructionalPackage,
  getStage4DiagnosticAssessment,
  getStage4LLMInteractiveSpec,
  getStage4RemediationPack,
  getStage4SummativeAssessments,
  getStage4CourseBook,
  getStage4CourseBookMarkdown,
  getStage4ValidationReport,
  getStage4VisualAssetSpecs,
  getStage4VideoProductionPackage
} from '../services/stage4.service.js';
import { runStage5, createMarkdownZip } from '../services/stage5.service.js';
import { runStage5A, getStage5AReport, getStage5AReportMarkdown, type Stage5AOptions } from '../services/stage5a.service.js';
import { getProgress, subscribeToProgress, type ProgressUpdate } from '../services/progress.service.js';
import { computeCLODistribution } from '../services/clo_weekly_plan.service.js';
import { generateSuggestedCloTopics } from '../services/openai_deep_research.service.js';
import {
  getLayerStateViews,
  runStage1Layer,
  approveStage1Layer,
  rejectStage1Layer,
  saveStage1LayerOutput,
  allStage1LayersApproved,
} from '../services/stage1Layers.service.js';
import {
  getCloRefinementContext,
  saveCloRefinements,
} from '../services/cloRefinements.service.js';
import {
  getAssessmentRedesignContext,
  saveAssessmentRedesigns,
} from '../services/assessmentRedesigns.service.js';
import {
  getWeightingRubricContext,
  saveWeightingRubric,
} from '../services/weightingRubric.service.js';
import {
  getIntegrityReviewContext,
  saveIntegrityReview,
} from '../services/integrityReview.service.js';
import {
  getSubtopicArchitectureContext,
  saveSubtopicArchitecture,
} from '../services/subtopicArchitecture.service.js';
import type {
  CloRefinementItem,
  AssessmentRedesignItem,
  AssessmentStructureReview,
  CourseLevelWeightingSummary,
  AssessmentIntegrityReview,
  CourseLevelIntegritySummary,
  SubtopicArchitectureCourseSummary,
  SubtopicCloSection,
} from '../models/schemas.js';
import { assertAIConfigured } from '../services/council.service.js';
import { requireRole, courseAccessParamHandler } from '../auth/middleware.js';
import { recordAudit } from '../services/audit.service.js';
import * as userRepo from '../db/repos/userRepo.js';
import { listAccessibleCourseCodes } from '../auth/courseAccess.js';
import { LEGACY_STAGES_ENABLED, isLegacyStage } from '../config/featureFlags.js';
import { startStageProgress, completeStageProgress, errorStageProgress } from '../services/progress.service.js';
import type { 
  CourseListItem, StageNumber, StageExecutionMode, Stage4Options,
  CloTopics, CloTopicGroup, TopicItem, CloTopicCoverage, CloTopicCoverageStat,
} from '../models/schemas.js';
import type { CompiledDocType, CompiledDocFormat } from '../services/file.service.js';

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ];
    // Some browsers report an empty or generic MIME type for .docx files, so
    // also accept based on the file extension.
    const name = (file.originalname || '').toLowerCase();
    const hasAllowedExtension = name.endsWith('.pdf') || name.endsWith('.docx');
    if (allowedTypes.includes(file.mimetype) || hasAllowedExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and DOCX files are allowed'));
    }
  }
});

// Curriculum authoring/review is restricted to admins and professors. Students are
// modeled + assignable but have no authoring access yet (consumption lands later).
router.use(requireRole('admin', 'professor'));

// Enforce course-scoped access for every route that carries a :code param. Because
// it is keyed to the param, it never runs for sibling routes like POST /form.
router.param('code', courseAccessParamHandler);

// GET /api/courses - List courses the caller may access
router.get('/', async (req: Request, res: Response) => {
  try {
    const courses = await neo4j.getAllCourses();
    let visible = courses;
    // Per-course relationship for the caller (owner/reviewer/admin).
    const ownedCodes = new Set<string>();
    const reviewingCodes = new Set<string>();
    const isAdmin = req.user?.role === 'admin';
    // Admins see everything; professors see only owned or review-assigned courses.
    if (req.user && !isAdmin) {
      const reviewing = new Set(await listAccessibleCourseCodes(req.user));
      for (const code of reviewing) reviewingCodes.add(code);
      const ownerCodes = await Promise.all(
        courses.map(async (c) =>
          (await userRepo.getCourseOwner(c.course_code)) === req.user!.id ? c.course_code : null
        )
      );
      for (const code of ownerCodes) if (code) ownedCodes.add(code);
      const allowed = new Set<string>([...reviewingCodes, ...ownedCodes]);
      visible = courses.filter((c) => allowed.has(c.course_code));
    }
    const ownerByCourse = new Map<string, { owner_user_id: string | null; owner_name: string | null; owner_email: string | null }>();
    const ownerEntries = await Promise.all(
      visible.map(async (course) => {
        const ownerUserId = await userRepo.getCourseOwner(course.course_code);
        if (!ownerUserId) {
          return [course.course_code, { owner_user_id: null, owner_name: null, owner_email: null }] as const;
        }
        const owner = await userRepo.getUserById(ownerUserId);
        return [
          course.course_code,
          {
            owner_user_id: ownerUserId,
            owner_name: owner?.name ?? null,
            owner_email: owner?.email ?? null,
          },
        ] as const;
      })
    );
    for (const [courseCode, owner] of ownerEntries) ownerByCourse.set(courseCode, owner);

    const courseList: CourseListItem[] = visible.map(c => ({
      course_code: c.course_code,
      title: c.title,
      current_stage: c.current_stage,
      created_at: c.created_at,
      updated_at: c.updated_at,
      access: isAdmin
        ? 'admin'
        : ownedCodes.has(c.course_code)
        ? 'owner'
        : reviewingCodes.has(c.course_code)
        ? 'reviewer'
        : undefined,
      owner_user_id: ownerByCourse.get(c.course_code)?.owner_user_id ?? null,
      owner_name: ownerByCourse.get(c.course_code)?.owner_name ?? null,
      owner_email: ownerByCourse.get(c.course_code)?.owner_email ?? null,
    }));
    res.json(courseList);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// GET /api/courses/:code - Get course details
router.get('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const clos = await neo4j.getCLOs(code);
    const nodes = await neo4j.getLearningNodes(code);
    const contract = await fileService.getCourseContract(code);
    let snapshot = await fileService.getExtractedSnapshot(code);
    const confirmations = await fileService.getConfirmations(code);
    
    // ── Auto-migration: weekly_plan → clo_topics ──────────────────
    // If snapshot has legacy weekly_plan with CLO mappings but no clo_topics,
    // auto-derive clo_topics from the weekly plan for backward compatibility.
    if (snapshot && !snapshot.clo_topics && snapshot.weekly_plan && snapshot.weekly_plan.length > 0 && clos.length > 0) {
      console.log(`[Migration] Auto-migrating weekly_plan → clo_topics for course ${code}`);
      
      const cloGroupMap = new Map<string, TopicItem[]>();
      for (const clo of clos) {
        cloGroupMap.set(clo.clo_id, []);
      }
      
      for (const week of snapshot.weekly_plan) {
        const assignedCloIds = week.clo_ids || [];
        if (assignedCloIds.length === 0) continue;
        
        // Create a topic from this week item
        const topicItem: TopicItem = {
          topic_id: uuidv4(),
          title: week.topic || `Topic (from Week ${week.week})`,
          description: week.description || '',
          readings: week.readings || '',
        };
        
        // Assign to the first CLO (or to all if multiple)
        for (const cloId of assignedCloIds) {
          if (cloGroupMap.has(cloId)) {
            cloGroupMap.get(cloId)!.push(topicItem);
          }
        }
      }
      
      const migratedTopics: CloTopics = Array.from(cloGroupMap.entries()).map(([cloId, topics]) => ({
        clo_id: cloId,
        topics,
      }));
      
      // Compute coverage
      const coverage = computeCloTopicCoverage(migratedTopics, clos);
      
      // Persist the migration
      snapshot = {
        ...snapshot,
        clo_topics: migratedTopics,
        clo_topic_coverage: coverage,
      };
      await fileService.saveExtractedSnapshot(code, snapshot);
      
      console.log(`[Migration] Migrated ${snapshot.weekly_plan.length} weeks → ${coverage.total_topics} topics for ${code}`);
    }
    // ── End migration ─────────────────────────────────────────────
    
    res.json({
      ...course,
      clos,
      nodes,
      contract,
      snapshot,
      confirmations
    });
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// GET /api/courses/:code/progress - Get current progress (polling fallback)
router.get('/:code/progress', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const progress = getProgress(code);
    
    if (!progress) {
      return res.json({ status: 'idle', message: 'No active process' });
    }
    
    res.json(progress);
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// GET /api/courses/:code/progress/stream - SSE endpoint for real-time progress
router.get('/:code/progress/stream', async (req: Request, res: Response) => {
  const { code } = req.params;
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  
  // Send initial progress if exists
  const currentProgress = getProgress(code);
  if (currentProgress) {
    res.write(`data: ${JSON.stringify(currentProgress)}\n\n`);
  } else {
    res.write(`data: ${JSON.stringify({ status: 'idle', courseCode: code })}\n\n`);
  }
  
  // Subscribe to progress updates
  const unsubscribe = subscribeToProgress(code, (update: ProgressUpdate) => {
    res.write(`data: ${JSON.stringify(update)}\n\n`);
  });
  
  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);
  
  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    console.log(`SSE connection closed for course ${code}`);
  });
});

// POST /api/courses - Create new course (file upload)
// Optional form field: execution='single'|'council' to override stage execution mode
router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Get optional execution override from request body
    const { execution } = req.body as { execution?: StageExecutionMode };
    const executionOverride = execution && ['single', 'council'].includes(execution) 
      ? execution 
      : undefined;
    
    assertAIConfigured();

    // Extract text from uploaded file
    console.log('Extracting text from uploaded file...');
    const rawText = await extractTextFromBuffer(file.buffer, file.mimetype, file.originalname);

    if (!rawText?.trim()) {
      return res.status(400).json({
        error: 'Could not extract text from this file. Try a different PDF/DOCX or use manual course entry.',
      });
    }
    
    // Run Stage 1
    const result = await runStage1(rawText, undefined, executionOverride);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || result.message });
    }

    // Record course ownership for the creating user (admins create unowned-by-default
    // courses they always see; professors must own to retain access).
    const createdCode = (result as { data?: { course_code?: string } }).data?.course_code;
    if (createdCode && req.user) {
      await userRepo.setCourseOwner(createdCode, req.user.id);
    }

    void recordAudit(req, {
      action: 'course.create',
      category: 'course',
      entityType: 'course',
      entityId: createdCode ?? '',
      courseCode: createdCode ?? '',
      summary: `Created course ${createdCode ?? '(unknown)'} from upload "${file.originalname}"`,
      metadata: { source: 'file', filename: file.originalname },
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating course:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to create course' 
    });
  }
});

// POST /api/courses/form - Create course from form data
// Optional body field: execution='single'|'council' to override stage execution mode
router.post('/form', async (req: Request, res: Response) => {
  try {
    const { course_code, title, description, credit_hours, clos, assessments, references, execution } = req.body;
    
    if (!course_code || !title || !clos || clos.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: course_code, title, and at least one CLO' 
      });
    }
    
    // Get optional execution override
    const executionOverride = execution && ['single', 'council'].includes(execution) 
      ? execution as StageExecutionMode
      : undefined;
    
    // Check if course already exists
    const exists = await neo4j.courseExists(course_code);
    if (exists) {
      return res.status(409).json({ error: 'Course with this code already exists' });
    }

    assertAIConfigured();
    
    const result = await runStage1FromForm({
      course_code,
      title,
      description: description || '',
      credit_hours: credit_hours || 3,
      clos,
      assessments,
      references
    }, executionOverride);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || result.message });
    }

    if (req.user) {
      await userRepo.setCourseOwner(course_code, req.user.id);
    }

    void recordAudit(req, {
      action: 'course.create',
      category: 'course',
      entityType: 'course',
      entityId: course_code,
      courseCode: course_code,
      summary: `Created course ${course_code} from manual entry`,
      metadata: { source: 'form', title },
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating course from form:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to create course' 
    });
  }
});

// DELETE /api/courses/:code - Delete a course (course owner or admin)
router.delete('/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    if (req.user?.role !== 'admin' && req.courseAccess !== 'owner') {
      return res.status(403).json({ error: 'Only the course owner or an admin can delete this course' });
    }
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Delete from Neo4j
    await neo4j.deleteCourse(code);
    
    // Delete files
    await fileService.deleteCourseDirectory(code);
    
    void recordAudit(req, {
      action: 'course.delete',
      category: 'course',
      entityType: 'course',
      entityId: code,
      courseCode: code,
      summary: `Deleted course ${code}`,
    });

    res.json({ message: `Course ${code} deleted successfully` });
  } catch (error) {
    console.error('Error deleting course:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// POST /api/courses/:code/stage/:num - Run or rerun a stage
// Optional body: { execution?: 'single' | 'council' } to override stage execution mode
// For Stage 4, also accepts: { resume?: boolean, forceRestart?: boolean }
//   - resume: true (default) - auto-resume from checkpoint if exists
//   - forceRestart: true - ignore checkpoint and start fresh
router.post('/:code/stage/:num', async (req: Request, res: Response) => {
  try {
    const { code, num } = req.params;
    const stageNum = parseInt(num) as StageNumber;
    
    // Get optional execution override from request body
    const { execution, resume, forceRestart } = req.body as { 
      execution?: StageExecutionMode;
      resume?: boolean;
      forceRestart?: boolean;
    };
    const executionOverride = execution && ['single', 'council'].includes(execution) 
      ? execution 
      : undefined;
    
    if (stageNum < 1 || stageNum > 5) {
      return res.status(400).json({ error: 'Invalid stage number (1-5)' });
    }
    
    // Legacy Stages 2-5 are parked behind a reversible feature flag. The Maestro
    // Node Engine (which consumes the approved Stage 1 Layer 6 output) supersedes
    // them. Return a clear "disabled" response instead of running legacy code.
    if (!LEGACY_STAGES_ENABLED && isLegacyStage(stageNum)) {
      return res.status(409).json({
        error: `Stage ${stageNum} is disabled. The legacy Stage 2-5 pipeline has been retired in favour of the Maestro Node Engine. Set LEGACY_STAGES_ENABLED=true to re-enable it.`,
        disabled: true,
        legacy_stages_enabled: false,
        stage: stageNum,
      });
    }
    
    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check if prerequisite stages are complete
    if (stageNum > 1 && course.current_stage < stageNum - 1) {
      return res.status(400).json({ 
        error: `Stage ${stageNum - 1} must be completed first` 
      });
    }
    
    // Get confirmations for gate checks
    const confirmations = await fileService.getConfirmations(code);
    
    // Stage 2 requires all Stage 1 internal layers approved (or legacy CLO topic confirmation)
    if (stageNum === 2) {
      const layersApproved = await allStage1LayersApproved(code);
      const legacyConfirmed =
        !!confirmations?.clo_topics_confirmed_at || !!confirmations?.weekly_plan_confirmed_at;
      if (!layersApproved && !legacyConfirmed) {
        return res.status(400).json({
          error:
            'All six Stage 1 academic contract layers must be approved before running Stage 2. Complete and approve each layer under Stage 1 — Extraction & Contract.',
        });
      }
    }
    
    // Stage 3 requires node graph confirmation (Stage 2.5)
    if (stageNum === 3) {
      if (!confirmations?.node_graph_confirmed_at) {
        return res.status(400).json({ 
          error: 'Node graph must be confirmed before running Stage 3. Please review and confirm the node structure in the Edit Graph tab.' 
        });
      }
    }
    
    // Stage 4 requires graph confirmation
    if (stageNum === 4) {
      if (!confirmations?.graph_confirmed_at) {
        return res.status(400).json({ 
          error: 'Graph structure must be confirmed before running Stage 4. Please review and confirm the node dependencies on the Graph tab.' 
        });
      }
    }
    
    // Log execution mode for debugging
    if (executionOverride) {
      console.log(`Stage ${stageNum}: Running with execution override: ${executionOverride}`);
    }
    
    let result;
    
    switch (stageNum) {
      case 1:
        // For Stage 1 regeneration, use existing raw text
        const snapshot = await fileService.getExtractedSnapshot(code);
        if (!snapshot) {
          return res.status(400).json({ error: 'No extracted data found for regeneration' });
        }
        result = await runStage1(snapshot.raw_text, code, executionOverride);
        break;
      case 2:
        result = await runStage2(code, executionOverride);
        break;
      case 3:
        result = await runStage3(code, executionOverride);
        break;
      case 4:
        // Stage 4 supports resume/forceRestart options
        const stage4Options: Stage4Options = {
          resume: resume !== false, // Default to true
          forceRestart: forceRestart === true
        };
        if (stage4Options.forceRestart) {
          console.log(`Stage 4: Force restart requested for ${code}`);
        } else if (stage4Options.resume) {
          console.log(`Stage 4: Resume mode enabled for ${code}`);
        }
        result = await runStage4(code, executionOverride, stage4Options);
        break;
      case 5:
        result = await runStage5(code, executionOverride);
        break;
      default:
        return res.status(400).json({ error: 'Invalid stage number' });
    }
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || result.message });
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error running stage:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to run stage' 
    });
  }
});

// GET /api/courses/:code/stage/3/snapshot - Get Stage 3 assessment intelligence snapshot
router.get('/:code/stage/3/snapshot', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const snapshot = await fileService.getStage3Snapshot(code);
    if (!snapshot) {
      return res.status(404).json({ 
        error: 'Stage 3 snapshot not found. Please run Stage 3 first.' 
      });
    }
    
    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching Stage 3 snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch Stage 3 snapshot' });
  }
});

// GET /api/courses/:code/stage/3/incomplete-report - Get Stage 3 incomplete nodes report
router.get('/:code/stage/3/incomplete-report', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const report = await fileService.getStage3IncompleteReport(code);
    if (!report) {
      // No report means Stage 3 hasn't run yet or no incomplete nodes
      return res.json({ 
        course_code: code,
        generated_at: '',
        incomplete_count: 0,
        nodes: []
      });
    }
    
    res.json(report);
  } catch (error) {
    console.error('Error fetching Stage 3 incomplete report:', error);
    res.status(500).json({ error: 'Failed to fetch Stage 3 incomplete report' });
  }
});

// GET /api/courses/:code/stage/4/checkpoint - Get Stage 4 checkpoint status
router.get('/:code/stage/4/checkpoint', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const checkpoint = getStage4CheckpointStatus(code);
    if (!checkpoint) {
      return res.json({ 
        hasCheckpoint: false, 
        message: 'No checkpoint found - Stage 4 not started or completed successfully' 
      });
    }
    
    res.json({
      hasCheckpoint: true,
      checkpoint
    });
  } catch (error) {
    console.error('Error fetching checkpoint:', error);
    res.status(500).json({ error: 'Failed to fetch checkpoint status' });
  }
});

// GET /api/courses/:code/stage/4/errors - Get Stage 4 error log
router.get('/:code/stage/4/errors', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const errors = await getStage4Errors(code);
    res.json({
      course_code: code,
      error_count: errors.length,
      errors
    });
  } catch (error) {
    console.error('Error fetching error log:', error);
    res.status(500).json({ error: 'Failed to fetch error log' });
  }
});

// DELETE /api/courses/:code/stage/4/errors - Clear Stage 4 error log
router.delete('/:code/stage/4/errors', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    clearStage4Errors(code);
    res.json({ message: 'Error log cleared successfully' });
  } catch (error) {
    console.error('Error clearing error log:', error);
    res.status(500).json({ error: 'Failed to clear error log' });
  }
});

// PUT /api/courses/:code/weekly-plan/mapping - Save user-edited CLO-to-week mappings
router.put('/:code/weekly-plan/mapping', async (req: Request, res: Response) => {
  console.log('[API] PUT weekly-plan/mapping called for course:', req.params.code);
  try {
    const { code } = req.params;
    const { mappings } = req.body as {
      mappings: Array<{ week: number; clo_id?: string | null; clo_ids?: string[] }>;
    };
    
    console.log('[API] Received mappings:', JSON.stringify(mappings?.slice(0, 3)), '...');
    
    // Validate mappings array
    if (!mappings || !Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings array is required' });
    }
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Get existing snapshot
    const snapshot = await fileService.getExtractedSnapshot(code);
    if (!snapshot) {
      return res.status(400).json({ error: 'No extracted snapshot found. Please run Stage 1 first.' });
    }
    
    if (!snapshot.weekly_plan || snapshot.weekly_plan.length === 0) {
      return res.status(400).json({ error: 'No weekly plan available to update.' });
    }
    
    // Get valid CLO IDs for validation
    const clos = await neo4j.getCLOs(code);
    const validCloIds = new Set(clos.map(c => c.clo_id));
    
    // Create a map for quick lookup of incoming mappings
    // Support both old format (clo_id: string) and new format (clo_ids: string[])
    const mappingByWeek = new Map<number, string[]>();
    for (const m of mappings) {
      let cloIds: string[] = [];
      if (Array.isArray(m.clo_ids)) {
        cloIds = m.clo_ids;
      } else if (m.clo_id) {
        cloIds = [m.clo_id];
      }
      // Validate CLO IDs
      for (const id of cloIds) {
        if (!validCloIds.has(id)) {
          return res.status(400).json({ error: `Invalid CLO ID: ${id}` });
        }
      }
      mappingByWeek.set(m.week, cloIds);
    }
    
    // Update weekly_plan with new mappings
    const updatedWeeklyPlan = snapshot.weekly_plan.map(week => {
      if (mappingByWeek.has(week.week)) {
        const cloIds = mappingByWeek.get(week.week)!;
        return {
          ...week,
          clo_ids: cloIds,
        };
      }
      return week;
    });
    
    // Recompute CLO distribution
    const newDistribution = computeCLODistribution(updatedWeeklyPlan, clos);
    
    // Update snapshot - also mark existing suggestions as stale
    const updatedSnapshot = {
      ...snapshot,
      weekly_plan: updatedWeeklyPlan,
      clo_distribution: newDistribution,
      // Mark suggested weekly plan as stale since mapping changed
      ...(snapshot.suggested_weekly_plan ? {
        suggested_weekly_plan: {
          ...snapshot.suggested_weekly_plan,
          stale: true,
          stale_reason: 'mapping_changed',
        }
      } : {}),
    };
    
    // Save updated snapshot
    await fileService.saveExtractedSnapshot(code, updatedSnapshot);
    
    // Invalidate weekly plan confirmation since mapping changed
    const confirmations = await fileService.getConfirmations(code);
    if (confirmations?.weekly_plan_confirmed_at) {
      await fileService.updateConfirmations(code, {
        weekly_plan_confirmed_at: undefined,
        weekly_plan_summary: undefined
      });
    }
    
    console.log(`Weekly plan mapping updated for ${code}: ${mappings.length} changes`);
    
    res.json({
      message: 'Weekly plan mapping updated successfully',
      weekly_plan: updatedWeeklyPlan,
      clo_distribution: newDistribution
    });
  } catch (error) {
    console.error('Error updating weekly plan mapping:', error);
    res.status(500).json({ error: 'Failed to update weekly plan mapping' });
  }
});

// POST /api/courses/:code/weekly-plan/suggest-clo-weeks - LEGACY: redirects to new endpoint
router.post('/:code/weekly-plan/suggest-clo-weeks', async (req: Request, res: Response) => {
  // Redirect to new endpoint
  return res.status(301).json({ error: 'Use POST /:code/clo-topics/suggest instead' });
});

// ============================================================================
// CLO TOPICS ENDPOINTS (replaces weekly plan mapping)
// ============================================================================

// Helper: compute CLO topic coverage statistics
function computeCloTopicCoverage(cloTopics: CloTopics, clos: Array<{ clo_id: string; clo_text: string }>): CloTopicCoverage {
  const perClo: CloTopicCoverageStat[] = clos.map(clo => {
    const group = cloTopics.find(g => g.clo_id === clo.clo_id);
    const topicCount = group ? group.topics.length : 0;
    return {
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      topic_count: topicCount,
      has_topics: topicCount > 0,
    };
  });
  
  const totalTopics = perClo.reduce((sum, s) => sum + s.topic_count, 0);
  const allCovered = perClo.every(s => s.has_topics);
  
  return {
    total_clos: clos.length,
    total_topics: totalTopics,
    per_clo: perClo,
    all_clos_covered: allCovered,
    computed_at: new Date().toISOString(),
  };
}

// PUT /api/courses/:code/clo-topics - Save user-edited topics per CLO
router.put('/:code/clo-topics', async (req: Request, res: Response) => {
  console.log('[API] PUT clo-topics called for course:', req.params.code);
  try {
    const { code } = req.params;
    const { clo_topics } = req.body as { clo_topics: CloTopics };
    
    if (!clo_topics || !Array.isArray(clo_topics)) {
      return res.status(400).json({ error: 'clo_topics array is required' });
    }
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const snapshot = await fileService.getExtractedSnapshot(code);
    if (!snapshot) {
      return res.status(400).json({ error: 'No extracted snapshot found. Please run Stage 1 first.' });
    }
    
    // Get CLOs for validation
    const clos = await neo4j.getCLOs(code);
    const validCloIds = new Set(clos.map(c => c.clo_id));
    
    // Validate CLO IDs in input
    for (const group of clo_topics) {
      if (!validCloIds.has(group.clo_id)) {
        return res.status(400).json({ error: `Invalid CLO ID: ${group.clo_id}` });
      }
      // Ensure all topics have topic_ids
      for (const topic of group.topics) {
        if (!topic.topic_id) {
          topic.topic_id = uuidv4();
        }
      }
    }
    
    // Compute coverage
    const coverage = computeCloTopicCoverage(clo_topics, clos);
    
    // Update snapshot — mark AI suggestions as stale
    const updatedSnapshot = {
      ...snapshot,
      clo_topics: clo_topics,
      clo_topic_coverage: coverage,
      ...(snapshot.suggested_clo_topics ? {
        suggested_clo_topics: {
          ...snapshot.suggested_clo_topics,
          stale: true,
          stale_reason: 'topics_changed',
        }
      } : {}),
    };
    
    await fileService.saveExtractedSnapshot(code, updatedSnapshot);
    
    // Invalidate CLO topics confirmation since topics changed
    const confirmations = await fileService.getConfirmations(code);
    if (confirmations?.clo_topics_confirmed_at) {
      await fileService.updateConfirmations(code, {
        clo_topics_confirmed_at: undefined,
        clo_topics_summary: undefined,
      });
    }
    
    console.log(`CLO topics updated for ${code}: ${clo_topics.length} CLO groups, ${coverage.total_topics} topics total`);
    
    res.json({
      message: 'CLO topics updated successfully',
      clo_topics: clo_topics,
      clo_topic_coverage: coverage,
    });
  } catch (error) {
    console.error('Error updating CLO topics:', error);
    res.status(500).json({ error: 'Failed to update CLO topics' });
  }
});

// POST /api/courses/:code/clo-topics/suggest - Generate AI-suggested topics per CLO (deep research)
router.post('/:code/clo-topics/suggest', async (req: Request, res: Response) => {
  const { code } = req.params;
  console.log(`[API] POST clo-topics/suggest called for course: ${code}`);
  
  try {
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const snapshot = await fileService.getExtractedSnapshot(code);
    if (!snapshot) {
      return res.status(400).json({ error: 'No extracted snapshot found. Please run Stage 1 first.' });
    }
    
    const clos = await neo4j.getCLOs(code);
    if (!clos || clos.length === 0) {
      return res.status(400).json({ error: 'No CLOs found. Please run Stage 1 first.' });
    }
    
    // Return immediately (async operation)
    res.json({ 
      message: 'AI CLO topic suggestion started',
      status: 'started',
    });
    
    // Run async — fire and forget (progress tracked via SSE)
    (async () => {
      try {
        startStageProgress(code, 1, 'Deep research: designing suggested topics per CLO');
        
        const suggestedTopics = await generateSuggestedCloTopics(
          code,
          clos,
          snapshot.references || [],
        );
        
        // Save into snapshot
        const currentSnapshot = await fileService.getExtractedSnapshot(code);
        if (currentSnapshot) {
          const updatedSnapshot = {
            ...currentSnapshot,
            suggested_clo_topics: suggestedTopics,
          };
          await fileService.saveExtractedSnapshot(code, updatedSnapshot);
        }
        
        const topicCount = suggestedTopics.topics_by_clo.reduce(
          (sum, g) => sum + g.topics.length, 0
        );
        completeStageProgress(code, 1, `Generated ${topicCount} suggested topics across ${suggestedTopics.topics_by_clo.length} CLOs`);
        console.log(`[API] Suggested CLO topics generated for course ${code}`);
      } catch (error) {
        console.error('[API] Suggested CLO topics generation failed:', error);
        errorStageProgress(code, 1, error instanceof Error ? error.message : String(error));
      }
    })();
    
  } catch (error) {
    console.error('Error starting suggested CLO topics:', error);
    res.status(500).json({ error: 'Failed to start suggested CLO topics generation' });
  }
});

// GET /api/courses/:code/stage1/layers - List Stage 1 internal layer states
router.get('/:code/stage1/layers', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const layers = await getLayerStateViews(code);
    const allApproved = await allStage1LayersApproved(code);
    res.json({ layers, allApproved, stage1Complete: allApproved });
  } catch (error) {
    console.error('Error fetching Stage 1 layers:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch Stage 1 layers',
    });
  }
});

// POST /api/courses/:code/stage1/layers/:layerId/run
router.post('/:code/stage1/layers/:layerId/run', async (req: Request, res: Response) => {
  try {
    const { code, layerId } = req.params;
    const { execution } = req.body as { execution?: StageExecutionMode };

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const state = await runStage1Layer(code, layerId, execution);
    const layers = await getLayerStateViews(code);
    res.json({ success: state.status !== 'blocked', layer: state, layers });
  } catch (error) {
    console.error('Error running Stage 1 layer:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run layer',
    });
  }
});

// POST /api/courses/:code/stage1/layers/:layerId/approve
router.post('/:code/stage1/layers/:layerId/approve', async (req: Request, res: Response) => {
  try {
    const { code, layerId } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const state = await approveStage1Layer(code, layerId);
    const layers = await getLayerStateViews(code);
    const allApproved = await allStage1LayersApproved(code);
    void recordAudit(req, {
      action: 'course.stage1_layer_approve',
      category: 'approval',
      entityType: 'stage1_layer',
      entityId: `${code}/${layerId}`,
      courseCode: code,
      summary: `Approved Stage 1 layer "${layerId}" for ${code}`,
      metadata: { layerId, allApproved },
    });
    res.json({
      message: 'Layer approved',
      layer: state,
      layers,
      allApproved,
    });
  } catch (error) {
    console.error('Error approving Stage 1 layer:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to approve layer',
    });
  }
});

// POST /api/courses/:code/stage1/layers/:layerId/reject
router.post('/:code/stage1/layers/:layerId/reject', async (req: Request, res: Response) => {
  try {
    const { code, layerId } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const state = await rejectStage1Layer(code, layerId);
    const layers = await getLayerStateViews(code);
    void recordAudit(req, {
      action: 'course.stage1_layer_reject',
      category: 'approval',
      entityType: 'stage1_layer',
      entityId: `${code}/${layerId}`,
      courseCode: code,
      summary: `Marked Stage 1 layer "${layerId}" for revision for ${code}`,
      metadata: { layerId },
    });
    res.json({ message: 'Layer marked for revision', layer: state, layers });
  } catch (error) {
    console.error('Error rejecting Stage 1 layer:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to reject layer',
    });
  }
});

// PUT /api/courses/:code/stage1/layers/:layerId/output
router.put('/:code/stage1/layers/:layerId/output', async (req: Request, res: Response) => {
  try {
    const { code, layerId } = req.params;
    const { reportMarkdown } = req.body as { reportMarkdown?: string };

    if (!reportMarkdown?.trim()) {
      return res.status(400).json({ error: 'reportMarkdown is required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const state = await saveStage1LayerOutput(code, layerId, reportMarkdown);
    const layers = await getLayerStateViews(code);
    res.json({ message: 'Layer output saved', layer: state, layers });
  } catch (error) {
    console.error('Error saving Stage 1 layer output:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save layer output',
    });
  }
});

// GET /api/courses/:code/stage1/clo-refinements — Layer 2 SME refinement workspace
router.get('/:code/stage1/clo-refinements', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(await getCloRefinementContext(code));
  } catch (error) {
    console.error('Error fetching CLO refinements:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch CLO refinements',
    });
  }
});

// PUT /api/courses/:code/stage1/clo-refinements — Save SME refinement decisions
router.put('/:code/stage1/clo-refinements', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { items } = req.body as { items?: CloRefinementItem[] };

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const result = await saveCloRefinements(code, items);
    res.json(result);
  } catch (error) {
    console.error('Error saving CLO refinements:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save CLO refinements',
    });
  }
});

// GET /api/courses/:code/stage1/assessment-redesigns — Layer 3 SME redesign workspace
router.get('/:code/stage1/assessment-redesigns', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(await getAssessmentRedesignContext(code));
  } catch (error) {
    console.error('Error fetching assessment redesigns:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch assessment redesigns',
    });
  }
});

// PUT /api/courses/:code/stage1/assessment-redesigns — Save SME redesign decisions
router.put('/:code/stage1/assessment-redesigns', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { items } = req.body as { items?: AssessmentRedesignItem[] };

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const result = await saveAssessmentRedesigns(code, items);
    res.json(result);
  } catch (error) {
    console.error('Error saving assessment redesigns:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save assessment redesigns',
    });
  }
});

// GET /api/courses/:code/stage1/weighting-rubric — Layer 4 SME weighting + rubric workspace
router.get('/:code/stage1/weighting-rubric', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(await getWeightingRubricContext(code));
  } catch (error) {
    console.error('Error fetching weighting rubric:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch weighting rubric',
    });
  }
});

// PUT /api/courses/:code/stage1/weighting-rubric — Save SME weighting + rubric decisions
router.put('/:code/stage1/weighting-rubric', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { courseLevelWeightingSummary, assessmentStructureReviews, fullAssessmentStructureReport } =
      req.body as {
        courseLevelWeightingSummary?: CourseLevelWeightingSummary;
        assessmentStructureReviews?: AssessmentStructureReview[];
        fullAssessmentStructureReport?: string;
      };

    if (!courseLevelWeightingSummary || !Array.isArray(assessmentStructureReviews)) {
      return res
        .status(400)
        .json({ error: 'courseLevelWeightingSummary and assessmentStructureReviews are required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const result = await saveWeightingRubric(code, {
      course_level_weighting_summary: courseLevelWeightingSummary,
      assessment_structure_reviews: assessmentStructureReviews,
      full_assessment_structure_report: fullAssessmentStructureReport,
    });
    res.json(result);
  } catch (error) {
    console.error('Error saving weighting rubric:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save weighting rubric',
    });
  }
});

// GET /api/courses/:code/stage1/integrity-review — Layer 5 SME integrity workspace
router.get('/:code/stage1/integrity-review', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(await getIntegrityReviewContext(code));
  } catch (error) {
    console.error('Error fetching integrity review:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch integrity review',
    });
  }
});

// PUT /api/courses/:code/stage1/integrity-review — Save SME integrity decisions
router.put('/:code/stage1/integrity-review', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { courseLevelIntegritySummary, assessmentIntegrityReviews } = req.body as {
      courseLevelIntegritySummary?: CourseLevelIntegritySummary;
      assessmentIntegrityReviews?: AssessmentIntegrityReview[];
    };

    if (!courseLevelIntegritySummary || !Array.isArray(assessmentIntegrityReviews)) {
      return res
        .status(400)
        .json({ error: 'courseLevelIntegritySummary and assessmentIntegrityReviews are required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const result = await saveIntegrityReview(code, {
      course_level_integrity_summary: courseLevelIntegritySummary,
      assessment_integrity_reviews: assessmentIntegrityReviews,
    });
    res.json(result);
  } catch (error) {
    console.error('Error saving integrity review:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save integrity review',
    });
  }
});

// GET /api/courses/:code/stage1/subtopic-architecture — Layer 6 SME workspace
router.get('/:code/stage1/subtopic-architecture', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(await getSubtopicArchitectureContext(code));
  } catch (error) {
    console.error('Error fetching subtopic architecture:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch subtopic architecture',
    });
  }
});

// PUT /api/courses/:code/stage1/subtopic-architecture — Save SME subtopic decisions
router.put('/:code/stage1/subtopic-architecture', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { courseSummary, cloSections } = req.body as {
      courseSummary?: SubtopicArchitectureCourseSummary;
      cloSections?: SubtopicCloSection[];
    };

    if (!courseSummary || !Array.isArray(cloSections)) {
      return res
        .status(400)
        .json({ error: 'courseSummary and cloSections are required' });
    }

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const result = await saveSubtopicArchitecture(code, {
      course_summary: courseSummary,
      clo_sections: cloSections,
    });
    res.json(result);
  } catch (error) {
    console.error('Error saving subtopic architecture:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save subtopic architecture',
    });
  }
});

// PUT /api/courses/:code/references — SME-managed reference list (fed into downstream AI context)
router.put('/:code/references', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { references } = req.body as { references?: unknown };

    if (!Array.isArray(references)) {
      return res.status(400).json({ error: 'references array is required' });
    }

    const cleaned = references
      .map((r) => (typeof r === 'string' ? r.trim() : ''))
      .filter((r) => !!r);

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const snapshot = await fileService.getExtractedSnapshot(code);
    if (!snapshot) {
      return res.status(404).json({ error: 'Course snapshot not found. Run intake first.' });
    }

    await fileService.saveExtractedSnapshot(code, { ...snapshot, references: cleaned });
    res.json({ references: cleaned });
  } catch (error) {
    console.error('Error saving references:', error);
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to save references',
    });
  }
});

// POST /api/courses/:code/confirm/clo-topics - Confirm CLO topic coverage to unlock Stage 2
router.post('/:code/confirm/clo-topics', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const snapshot = await fileService.getExtractedSnapshot(code);
    const cloTopics = snapshot?.clo_topics;
    
    if (!cloTopics || cloTopics.length === 0) {
      return res.status(400).json({ 
        error: 'No CLO topics configured. Please add topics to your CLOs first.' 
      });
    }
    
    const clos = await neo4j.getCLOs(code);
    const coverage = computeCloTopicCoverage(cloTopics, clos);
    
    // Update confirmations
    const updated = await fileService.updateConfirmations(code, {
      clo_topics_confirmed_at: new Date().toISOString(),
      clo_topics_summary: `Confirmed: ${coverage.total_topics} topics across ${coverage.total_clos} CLOs. All covered: ${coverage.all_clos_covered}`,
    });
    
    console.log(`CLO topics confirmed for ${code}`);
    
    res.json({
      message: 'CLO topic coverage confirmed',
      confirmations: updated,
    });
  } catch (error) {
    console.error('Error confirming CLO topics:', error);
    res.status(500).json({ error: 'Failed to confirm CLO topics' });
  }
});

// POST /api/courses/:code/confirm/weekly-plan - Confirm weekly plan distribution
router.post('/:code/confirm/weekly-plan', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Get snapshot to check if CLO distribution exists
    const snapshot = await fileService.getExtractedSnapshot(code);
    if (!snapshot?.clo_distribution) {
      return res.status(400).json({ 
        error: 'No CLO distribution data available. Please run Stage 1 first.' 
      });
    }
    
    // Update confirmations
    const updated = await fileService.updateConfirmations(code, {
      weekly_plan_confirmed_at: new Date().toISOString(),
      weekly_plan_summary: `Confirmed: ${snapshot.clo_distribution.total_clos} CLOs across ${snapshot.clo_distribution.total_weeks} weeks. Fair distribution: ${snapshot.clo_distribution.overall_is_fair}`
    });
    
    console.log(`Weekly plan confirmed for ${code}`);
    
    res.json({
      message: 'Weekly plan distribution confirmed',
      confirmations: updated
    });
  } catch (error) {
    console.error('Error confirming weekly plan:', error);
    res.status(500).json({ error: 'Failed to confirm weekly plan' });
  }
});

// POST /api/courses/:code/confirm/graph - Confirm graph structure
router.post('/:code/confirm/graph', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check that Stage 3 is complete
    if (course.current_stage < 3) {
      return res.status(400).json({ 
        error: 'Stage 3 must be completed before confirming the graph.' 
      });
    }
    
    // Get nodes for summary
    const nodes = await neo4j.getLearningNodes(code);
    const mandatoryCount = nodes.filter(n => n.mandatory).length;
    const skippableCount = nodes.filter(n => n.skippable).length;
    
    // Update confirmations
    const updated = await fileService.updateConfirmations(code, {
      graph_confirmed_at: new Date().toISOString(),
      graph_summary: `Confirmed: ${nodes.length} nodes (${mandatoryCount} required, ${skippableCount} skippable)`
    });
    
    console.log(`Graph confirmed for ${code}`);
    
    res.json({
      message: 'Graph structure confirmed',
      confirmations: updated
    });
  } catch (error) {
    console.error('Error confirming graph:', error);
    res.status(500).json({ error: 'Failed to confirm graph' });
  }
});

// GET /api/courses/:code/graph - Get graph data for visualization
router.get('/:code/graph', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const graphData = await neo4j.getGraphData(code);
    res.json(graphData);
  } catch (error) {
    console.error('Error fetching graph:', error);
    res.status(500).json({ error: 'Failed to fetch graph data' });
  }
});

// ============================================================================
// STAGE 2.5: CLO Graph Editing Endpoints
// ============================================================================

// GET /api/courses/:code/clos/:cloId/nodes - Get learning nodes for a CLO
router.get('/:code/clos/:cloId/nodes', async (req: Request, res: Response) => {
  try {
    const { code, cloId } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const clos = await neo4j.getCLOs(code);
    const clo = clos.find(c => c.clo_id === cloId);
    if (!clo) {
      return res.status(404).json({ error: 'CLO not found' });
    }
    
    const nodes = await neo4j.getLearningNodesByClo(cloId);
    
    res.json({
      clo_id: cloId,
      nodes,
      node_count: nodes.length
    });
  } catch (error) {
    console.error('Error fetching CLO nodes:', error);
    res.status(500).json({ error: 'Failed to fetch CLO nodes' });
  }
});

// PUT /api/courses/:code/clos/:cloId/nodes - Upsert/delete nodes for a CLO (Stage 2.5)
router.put('/:code/clos/:cloId/nodes', async (req: Request, res: Response) => {
  try {
    const { code, cloId } = req.params;
    const { upserts, deletes } = req.body as {
      upserts?: Array<{
        node_id?: string;
        node_type: string;
        learning_intent: string;
        risk_level: string;
        failure_meaning?: string;
        diagnostic_intent?: string;
        ui_x?: number;
        ui_y?: number;
      }>;
      deletes?: string[];
    };
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Verify CLO exists
    const clos = await neo4j.getCLOs(code);
    const clo = clos.find(c => c.clo_id === cloId);
    if (!clo) {
      return res.status(404).json({ error: 'CLO not found' });
    }
    
    // Validate inputs
    if (!upserts && !deletes) {
      return res.status(400).json({ error: 'At least one of upserts or deletes is required' });
    }
    
    // Validate upserts have required fields
    if (upserts) {
      for (const node of upserts) {
        if (!node.node_type || !node.learning_intent || !node.risk_level) {
          return res.status(400).json({ 
            error: 'Each upsert must have node_type, learning_intent, and risk_level' 
          });
        }
      }
    }
    
    // Perform upsert/delete operations
    const result = await neo4j.upsertCloNodes(
      cloId,
      (upserts || []) as import('../models/schemas.js').LearningNodeUpsert[],
      deletes || []
    );
    
    // Clear node graph confirmation since structure changed
    const confirmations = await fileService.getConfirmations(code);
    if (confirmations?.node_graph_confirmed_at) {
      await fileService.updateConfirmations(code, {
        node_graph_confirmed_at: undefined,
        node_graph_summary: undefined
      });
    }
    
    console.log(`Stage 2.5: Updated nodes for CLO ${cloId} in course ${code}`);
    
    res.json({
      message: 'Nodes updated successfully',
      clo_id: cloId,
      created: result.created,
      deleted: result.deleted
    });
  } catch (error) {
    console.error('Error updating CLO nodes:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to update CLO nodes' 
    });
  }
});

// PUT /api/courses/:code/clos/:cloId/prerequisites - Save prerequisites for a CLO (Stage 2.5)
router.put('/:code/clos/:cloId/prerequisites', async (req: Request, res: Response) => {
  try {
    const { code, cloId } = req.params;
    const { edges } = req.body as {
      edges: Array<{ source_node_id: string; target_node_id: string }>;
    };
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Verify CLO exists
    const clos = await neo4j.getCLOs(code);
    const clo = clos.find(c => c.clo_id === cloId);
    if (!clo) {
      return res.status(404).json({ error: 'CLO not found' });
    }
    
    // Get all node IDs for this CLO
    const cloNodes = await neo4j.getLearningNodesByClo(cloId);
    const validNodeIds = new Set(cloNodes.map(n => n.node_id));
    
    // Validate edges
    const validEdges = edges || [];
    for (const edge of validEdges) {
      // Check both nodes exist and belong to this CLO
      if (!validNodeIds.has(edge.source_node_id)) {
        return res.status(400).json({ 
          error: `Invalid source node: ${edge.source_node_id}` 
        });
      }
      if (!validNodeIds.has(edge.target_node_id)) {
        return res.status(400).json({ 
          error: `Invalid target node: ${edge.target_node_id}` 
        });
      }
      // Check for self-dependency
      if (edge.source_node_id === edge.target_node_id) {
        return res.status(400).json({ 
          error: `Self-dependency not allowed: ${edge.source_node_id}` 
        });
      }
    }
    
    // Validate DAG (no cycles)
    const dagResult = await neo4j.validateCloEdgesDAG(cloId, validEdges);
    if (!dagResult.valid) {
      return res.status(400).json({ 
        error: 'Cycle detected in prerequisites',
        cycle: dagResult.cycle
      });
    }
    
    // Replace prerequisites
    await neo4j.replaceCloPrerequisites(cloId, validEdges);
    
    // Clear node graph confirmation since structure changed
    const confirmations = await fileService.getConfirmations(code);
    if (confirmations?.node_graph_confirmed_at) {
      await fileService.updateConfirmations(code, {
        node_graph_confirmed_at: undefined,
        node_graph_summary: undefined
      });
    }
    
    console.log(`Stage 2.5: Updated prerequisites for CLO ${cloId} in course ${code} (${validEdges.length} edges)`);
    
    res.json({
      message: 'Prerequisites updated successfully',
      clo_id: cloId,
      edge_count: validEdges.length
    });
  } catch (error) {
    console.error('Error updating CLO prerequisites:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to update prerequisites' 
    });
  }
});

// POST /api/courses/:code/confirm/node-graph - Confirm node graph structure (Stage 2.5)
router.post('/:code/confirm/node-graph', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check that Stage 2 is complete
    if (course.current_stage < 2) {
      return res.status(400).json({ 
        error: 'Stage 2 must be completed before confirming the node graph.' 
      });
    }
    
    // Get nodes and CLO counts for summary
    const nodes = await neo4j.getLearningNodes(code);
    const nodeCounts = await neo4j.getNodeCountsByClo(code);
    const cloCount = Object.keys(nodeCounts).length;
    
    // Count edges
    let edgeCount = 0;
    for (const node of nodes) {
      edgeCount += node.prerequisite_nodes.length;
    }
    
    // Update confirmations
    const updated = await fileService.updateConfirmations(code, {
      node_graph_confirmed_at: new Date().toISOString(),
      node_graph_summary: `Confirmed: ${nodes.length} nodes across ${cloCount} CLOs, ${edgeCount} prerequisite edges`
    });
    
    console.log(`Node graph confirmed for ${code}`);
    
    res.json({
      message: 'Node graph structure confirmed',
      confirmations: updated,
      summary: {
        total_nodes: nodes.length,
        clo_count: cloCount,
        edge_count: edgeCount,
        nodes_per_clo: nodeCounts
      }
    });
  } catch (error) {
    console.error('Error confirming node graph:', error);
    res.status(500).json({ error: 'Failed to confirm node graph' });
  }
});

// GET /api/courses/:code/download - Download compiled PDF
router.get('/:code/download', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const pdfBuffer = fileService.getCompiledPDF(code);
    if (!pdfBuffer) {
      return res.status(404).json({ error: 'PDF not found. Please run Stage 5 first.' });
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// GET /api/courses/:code/download/zip - Download markdown ZIP
router.get('/:code/download/zip', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const zipPath = await createMarkdownZip(code);
    res.download(zipPath, `${code}-markdown.zip`);
  } catch (error) {
    console.error('Error creating ZIP:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to create ZIP' 
    });
  }
});

// GET /api/courses/:code/download/:docType/:format - Download a specific compiled document
// :docType = main-course | content | video-scripts | assessments | combined
// :format  = pdf | docx
router.get('/:code/download/:docType/:format', async (req: Request, res: Response) => {
  try {
    const { code, docType, format } = req.params;

    const validDocTypes: CompiledDocType[] = ['main-course', 'content', 'video-scripts', 'assessments', 'combined'];
    const validFormats: CompiledDocFormat[] = ['pdf', 'docx'];

    if (!validDocTypes.includes(docType as CompiledDocType)) {
      return res.status(400).json({
        error: `Invalid document type "${docType}". Must be one of: ${validDocTypes.join(', ')}`
      });
    }

    if (!validFormats.includes(format as CompiledDocFormat)) {
      return res.status(400).json({
        error: `Invalid format "${format}". Must be one of: ${validFormats.join(', ')}`
      });
    }

    const buffer = fileService.getCompiledDocument(
      code,
      docType as CompiledDocType,
      format as CompiledDocFormat
    );

    if (!buffer) {
      return res.status(404).json({
        error: `Document not found: ${docType}.${format}. Please run Stage 5 first.`
      });
    }

    const contentType = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    const filename = `${code}-${docType}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading document:', error);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

// GET /api/courses/:code/download/list - List all available compiled documents
router.get('/:code/download/list', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const documents = fileService.listCompiledDocuments(code);

    res.json({
      course_code: code,
      document_count: documents.length,
      documents: documents.map(d => ({
        docType: d.docType,
        format: d.format,
        downloadUrl: `/api/courses/${code}/download/${d.docType}/${d.format}`
      }))
    });
  } catch (error) {
    console.error('Error listing documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/content - Get node content (legacy - instructional only)
router.get('/:code/nodes/:nodeId/content', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    
    // Try new Stage 4 content first
    const stage4Content = await getStage4NodeContent(code, nodeId);
    if (stage4Content) {
      return res.json({ 
        node_id: nodeId, 
        content: stage4Content.instructional_content 
      });
    }
    
    // Fall back to legacy content
    const content = await fileService.getNodeContent(code, nodeId);
    if (!content) {
      return res.status(404).json({ error: 'Node content not found' });
    }
    
    res.json({ node_id: nodeId, content });
  } catch (error) {
    console.error('Error fetching node content:', error);
    res.status(500).json({ error: 'Failed to fetch node content' });
  }
});

// ============================================================================
// STAGE 4 ENHANCED ENDPOINTS - Content Pack, Assessments, Videos, Rubric, Workload
// ============================================================================

// GET /api/courses/:code/stage/4/content-pack - Get full content pack summary
router.get('/:code/stage/4/content-pack', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const contentPack = getStage4ContentPack(code);
    if (!contentPack) {
      return res.status(404).json({ 
        error: 'Content pack not found. Please run Stage 4 first.' 
      });
    }
    
    res.json(contentPack);
  } catch (error) {
    console.error('Error fetching content pack:', error);
    res.status(500).json({ error: 'Failed to fetch content pack' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/content-pack - Get full node content pack
router.get('/:code/nodes/:nodeId/content-pack', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    
    const contentPack = getStage4NodeContent(code, nodeId);
    if (!contentPack) {
      return res.status(404).json({ error: 'Node content pack not found' });
    }
    
    res.json(contentPack);
  } catch (error) {
    console.error('Error fetching node content pack:', error);
    res.status(500).json({ error: 'Failed to fetch node content pack' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/assessments - Get node assessments
router.get('/:code/nodes/:nodeId/assessments', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    
    const assessments = await getNodeAssessments(code, nodeId);
    if (assessments.length === 0) {
      return res.status(404).json({ error: 'No assessments found for this node' });
    }
    
    res.json({
      node_id: nodeId,
      assessment_count: assessments.length,
      assessments
    });
  } catch (error) {
    console.error('Error fetching node assessments:', error);
    res.status(500).json({ error: 'Failed to fetch node assessments' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/video-script - Get node video script
router.get('/:code/nodes/:nodeId/video-script', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    
    const videoScript = getNodeVideoScript(code, nodeId);
    if (!videoScript) {
      return res.status(404).json({ error: 'No video script found for this node' });
    }
    
    res.json(videoScript);
  } catch (error) {
    console.error('Error fetching video script:', error);
    res.status(500).json({ error: 'Failed to fetch video script' });
  }
});

// GET /api/courses/:code/rubric - Get course rubric
router.get('/:code/rubric', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const rubric = getStage4Rubric(code);
    if (!rubric) {
      return res.status(404).json({ 
        error: 'Rubric not found. Please run Stage 4 first.' 
      });
    }
    
    res.json(rubric);
  } catch (error) {
    console.error('Error fetching rubric:', error);
    res.status(500).json({ error: 'Failed to fetch rubric' });
  }
});

// GET /api/courses/:code/workload - Get workload map
router.get('/:code/workload', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const workloadMap = await getStage4WorkloadMap(code);
    if (!workloadMap) {
      return res.status(404).json({ 
        error: 'Workload map not found. Please run Stage 4 first.' 
      });
    }
    
    res.json(workloadMap);
  } catch (error) {
    console.error('Error fetching workload map:', error);
    res.status(500).json({ error: 'Failed to fetch workload map' });
  }
});

// GET /api/courses/:code/workload/validate - Validate workload against credits
router.get('/:code/workload/validate', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const workloadMap = await getStage4WorkloadMap(code);
    if (!workloadMap) {
      return res.status(404).json({ 
        error: 'Workload map not found. Please run Stage 4 first.' 
      });
    }
    
    res.json({
      course_code: code,
      credit_hours: workloadMap.credit_hours,
      expected_hours: workloadMap.expected_hours,
      actual_hours: workloadMap.total_hours,
      alignment_status: workloadMap.alignment_status,
      deviation_percentage: workloadMap.deviation_percentage,
      deviation_hours: workloadMap.deviation_hours,
      is_valid: workloadMap.is_valid,
      validation_notes: workloadMap.validation_notes
    });
  } catch (error) {
    console.error('Error validating workload:', error);
    res.status(500).json({ error: 'Failed to validate workload' });
  }
});

// GET /api/courses/:code/learner-instructions - Get learner instructions
router.get('/:code/learner-instructions', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const instructions = getStage4LearnerInstructions(code);
    if (!instructions) {
      return res.status(404).json({ 
        error: 'Learner instructions not found. Please run Stage 4 first.' 
      });
    }
    
    res.json({
      course_code: code,
      instructions
    });
  } catch (error) {
    console.error('Error fetching learner instructions:', error);
    res.status(500).json({ error: 'Failed to fetch learner instructions' });
  }
});

// GET /api/courses/:code/assessments - Get all assessments for a course
router.get('/:code/assessments', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const contentPack = getStage4ContentPack(code);
    if (!contentPack) {
      return res.status(404).json({ 
        error: 'Content pack not found. Please run Stage 4 first.' 
      });
    }
    
    // Get all nodes and their assessments
    const nodes = await neo4j.getLearningNodes(code);
    const allAssessments = (await Promise.all(nodes.map(async node => {
      const assessments = await getNodeAssessments(code, node.node_id);
      return assessments.map(a => ({
        ...a,
        node_learning_intent: node.learning_intent,
        node_type: node.node_type
      }));
    }))).flat();
    
    // Group by assessment type
    const byType = {
      pre_knowledge: allAssessments.filter(a => a.assessment_type === 'pre_knowledge'),
      formative_diagnostic: allAssessments.filter(a => a.assessment_type === 'formative_diagnostic'),
      mastery_evidence: allAssessments.filter(a => a.assessment_type === 'mastery_evidence')
    };
    
    res.json({
      course_code: code,
      total_assessments: allAssessments.length,
      by_type: byType,
      summary: {
        pre_knowledge_count: byType.pre_knowledge.length,
        formative_count: byType.formative_diagnostic.length,
        mastery_count: byType.mastery_evidence.length
      }
    });
  } catch (error) {
    console.error('Error fetching all assessments:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

// GET /api/courses/:code/video-scripts - Get all video scripts for a course
router.get('/:code/video-scripts', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const nodes = await neo4j.getLearningNodes(code);
    const videoScripts = (await Promise.all(nodes
      .map(async node => {
        const script = await getNodeVideoScript(code, node.node_id);
        if (script) {
          return {
            ...script,
            node_learning_intent: node.learning_intent,
            node_type: node.node_type
          };
        }
        return null;
      })))
      .filter(script => script !== null);
    
    res.json({
      course_code: code,
      total_videos: videoScripts.length,
      total_duration_minutes: videoScripts.reduce((sum, s) => sum + (s?.duration_minutes || 0), 0),
      video_scripts: videoScripts
    });
  } catch (error) {
    console.error('Error fetching video scripts:', error);
    res.status(500).json({ error: 'Failed to fetch video scripts' });
  }
});

// ============================================================================
// STAGE 4 ENHANCED ARTIFACT ENDPOINTS (Steps A–G)
// ============================================================================

// GET /api/courses/:code/nodes/:nodeId/modality-plan - Get node modality plan (Step A)
router.get('/:code/nodes/:nodeId/modality-plan', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const plan = getStage4ModalityPlan(code, nodeId);
    if (!plan) {
      return res.status(404).json({ error: 'Modality plan not found for this node' });
    }
    res.json(plan);
  } catch (error) {
    console.error('Error fetching modality plan:', error);
    res.status(500).json({ error: 'Failed to fetch modality plan' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/instructional-package - Get instructional package (Step B)
router.get('/:code/nodes/:nodeId/instructional-package', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const pkg = getStage4InstructionalPackage(code, nodeId);
    if (!pkg) {
      return res.status(404).json({ error: 'Instructional package not found for this node' });
    }
    res.json(pkg);
  } catch (error) {
    console.error('Error fetching instructional package:', error);
    res.status(500).json({ error: 'Failed to fetch instructional package' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/diagnostic-assessment - Get diagnostic assessment (Step C Layer 1)
router.get('/:code/nodes/:nodeId/diagnostic-assessment', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const assessment = getStage4DiagnosticAssessment(code, nodeId);
    if (!assessment) {
      return res.status(404).json({ error: 'Diagnostic assessment not found for this node' });
    }
    res.json(assessment);
  } catch (error) {
    console.error('Error fetching diagnostic assessment:', error);
    res.status(500).json({ error: 'Failed to fetch diagnostic assessment' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/llm-interactive-spec - Get LLM interactive spec (Step C Layer 2)
router.get('/:code/nodes/:nodeId/llm-interactive-spec', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const spec = getStage4LLMInteractiveSpec(code, nodeId);
    if (!spec) {
      return res.status(404).json({ error: 'LLM-interactive assessment spec not found for this node' });
    }
    res.json(spec);
  } catch (error) {
    console.error('Error fetching LLM interactive spec:', error);
    res.status(500).json({ error: 'Failed to fetch LLM interactive spec' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/remediation-assets - Get remediation assets (Step D)
router.get('/:code/nodes/:nodeId/remediation-assets', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const pack = getStage4RemediationPack(code, nodeId);
    if (!pack) {
      return res.status(404).json({ error: 'Remediation assets not found for this node' });
    }
    res.json(pack);
  } catch (error) {
    console.error('Error fetching remediation assets:', error);
    res.status(500).json({ error: 'Failed to fetch remediation assets' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/visual-specs - Get visual asset specs (Step E)
router.get('/:code/nodes/:nodeId/visual-specs', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const specs = getStage4VisualAssetSpecs(code, nodeId);
    if (!specs) {
      return res.status(404).json({ error: 'Visual asset specs not found for this node' });
    }
    res.json({ node_id: nodeId, visual_specs: specs });
  } catch (error) {
    console.error('Error fetching visual specs:', error);
    res.status(500).json({ error: 'Failed to fetch visual specs' });
  }
});

// GET /api/courses/:code/nodes/:nodeId/video-production-package - Get video production package (Step E)
router.get('/:code/nodes/:nodeId/video-production-package', async (req: Request, res: Response) => {
  try {
    const { code, nodeId } = req.params;
    const pkg = getStage4VideoProductionPackage(code, nodeId);
    if (!pkg) {
      return res.status(404).json({ error: 'Video production package not found for this node' });
    }
    res.json(pkg);
  } catch (error) {
    console.error('Error fetching video production package:', error);
    res.status(500).json({ error: 'Failed to fetch video production package' });
  }
});

// GET /api/courses/:code/summative-assessments - Get summative assessment pack (Step C Layer 3)
router.get('/:code/summative-assessments', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const pack = getStage4SummativeAssessments(code);
    if (!pack) {
      return res.status(404).json({ error: 'Summative assessments not generated yet' });
    }
    res.json(pack);
  } catch (error) {
    console.error('Error fetching summative assessments:', error);
    res.status(500).json({ error: 'Failed to fetch summative assessments' });
  }
});

// GET /api/courses/:code/course-book - Get course book JSON (Step F)
router.get('/:code/course-book', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const format = req.query.format as string;
    
    if (format === 'markdown') {
      const markdown = getStage4CourseBookMarkdown(code);
      if (!markdown) {
        return res.status(404).json({ error: 'Course book not generated yet' });
      }
      res.type('text/markdown').send(markdown);
    } else {
      const book = getStage4CourseBook(code);
      if (!book) {
        return res.status(404).json({ error: 'Course book not generated yet' });
      }
      res.json(book);
    }
  } catch (error) {
    console.error('Error fetching course book:', error);
    res.status(500).json({ error: 'Failed to fetch course book' });
  }
});

// GET /api/courses/:code/stage/4/validation - Get Stage 4 validation report
router.get('/:code/stage/4/validation', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const report = getStage4ValidationReport(code);
    if (!report) {
      return res.status(404).json({ error: 'Validation report not generated yet' });
    }
    res.json(report);
  } catch (error) {
    console.error('Error fetching validation report:', error);
    res.status(500).json({ error: 'Failed to fetch validation report' });
  }
});

// ============================================================================
// STAGE 5A — Structural Assembly & Adaptive Logic Validation
// ============================================================================

// POST /api/courses/:code/stage/5a - Run Stage 5A validation
// Optional body: { simulate?: boolean } to include learner path simulations
router.post('/:code/stage/5a', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { simulate } = req.body as { simulate?: boolean };

    const course = await neo4j.getCourse(code);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Gate: must be at least Stage 4
    if (course.current_stage < 4) {
      return res.status(400).json({
        error: 'Stage 4 must be completed before running Stage 5A validation.'
      });
    }

    // Gate: graph must be confirmed
    const confirmations = await fileService.getConfirmations(code);
    if (!confirmations?.graph_confirmed_at) {
      return res.status(400).json({
        error: 'Graph structure must be confirmed before running Stage 5A. Please confirm the graph on the Graph tab.'
      });
    }

    // Run asynchronously (respond immediately, track via SSE)
    res.json({
      message: 'Stage 5A validation started',
      status: 'started',
      course_code: code
    });

    // Fire and forget — progress tracked via SSE
    (async () => {
      try {
        const options: Stage5AOptions = {
          simulate: simulate !== false  // Default to true
        };
        await runStage5A(code, options);
      } catch (error) {
        console.error('Stage 5A background error:', error);
      }
    })();

  } catch (error) {
    console.error('Error starting Stage 5A:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Stage 5A validation'
    });
  }
});

// GET /api/courses/:code/stage/5a/report - Get Stage 5A validation report (JSON)
router.get('/:code/stage/5a/report', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const format = req.query.format as string;

    const exists = await neo4j.courseExists(code);
    if (!exists) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (format === 'markdown') {
      const markdown = getStage5AReportMarkdown(code);
      if (!markdown) {
        return res.status(404).json({
          error: 'Stage 5A report not found. Please run Stage 5A first.'
        });
      }
      res.type('text/markdown').send(markdown);
    } else {
      const report = getStage5AReport(code);
      if (!report) {
        return res.status(404).json({
          error: 'Stage 5A report not found. Please run Stage 5A first.'
        });
      }
      res.json(report);
    }
  } catch (error) {
    console.error('Error fetching Stage 5A report:', error);
    res.status(500).json({ error: 'Failed to fetch Stage 5A report' });
  }
});

export default router;
