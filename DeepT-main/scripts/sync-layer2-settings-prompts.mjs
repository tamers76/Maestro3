import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(root, 'config', 'settings.json');
const promptsPath = join(root, 'backend', 'src', 'config', 'layer2CloReview.prompts.ts');

// Dynamic import via compiling - read prompts from ts file by regex (simple approach)
const ts = readFileSync(promptsPath, 'utf-8');
function extractConst(name) {
  const re = new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`);
  const m = ts.match(re);
  if (!m) throw new Error(`Missing ${name}`);
  return m[1];
}
function extractOutputFields() {
  const re = /export const LAYER2_CLO_REVIEW_OUTPUT_FIELDS = \[([\s\S]*?)\] as const/;
  const m = ts.match(re);
  if (!m) throw new Error('Missing output fields');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const memberSystemPrompt = extractConst('LAYER2_MEMBER_SYSTEM_PROMPT');
const chairmanSystemPrompt = extractConst('LAYER2_CHAIRMAN_SYSTEM_PROMPT');
const taskPrompt = extractConst('LAYER2_TASK_PROMPT');
const outputFields = extractOutputFields();

const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
const layer2 = settings.stage1Layers?.find((l) => l.id === 'layer2-clo-review');
if (!layer2) throw new Error('layer2-clo-review not found');
layer2.outputFields = outputFields;
layer2.memberSystemPrompt = memberSystemPrompt;
layer2.chairmanSystemPrompt = chairmanSystemPrompt;
layer2.taskPrompt = taskPrompt;

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
console.log('Updated layer2-clo-review prompts in config/settings.json');
