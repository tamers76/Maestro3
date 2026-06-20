import { useCallback, useEffect, useState } from 'react'
import {
  fetchStage1Layers,
  fetchAlignment,
  type Stage1LayerStatus,
  type Stage1LayerStateView,
} from '@/services/api'
import { NODE_ENGINE_LAYER_MAP } from '@/components/nodeEngine/nodeEngineLayers'
import type { StageStatus } from './StageStepper'

export type WizardPhase = 'architect' | 'engine'

export interface JourneyStep {
  /** Stable id used in the URL (e.g. the layerId, or `engine-1`). */
  id: string
  phase: WizardPhase
  label: string
  status: StageStatus
}

export interface CourseJourney {
  loading: boolean
  architectSteps: JourneyStep[]
  engineSteps: JourneyStep[]
  architectComplete: boolean
  nodeGenReady: boolean
  refresh: () => Promise<void>
}

/** Map a backend Course Architect layer status to a stepper status. */
function mapArchitectStatus(status: Stage1LayerStatus): StageStatus {
  if (status === 'approved') return 'done'
  if (status === 'locked' || status === 'blocked') return 'locked'
  return 'upcoming'
}

/**
 * Derives the wizard navigation model (two phases, their layer steps, and each
 * step's status) from the SAME endpoints the existing panels use. This is a
 * read-only projection — it runs nothing and changes no behaviour.
 */
export function useCourseJourney(courseCode: string | undefined): CourseJourney {
  const [loading, setLoading] = useState(true)
  const [layers, setLayers] = useState<Stage1LayerStateView[]>([])
  const [architectComplete, setArchitectComplete] = useState(false)
  const [nodeGenReady, setNodeGenReady] = useState(false)

  const refresh = useCallback(async () => {
    if (!courseCode) return
    setLoading(true)
    try {
      const data = await fetchStage1Layers(courseCode)
      setLayers(data.layers)
      const allApproved = data.layers.length > 0 && data.layers.every((l) => l.status === 'approved')
      setArchitectComplete(allApproved)
      if (allApproved) {
        try {
          const alignment = await fetchAlignment(courseCode)
          setNodeGenReady(alignment.state.node_gen_ready)
        } catch {
          setNodeGenReady(false)
        }
      } else {
        setNodeGenReady(false)
      }
    } catch {
      setLayers([])
      setArchitectComplete(false)
      setNodeGenReady(false)
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Build Course Architect steps, ordered, with the frontier marked "current".
  const ordered = [...layers].sort((a, b) => a.config.order - b.config.order)
  let currentAssigned = false
  const architectSteps: JourneyStep[] = ordered.map((layer) => {
    let status = mapArchitectStatus(layer.status)
    if (!currentAssigned && status !== 'done' && status !== 'locked') {
      status = 'current'
      currentAssigned = true
    }
    return {
      id: layer.layerId,
      phase: 'architect',
      label: `${layer.config.order}. ${layer.config.name}`,
      status,
    }
  })

  // Node Engine steps. Detailed per-layer approval is owned by the engine panel;
  // here we only gate the phase: locked until Course Architect is complete and
  // alignment is active, then Layer 1 becomes the frontier.
  const engineUnlocked = architectComplete && nodeGenReady
  const engineSteps: JourneyStep[] = NODE_ENGINE_LAYER_MAP.map((l, i) => ({
    id: `engine-${l.layer}`,
    phase: 'engine',
    label: `${l.layer}. ${l.label}`,
    status: !engineUnlocked ? 'locked' : i === 0 ? 'current' : 'locked',
  }))

  return {
    loading,
    architectSteps,
    engineSteps,
    architectComplete,
    nodeGenReady,
    refresh,
  }
}
