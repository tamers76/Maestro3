import { callAI, parseAIJson } from './ai.service.js';
import { buildCLOWeeklyMappingPrompt } from '../utils/prompts.js';
import { updateProgress, type CouncilInfo } from './progress.service.js';
import type { 
  CLO, 
  WeeklyPlanItem, 
  CLODistribution, 
  CLODistributionStat,
  StageExecutionMode 
} from '../models/schemas.js';

interface WeekCLOMapping {
  week: number;
  clo_ids: string[];
}

interface MappingResult {
  mappings: WeekCLOMapping[];
}

/**
 * Maps weekly plan items to CLOs using AI analysis
 * @param clos - Array of analyzed CLOs with clo_id and clo_text
 * @param weeklyPlan - Array of weekly plan items
 * @param courseCode - Course code for progress updates
 * @param council - Council info for progress reporting
 * @param executionOverride - Optional execution mode override
 * @returns Updated weekly plan with clo_ids added to each week
 */
export async function mapWeeklyPlanToCLOs(
  clos: CLO[],
  weeklyPlan: WeeklyPlanItem[],
  courseCode: string,
  council?: CouncilInfo,
  executionOverride?: StageExecutionMode
): Promise<WeeklyPlanItem[]> {
  // Skip if no weekly plan
  if (!weeklyPlan || weeklyPlan.length === 0) {
    console.log('CLO Mapping: No weekly plan to map');
    return weeklyPlan;
  }

  // Skip if no CLOs
  if (!clos || clos.length === 0) {
    console.log('CLO Mapping: No CLOs to map');
    return weeklyPlan;
  }

  console.log(`CLO Mapping: Mapping ${weeklyPlan.length} weeks to ${clos.length} CLOs...`);

  updateProgress({
    courseCode,
    stage: 1,
    status: 'running',
    step: 'Mapping weeks to CLOs',
    message: `AI is analyzing which CLOs each week covers...`,
    council
  });

  const prompt = buildCLOWeeklyMappingPrompt(
    clos.map(c => ({ clo_id: c.clo_id, clo_text: c.clo_text })),
    weeklyPlan.map(w => ({ 
      week: w.week, 
      topic: w.topic, 
      description: w.description, 
      readings: w.readings 
    }))
  );

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    1, // Use stage 1 config
    { jsonMode: true },
    executionOverride
  );

  const result = parseAIJson<MappingResult>(response);

  // Validate the mapping result
  if (!result || !result.mappings || !Array.isArray(result.mappings)) {
    console.error('CLO Mapping: Invalid AI response - missing mappings array');
    // Return original weekly plan without modifications
    return weeklyPlan.map(w => ({ ...w, clo_ids: [] }));
  }

  // Create a map for quick lookup
  const validCloIds = new Set(clos.map(c => c.clo_id));
  const mappingByWeek = new Map<number, string[]>();
  
  for (const mapping of result.mappings) {
    // Filter to only valid CLO IDs and deduplicate
    const validIds = [...new Set((mapping.clo_ids || []).filter(id => validCloIds.has(id)))];
    
    // ENFORCE 0/1 CLO PER WEEK: If AI returned multiple, truncate to the first one
    // This ensures each week maps to at most one CLO
    const normalizedIds = validIds.length > 1 ? [validIds[0]] : validIds;
    
    if (validIds.length > 1) {
      console.log(`CLO Mapping: Week ${mapping.week} had ${validIds.length} CLOs, truncating to 1 (${normalizedIds[0]})`);
    }
    
    mappingByWeek.set(mapping.week, normalizedIds);
  }

  // Merge mappings into weekly plan, ensuring every week has an entry
  const updatedPlan = weeklyPlan.map(w => ({
    ...w,
    clo_ids: mappingByWeek.get(w.week) || []
  }));

  // Log summary
  const mappedWeeks = updatedPlan.filter(w => w.clo_ids && w.clo_ids.length > 0).length;
  const unmappedWeeks = updatedPlan.filter(w => !w.clo_ids || w.clo_ids.length === 0).length;
  console.log(`CLO Mapping: Complete - ${mappedWeeks} weeks mapped, ${unmappedWeeks} weeks unmapped`);
  
  return updatedPlan;
}

/**
 * Computes CLO distribution statistics from the weekly plan
 * @param weeklyPlan - Weekly plan with clo_ids mapped
 * @param clos - Array of CLOs
 * @returns CLO distribution statistics including fairness assessment
 */
export function computeCLODistribution(
  weeklyPlan: WeeklyPlanItem[],
  clos: CLO[]
): CLODistribution {
  const totalWeeks = weeklyPlan.length;
  const totalClos = clos.length;

  // Handle edge cases
  if (totalWeeks === 0 || totalClos === 0) {
    return {
      total_weeks: totalWeeks,
      total_clos: totalClos,
      ideal_weeks_per_clo: 0,
      min_acceptable: 0,
      max_acceptable: 0,
      per_clo: [],
      overall_is_fair: true,
      mapped_weeks: 0,
      unmapped_weeks: [],
      computed_at: new Date().toISOString()
    };
  }

  // Calculate ideal distribution
  const ideal = totalWeeks / totalClos;
  const minAcceptable = Math.max(1, Math.floor(0.8 * ideal));
  const maxAcceptable = Math.ceil(1.2 * ideal);

  // Count weeks per CLO and track mapped/unmapped weeks
  const cloWeeksMap = new Map<string, number[]>();
  for (const clo of clos) {
    cloWeeksMap.set(clo.clo_id, []);
  }

  // Track which weeks are mapped vs unmapped
  const unmappedWeekNumbers: number[] = [];
  let mappedWeekCount = 0;

  for (const week of weeklyPlan) {
    const weekClos = week.clo_ids || [];
    
    if (weekClos.length === 0) {
      // Week has no CLO assigned (exam/review/admin week)
      unmappedWeekNumbers.push(week.week);
    } else {
      mappedWeekCount++;
      // Add week to CLO's coverage (should be at most 1 CLO per week now)
      for (const cloId of weekClos) {
        const weeks = cloWeeksMap.get(cloId);
        if (weeks) {
          weeks.push(week.week);
        }
      }
    }
  }

  // Build per-CLO statistics
  const perClo: CLODistributionStat[] = clos.map(clo => {
    const weeksCovered = cloWeeksMap.get(clo.clo_id) || [];
    const count = weeksCovered.length;
    const isFair = count >= minAcceptable && count <= maxAcceptable;

    return {
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      weeks_covered: weeksCovered.sort((a, b) => a - b),
      count,
      is_fair: isFair
    };
  });

  // Determine overall fairness
  const overallIsFair = perClo.every(stat => stat.is_fair);

  return {
    total_weeks: totalWeeks,
    total_clos: totalClos,
    ideal_weeks_per_clo: Math.round(ideal * 100) / 100, // Round to 2 decimal places
    min_acceptable: minAcceptable,
    max_acceptable: maxAcceptable,
    per_clo: perClo,
    overall_is_fair: overallIsFair,
    mapped_weeks: mappedWeekCount,
    unmapped_weeks: unmappedWeekNumbers.sort((a, b) => a - b),
    computed_at: new Date().toISOString()
  };
}

/**
 * Full CLO mapping pipeline: maps weeks to CLOs and computes distribution
 * @param clos - Array of analyzed CLOs
 * @param weeklyPlan - Array of weekly plan items
 * @param courseCode - Course code for progress updates
 * @param council - Council info for progress reporting
 * @param executionOverride - Optional execution mode override
 * @returns Object with updated weekly plan and distribution statistics
 */
export async function runCLOMapping(
  clos: CLO[],
  weeklyPlan: WeeklyPlanItem[],
  courseCode: string,
  council?: CouncilInfo,
  executionOverride?: StageExecutionMode
): Promise<{
  weekly_plan: WeeklyPlanItem[];
  distribution: CLODistribution;
}> {
  // Map weeks to CLOs
  const mappedPlan = await mapWeeklyPlanToCLOs(
    clos,
    weeklyPlan,
    courseCode,
    council,
    executionOverride
  );

  // Compute distribution statistics
  const distribution = computeCLODistribution(mappedPlan, clos);

  return {
    weekly_plan: mappedPlan,
    distribution
  };
}
