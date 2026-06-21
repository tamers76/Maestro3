import type {
  BlueprintVehicle,
  NodeEngineBlueprint,
  NodeEngineBlueprintObject,
  NodeEngineContentSpec,
  NodeEngineNode,
  NodeEngineProducedObject,
} from '@/services/api'

export type LayerFilterKind = 'blueprint' | 'contentSpec' | 'production'

export type ArtifactStatusFilter =
  | 'all'
  | 'not_generated'
  | 'draft'
  | 'approved'
  | 'missing'
  | 'produced'

export interface NodeEngineFilterState {
  query: string
  vehicle: BlueprintVehicle | 'all'
  purpose: string | 'all'
  artifactStatus: ArtifactStatusFilter
}

export const DEFAULT_NODE_ENGINE_FILTERS: NodeEngineFilterState = {
  query: '',
  vehicle: 'all',
  purpose: 'all',
  artifactStatus: 'all',
}

export const VEHICLE_FILTER_OPTIONS: BlueprintVehicle[] = [
  'text',
  'video',
  'interactive',
  'simulation',
  'structured_visual',
  'pictorial_visual',
  'learning_anchor',
]

export const PURPOSE_FILTER_OPTIONS = [
  'orientation',
  'explanation',
  'remediation',
  'worked_example',
  'practice',
  'assessment_connection',
  'evidence_check',
] as const

export interface ApprovedNodeRef {
  node: NodeEngineNode
  subtopicId: string
  subtopicTitle: string
  cloId: string
}

function includesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query)
}

export function isFilterActive(filters: NodeEngineFilterState): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.vehicle !== 'all' ||
    filters.purpose !== 'all' ||
    filters.artifactStatus !== 'all'
  )
}

export function nodeSearchTexts(ref: ApprovedNodeRef): string[] {
  return [
    ref.node.node_id,
    ref.node.node_title,
    ref.node.node_type,
    ref.node.knowledge_component,
    ref.subtopicId,
    ref.subtopicTitle,
    ref.cloId,
  ]
}

export function objectSearchTexts(obj: NodeEngineBlueprintObject): string[] {
  return [
    obj.object_id,
    obj.title,
    obj.node_object_purpose ?? '',
    obj.suggested_vehicle,
  ]
}

export function nodeMatchesQuery(ref: ApprovedNodeRef, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return nodeSearchTexts(ref).some((t) => includesQuery(t, q))
}

export function objectMatchesQuery(
  obj: NodeEngineBlueprintObject,
  ref: ApprovedNodeRef,
  query: string
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (nodeMatchesQuery(ref, q)) return true
  return objectSearchTexts(obj).some((t) => includesQuery(t, q))
}

function blueprintNodeStatusMatches(
  blueprint: NodeEngineBlueprint | null | undefined,
  status: ArtifactStatusFilter
): boolean {
  switch (status) {
    case 'all':
      return true
    case 'not_generated':
      return !blueprint
    case 'draft':
      return blueprint?.status === 'draft'
    case 'approved':
      return blueprint?.status === 'approved'
    default:
      return true
  }
}

function contentSpecStatusMatches(
  spec: NodeEngineContentSpec | null | undefined,
  status: ArtifactStatusFilter
): boolean {
  switch (status) {
    case 'all':
      return true
    case 'missing':
      return !spec
    case 'draft':
      return spec?.status === 'draft'
    case 'approved':
      return spec?.status === 'approved'
    default:
      return true
  }
}

function productionStatusMatches(
  produced: NodeEngineProducedObject | null | undefined,
  status: ArtifactStatusFilter
): boolean {
  switch (status) {
    case 'all':
      return true
    case 'produced':
      return Boolean(produced)
    case 'missing':
      return !produced
    default:
      return true
  }
}

export interface ObjectFilterInputs {
  layer: LayerFilterKind
  blueprint?: NodeEngineBlueprint | null
  contentSpec?: NodeEngineContentSpec | null
  produced?: NodeEngineProducedObject | null
}

export function objectPassesFilters(
  obj: NodeEngineBlueprintObject,
  ref: ApprovedNodeRef,
  filters: NodeEngineFilterState,
  inputs: ObjectFilterInputs
): boolean {
  if (!objectMatchesQuery(obj, ref, filters.query)) return false
  if (filters.vehicle !== 'all' && obj.suggested_vehicle !== filters.vehicle) return false
  if (filters.purpose !== 'all' && obj.node_object_purpose !== filters.purpose) return false

  if (filters.artifactStatus === 'all') return true

  switch (inputs.layer) {
    case 'blueprint':
      return blueprintNodeStatusMatches(inputs.blueprint, filters.artifactStatus)
    case 'contentSpec':
      return contentSpecStatusMatches(inputs.contentSpec, filters.artifactStatus)
    case 'production':
      return productionStatusMatches(inputs.produced, filters.artifactStatus)
    default:
      return true
  }
}

export function filterVisibleObjects(
  objects: NodeEngineBlueprintObject[],
  ref: ApprovedNodeRef,
  filters: NodeEngineFilterState,
  inputs: Omit<ObjectFilterInputs, 'contentSpec' | 'produced'> & {
    getContentSpec?: (objectId: string) => NodeEngineContentSpec | null | undefined
    getProduced?: (objectId: string) => NodeEngineProducedObject | null | undefined
  }
): NodeEngineBlueprintObject[] {
  if (!isFilterActive(filters)) return objects

  if (inputs.layer === 'blueprint' && filters.artifactStatus !== 'all') {
    if (!blueprintNodeStatusMatches(inputs.blueprint, filters.artifactStatus)) return []
  }

  return objects.filter((obj) =>
    objectPassesFilters(obj, ref, filters, {
      layer: inputs.layer,
      blueprint: inputs.blueprint,
      contentSpec: inputs.getContentSpec?.(obj.object_id),
      produced: inputs.getProduced?.(obj.object_id),
    })
  )
}

/** Whether a mastery node card should render under active filters. */
export function nodeIsVisible(
  ref: ApprovedNodeRef,
  objects: NodeEngineBlueprintObject[],
  filters: NodeEngineFilterState,
  inputs: Omit<ObjectFilterInputs, 'contentSpec' | 'produced'> & {
    getContentSpec?: (objectId: string) => NodeEngineContentSpec | null | undefined
    getProduced?: (objectId: string) => NodeEngineProducedObject | null | undefined
  }
): boolean {
  if (!isFilterActive(filters)) return true
  const visible = filterVisibleObjects(objects, ref, filters, inputs)
  if (visible.length > 0) return true
  if (objects.length > 0) return false
  if (inputs.layer !== 'blueprint') return false
  if (filters.vehicle !== 'all' || filters.purpose !== 'all') return false
  if (!blueprintNodeStatusMatches(inputs.blueprint, filters.artifactStatus)) return false
  return nodeMatchesQuery(ref, filters.query)
}

export function countLayerMatches(
  nodes: ApprovedNodeRef[],
  filters: NodeEngineFilterState,
  layer: LayerFilterKind,
  getBlueprint: (nodeId: string) => NodeEngineBlueprint | null | undefined,
  getObjects: (ref: ApprovedNodeRef) => NodeEngineBlueprintObject[],
  getContentSpec?: (objectId: string) => NodeEngineContentSpec | null | undefined,
  getProduced?: (objectId: string) => NodeEngineProducedObject | null | undefined
): { nodes: number; objects: number } {
  if (!isFilterActive(filters)) return { nodes: nodes.length, objects: 0 }

  let nodeCount = 0
  let objectCount = 0
  for (const ref of nodes) {
    const blueprint = getBlueprint(ref.node.node_id)
    const visible = filterVisibleObjects(getObjects(ref), ref, filters, {
      layer,
      blueprint,
      getContentSpec,
      getProduced,
    })
    if (visible.length > 0) {
      nodeCount++
      objectCount += visible.length
    }
  }
  return { nodes: nodeCount, objects: objectCount }
}

export function statusOptionsForLayer(layer: LayerFilterKind): Array<{ value: ArtifactStatusFilter; label: string }> {
  switch (layer) {
    case 'blueprint':
      return [
        { value: 'all', label: 'All statuses' },
        { value: 'not_generated', label: 'Not generated' },
        { value: 'draft', label: 'Draft blueprint' },
        { value: 'approved', label: 'Approved blueprint' },
      ]
    case 'contentSpec':
      return [
        { value: 'all', label: 'All statuses' },
        { value: 'missing', label: 'No spec yet' },
        { value: 'draft', label: 'Draft spec' },
        { value: 'approved', label: 'Approved spec' },
      ]
    case 'production':
      return [
        { value: 'all', label: 'All statuses' },
        { value: 'produced', label: 'Produced' },
        { value: 'missing', label: 'Not produced' },
      ]
  }
}
