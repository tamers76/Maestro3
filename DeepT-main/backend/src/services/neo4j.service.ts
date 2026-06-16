import neo4j, { Driver, Session, Result } from 'neo4j-driver';
import { getSettings } from '../config.js';
import type { 
  Course, 
  CLO, 
  LearningNode, 
  LearningNodeUpsert,
  Topic,
  GraphData, 
  GraphNode, 
  GraphEdge,
  CourseContract,
  ReferenceChunk
} from '../models/schemas.js';
import type { NodeSet } from '../models/nodeEngine.js';

let driver: Driver | null = null;
let lastInitError: string | null = null;

// Initialize Neo4j connection
export async function initNeo4j(): Promise<void> {
  const settings = getSettings();
  
  if (driver) {
    await driver.close();
  }
  
  lastInitError = null;

  driver = neo4j.driver(
    settings.neo4j.uri,
    neo4j.auth.basic(settings.neo4j.user, settings.neo4j.password)
  );
  
  // Verify connection
  const session = driver.session();
  try {
    await session.run('RETURN 1');
    console.log('✓ Neo4j connected successfully');
  } catch (err) {
    lastInitError = err instanceof Error ? err.message : String(err);
    // Ensure we don't keep a broken/unauthorized driver around
    try {
      await driver.close();
    } finally {
      driver = null;
    }
    throw err;
  } finally {
    await session.close();
  }
}

export function getNeo4jStatus(): { connected: boolean; last_error: string | null } {
  return {
    connected: driver !== null,
    last_error: lastInitError
  };
}

// Get session
function getSession(): Session {
  if (!driver) {
    throw new Error('Neo4j driver not initialized');
  }
  return driver.session();
}

// Close connection
export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// ============== Course Operations ==============

export async function createCourse(course: Course): Promise<void> {
  const session = getSession();
  try {
    await session.run(
      `CREATE (c:Course {
        course_code: $course_code,
        title: $title,
        description: $description,
        credit_hours: $credit_hours,
        raw_extracted_text: $raw_extracted_text,
        current_stage: $current_stage,
        created_at: $created_at,
        updated_at: $updated_at
      })`,
      course
    );
  } finally {
    await session.close();
  }
}

export async function getCourse(courseCode: string): Promise<Course | null> {
  const session = getSession();
  try {
    const result = await session.run(
      'MATCH (c:Course {course_code: $courseCode}) RETURN c',
      { courseCode }
    );
    if (result.records.length === 0) return null;
    return result.records[0].get('c').properties as Course;
  } finally {
    await session.close();
  }
}

export async function getAllCourses(): Promise<Course[]> {
  const session = getSession();
  try {
    const result = await session.run(
      'MATCH (c:Course) RETURN c ORDER BY c.created_at DESC'
    );
    return result.records.map(r => r.get('c').properties as Course);
  } finally {
    await session.close();
  }
}

export async function updateCourseStage(courseCode: string, stage: number): Promise<void> {
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:Course {course_code: $courseCode})
       SET c.current_stage = $stage, c.updated_at = $updated_at`,
      { courseCode, stage, updated_at: new Date().toISOString() }
    );
  } finally {
    await session.close();
  }
}

export async function deleteCourse(courseCode: string): Promise<void> {
  const session = getSession();
  try {
    // Delete all related nodes and relationships (including Topics)
    await session.run(
      `MATCH (c:Course {course_code: $courseCode})
       OPTIONAL MATCH (c)-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)
       OPTIONAL MATCH (t)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       OPTIONAL MATCH (c)-[:SATISFIES]->(tag:AccreditationTag)
       DETACH DELETE c, clo, t, ln1, ln2`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

// ============== CLO Operations ==============

export async function createCLOs(courseCode: string, clos: CLO[]): Promise<void> {
  const session = getSession();
  try {
    for (const clo of clos) {
      await session.run(
        `MATCH (c:Course {course_code: $courseCode})
         CREATE (clo:CLO {
           clo_id: $clo_id,
           course_code: $courseCode,
           clo_text: $clo_text,
           capability_statement: $capability_statement,
           conditions_of_performance: $conditions_of_performance,
           evidence_of_mastery: $evidence_of_mastery,
           bloom_level: $bloom_level,
           knowledge_type: $knowledge_type,
           risk_level: $risk_level
         })
         CREATE (c)-[:HAS_CLO]->(clo)`,
        { courseCode, ...clo }
      );
    }
  } finally {
    await session.close();
  }
}

export async function getCLOs(courseCode: string): Promise<CLO[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       RETURN clo ORDER BY clo.clo_id`,
      { courseCode }
    );
    return result.records.map(r => r.get('clo').properties as CLO);
  } finally {
    await session.close();
  }
}

export async function deleteCLOs(courseCode: string): Promise<void> {
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)
       OPTIONAL MATCH (t)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       DETACH DELETE clo, t, ln1, ln2`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

// ============== Learning Node Operations ==============

export async function createLearningNodes(nodes: LearningNode[]): Promise<void> {
  const session = getSession();
  try {
    // First, create all nodes
    // If a node has a topic_id, attach it to the Topic; otherwise fallback to CLO (legacy)
    for (const node of nodes) {
      if (node.topic_id) {
        // New path: attach to Topic node
        await session.run(
          `MATCH (t:Topic {topic_id: $topic_id})
           CREATE (ln:LearningNode {
             node_id: $node_id,
             clo_id: $clo_id,
             topic_id: $topic_id,
             topic_title: $topic_title,
             node_type: $node_type,
             learning_intent: $learning_intent,
             risk_level: $risk_level,
             mandatory: $mandatory,
             skippable: $skippable,
             required_status: $required_status,
             skipping_eligibility: $skipping_eligibility,
             skip_conditions: $skip_conditions,
             failure_meaning: $failure_meaning,
             diagnostic_intent: $diagnostic_intent,
             ui_x: $ui_x,
             ui_y: $ui_y
           })
           CREATE (t)-[:DECOMPOSED_TO]->(ln)`,
          {
            node_id: node.node_id,
            clo_id: node.clo_id,
            topic_id: node.topic_id,
            topic_title: node.topic_title || '',
            node_type: node.node_type,
            learning_intent: node.learning_intent,
            risk_level: node.risk_level,
            mandatory: node.mandatory,
            skippable: node.skippable,
            required_status: node.required_status || (node.mandatory ? 'mandatory' : 'optional'),
            skipping_eligibility: node.skipping_eligibility || (node.skippable ? 'skippable' : 'non_skippable'),
            skip_conditions: node.skip_conditions || '',
            failure_meaning: node.failure_meaning || '',
            diagnostic_intent: node.diagnostic_intent || '',
            ui_x: node.ui_x ?? null,
            ui_y: node.ui_y ?? null
          }
        );
      } else {
        // Legacy path: attach to CLO directly
        await session.run(
          `MATCH (clo:CLO {clo_id: $clo_id})
           CREATE (ln:LearningNode {
             node_id: $node_id,
             clo_id: $clo_id,
             topic_id: $topic_id,
             topic_title: $topic_title,
             node_type: $node_type,
             learning_intent: $learning_intent,
             risk_level: $risk_level,
             mandatory: $mandatory,
             skippable: $skippable,
             required_status: $required_status,
             skipping_eligibility: $skipping_eligibility,
             skip_conditions: $skip_conditions,
             failure_meaning: $failure_meaning,
             diagnostic_intent: $diagnostic_intent,
             ui_x: $ui_x,
             ui_y: $ui_y
           })
           CREATE (clo)-[:DECOMPOSED_TO]->(ln)`,
          {
            node_id: node.node_id,
            clo_id: node.clo_id,
            topic_id: node.topic_id || '',
            topic_title: node.topic_title || '',
            node_type: node.node_type,
            learning_intent: node.learning_intent,
            risk_level: node.risk_level,
            mandatory: node.mandatory,
            skippable: node.skippable,
            required_status: node.required_status || (node.mandatory ? 'mandatory' : 'optional'),
            skipping_eligibility: node.skipping_eligibility || (node.skippable ? 'skippable' : 'non_skippable'),
            skip_conditions: node.skip_conditions || '',
            failure_meaning: node.failure_meaning || '',
            diagnostic_intent: node.diagnostic_intent || '',
            ui_x: node.ui_x ?? null,
            ui_y: node.ui_y ?? null
          }
        );
      }
    }
    
    // Then, create prerequisite relationships
    for (const node of nodes) {
      if (node.prerequisite_nodes && node.prerequisite_nodes.length > 0) {
        for (const prereqId of node.prerequisite_nodes) {
          await session.run(
            `MATCH (ln:LearningNode {node_id: $node_id})
             MATCH (prereq:LearningNode {node_id: $prereq_id})
             CREATE (ln)-[:PREREQUIRES]->(prereq)`,
            { node_id: node.node_id, prereq_id: prereqId }
          );
        }
      }
    }
  } finally {
    await session.close();
  }
}

export async function getLearningNodes(courseCode: string): Promise<LearningNode[]> {
  const session = getSession();
  try {
    // Query handles both new path (CLO→Topic→LN) and legacy path (CLO→LN)
    const result = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       WITH coalesce(ln1, ln2) as ln
       WHERE ln IS NOT NULL
       WITH DISTINCT ln
       OPTIONAL MATCH (ln)-[:PREREQUIRES]->(prereq:LearningNode)
       RETURN ln, collect(prereq.node_id) as prerequisites
       ORDER BY ln.clo_id, ln.topic_id, ln.node_id`,
      { courseCode }
    );
    return result.records.map(r => mapNodeRecord(r));
  } finally {
    await session.close();
  }
}

/** Shared helper to map a Neo4j record to LearningNode (handles legacy + new fields) */
function mapNodeRecord(r: { get: (key: string) => any }): LearningNode {
  const props = r.get('ln').properties;
  const mandatory = props.mandatory ?? true;
  const skippable = props.skippable ?? false;
  return {
    node_id: props.node_id,
    clo_id: props.clo_id,
    topic_id: props.topic_id || '',
    topic_title: props.topic_title || '',
    node_type: props.node_type,
    learning_intent: props.learning_intent,
    prerequisite_nodes: r.get('prerequisites').filter((p: string | null) => p !== null),
    risk_level: props.risk_level,
    mandatory,
    skippable,
    required_status: props.required_status || (mandatory ? 'mandatory' : 'optional'),
    skipping_eligibility: props.skipping_eligibility || (skippable ? 'skippable' : 'non_skippable'),
    skip_conditions: props.skip_conditions || '',
    failure_meaning: props.failure_meaning || '',
    diagnostic_intent: props.diagnostic_intent || '',
    // Stage 3 assessment intelligence fields
    stage3_logic_json: props.stage3_logic_json || undefined,
    stage3_preknowledge_eligible: props.stage3_preknowledge_eligible ?? undefined,
    stage3_gate_strictness: props.stage3_gate_strictness || undefined,
    content_path: props.content_path,
    ui_x: props.ui_x ?? undefined,
    ui_y: props.ui_y ?? undefined
  };
}

export async function updateLearningNode(nodeId: string, updates: Partial<LearningNode>): Promise<void> {
  const session = getSession();
  try {
    const setClause = Object.keys(updates)
      .map(key => `ln.${key} = $${key}`)
      .join(', ');
    
    await session.run(
      `MATCH (ln:LearningNode {node_id: $nodeId})
       SET ${setClause}`,
      { nodeId, ...updates }
    );
  } finally {
    await session.close();
  }
}

export async function deleteLearningNodes(courseCode: string): Promise<void> {
  const session = getSession();
  try {
    // Delete learning nodes from both new (Topic→LN) and legacy (CLO→LN) paths, and delete Topic nodes too
    await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       DETACH DELETE ln1, ln2, t`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

// ============== Stage 2.5: Node + Edge Editing ==============

/**
 * Get learning nodes for a specific CLO (handles both Topic→LN and legacy CLO→LN paths)
 */
export async function getLearningNodesByClo(cloId: string): Promise<LearningNode[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (clo:CLO {clo_id: $cloId})
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       WITH coalesce(ln1, ln2) as ln
       WHERE ln IS NOT NULL
       WITH DISTINCT ln
       OPTIONAL MATCH (ln)-[:PREREQUIRES]->(prereq:LearningNode)
       RETURN ln, collect(prereq.node_id) as prerequisites
       ORDER BY ln.topic_id, ln.node_id`,
      { cloId }
    );
    return result.records.map(r => mapNodeRecord(r));
  } finally {
    await session.close();
  }
}

/**
 * Create a single learning node for a CLO (Stage 2.5)
 * Returns the node_id (either provided or generated)
 */
export async function createSingleLearningNode(
  cloId: string, 
  nodeData: LearningNodeUpsert,
  generatedNodeId?: string
): Promise<string> {
  const session = getSession();
  try {
    const nodeId = nodeData.node_id || generatedNodeId || `${cloId}-N${Date.now()}`;
    
    // If topic_id is provided, try to attach to Topic; else attach to CLO
    if (nodeData.topic_id) {
      await session.run(
        `MATCH (t:Topic {topic_id: $topicId})
         CREATE (ln:LearningNode {
           node_id: $node_id,
           clo_id: $cloId,
           topic_id: $topicId,
           node_type: $node_type,
           learning_intent: $learning_intent,
           risk_level: $risk_level,
           mandatory: true,
           skippable: false,
           required_status: 'mandatory',
           skipping_eligibility: 'non_skippable',
           skip_conditions: '',
           failure_meaning: $failure_meaning,
           diagnostic_intent: $diagnostic_intent,
           ui_x: $ui_x,
           ui_y: $ui_y
         })
         CREATE (t)-[:DECOMPOSED_TO]->(ln)`,
        {
          cloId,
          topicId: nodeData.topic_id,
          node_id: nodeId,
          node_type: nodeData.node_type,
          learning_intent: nodeData.learning_intent,
          risk_level: nodeData.risk_level,
          failure_meaning: nodeData.failure_meaning || '',
          diagnostic_intent: nodeData.diagnostic_intent || '',
          ui_x: nodeData.ui_x ?? null,
          ui_y: nodeData.ui_y ?? null
        }
      );
    } else {
      await session.run(
        `MATCH (clo:CLO {clo_id: $cloId})
         CREATE (ln:LearningNode {
           node_id: $node_id,
           clo_id: $cloId,
           topic_id: '',
           node_type: $node_type,
           learning_intent: $learning_intent,
           risk_level: $risk_level,
           mandatory: true,
           skippable: false,
           required_status: 'mandatory',
           skipping_eligibility: 'non_skippable',
           skip_conditions: '',
           failure_meaning: $failure_meaning,
           diagnostic_intent: $diagnostic_intent,
           ui_x: $ui_x,
           ui_y: $ui_y
         })
         CREATE (clo)-[:DECOMPOSED_TO]->(ln)`,
        {
          cloId,
          node_id: nodeId,
          node_type: nodeData.node_type,
          learning_intent: nodeData.learning_intent,
          risk_level: nodeData.risk_level,
          failure_meaning: nodeData.failure_meaning || '',
          diagnostic_intent: nodeData.diagnostic_intent || '',
          ui_x: nodeData.ui_x ?? null,
          ui_y: nodeData.ui_y ?? null
        }
      );
    }
    
    return nodeId;
  } finally {
    await session.close();
  }
}

/**
 * Delete a single learning node by ID (Stage 2.5)
 * DETACH DELETE removes the node and all its relationships
 */
export async function deleteSingleLearningNode(nodeId: string): Promise<void> {
  const session = getSession();
  try {
    await session.run(
      `MATCH (ln:LearningNode {node_id: $nodeId})
       DETACH DELETE ln`,
      { nodeId }
    );
  } finally {
    await session.close();
  }
}

/**
 * Upsert multiple nodes for a CLO (Stage 2.5)
 * - For nodes with existing node_id: update properties
 * - For nodes without node_id: create new with generated ID
 * Returns map of temp IDs to generated IDs for new nodes
 */
export async function upsertCloNodes(
  cloId: string,
  upserts: LearningNodeUpsert[],
  deletes: string[]
): Promise<{ created: Record<string, string>; deleted: string[] }> {
  const session = getSession();
  const created: Record<string, string> = {};
  
  try {
    // First, delete nodes
    for (const nodeId of deletes) {
      await session.run(
        `MATCH (ln:LearningNode {node_id: $nodeId, clo_id: $cloId})
         DETACH DELETE ln`,
        { nodeId, cloId }
      );
    }
    
    // Then, upsert nodes
    for (let i = 0; i < upserts.length; i++) {
      const nodeData = upserts[i];
      
      if (nodeData.node_id) {
        // Update existing node
        await session.run(
          `MATCH (ln:LearningNode {node_id: $node_id, clo_id: $cloId})
           SET ln.node_type = $node_type,
               ln.learning_intent = $learning_intent,
               ln.risk_level = $risk_level,
               ln.failure_meaning = $failure_meaning,
               ln.diagnostic_intent = $diagnostic_intent,
               ln.ui_x = $ui_x,
               ln.ui_y = $ui_y`,
          {
            node_id: nodeData.node_id,
            cloId,
            node_type: nodeData.node_type,
            learning_intent: nodeData.learning_intent,
            risk_level: nodeData.risk_level,
            failure_meaning: nodeData.failure_meaning || '',
            diagnostic_intent: nodeData.diagnostic_intent || '',
            ui_x: nodeData.ui_x ?? null,
            ui_y: nodeData.ui_y ?? null
          }
        );
      } else {
        // Create new node with generated ID
        const generatedId = `${cloId}-N${Date.now()}-${i}`;
        await session.run(
          `MATCH (clo:CLO {clo_id: $cloId})
           CREATE (ln:LearningNode {
             node_id: $node_id,
             clo_id: $cloId,
             topic_id: $topic_id,
             node_type: $node_type,
             learning_intent: $learning_intent,
             risk_level: $risk_level,
             mandatory: true,
             skippable: false,
             required_status: 'mandatory',
             skipping_eligibility: 'non_skippable',
             skip_conditions: '',
             failure_meaning: $failure_meaning,
             diagnostic_intent: $diagnostic_intent,
             ui_x: $ui_x,
             ui_y: $ui_y
           })
           CREATE (clo)-[:DECOMPOSED_TO]->(ln)`,
          {
            cloId,
            node_id: generatedId,
            topic_id: nodeData.topic_id || '',
            node_type: nodeData.node_type,
            learning_intent: nodeData.learning_intent,
            risk_level: nodeData.risk_level,
            failure_meaning: nodeData.failure_meaning || '',
            diagnostic_intent: nodeData.diagnostic_intent || '',
            ui_x: nodeData.ui_x ?? null,
            ui_y: nodeData.ui_y ?? null
          }
        );
        // Track created node with temp index key
        created[`temp-${i}`] = generatedId;
      }
    }
    
    return { created, deleted: deletes };
  } finally {
    await session.close();
  }
}

/**
 * Replace all prerequisites for a CLO (Stage 2.5)
 * Deletes all existing PREREQUIRES edges between nodes of the CLO,
 * then creates new edges from the provided list
 */
export async function replaceCloPrerequisites(
  cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>
): Promise<void> {
  const session = getSession();
  try {
    // Delete all existing PREREQUIRES edges for nodes in this CLO
    await session.run(
      `MATCH (ln1:LearningNode {clo_id: $cloId})-[r:PREREQUIRES]->(ln2:LearningNode {clo_id: $cloId})
       DELETE r`,
      { cloId }
    );
    
    // Create new edges
    for (const edge of edges) {
      await session.run(
        `MATCH (source:LearningNode {node_id: $sourceId, clo_id: $cloId})
         MATCH (target:LearningNode {node_id: $targetId, clo_id: $cloId})
         CREATE (source)-[:PREREQUIRES]->(target)`,
        { 
          sourceId: edge.source_node_id, 
          targetId: edge.target_node_id,
          cloId 
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Validate that edges form a DAG (no cycles) within a CLO
 * Returns true if valid, false if cycles detected
 */
export async function validateCloEdgesDAG(
  cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>
): Promise<{ valid: boolean; cycle?: string[] }> {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  const nodes = new Set<string>();
  
  for (const edge of edges) {
    nodes.add(edge.source_node_id);
    nodes.add(edge.target_node_id);
    
    if (!adj.has(edge.source_node_id)) {
      adj.set(edge.source_node_id, []);
    }
    adj.get(edge.source_node_id)!.push(edge.target_node_id);
  }
  
  // DFS to detect cycles
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  
  function hasCycle(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    path.push(node);
    
    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        // Found cycle - neighbor is already in recursion stack
        path.push(neighbor);
        return true;
      }
    }
    
    recStack.delete(node);
    path.pop();
    return false;
  }
  
  for (const node of nodes) {
    if (!visited.has(node)) {
      if (hasCycle(node)) {
        return { valid: false, cycle: [...path] };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Get node count per CLO for a course
 */
export async function getNodeCountsByClo(courseCode: string): Promise<Record<string, number>> {
  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       WITH clo, coalesce(ln1, ln2) as ln
       WHERE ln IS NOT NULL
       WITH clo, collect(DISTINCT ln) as nodes
       RETURN clo.clo_id as clo_id, size(nodes) as node_count`,
      { courseCode }
    );
    
    const counts: Record<string, number> = {};
    for (const record of result.records) {
      const cloId = record.get('clo_id');
      const count = record.get('node_count').toNumber ? 
        record.get('node_count').toNumber() : 
        record.get('node_count');
      counts[cloId] = count;
    }
    return counts;
  } finally {
    await session.close();
  }
}

// ============== Graph Visualization ==============

export async function getGraphData(courseCode: string): Promise<GraphData> {
  const session = getSession();
  try {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    
    // Get course node
    const courseResult = await session.run(
      'MATCH (c:Course {course_code: $courseCode}) RETURN c',
      { courseCode }
    );
    if (courseResult.records.length > 0) {
      const course = courseResult.records[0].get('c').properties;
      nodes.push({
        id: `course-${courseCode}`,
        type: 'course',
        label: course.title,
        data: course
      });
    }
    
    // Get CLO nodes
    const cloResult = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)
       RETURN clo`,
      { courseCode }
    );
    for (const record of cloResult.records) {
      const clo = record.get('clo').properties;
      nodes.push({
        id: `clo-${clo.clo_id}`,
        type: 'clo',
        label: clo.clo_text.substring(0, 50) + '...',
        data: clo
      });
      edges.push({
        id: `edge-course-${clo.clo_id}`,
        source: `course-${courseCode}`,
        target: `clo-${clo.clo_id}`,
        type: 'HAS_CLO'
      });
    }
    
    // Get Topic nodes (new path)
    const topicResult = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)-[:HAS_TOPIC]->(t:Topic)
       RETURN t, clo.clo_id as clo_id`,
      { courseCode }
    );
    const topicIdSet = new Set<string>();
    for (const record of topicResult.records) {
      const t = record.get('t').properties;
      const cloId = record.get('clo_id');
      const topicGraphId = `topic-${t.topic_id}`;
      if (!topicIdSet.has(topicGraphId)) {
        topicIdSet.add(topicGraphId);
        nodes.push({
          id: topicGraphId,
          type: 'topic',
          label: t.title ? (t.title.length > 50 ? t.title.substring(0, 50) + '...' : t.title) : t.topic_id,
          data: t
        });
        edges.push({
          id: `edge-clo-topic-${t.topic_id}`,
          source: `clo-${cloId}`,
          target: topicGraphId,
          type: 'HAS_TOPIC'
        });
      }
    }

    // Get Learning nodes via Topic path (new)
    const lnNewResult = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)-[:HAS_TOPIC]->(t:Topic)-[:DECOMPOSED_TO]->(ln:LearningNode)
       OPTIONAL MATCH (ln)-[:PREREQUIRES]->(prereq:LearningNode)
       RETURN ln, clo.clo_id as clo_id, t.topic_id as topic_id, collect(prereq.node_id) as prerequisites`,
      { courseCode }
    );
    const addedLnIds = new Set<string>();
    for (const record of lnNewResult.records) {
      const ln = record.get('ln').properties;
      const topicId = record.get('topic_id');
      const prerequisites = record.get('prerequisites').filter((p: string | null) => p !== null);
      const lnGraphId = `ln-${ln.node_id}`;
      
      if (!addedLnIds.has(lnGraphId)) {
        addedLnIds.add(lnGraphId);
        nodes.push({
          id: lnGraphId,
          type: 'learning_node',
          label: ln.learning_intent.substring(0, 40) + '...',
          data: { ...ln, prerequisite_nodes: prerequisites }
        });
        
        // Edge from Topic to LearningNode
        edges.push({
          id: `edge-topic-${ln.node_id}`,
          source: `topic-${topicId}`,
          target: lnGraphId,
          type: 'DECOMPOSED_TO'
        });
        
        for (const prereqId of prerequisites) {
          edges.push({
            id: `edge-prereq-${ln.node_id}-${prereqId}`,
            source: lnGraphId,
            target: `ln-${prereqId}`,
            type: 'PREREQUIRES'
          });
        }
      }
    }

    // Get Learning nodes via legacy path (CLO→LN directly, no Topic)
    const lnLegacyResult = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)-[:DECOMPOSED_TO]->(ln:LearningNode)
       OPTIONAL MATCH (ln)-[:PREREQUIRES]->(prereq:LearningNode)
       RETURN ln, clo.clo_id as clo_id, collect(prereq.node_id) as prerequisites`,
      { courseCode }
    );
    for (const record of lnLegacyResult.records) {
      const ln = record.get('ln').properties;
      const cloId = record.get('clo_id');
      const prerequisites = record.get('prerequisites').filter((p: string | null) => p !== null);
      const lnGraphId = `ln-${ln.node_id}`;
      
      if (!addedLnIds.has(lnGraphId)) {
        addedLnIds.add(lnGraphId);
        nodes.push({
          id: lnGraphId,
          type: 'learning_node',
          label: ln.learning_intent.substring(0, 40) + '...',
          data: { ...ln, prerequisite_nodes: prerequisites }
        });
        
        // Edge from CLO directly (legacy)
        edges.push({
          id: `edge-clo-${ln.node_id}`,
          source: `clo-${cloId}`,
          target: lnGraphId,
          type: 'DECOMPOSED_TO'
        });
        
        for (const prereqId of prerequisites) {
          edges.push({
            id: `edge-prereq-${ln.node_id}-${prereqId}`,
            source: lnGraphId,
            target: `ln-${prereqId}`,
            type: 'PREREQUIRES'
          });
        }
      }
    }
    
    return { nodes, edges };
  } finally {
    await session.close();
  }
}

// ============== Topic Operations ==============

/**
 * Create Topic nodes for a CLO and link them (CLO)-[:HAS_TOPIC]->(Topic)
 */
export async function createTopics(cloId: string, topics: Topic[]): Promise<void> {
  const session = getSession();
  try {
    for (const topic of topics) {
      await session.run(
        `MATCH (clo:CLO {clo_id: $clo_id})
         CREATE (t:Topic {
           topic_id: $topic_id,
           clo_id: $clo_id,
           title: $title,
           description: $description,
           readings: $readings,
           rationale: $rationale
         })
         CREATE (clo)-[:HAS_TOPIC]->(t)`,
        {
          clo_id: cloId,
          topic_id: topic.topic_id,
          title: topic.title,
          description: topic.description || '',
          readings: topic.readings || '',
          rationale: topic.rationale || ''
        }
      );
    }
  } finally {
    await session.close();
  }
}

/**
 * Delete all Topic nodes (and their LearningNodes) for a course
 */
export async function deleteTopics(courseCode: string): Promise<void> {
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)-[:HAS_TOPIC]->(t:Topic)
       OPTIONAL MATCH (t)-[:DECOMPOSED_TO]->(ln:LearningNode)
       DETACH DELETE t, ln`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

/**
 * Get all Topics for a course
 */
export async function getTopics(courseCode: string): Promise<Topic[]> {
  const session = getSession();
  try {
    const result = await session.run(
      `MATCH (c:Course {course_code: $courseCode})-[:HAS_CLO]->(clo:CLO)-[:HAS_TOPIC]->(t:Topic)
       RETURN t ORDER BY t.clo_id, t.topic_id`,
      { courseCode }
    );
    return result.records.map(r => {
      const props = r.get('t').properties;
      return {
        topic_id: props.topic_id,
        clo_id: props.clo_id,
        title: props.title,
        description: props.description || '',
        readings: props.readings || '',
        rationale: props.rationale || ''
      } as Topic;
    });
  } finally {
    await session.close();
  }
}

// ============== Accreditation Tags ==============

export async function createAccreditationTags(courseCode: string, tags: string[]): Promise<void> {
  const session = getSession();
  try {
    for (const tag of tags) {
      await session.run(
        `MATCH (c:Course {course_code: $courseCode})
         MERGE (t:AccreditationTag {tag_id: $tag_id, name: $name})
         CREATE (c)-[:SATISFIES]->(t)`,
        { courseCode, tag_id: tag.toLowerCase().replace(/\s+/g, '-'), name: tag }
      );
    }
  } finally {
    await session.close();
  }
}

// ============== Utility ==============

export async function courseExists(courseCode: string): Promise<boolean> {
  const course = await getCourse(courseCode);
  return course !== null;
}

export async function runQuery(query: string, params: Record<string, unknown> = {}): Promise<Result> {
  const session = getSession();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
}

// ============================================================================
// REFERENCE-GROUNDING (RAG) — vector index helpers
// ============================================================================
// These are best-effort: every function returns gracefully (or false) when the
// driver is unavailable or the Neo4j server lacks vector-index support, so the
// reference store can fall back to the JSON cosine backend.

const REFERENCE_VECTOR_INDEX = 'reference_chunk_embeddings';

export function isNeo4jConnected(): boolean {
  return driver !== null;
}

/**
 * Ensure a cosine vector index exists for ReferenceChunk embeddings at the given
 * dimensions. Returns true if the index is usable at those dims, false otherwise
 * (driver down, unsupported server, or a dimension mismatch with an existing index).
 */
export async function ensureReferenceVectorIndex(dimensions: number): Promise<boolean> {
  if (!driver) return false;
  const session = getSession();
  try {
    // If an index already exists, only reuse it when dimensions match.
    const existing = await session.run(
      `SHOW VECTOR INDEXES YIELD name, options WHERE name = $name RETURN options`,
      { name: REFERENCE_VECTOR_INDEX }
    );
    if (existing.records.length > 0) {
      const options = existing.records[0].get('options') as
        | { indexConfig?: Record<string, unknown> }
        | null;
      const dims = Number(
        (options?.indexConfig as Record<string, unknown> | undefined)?.['vector.dimensions']
      );
      return Number.isFinite(dims) ? dims === dimensions : true;
    }

    await session.run(
      `CREATE VECTOR INDEX ${REFERENCE_VECTOR_INDEX} IF NOT EXISTS
       FOR (c:ReferenceChunk) ON (c.embedding)
       OPTIONS { indexConfig: { \`vector.dimensions\`: $dimensions, \`vector.similarity_function\`: 'cosine' } }`,
      { dimensions: neo4j.int(dimensions) }
    );
    return true;
  } catch (err) {
    console.warn(
      '[neo4j] Vector index unavailable, reference store will fall back to JSON:',
      err instanceof Error ? err.message : String(err)
    );
    return false;
  } finally {
    await session.close();
  }
}

/** Upsert reference chunks as (:ReferenceChunk) nodes linked to their Course. */
export async function upsertReferenceChunks(chunks: ReferenceChunk[]): Promise<void> {
  if (!driver || chunks.length === 0) return;
  const session = getSession();
  try {
    await session.run(
      `UNWIND $chunks AS chunk
       MERGE (c:ReferenceChunk { chunk_id: chunk.chunk_id })
       SET c.doc_id = chunk.doc_id,
           c.course_code = chunk.course_code,
           c.seq = chunk.seq,
           c.text = chunk.text,
           c.citation = chunk.citation,
           c.clo_ids = chunk.clo_ids,
           c.subtopic_ids = chunk.subtopic_ids,
           c.embedding = chunk.embedding
       WITH c, chunk
       MATCH (course:Course { course_code: chunk.course_code })
       MERGE (course)-[:HAS_REFERENCE_CHUNK]->(c)`,
      {
        chunks: chunks.map((c) => ({
          chunk_id: c.chunk_id,
          doc_id: c.doc_id,
          course_code: c.course_code,
          seq: neo4j.int(c.seq),
          text: c.text,
          citation: c.citation,
          clo_ids: c.clo_ids,
          subtopic_ids: c.subtopic_ids,
          embedding: c.embedding,
        })),
      }
    );
  } finally {
    await session.close();
  }
}

/** Vector search scoped to a course (and optionally a CLO/subtopic). */
export async function queryReferenceChunks(
  courseCode: string,
  queryVector: number[],
  topN: number,
  scope?: { cloId?: string; subtopicId?: string }
): Promise<{ chunk_id: string; score: number }[]> {
  if (!driver) return [];
  const session = getSession();
  // Over-fetch because the post-filter (course/scope) can drop candidates.
  const k = Math.max(topN * 5, 50);
  try {
    const result = await session.run(
      `CALL db.index.vector.queryNodes($index, $k, $vector)
       YIELD node, score
       WHERE node.course_code = $courseCode
         AND ($cloId IS NULL OR $cloId IN node.clo_ids)
         AND ($subtopicId IS NULL OR $subtopicId IN node.subtopic_ids)
       RETURN node.chunk_id AS chunk_id, score
       ORDER BY score DESC
       LIMIT $limit`,
      {
        index: REFERENCE_VECTOR_INDEX,
        k: neo4j.int(k),
        vector: queryVector,
        courseCode,
        cloId: scope?.cloId ?? null,
        subtopicId: scope?.subtopicId ?? null,
        limit: neo4j.int(topN),
      }
    );
    return result.records.map((r) => ({
      chunk_id: r.get('chunk_id') as string,
      score: Number(r.get('score')),
    }));
  } finally {
    await session.close();
  }
}

/** Remove all reference chunks for one document. */
export async function deleteReferenceChunksByDoc(courseCode: string, docId: string): Promise<void> {
  if (!driver) return;
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:ReferenceChunk { course_code: $courseCode, doc_id: $docId }) DETACH DELETE c`,
      { courseCode, docId }
    );
  } finally {
    await session.close();
  }
}

/** Remove all reference chunks for a course. */
export async function deleteAllReferenceChunks(courseCode: string): Promise<void> {
  if (!driver) return;
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:ReferenceChunk { course_code: $courseCode }) DETACH DELETE c`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

// ============================================================================
// M7 — Node-set graph (D1 storage split). NEW labels, never the legacy
// :LearningNode graph. Best-effort: every function returns gracefully when the
// driver is unavailable, so M7 unit tests never require a live DB.
//
//   (:MaestroNode)          one Step-1 node (KC, EC requirement, governance)
//   (:KnowledgeComponent)   the masterable thing (FK kc_ids)
//   (:EvidenceCheckRequirement) the mandatory ec_node_<id>_primary requirement
// Foreign keys back to subtopic / CLO / assessment are stored as properties on
// :MaestroNode (subtopic_id, clo_ids[], prepares_for_assessment_id).
// ============================================================================

/** Replace any previously persisted node-set graph for one subtopic. */
export async function deleteNodeSetGraph(subtopicId: string): Promise<void> {
  if (!driver) return;
  const session = getSession();
  try {
    await session.run(
      `MATCH (n:MaestroNode { subtopic_id: $subtopicId })
       OPTIONAL MATCH (n)-[:HAS_KC]->(kc:KnowledgeComponent)
       OPTIONAL MATCH (n)-[:HAS_PRIMARY_EVIDENCE_CHECK]->(ec:EvidenceCheckRequirement)
       DETACH DELETE n, kc, ec`,
      { subtopicId }
    );
  } finally {
    await session.close();
  }
}

/**
 * Persist a governed node-set as graph entities under the NEW M7 labels, with
 * foreign keys back to subtopic / CLO / frozen assessment. Idempotent per
 * subtopic (replaces the prior graph). No-ops without a live driver.
 */
export async function persistNodeSetGraph(nodeSet: NodeSet): Promise<boolean> {
  if (!driver) return false;
  await deleteNodeSetGraph(nodeSet.subtopic_id);
  const session = getSession();
  try {
    for (const node of nodeSet.nodes) {
      await session.run(
        `MERGE (n:MaestroNode { node_id: $node_id })
         SET n.subtopic_id = $subtopic_id,
             n.course_id = $course_id,
             n.clo_ids = $clo_ids,
             n.node_type = $node_type,
             n.node_title = $node_title,
             n.knowledge_component = $knowledge_component,
             n.order = $order,
             n.prepares_for_assessment_id = $prepares_for_assessment_id,
             n.misconception_slots = $misconception_slots,
             n.risk_classification = $risk_classification,
             n.status = $status
         MERGE (kc:KnowledgeComponent { node_id: $node_id })
         SET kc.statement = $knowledge_component, kc.kc_ids = $kc_ids
         MERGE (n)-[:HAS_KC]->(kc)
         MERGE (ec:EvidenceCheckRequirement { evidence_check_id: $evidence_check_id })
         SET ec.node_id = $node_id,
             ec.preferred_evidence_mode = $preferred_evidence_mode,
             ec.must_capture_signals = $must_capture_signals
         MERGE (n)-[:HAS_PRIMARY_EVIDENCE_CHECK]->(ec)`,
        {
          node_id: node.node_id,
          subtopic_id: node.parent_subtopic_id,
          course_id: node.course_id ?? nodeSet.course_id,
          clo_ids: node.clo_ids,
          node_type: node.node_type,
          node_title: node.node_title,
          knowledge_component: node.knowledge_component,
          order: neo4j.int(node.order),
          prepares_for_assessment_id: node.prepares_for_assessment_id ?? null,
          misconception_slots: node.misconception_slots,
          risk_classification: node.risk_classification,
          status: node.status,
          kc_ids: node.kc_ids,
          evidence_check_id: node.primary_evidence_check_requirement.evidence_check_id,
          preferred_evidence_mode: node.primary_evidence_check_requirement.preferred_evidence_mode,
          must_capture_signals: node.primary_evidence_check_requirement.must_capture_signals,
        }
      );
    }
    // Prerequisite edges within the set.
    for (const node of nodeSet.nodes) {
      for (const prereq of node.prerequisite_node_ids) {
        await session.run(
          `MATCH (n:MaestroNode { node_id: $node_id })
           MATCH (p:MaestroNode { node_id: $prereq_id })
           MERGE (n)-[:PREREQUISITE_OF]->(p)`,
          { node_id: node.node_id, prereq_id: prereq }
        );
      }
    }
    return true;
  } finally {
    await session.close();
  }
}
