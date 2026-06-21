/**
 * OpenAI Deep Research Service
 * 
 * Uses the OpenAI Responses API with the web_search tool to:
 * 1. Resolve the primary textbook from syllabus references
 * 2. Research the textbook's TOC/chapter themes via web search
 * 3. Design self-paced topics per CLO based on textbook research
 */

import { getSettings } from '../config.js';
import { updateProgress } from './progress.service.js';
import type {
  CLO,
  SuggestedCloTopics,
  SuggestedCloTopicGroup,
  SuggestedTopicItem,
  ResolvedTextbook,
} from '../models/schemas.js';

// ─── OpenAI Responses API types ────────────────────────────────────────────

interface ResponsesAPIOutput {
  id: string;
  type: string;
  status: string;
  role?: string;
  content?: Array<{
    type: string;
    text: string;
    annotations?: Array<{
      type: string;
      url: string;
      title: string;
      start_index: number;
      end_index: number;
    }>;
  }>;
}

interface ResponsesAPIResponse {
  id: string;
  object: string;
  model: string;
  output: ResponsesAPIOutput[];
  output_text: string;
  status: string;
  error?: { message: string };
}

// ─── Call OpenAI Responses API ─────────────────────────────────────────────

/**
 * Call the OpenAI Responses API with the web_search tool. Exported so other
 * features (e.g. the Reference Coverage Phase-C source suggestions) can reuse the
 * SAME grounded web-search path instead of replicating the fetch. Requires
 * `settings.openai.apiKey`; throws when it is not configured.
 */
export async function callResponsesAPI(
  input: string,
  model: string = 'gpt-4o',
): Promise<ResponsesAPIResponse> {
  const settings = getSettings();

  if (!settings.openai?.apiKey) {
    throw new Error(
      'OpenAI API key is not configured. This feature requires the OpenAI provider. ' +
      'Go to Settings and add your OpenAI API key.'
    );
  }

  const baseUrl = settings.openai.baseUrl || 'https://api.openai.com/v1';

  const requestBody = {
    model,
    tools: [{ type: 'web_search' }],
    input,
  };

  console.log(`[DeepResearch] Calling OpenAI Responses API with model: ${model}`);
  console.log(`[DeepResearch] Input length: ${input.length} chars`);

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openai.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(300_000), // 5 minute timeout
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[DeepResearch] API error: ${response.status} - ${errorText}`);
    throw new Error(`OpenAI Responses API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as Record<string, unknown>;
  console.log(`[DeepResearch] Response keys: ${Object.keys(data).join(', ')}`);
  console.log(`[DeepResearch] Response status: ${data.status}`);

  if (data.error) {
    const err = data.error as { message: string };
    throw new Error(`OpenAI Responses API returned error: ${err.message}`);
  }

  // Extract output text from multiple possible locations
  let outputText = (data.output_text as string) || '';
  const output = (data.output as ResponsesAPIOutput[]) || [];

  // Some API versions use a top-level "text" field
  if (!outputText && data.text) {
    const textField = data.text as { output?: string } | string;
    if (typeof textField === 'string') outputText = textField;
    else if (typeof textField === 'object' && textField.output) outputText = textField.output;
  }

  // Extract from output items as fallback
  if (!outputText && output.length > 0) {
    const textParts: string[] = [];
    for (const item of output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.type === 'output_text' || block.type === 'text') {
            textParts.push(block.text);
          }
        }
      }
    }
    outputText = textParts.join('\n');
  }

  console.log(`[DeepResearch] output_text length: ${outputText.length}`);
  console.log(`[DeepResearch] output items count: ${output.length}`);
  if (!outputText) {
    console.log(`[DeepResearch] Raw response (first 1000 chars): ${JSON.stringify(data).substring(0, 1000)}`);
  }

  return {
    id: data.id as string || '',
    object: data.object as string || '',
    model: data.model as string || '',
    output,
    output_text: outputText,
    status: data.status as string || '',
  };
}

// ─── Extract URL citations ─────────────────────────────────────────────────

export function extractCitations(output: ResponsesAPIOutput[]): Array<{ title: string; url: string }> {
  const citations: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  for (const item of output) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.annotations) {
          for (const ann of block.annotations) {
            if (ann.type === 'url_citation' && !seen.has(ann.url)) {
              seen.add(ann.url);
              citations.push({ title: ann.title || '', url: ann.url });
            }
          }
        }
      }
    }
  }

  return citations;
}

// ─── Build the deep research prompt ────────────────────────────────────────

function buildResearchPrompt(
  clos: CLO[],
  references: string[],
): string {
  const refsText = references.length > 0
    ? references.map((r, i) => `  ${i + 1}. ${r}`).join('\n')
    : '  (No references listed)';

  const closText = clos
    .map(clo => `  ${clo.clo_id}: ${clo.clo_text} [Bloom: ${clo.bloom_level}, Knowledge: ${clo.knowledge_type}]`)
    .join('\n');

  return `You are an expert curriculum designer. Your task is to design **self-paced learning topics** for each Course Learning Outcome (CLO), based on deep research of the referenced textbook(s).

This course is self-paced — there are NO weeks. Instead, each CLO has a list of topics that the student completes at their own pace to achieve that CLO.

## Course References / Textbook(s):
${refsText}

## Course Learning Outcomes (${clos.length} CLOs):
${closText}

## Your Task

1. **Identify the Primary Textbook**: From the references above, identify the main textbook. Search the web for its Table of Contents, chapter structure, chapter summaries, and topic coverage. Use publisher pages, library listings, or academic sites.

2. **Design Topics per CLO**: For EACH CLO, design a list of self-paced learning topics (typically 3-6 per CLO, but use your judgment). Each topic represents one learning unit that the student must complete to progress toward mastering the CLO. For each topic, provide:
   - **title**: A clear, specific topic title derived from the textbook chapters
   - **description**: A 1-2 sentence description of what will be covered
   - **readings**: Specific textbook chapter(s) and sections to read (e.g. "Chapter 3: Biodiversity Conservation, pp. 45-78")
   - **rationale**: Brief explanation of why this topic is needed for this CLO

3. **Design Principles**:
   - Follow the textbook's natural chapter ordering within each CLO
   - Start with foundational topics and progress to advanced ones within each CLO
   - Lower Bloom levels (Remember, Understand) CLOs should have topics focusing on comprehension
   - Higher Bloom levels (Analyze, Evaluate, Create) CLOs should have topics focusing on application and synthesis
   - Every CLO must have at least one topic
   - Readings should reference specific chapters from the identified textbook

## Required Output Format

You MUST respond with ONLY a valid JSON object (no markdown, no explanations before/after). Use this exact structure:

{
  "textbook": {
    "title": "Full textbook title",
    "authors": ["Author 1", "Author 2"],
    "edition": "Edition string or null",
    "isbn": "ISBN or null"
  },
  "topics_by_clo": [
    {
      "clo_id": "${clos[0]?.clo_id || 'CLO-1'}",
      "topics": [
        {
          "title": "Topic Title",
          "description": "What the student will learn...",
          "readings": "Chapter 1: Introduction (pp. 1-25)",
          "rationale": "This foundational topic builds understanding of core concepts needed for this CLO."
        }
      ]
    }
  ]
}

IMPORTANT:
- You MUST include an entry for EVERY CLO: ${clos.map(c => c.clo_id).join(', ')}
- Each CLO should have between 2 and 8 topics (use your judgment based on scope)
- Readings MUST reference actual chapters from the textbook you researched
- Do NOT include week numbers — this is a self-paced course

RESPOND WITH ONLY THE JSON OBJECT.`;
}

// ─── Parse the response JSON ───────────────────────────────────────────────

function parseResponse(outputText: string): {
  textbook: ResolvedTextbook | null;
  topics_by_clo: Array<{
    clo_id: string;
    topics: Array<{
      title: string;
      description: string;
      readings: string;
      rationale: string;
    }>;
  }>;
} {
  let cleaned = outputText.trim();

  // Remove markdown code blocks if present
  const jsonBlockMatch = cleaned.match(/```json\s*([\s\S]*?)```/) ||
                          cleaned.match(/```\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  // Find JSON start
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart > 0) {
    cleaned = cleaned.slice(jsonStart);
  }

  // Find matching end brace
  if (cleaned[0] === '{') {
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (char === '\\' && inString) { escapeNext = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            cleaned = cleaned.slice(0, i + 1);
            break;
          }
        }
      }
    }
  }

  // Fix trailing commas
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('[DeepResearch] Failed to parse JSON:', error);
    console.error('[DeepResearch] Raw text (first 500 chars):', cleaned.substring(0, 500));
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Generate suggested self-paced topics per CLO using OpenAI deep textbook research.
 * 
 * The AI researches the referenced textbook(s) via web search and designs
 * topics for each CLO with titles, descriptions, readings, and rationale.
 */
export async function generateSuggestedCloTopics(
  courseCode: string,
  clos: CLO[],
  references: string[],
): Promise<SuggestedCloTopics> {
  const settings = getSettings();

  if (!settings.openai?.apiKey) {
    throw new Error(
      'This feature requires an OpenAI API key. ' +
      'Please configure your OpenAI API key in Settings.'
    );
  }

  const model = 'gpt-4o';

  // Step 1: Build the research prompt
  updateProgress({
    courseCode,
    stage: 1,
    status: 'running',
    step: 'Deep research: preparing textbook analysis',
    message: 'Building research prompt with references and CLOs...',
  });

  const prompt = buildResearchPrompt(clos, references);

  // Step 2: Call OpenAI Responses API with web search
  updateProgress({
    courseCode,
    stage: 1,
    status: 'running',
    step: 'Deep research: researching textbook chapters',
    message: 'AI is searching the web for textbook content and designing topics per CLO...',
  });

  let apiResponse: ResponsesAPIResponse;
  try {
    apiResponse = await callResponsesAPI(prompt, model);
  } catch (error) {
    console.error('[DeepResearch] API call failed:', error);
    throw new Error(
      `Deep research failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Step 3: Parse the response
  updateProgress({
    courseCode,
    stage: 1,
    status: 'running',
    step: 'Deep research: building suggested topics',
    message: 'Parsing research results and building topic lists per CLO...',
  });

  const outputText = apiResponse.output_text;
  if (!outputText || outputText.trim().length === 0) {
    console.error('[DeepResearch] Empty output. Response:', JSON.stringify(apiResponse).substring(0, 2000));
    throw new Error('OpenAI returned an empty response. Check the backend logs.');
  }

  // Extract URL citations from the API response
  const webCitations = extractCitations(apiResponse.output);
  console.log(`[DeepResearch] Extracted ${webCitations.length} web citations`);

  // Parse the JSON
  const parsed = parseResponse(outputText);

  // Normalize CLO IDs in the response to match actual IDs
  const actualCloIds = clos.map(c => c.clo_id);
  const normalizeStr = (s: string) => s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D\u002D]/g, '-').trim();
  
  // Build a lookup: normalized form → actual CLO ID
  const cloLookup = new Map<string, string>();
  for (const id of actualCloIds) {
    cloLookup.set(id, id); // exact
    cloLookup.set(normalizeStr(id), id); // normalized with regular hyphens
    cloLookup.set(id.replace(/-/g, ''), id); // no hyphens e.g. "CLO1"
    cloLookup.set(normalizeStr(id).replace(/-/g, ''), id); // fully stripped
  }

  function normalizeCloId(aiCloId: string): string {
    if (cloLookup.has(aiCloId)) return cloLookup.get(aiCloId)!;
    const normalized = normalizeStr(aiCloId);
    if (cloLookup.has(normalized)) return cloLookup.get(normalized)!;
    const stripped = normalized.replace(/-/g, '');
    if (cloLookup.has(stripped)) return cloLookup.get(stripped)!;
    const withHyphen = stripped.replace(/(\D)(\d)/, '$1-$2');
    if (cloLookup.has(withHyphen)) return cloLookup.get(withHyphen)!;
    return aiCloId;
  }

  // Build the topics_by_clo structure
  const topicsByClo: SuggestedCloTopicGroup[] = (parsed.topics_by_clo || []).map(group => ({
    clo_id: normalizeCloId(group.clo_id),
    topics: (group.topics || []).map(t => ({
      title: t.title || 'Untitled Topic',
      description: t.description || '',
      readings: t.readings || '',
      rationale: t.rationale || '',
    })),
  }));

  // Ensure every CLO has an entry (fill gaps for any missing CLOs)
  const existingCloIds = new Set(topicsByClo.map(g => g.clo_id));
  for (const cloId of actualCloIds) {
    if (!existingCloIds.has(cloId)) {
      topicsByClo.push({
        clo_id: cloId,
        topics: [{
          title: 'No suggestion generated',
          description: 'AI did not generate a topic for this CLO. Please add topics manually.',
          readings: '',
          rationale: '',
        }],
      });
    }
  }

  // Sort by CLO order
  const cloOrder = new Map(actualCloIds.map((id, idx) => [id, idx]));
  topicsByClo.sort((a, b) => (cloOrder.get(a.clo_id) ?? 999) - (cloOrder.get(b.clo_id) ?? 999));

  // Build textbook info
  let textbook: ResolvedTextbook | null = null;
  if (parsed.textbook && (parsed.textbook.title || parsed.textbook.isbn)) {
    textbook = {
      title: parsed.textbook.title || undefined,
      authors: Array.isArray(parsed.textbook.authors) ? parsed.textbook.authors : undefined,
      edition: parsed.textbook.edition || undefined,
      isbn: parsed.textbook.isbn || undefined,
    };
  }

  const totalTopics = topicsByClo.reduce((sum, g) => sum + g.topics.length, 0);

  const result: SuggestedCloTopics = {
    generated_at: new Date().toISOString(),
    provider: 'openai',
    model: apiResponse.model || model,
    textbook,
    topics_by_clo: topicsByClo,
    web_sources: webCitations,
  };

  console.log(`[DeepResearch] Generated ${totalTopics} topics across ${topicsByClo.length} CLOs`);
  return result;
}
