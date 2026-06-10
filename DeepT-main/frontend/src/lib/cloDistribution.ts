/**
 * Frontend CLO distribution computation - mirrors backend logic
 * from backend/src/services/clo_weekly_plan.service.ts
 */

import type { CLO, WeeklyPlanItem, CLODistribution, CLODistributionStat } from '@/services/api'

/**
 * Computes CLO distribution statistics from the weekly plan
 * This mirrors the backend computeCLODistribution function for real-time updates
 */
export function computeCLODistribution(
  weeklyPlan: WeeklyPlanItem[],
  clos: CLO[]
): CLODistribution {
  const totalWeeks = weeklyPlan.length
  const totalClos = clos.length

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
    }
  }

  // Calculate ideal distribution
  const ideal = totalWeeks / totalClos
  const minAcceptable = Math.max(1, Math.floor(0.8 * ideal))
  const maxAcceptable = Math.ceil(1.2 * ideal)

  // Count weeks per CLO and track mapped/unmapped weeks
  const cloWeeksMap = new Map<string, number[]>()
  for (const clo of clos) {
    cloWeeksMap.set(clo.clo_id, [])
  }

  // Track which weeks are mapped vs unmapped
  const unmappedWeekNumbers: number[] = []
  let mappedWeekCount = 0

  for (const week of weeklyPlan) {
    const weekClos = week.clo_ids || []
    
    if (weekClos.length === 0) {
      // Week has no CLO assigned (exam/review/admin week)
      unmappedWeekNumbers.push(week.week)
    } else {
      mappedWeekCount++
      // Add week to CLO's coverage (should be at most 1 CLO per week)
      for (const cloId of weekClos) {
        const weeks = cloWeeksMap.get(cloId)
        if (weeks) {
          weeks.push(week.week)
        }
      }
    }
  }

  // Build per-CLO statistics
  const perClo: CLODistributionStat[] = clos.map(clo => {
    const weeksCovered = cloWeeksMap.get(clo.clo_id) || []
    const count = weeksCovered.length
    const isFair = count >= minAcceptable && count <= maxAcceptable

    return {
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      weeks_covered: weeksCovered.sort((a, b) => a - b),
      count,
      is_fair: isFair
    }
  })

  // Determine overall fairness
  const overallIsFair = perClo.every(stat => stat.is_fair)

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
  }
}
