import { config } from 'dotenv';
import { join } from 'path';
import { initPostgres, closePostgres } from '../src/db/client.js';
import {
  hydrateRegistry,
  updateTemplate,
  getActiveVersion,
} from '../src/node-engine/promptTemplateRegistry.service.js';
import { defaultPromptTemplates } from '../src/config/promptTemplates.defaults.js';

config({ path: join(process.cwd(), '..', '.env') });

const TEMPLATE_ID = 'video_brief_generation_prompt';

async function main(): Promise<void> {
  await initPostgres();
  await hydrateRegistry();

  const seed = defaultPromptTemplates.find((t) => t.prompt_template_id === TEMPLATE_ID);
  if (!seed) {
    throw new Error(`Seed template not found: ${TEMPLATE_ID}`);
  }

  const before = getActiveVersion(TEMPLATE_ID);
  if (before && before.task_prompt === seed.task_prompt) {
    console.log(`Active version ${before.version} already matches the current default — no change.`);
    await closePostgres();
    return;
  }

  const updated = await updateTemplate(TEMPLATE_ID, {
    task_prompt: seed.task_prompt,
    status: 'approved',
    last_updated_by: 'system:prompt-refresh',
    change_note:
      'Adopt lighter, more creative HeyGen Video Agent brief prompt (premium explainer + director-level heygen prompt).',
  });

  console.log(
    `Updated ${TEMPLATE_ID}: active version ${before?.version ?? 'n/a'} -> ${updated.version} (${
      updated.task_prompt.length
    } chars).`
  );
  await closePostgres();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
