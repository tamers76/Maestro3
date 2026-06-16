/**
 * LLM Council Service
 * 
 * Implements council-based AI execution where multiple models deliberate
 * and a chairman synthesizes the final output.
 * 
 * Key behaviors:
 * - council-of-1: Single model execution (fast path, same as before)
 * - multi-member council: Parallel model queries + chairman synthesis
 */

import { getSettings, getStage1LayerConfig } from '../config.js';
import type { StageNumber, StageExecutionMode, StageModelConfig } from '../models/schemas.js';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CouncilProgressCallback {
  onMemberStart?: (model: string, index: number, total: number) => void;
  onMemberComplete?: (model: string, index: number, total: number) => void;
  onSynthesisStart?: (chairmanModel: string, memberCount: number) => void;
}

export interface CouncilOptions {
  maxTokens?: number;
  jsonMode?: boolean;
  progressCallback?: CouncilProgressCallback;
}

export interface CouncilMemberResponse {
  model: string;
  response: string | null;
  error?: string;
}

// OpenRouter/OpenAI-compatible response format
interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// Ollama response format
interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

// ============================================================================
// Provider-specific API calls
// ============================================================================

// Check if a model is a reasoning model that uses internal thinking tokens
function isReasoningModel(model: string): boolean {
  const reasoningModels = ['o1', 'o1-mini', 'o1-preview', 'gpt-5', 'o3', 'o3-mini'];
  const lowerModel = model.toLowerCase();
  return reasoningModels.some(rm => lowerModel.includes(rm));
}

async function callOpenRouter(
  messages: AIMessage[],
  model: string,
  options: CouncilOptions
): Promise<string> {
  const settings = getSettings();
  const { maxTokens = 4096, jsonMode = false } = options;
  
  // Reasoning models need much higher token limits
  const isReasoning = isReasoningModel(model);
  const effectiveMaxTokens = isReasoning ? Math.max(maxTokens, 16384) : maxTokens;
  
  if (isReasoning) {
    console.log(`[OpenRouter] Detected reasoning model ${model}, increasing max_tokens from ${maxTokens} to ${effectiveMaxTokens}`);
  }
  
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: effectiveMaxTokens,
  };
  
  // Reasoning models don't support response_format
  if (jsonMode && !isReasoning) {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const response = await fetch(`${settings.openrouter.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openrouter.apiKey}`,
      'HTTP-Referer': 'http://localhost:3001',
      'X-Title': 'Adaptive Curriculum Intelligence'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;
  
  // Log full response for debugging
  console.log(`[OpenRouter] Raw API response for ${model}:`, JSON.stringify(data, null, 2).substring(0, 500));
  
  if (!content) {
    console.error('[OpenRouter] Empty or null content received. Full response:', JSON.stringify(data, null, 2));
    throw new Error(`OpenRouter returned empty content. Model: ${model}`);
  }
  
  console.log(`[OpenRouter] Response from ${model}: ${content.length} chars`);
  return content;
}

async function callOpenAI(
  messages: AIMessage[],
  model: string,
  options: CouncilOptions
): Promise<string> {
  const settings = getSettings();
  const { maxTokens = 4096, jsonMode = false } = options;
  
  // Reasoning models need much higher token limits because they use tokens for internal thinking
  // before producing output. Default 4096 is often not enough.
  const isReasoning = isReasoningModel(model);
  const effectiveMaxTokens = isReasoning ? Math.max(maxTokens, 16384) : maxTokens;
  
  if (isReasoning) {
    console.log(`[OpenAI] Detected reasoning model ${model}, increasing max_tokens from ${maxTokens} to ${effectiveMaxTokens}`);
  }
  
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: effectiveMaxTokens,
  };
  
  // Note: Reasoning models (o1, gpt-5) don't support response_format
  if (jsonMode && !isReasoning) {
    requestBody.response_format = { type: 'json_object' };
  }
  
  const response = await fetch(`${settings.openai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openai.apiKey}`,
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content;
  
  // Log full response for debugging
  console.log(`[OpenAI] Raw API response for ${model}:`, JSON.stringify(data, null, 2).substring(0, 500));
  
  if (!content) {
    console.error('[OpenAI] Empty or null content received. Full response:', JSON.stringify(data, null, 2));
    throw new Error(`OpenAI returned empty content. Model: ${model}`);
  }
  
  console.log(`[OpenAI] Response from ${model}: ${content.length} chars`);
  return content;
}

async function callOllama(
  messages: AIMessage[],
  model: string,
  options: CouncilOptions
): Promise<string> {
  const settings = getSettings();
  const { maxTokens = 4096, jsonMode = false } = options;
  
  // Ollama timeout: 10 minutes (local LLMs can be slow, especially when loading models)
  const OLLAMA_TIMEOUT_MS = 600000;
  
  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: {
      num_predict: maxTokens,
      num_ctx: settings.ollama?.options?.numCtx || 4096,
    }
  };
  
  if (jsonMode) {
    requestBody.format = 'json';
  }
  
  console.log(`[Ollama] Calling model ${model} (timeout: ${OLLAMA_TIMEOUT_MS / 1000}s)...`);
  
  let response: Response;
  try {
    response = await fetch(`${settings.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
  } catch (fetchError) {
    // Handle timeout and connection errors with clearer messages
    if (fetchError instanceof Error) {
      if (fetchError.name === 'TimeoutError' || fetchError.message.includes('timeout')) {
        throw new Error(`Ollama timeout after ${OLLAMA_TIMEOUT_MS / 1000}s. Model ${model} may be slow or not loaded. Try: ollama run ${model} "hello"`);
      }
      if (fetchError.message.includes('ECONNREFUSED') || fetchError.message.includes('fetch failed')) {
        throw new Error(`Cannot connect to Ollama at ${settings.ollama.baseUrl}. Is Ollama running? Try: ollama serve`);
      }
    }
    throw fetchError;
  }
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${response.status} - ${error}. Is Ollama running?`);
  }
  
  const data = await response.json() as OllamaResponse;
  const content = data.message?.content;
  
  // Log full response for debugging
  console.log(`[Ollama] Raw API response for ${model}:`, JSON.stringify(data, null, 2).substring(0, 500));
  
  if (!content) {
    console.error('[Ollama] Empty or null content received. Full response:', JSON.stringify(data, null, 2));
    throw new Error(`Ollama returned empty content. Model: ${model}`);
  }
  
  console.log(`[Ollama] Response from ${model}: ${content.length} chars`);
  return content;
}

const AI_NOT_CONFIGURED_MSG =
  'No AI API key is configured. Add OPENAI_API_KEY or OPENROUTER_API_KEY to DeepT-main/.env (then restart the backend), or set your key in Settings and use a .env file — keys entered in the UI are not saved to disk. In Settings, set AI Provider to match the key you added.';

function hasProviderKey(provider: 'openrouter' | 'openai' | 'ollama'): boolean {
  const settings = getSettings();
  if (provider === 'openrouter') return !!settings.openrouter.apiKey?.trim();
  if (provider === 'openai') return !!settings.openai.apiKey?.trim();
  return true; // Ollama does not require an API key
}

/** Resolve which provider to use (prefers configured aiProvider, then any provider with a key). */
export function getActiveAIProvider(): 'openrouter' | 'openai' | 'ollama' {
  const settings = getSettings();
  const preferred = settings.aiProvider;

  if (preferred === 'ollama') return 'ollama';
  if (preferred === 'openai' && hasProviderKey('openai')) return 'openai';
  if (preferred === 'openrouter' && hasProviderKey('openrouter')) return 'openrouter';
  if (hasProviderKey('openai')) return 'openai';
  if (hasProviderKey('openrouter')) return 'openrouter';
  if (preferred === 'ollama') return 'ollama';

  throw new Error(AI_NOT_CONFIGURED_MSG);
}

export function assertAIConfigured(): void {
  getActiveAIProvider();
}

/**
 * Call a specific model with the given messages
 */
export async function callModel(
  messages: AIMessage[],
  model: string,
  options: CouncilOptions = {}
): Promise<string> {
  const provider = getActiveAIProvider();

  if (provider === 'ollama') {
    return callOllama(messages, model, options);
  }

  if (provider === 'openai') {
    return callOpenAI(messages, model, options);
  }

  return callOpenRouter(messages, model, options);
}

// ============================================================================
// Council Orchestration
// ============================================================================

/**
 * Collect responses from multiple council members in parallel
 * @param messages - The messages to send
 * @param memberModels - List of models to query
 * @param options - Additional options
 * @param memberSystemPrompt - Optional per-stage member system prompt
 */
export async function collectCouncilResponses(
  messages: AIMessage[],
  memberModels: string[],
  options: CouncilOptions = {},
  memberSystemPrompt?: string
): Promise<CouncilMemberResponse[]> {
  const settings = getSettings();
  // Use provided per-stage prompt, or fall back to global settings
  const systemPrompt = memberSystemPrompt ?? settings.councilSettings?.memberSystemPrompt ?? settings.council?.memberSystemPrompt ?? 'You are a helpful AI assistant participating in a council deliberation.';
  
  const memberOptions: CouncilOptions = {
    ...options
  };
  
  // Add member system prompt if not already present
  const messagesWithSystemPrompt = messages[0]?.role === 'system'
    ? messages
    : [
        { role: 'system' as const, content: systemPrompt },
        ...messages
      ];
  
  const total = memberModels.length;
  const completedResponses: CouncilMemberResponse[] = [];
  
  // Query all members in parallel, but track completion
  const promises = memberModels.map(async (model, index): Promise<CouncilMemberResponse> => {
    // Notify start
    options.progressCallback?.onMemberStart?.(model, index, total);
    
    try {
      const response = await callModel(messagesWithSystemPrompt, model, memberOptions);
      const result = { model, response };
      completedResponses.push(result);
      
      // Notify completion
      options.progressCallback?.onMemberComplete?.(model, completedResponses.length, total);
      
      return result;
    } catch (error) {
      console.error(`Council member ${model} failed:`, error);
      const result = {
        model,
        response: null,
        error: error instanceof Error ? error.message : String(error)
      };
      completedResponses.push(result);
      
      // Still notify completion (with error)
      options.progressCallback?.onMemberComplete?.(model, completedResponses.length, total);
      
      return result;
    }
  });
  
  return Promise.all(promises);
}

/**
 * Build the chairman prompt that includes all member responses
 * @param originalMessages - The original messages sent to council members
 * @param memberResponses - Responses from council members
 * @param jsonMode - Whether to enforce JSON output
 * @param stageChairmanPrompt - Optional per-stage chairman system prompt
 */
function buildChairmanPrompt(
  originalMessages: AIMessage[],
  memberResponses: CouncilMemberResponse[],
  jsonMode: boolean,
  stageChairmanPrompt?: string
): AIMessage[] {
  const settings = getSettings();
  
  // Get the original user query (last user message)
  const userMessage = [...originalMessages].reverse().find(m => m.role === 'user');
  const originalQuery = userMessage?.content || 'No query provided';
  
  // Build the member responses text - filter out null AND empty responses
  const successfulResponses = memberResponses.filter(r => r.response !== null && r.response !== '');
  
  console.log(`[Chairman] Member responses: ${memberResponses.length} total, ${successfulResponses.length} successful`);
  memberResponses.forEach((r, i) => {
    if (r.response === null || r.response === '') {
      console.log(`[Chairman] Member ${i + 1} (${r.model}): FAILED/EMPTY - ${r.error || 'empty response'}`);
    } else {
      console.log(`[Chairman] Member ${i + 1} (${r.model}): ${r.response!.length} chars`);
    }
  });
  
  if (successfulResponses.length === 0) {
    throw new Error('All council members failed to respond or returned empty responses');
  }
  
  const responsesText = successfulResponses
    .map((r, i) => `--- Response from Model ${i + 1} (${r.model}) ---\n${r.response}`)
    .join('\n\n');
  
  // Build chairman system prompt with JSON instruction if needed
  // Use provided per-stage prompt, or fall back to global settings
  const defaultChairmanPrompt = `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a task.
Your role is to synthesize all responses into a single, comprehensive, accurate final answer.`;
  let chairmanSystemPrompt = stageChairmanPrompt ?? settings.councilSettings?.chairmanSystemPrompt ?? settings.council?.chairmanSystemPrompt ?? defaultChairmanPrompt;
  
  if (jsonMode) {
    chairmanSystemPrompt += `

CRITICAL JSON MODE ACTIVE: You MUST output ONLY valid JSON.
- Start your response with { or [ immediately
- Do not include ANY text, explanations, or markdown before or after the JSON
- Your entire response must parse as valid JSON`;
  }
  
  // Build the user prompt - be VERY explicit about schema for JSON mode
  const jsonInstruction = jsonMode 
    ? `

=== CRITICAL JSON OUTPUT REQUIREMENTS ===
1. Your ENTIRE response must be ONLY valid JSON - no text before or after
2. Start IMMEDIATELY with { or [ (whichever matches the expected schema)
3. End with the matching } or ]
4. Use the EXACT SAME JSON SCHEMA that the council members used
5. Do NOT add markdown code blocks (\`\`\`)
6. Do NOT add explanatory text like "Here is the synthesized response:"
7. Do NOT modify the schema or add new fields
8. Merge the CONTENT from members, but keep the STRUCTURE identical

WRONG: "Here is the combined response: {...}"
WRONG: \`\`\`json {...} \`\`\`
CORRECT: {"field": "value", ...}`
    : '';
  
  const chairmanUserPrompt = `ORIGINAL TASK:
${originalQuery}

COUNCIL MEMBER RESPONSES (${successfulResponses.length} responses):

${responsesText}

---

Synthesize these ${successfulResponses.length} responses into ONE final answer that combines the best elements from each.${jsonInstruction}`;
  
  return [
    { role: 'system', content: chairmanSystemPrompt },
    { role: 'user', content: chairmanUserPrompt }
  ];
}

/**
 * Synthesize member responses with the chairman model
 * @deprecated Use synthesizeWithChairmanModel for per-stage chairman support
 */
export async function synthesizeWithChairman(
  originalMessages: AIMessage[],
  memberResponses: CouncilMemberResponse[],
  options: CouncilOptions = {}
): Promise<string> {
  const settings = getSettings();
  const chairmanModel = settings.council.chairmanModel;
  return synthesizeWithChairmanModel(originalMessages, memberResponses, chairmanModel, options);
}

/**
 * Synthesize member responses with a specific chairman model
 * @param originalMessages - The original messages sent to council members
 * @param memberResponses - Responses from council members
 * @param chairmanModel - The model to use for synthesis
 * @param options - Additional options
 * @param chairmanSystemPrompt - Optional per-stage chairman system prompt
 */
export async function synthesizeWithChairmanModel(
  originalMessages: AIMessage[],
  memberResponses: CouncilMemberResponse[],
  chairmanModel: string,
  options: CouncilOptions = {},
  chairmanSystemPrompt?: string
): Promise<string> {
  const chairmanMessages = buildChairmanPrompt(
    originalMessages,
    memberResponses,
    options.jsonMode ?? false,
    chairmanSystemPrompt
  );
  
  console.log(`[Chairman] Calling chairman model: ${chairmanModel}`);
  const result = await callModel(chairmanMessages, chairmanModel, options);
  console.log(`[Chairman] Chairman returned: ${result?.length || 0} chars`);
  
  if (!result || result.trim() === '') {
    console.error('[Chairman] Chairman returned empty response!');
    // If chairman fails, try to return the best member response instead
    const bestMember = memberResponses.find(r => r.response && r.response.length > 0);
    if (bestMember) {
      console.log(`[Chairman] Falling back to best member response from ${bestMember.model}`);
      return bestMember.response!;
    }
    throw new Error('Chairman returned empty response and no valid member responses available');
  }
  
  return result;
}

// ============================================================================
// Unified Execution Entry Point
// ============================================================================

/**
 * Get stage configuration from new stageConfigs or fallback to legacy settings
 */
export function getStageConfig(stage: StageNumber): StageModelConfig {
  const settings = getSettings();
  const stageKey = `stage${stage}` as keyof typeof settings.stageConfigs;
  
  // Debug logging
  console.log(`[Council] Getting config for stage ${stage}`);
  console.log(`[Council] stageConfigs exists: ${!!settings.stageConfigs}`);
  console.log(`[Council] stageConfigs[${stageKey}] exists: ${!!settings.stageConfigs?.[stageKey]}`);
  
  // Try new stageConfigs first
  if (settings.stageConfigs && settings.stageConfigs[stageKey]) {
    const config = settings.stageConfigs[stageKey];
    console.log(`[Council] Found stageConfig for ${stageKey}:`, JSON.stringify(config, null, 2));
    
    // Ensure we have valid data
    if (config.mode && (config.singleModel || (config.councilModels && config.councilModels.length > 0))) {
      console.log(`[Council] Using NEW stageConfigs for stage ${stage}: mode=${config.mode}, councilModels=${config.councilModels?.length || 0}`);
      return config;
    } else {
      console.log(`[Council] stageConfig validation FAILED: mode=${config.mode}, singleModel=${config.singleModel}, councilModels=${config.councilModels?.length}`);
    }
  }
  
  // Fallback to legacy settings
  const legacyModelKey = `stage${stage}` as keyof typeof settings.models;
  const legacyStageKey = `stage${stage}` as keyof typeof settings.stageExecution;
  
  console.log(`[Council] FALLING BACK to legacy settings for stage ${stage}`);
  console.log(`[Council] Legacy model: ${settings.models?.[legacyModelKey]}`);
  console.log(`[Council] Legacy execution mode: ${settings.stageExecution?.[legacyStageKey]}`);
  
  return {
    mode: settings.stageExecution?.[legacyStageKey] || 'single',
    singleModel: settings.models?.[legacyModelKey] || '',
    councilModels: settings.council?.councilModels || [],
    chairmanModel: settings.council?.chairmanModel || ''
  };
}

/** The Stage 1 layer whose config drives the live intake extraction + CLO analysis. */
export const STAGE1_INTAKE_LAYER_ID = 'layer1-intake';

/**
 * Pure merge of the layer1-intake config over the legacy stageConfigs.stage1 config.
 *
 * The layer1-intake config is the source of truth for course intake, but any field
 * it leaves empty (model/prompts) falls back to stageConfigs.stage1 so nothing
 * regresses if a layer field was never populated.
 */
export function mergeIntakeConfig(
  layer: StageModelConfig | undefined,
  stage1: StageModelConfig
): StageModelConfig {
  if (!layer) return stage1;
  const str = (v?: string): string | undefined => (v && v.trim() ? v : undefined);
  const councilModels =
    layer.councilModels && layer.councilModels.length > 0
      ? layer.councilModels
      : stage1.councilModels;
  return {
    mode: layer.mode ?? stage1.mode,
    singleModel: str(layer.singleModel) ?? stage1.singleModel,
    councilModels,
    chairmanModel: str(layer.chairmanModel) ?? stage1.chairmanModel,
    memberSystemPrompt: str(layer.memberSystemPrompt) ?? stage1.memberSystemPrompt,
    chairmanSystemPrompt: str(layer.chairmanSystemPrompt) ?? stage1.chairmanSystemPrompt,
    taskPrompt: str(layer.taskPrompt) ?? stage1.taskPrompt,
    taskPrompt2: str(layer.taskPrompt2) ?? stage1.taskPrompt2,
  };
}

/**
 * Resolve the effective Stage 1 intake config: the layer1-intake Stage 1 layer is
 * the source of truth, with stageConfigs.stage1 as the per-field fallback. Used by
 * runStage1 / runStage1FromForm / the weekly CLO mapping so all intake AI calls share
 * one configuration (model, council, taskPrompt for extraction, taskPrompt2 for CLOs).
 */
export function resolveStage1IntakeConfig(): StageModelConfig {
  const stage1 = getStageConfig(1);
  const layer = getStage1LayerConfig(STAGE1_INTAKE_LAYER_ID);
  return mergeIntakeConfig(layer, stage1);
}

/**
 * Get model for a specific stage (legacy helper - uses new stageConfigs)
 */
function getModelForStage(stage: StageNumber): string {
  const config = getStageConfig(stage);
  return config.singleModel;
}

/**
 * Get execution mode for a specific stage (legacy helper - uses new stageConfigs)
 */
function getExecutionModeForStage(stage: StageNumber): StageExecutionMode {
  const config = getStageConfig(stage);
  return config.mode;
}

/**
 * Unified AI execution that handles both single (council-of-1) and multi-member council
 * 
 * @param messages - The messages to send to the AI
 * @param stage - The stage number (1-5)
 * @param options - Additional options (temperature, maxTokens, jsonMode)
 * @param executionOverride - Optional override for execution mode ('single' or 'council')
 * @returns The final AI response (synthesized if council, direct if single)
 */
export async function executeWithCouncil(
  messages: AIMessage[],
  stage: StageNumber,
  options: CouncilOptions = {},
  executionOverride?: StageExecutionMode,
  configOverride?: StageModelConfig
): Promise<string> {
  // Get per-stage configuration (override, new stageConfigs, or legacy fallback)
  const stageConfig = configOverride ?? getStageConfig(stage);
  
  // Determine execution mode (override takes precedence)
  const executionMode = executionOverride ?? stageConfig.mode;
  
  // Get the single model for this stage
  const singleModel = stageConfig.singleModel;
  
  if (executionMode === 'single') {
    // Council-of-1: Just call the single stage model
    console.log(`Stage ${stage}: Executing with single model (${singleModel})`);
    return callModel(messages, singleModel, options);
  }
  
  // Multi-member council mode - use per-stage council models
  const councilModels = stageConfig.councilModels || [];
  const chairmanModel = stageConfig.chairmanModel;
  
  // Get per-stage prompts (will fall back to global if not set)
  const memberSystemPrompt = stageConfig.memberSystemPrompt;
  const chairmanSystemPrompt = stageConfig.chairmanSystemPrompt;
  
  if (councilModels.length === 0) {
    // No council models configured for this stage, fall back to single model
    console.log(`Stage ${stage}: No council models configured, falling back to single model (${singleModel})`);
    return callModel(messages, singleModel, options);
  }
  
  if (councilModels.length === 1) {
    // Only one council model, skip chairman synthesis (acts as council-of-1)
    console.log(`Stage ${stage}: Council has 1 member (${councilModels[0]}), executing directly`);
    return callModel(messages, councilModels[0], options);
  }
  
  // Multi-member council: collect responses and synthesize
  console.log(`Stage ${stage}: Executing with council (${councilModels.length} members: ${councilModels.join(', ')})`);
  console.log(`Stage ${stage}: Chairman model: ${chairmanModel}`);
  if (memberSystemPrompt) {
    console.log(`Stage ${stage}: Using per-stage member prompt`);
  }
  if (chairmanSystemPrompt) {
    console.log(`Stage ${stage}: Using per-stage chairman prompt`);
  }
  
  // Step 1: Collect responses from all council members in parallel (with per-stage prompt)
  const memberResponses = await collectCouncilResponses(messages, councilModels, options, memberSystemPrompt);
  
  // Check if we got any successful responses
  const successfulResponses = memberResponses.filter(r => r.response !== null);
  if (successfulResponses.length === 0) {
    throw new Error('All council members failed to respond');
  }
  
  // If only one member succeeded, return their response directly
  if (successfulResponses.length === 1) {
    console.log(`Stage ${stage}: Only one council member responded, using their response directly`);
    return successfulResponses[0].response!;
  }
  
  // Step 2: Chairman synthesizes the responses using per-stage chairman model and prompt
  console.log(`Stage ${stage}: Chairman (${chairmanModel}) synthesizing ${successfulResponses.length} responses`);
  
  // Notify synthesis start
  options.progressCallback?.onSynthesisStart?.(chairmanModel, successfulResponses.length);
  
  return synthesizeWithChairmanModel(messages, memberResponses, chairmanModel, options, chairmanSystemPrompt);
}

/**
 * Get council execution info for a stage (useful for progress reporting)
 */
export function getCouncilInfo(
  stage: StageNumber,
  executionOverride?: StageExecutionMode,
  configOverride?: StageModelConfig
): {
  mode: StageExecutionMode;
  memberCount: number;
  models: string[];
  chairmanModel: string;
} {
  const stageConfig = configOverride ?? getStageConfig(stage);
  const executionMode = executionOverride ?? stageConfig.mode;
  
  if (executionMode === 'single') {
    return {
      mode: 'single',
      memberCount: 1,
      models: [stageConfig.singleModel],
      chairmanModel: stageConfig.singleModel
    };
  }
  
  const councilModels = stageConfig.councilModels || [];
  return {
    mode: 'council',
    memberCount: councilModels.length || 1,
    models: councilModels.length > 0 ? councilModels : [stageConfig.singleModel],
    chairmanModel: stageConfig.chairmanModel || stageConfig.singleModel
  };
}
