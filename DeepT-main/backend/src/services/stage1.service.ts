import { v4 as uuidv4 } from 'uuid';
import { callAI, parseAIJson, getCouncilInfo, resolveStage1IntakeConfig, type CouncilProgressCallback } from './ai.service.js';
import { assertAIConfigured } from './council.service.js';
import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import { buildStage1Prompt, buildCLOAnalysisPrompt } from '../utils/prompts.js';
import { startStageProgress, updateProgress, completeStageProgress, errorStageProgress, type CouncilInfo } from './progress.service.js';
import { runCLOMapping } from './clo_weekly_plan.service.js';

// Helper to create a council progress callback for a stage
function createCouncilProgressCallback(
  courseCode: string, 
  stage: number, 
  step: string, 
  councilInfo: CouncilInfo
): CouncilProgressCallback {
  return {
    onMemberComplete: (model: string, completed: number, total: number) => {
      updateProgress({
        courseCode,
        stage,
        status: 'running',
        step,
        message: `Council deliberating: ${completed}/${total} members responded`,
        council: {
          ...councilInfo,
          phase: 'deliberating',
          completedModels: councilInfo.models.slice(0, completed)
        }
      });
    },
    onSynthesisStart: (chairmanModel: string, memberCount: number) => {
      updateProgress({
        courseCode,
        stage,
        status: 'running',
        step,
        message: `All ${memberCount} council members submitted. Chairman synthesizing responses...`,
        council: {
          ...councilInfo,
          phase: 'synthesizing',
          completedModels: councilInfo.models
        }
      });
    }
  };
}
import type { 
  Course, 
  ExtractedSnapshot, 
  CourseContract, 
  CLO,
  StageResult,
  StageExecutionMode
} from '../models/schemas.js';

interface ExtractionResult {
  course_code: string;
  title: string;
  description: string;
  credit_hours: number;
  weekly_plan: Array<{
    week: number;
    topic: string;
    description: string;
    readings?: string;
  }>;
  clos: string[];
  assessments: Array<{
    name: string;
    type: string;
    weight: number;
    description: string;
  }>;
  references: string[];
  accreditation_tags: string[];
}

interface CLOAnalysisResult {
  clos: CLO[];
}

export async function runStage1(
  rawText: string,
  existingCourseCode?: string,
  executionOverride?: StageExecutionMode
): Promise<StageResult> {
  // Use a temporary code for progress until we know the actual course code
  const tempCode = existingCourseCode || 'NEW_COURSE';
  
  try {
    assertAIConfigured();
    console.log('Stage 1: Starting extraction...');
    
    // Resolve the intake config (layer1-intake is source of truth, stageConfigs.stage1
    // is the fallback) and use it for BOTH the AI calls and the council-info progress
    // reporting so they always reflect the same configuration.
    const stageConfig = resolveStage1IntakeConfig();
    const councilInfo = getCouncilInfo(1, executionOverride, stageConfig);
    const council: CouncilInfo = {
      mode: councilInfo.mode,
      memberCount: councilInfo.memberCount,
      models: councilInfo.models,
      chairmanModel: councilInfo.chairmanModel,
      phase: councilInfo.mode === 'council' ? 'deliberating' : undefined
    };
    
    startStageProgress(tempCode, 1, 'Extracting course data from document', council);
    
    // Step 1: Extract structured data from syllabus
    updateProgress({
      courseCode: tempCode,
      stage: 1,
      status: 'running',
      step: 'Extracting structured data',
      message: 'AI is analyzing the document...',
      council
    });
    
    // Use custom task prompt if configured
    const extractionPrompt = buildStage1Prompt(rawText, stageConfig.taskPrompt);
    const progressCallback = council.mode === 'council' 
      ? createCouncilProgressCallback(tempCode, 1, 'Extracting structured data', council)
      : undefined;
    const extractionResponse = await callAI(
      [{ role: 'user', content: extractionPrompt }],
      1,
      { jsonMode: true, progressCallback },
      executionOverride,
      stageConfig
    );
    
    // Debug: Log raw response before parsing
    console.log('Stage 1: Raw extraction response (first 500 chars):', extractionResponse.substring(0, 500));
    
    const extracted = parseAIJson<ExtractionResult>(extractionResponse);
    
    // Validate that the expected fields exist
    if (!extracted.clos || !Array.isArray(extracted.clos)) {
      console.error('Stage 1: Invalid response - missing or invalid clos field. Keys found:', Object.keys(extracted));
      throw new Error(`AI response missing required 'clos' array. Got keys: ${Object.keys(extracted).join(', ')}`);
    }
    
    console.log('Stage 1: Extraction complete, found', extracted.clos.length, 'CLOs');
    
    // Ensure course code is set
    const courseCode = existingCourseCode || extracted.course_code || `COURSE-${uuidv4().substring(0, 8).toUpperCase()}`;
    
    // Step 2: Analyze CLOs for pedagogical properties
    if (extracted.clos.length === 0) {
      throw new Error('No Course Learning Outcomes found in the document');
    }
    
    updateProgress({
      courseCode: courseCode,
      stage: 1,
      status: 'running',
      step: 'Analyzing CLOs',
      message: `Analyzing ${extracted.clos.length} Course Learning Outcomes...`,
      council
    });
    
    // Use custom CLO analysis prompt (taskPrompt2) if configured
    const analysisPrompt = buildCLOAnalysisPrompt(extracted.clos, stageConfig.taskPrompt2);
    const analysisCallback = council.mode === 'council'
      ? createCouncilProgressCallback(courseCode, 1, 'Analyzing CLOs', council)
      : undefined;
    const analysisResponse = await callAI(
      [{ role: 'user', content: analysisPrompt }],
      1,
      { jsonMode: true, progressCallback: analysisCallback },
      executionOverride,
      stageConfig
    );
    
    const cloAnalysis = parseAIJson<CLOAnalysisResult>(analysisResponse);
    console.log('Stage 1: CLO analysis complete');
    
    // Ensure CLOs have proper IDs
    const analyzedCLOs = cloAnalysis.clos.map((clo, index) => ({
      ...clo,
      clo_id: clo.clo_id || `CLO-${index + 1}`
    }));
    
    // Step 3: Map weekly plan to CLOs and compute distribution
    let mappedWeeklyPlan = extracted.weekly_plan || [];
    let cloDistribution = undefined;
    
    if (mappedWeeklyPlan.length > 0 && analyzedCLOs.length > 0) {
      updateProgress({
        courseCode: courseCode,
        stage: 1,
        status: 'running',
        step: 'Mapping CLOs to weekly plan',
        message: `Analyzing CLO coverage across ${mappedWeeklyPlan.length} weeks...`,
        council
      });
      
      const mappingResult = await runCLOMapping(
        analyzedCLOs,
        mappedWeeklyPlan,
        courseCode,
        council,
        executionOverride,
        stageConfig
      );
      
      mappedWeeklyPlan = mappingResult.weekly_plan;
      cloDistribution = mappingResult.distribution;
      
      console.log(`Stage 1: CLO mapping complete. Fair distribution: ${cloDistribution.overall_is_fair}`);
    }
    
    // Step 4: Create extracted snapshot
    const snapshot: ExtractedSnapshot = {
      course_code: courseCode,
      title: extracted.title || 'Untitled Course',
      description: extracted.description || '',
      credit_hours: extracted.credit_hours || 3,
      raw_text: rawText,
      weekly_plan: mappedWeeklyPlan,
      assessments: extracted.assessments || [],
      references: extracted.references || [],
      extracted_at: new Date().toISOString(),
      clo_distribution: cloDistribution
    };
    
    // Step 5: Create course contract
    const contract: CourseContract = {
      course_code: courseCode,
      course_metadata: {
        credits: extracted.credit_hours || 3,
        hours: (extracted.credit_hours || 3) * 15, // Typical semester hours
        accreditation_tags: extracted.accreditation_tags || []
      },
      course_learning_outcomes: analyzedCLOs,
      assessment_strategy: extracted.assessments
        .map(a => `${a.name} (${a.type}): ${a.weight}%`)
        .join('; ') || 'Assessment strategy not specified',
      assumptions_and_constraints: 'Extracted from uploaded syllabus document'
    };
    
    // Step 6: Initialize file storage
    updateProgress({
      courseCode: courseCode,
      stage: 1,
      status: 'running',
      step: 'Saving course data',
      message: 'Saving contract and snapshot...',
      council
    });
    
    fileService.initCourseDirectories(courseCode);
    fileService.saveExtractedSnapshot(courseCode, snapshot);
    fileService.saveCourseContract(courseCode, contract);
    
    // Clear any existing confirmations when Stage 1 is re-run
    fileService.clearConfirmations(courseCode);
    
    // Step 7: Save to Neo4j
    // Check if course exists and delete if regenerating
    const exists = await neo4j.courseExists(courseCode);
    if (exists) {
      await neo4j.deleteCLOs(courseCode);
      await neo4j.updateCourseStage(courseCode, 1);
    } else {
      // Create new course
      const course: Course = {
        course_code: courseCode,
        title: snapshot.title,
        description: snapshot.description,
        credit_hours: snapshot.credit_hours,
        raw_extracted_text: rawText.substring(0, 10000), // Limit stored text
        current_stage: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await neo4j.createCourse(course);
    }
    
    // Create CLO nodes
    await neo4j.createCLOs(courseCode, contract.course_learning_outcomes);
    
    // Create accreditation tags if present
    if (contract.course_metadata.accreditation_tags.length > 0) {
      await neo4j.createAccreditationTags(courseCode, contract.course_metadata.accreditation_tags);
    }
    
    console.log('Stage 1: Complete');
    completeStageProgress(courseCode, 1, `Extracted ${contract.course_learning_outcomes.length} CLOs`);
    
    return {
      success: true,
      stage: 1,
      message: `Extracted ${contract.course_learning_outcomes.length} CLOs from course ${courseCode}`,
      data: {
        course_code: courseCode,
        snapshot,
        contract
      }
    };
  } catch (error) {
    console.error('Stage 1 Error:', error);
    errorStageProgress(tempCode, 1, error instanceof Error ? error.message : String(error));
    return {
      success: false,
      stage: 1,
      message: 'Failed to complete Stage 1',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Run Stage 1 from manual form input
export async function runStage1FromForm(
  formData: {
    course_code: string;
    title: string;
    description: string;
    credit_hours: number;
    clos: string[];
    assessments?: Array<{ name: string; type: string; weight: number; description: string }>;
    references?: string[];
  },
  executionOverride?: StageExecutionMode
): Promise<StageResult> {
  try {
    console.log('Stage 1 (Form): Starting...');
    
    const courseCode = formData.course_code;
    
    // Resolve the intake config (layer1-intake is source of truth, stageConfigs.stage1
    // is the fallback) so the form path uses the same intake configuration as runStage1.
    const stageConfig = resolveStage1IntakeConfig();
    
    // Analyze CLOs
    if (formData.clos.length === 0) {
      throw new Error('At least one Course Learning Outcome is required');
    }
    
    // Use custom CLO analysis prompt (taskPrompt2) if configured
    const analysisPrompt = buildCLOAnalysisPrompt(formData.clos, stageConfig.taskPrompt2);
    const analysisResponse = await callAI(
      [{ role: 'user', content: analysisPrompt }],
      1,
      { jsonMode: true },
      executionOverride,
      stageConfig
    );
    
    const cloAnalysis = parseAIJson<CLOAnalysisResult>(analysisResponse);
    
    // Create snapshot
    const snapshot: ExtractedSnapshot = {
      course_code: courseCode,
      title: formData.title,
      description: formData.description,
      credit_hours: formData.credit_hours,
      raw_text: `Manual entry:\n${formData.clos.join('\n')}`,
      weekly_plan: [],
      assessments: formData.assessments || [],
      references: formData.references || [],
      extracted_at: new Date().toISOString()
    };
    
    // Create contract
    const contract: CourseContract = {
      course_code: courseCode,
      course_metadata: {
        credits: formData.credit_hours,
        hours: formData.credit_hours * 15,
        accreditation_tags: []
      },
      course_learning_outcomes: cloAnalysis.clos.map((clo, index) => ({
        ...clo,
        clo_id: clo.clo_id || `CLO-${index + 1}`
      })),
      assessment_strategy: formData.assessments
        ?.map(a => `${a.name} (${a.type}): ${a.weight}%`)
        .join('; ') || 'Assessment strategy not specified',
      assumptions_and_constraints: 'Entered manually via form'
    };
    
    // Save files
    fileService.initCourseDirectories(courseCode);
    fileService.saveExtractedSnapshot(courseCode, snapshot);
    fileService.saveCourseContract(courseCode, contract);
    
    // Save to Neo4j
    const exists = await neo4j.courseExists(courseCode);
    if (exists) {
      await neo4j.deleteCLOs(courseCode);
      await neo4j.updateCourseStage(courseCode, 1);
    } else {
      const course: Course = {
        course_code: courseCode,
        title: formData.title,
        description: formData.description,
        credit_hours: formData.credit_hours,
        raw_extracted_text: snapshot.raw_text,
        current_stage: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await neo4j.createCourse(course);
    }
    
    await neo4j.createCLOs(courseCode, contract.course_learning_outcomes);
    
    console.log('Stage 1 (Form): Complete');
    
    return {
      success: true,
      stage: 1,
      message: `Created course ${courseCode} with ${contract.course_learning_outcomes.length} CLOs`,
      data: {
        course_code: courseCode,
        snapshot,
        contract
      }
    };
  } catch (error) {
    console.error('Stage 1 (Form) Error:', error);
    return {
      success: false,
      stage: 1,
      message: 'Failed to complete Stage 1',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
