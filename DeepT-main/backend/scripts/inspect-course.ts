import { config } from 'dotenv';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { initPostgres, getDb, closePostgres } from '../src/db/client.js';
import * as artifactRepo from '../src/db/repos/artifactRepo.js';

config({ path: join(process.cwd(), '..', '.env') });

async function main(): Promise<void> {
  const code = process.argv[2] ?? 'MDLD602';
  await initPostgres();
  const db = getDb();

  const arts = await db.execute(sql`
    SELECT artifact_type, node_id, stage
    FROM stage_artifacts
    WHERE course_code = ${code}
    ORDER BY artifact_type, node_id
  `);
  console.log('artifacts:', arts.rows.length);
  for (const row of arts.rows as Array<{ artifact_type: string; node_id: string; stage: string | null }>) {
    console.log(`  ${row.artifact_type}${row.node_id ? ` [${row.node_id}]` : ''} (${row.stage ?? 'no-stage'})`);
  }

  const nodeEngine = await db.execute(sql`
    SELECT artifact_type, updated_at
    FROM stage_artifacts
    WHERE course_code = ${code} AND artifact_type LIKE 'node_engine:%'
    ORDER BY artifact_type
  `);
  console.log('\nnode_engine artifacts:', nodeEngine.rows.length);
  for (const row of nodeEngine.rows as Array<{ artifact_type: string; updated_at: string }>) {
    console.log(`  ${row.artifact_type} @ ${row.updated_at}`);
  }

  const arch = await artifactRepo.get(code, 'subtopic_architecture');
  if (arch) {
    const a = arch as { clo_sections?: Array<{ clo_id: string; subtopics: Array<{ subtopic_id: string; approval_status: string }> }> };
    const approved = (a.clo_sections ?? []).flatMap((s) => s.subtopics.filter((t) => t.approval_status === 'approved'));
    console.log('\nsubtopic_architecture approved subtopics:', approved.length);
  } else {
    console.log('\nsubtopic_architecture: MISSING');
  }

  const layers = await artifactRepo.get(code, 'stage1_layers');
  if (layers) {
    const l = layers as { layers?: Array<{ layer_id: string; status: string }> };
    console.log('stage1_layers:', (l.layers ?? []).map((x) => `${x.layer_id}:${x.status}`).join(', '));
  }

  await closePostgres();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
