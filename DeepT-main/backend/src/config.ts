import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Settings, CouncilConfig, StageExecution, StageConfigs, StageModelConfig, CouncilSettings, Stage1LayerConfig } from './models/schemas.js';
import { defaultStage1Layers } from './config/stage1Layers.defaults.js';
import {
  STAGE1_EXTRACTION_PROMPT,
  STAGE1_CLO_ANALYSIS_PROMPT,
  STAGE2_DECOMPOSITION_PROMPT,
  STAGE3_ADAPTIVE_PROMPT,
  STAGE4_CONTENT_PROMPT
} from './utils/prompts.js';

const CONFIG_PATH = join(process.cwd(), '..', 'config', 'settings.json');

// Default council member system prompt (global fallback)
const DEFAULT_MEMBER_SYSTEM_PROMPT = `You are a helpful AI assistant participating in a council deliberation.
Provide your best, most thorough response to the given task.
Be specific, accurate, and comprehensive in your answer.`;

// Default chairman system prompt for synthesizing council outputs (global fallback)
const DEFAULT_CHAIRMAN_SYSTEM_PROMPT = `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a task.

Your role is to synthesize all responses into a single, comprehensive, accurate final answer.

Consider:
- The individual responses and their unique insights
- Areas of agreement and disagreement between responses
- The most accurate and well-reasoned points from each response

Provide a clear, well-structured final answer that represents the council's collective wisdom.
If the task requires JSON output, ensure your response is valid JSON.`;

// Stage-specific recommended prompts (ALIGNED with taskPrompts for council mode compatibility)
// Key principle: memberSystemPrompt sets role/quality expectations, taskPrompt defines the actual task and schema
const STAGE_PROMPTS = {
  stage1: {
    member: `You are an expert curriculum analyst participating in a council deliberation.

Your role:
- Follow the user's task instructions EXACTLY
- Output ONLY valid JSON matching the schema in the task
- Be thorough and accurate in extracting/analyzing information
- If information is missing, use reasonable defaults or "unknown"

Quality standards:
- Extract information precisely as written when required
- Use professional academic terminology
- Ensure all required JSON fields are present

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`,
    chairman: `You are the Chairman synthesizing multiple council member responses.

Your job:
1) Review all member JSON responses
2) Select the most accurate and complete information from each
3) Resolve any conflicts by choosing the best-supported answer
4) Produce ONE final JSON that matches the task's required schema exactly

Rules:
- Output ONLY valid JSON
- Use the SAME schema structure as the original task requested
- Merge the best elements from all responses
- Ensure completeness - all required fields must be present

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`
  },
  stage2: {
    member: `You are an expert instructional designer participating in a council deliberation.

Your role:
- Follow the user's task instructions EXACTLY
- Output ONLY valid JSON matching the schema in the task
- Create pedagogically sound learning node decompositions
- Ensure logical prerequisite chains

Quality standards:
- Node types must match the allowed taxonomy
- Learning intents must be clear and measurable
- Prerequisites must form a valid DAG (no cycles)

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`,
    chairman: `You are the Chairman synthesizing multiple council member responses.

Your job:
1) Review all member JSON responses (learning node graphs)
2) Select the most pedagogically sound nodes from each
3) Ensure prerequisites are logical and complete
4) Produce ONE final JSON that matches the task's required schema exactly

Rules:
- Output ONLY valid JSON
- Use the SAME schema structure as the original task requested
- Merge the best nodes, avoiding duplicates
- Ensure all CLOs have adequate node coverage

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`
  },
  stage3: {
    member: `You are an expert in adaptive learning assessment intelligence participating in a council deliberation.

Your role:
- Follow the user's task instructions EXACTLY
- Output ONLY valid JSON matching the schema in the task
- Define diagnostic rules, failure types, remediation paths, and progression logic
- You must NOT generate any actual assessment questions, quiz items, or instructional content

Quality standards:
- Failure types must describe academic misconceptions, not technical errors
- Observable signals must describe what failure looks like in learner work
- Remediation paths must be tied to specific failure types
- Progression rules must reflect risk level and node type

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`,
    chairman: `You are the Chairman synthesizing multiple council member responses for assessment intelligence.

Your job:
1) Review all member JSON responses (assessment logic per node)
2) Select the most academically rigorous failure types, signals, and remediation paths
3) Ensure consistency in progression rules and gating decisions
4) Produce ONE final JSON that matches the task's required schema exactly

Rules:
- Output ONLY valid JSON
- Use the SAME schema structure as the original task requested
- All nodes from input must be present in output
- Do NOT include any actual assessment questions or instructional content

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`
  },
  stage4: {
    member: `You are an expert educational content writer participating in a council deliberation.

Your role:
- Follow the user's task instructions EXACTLY
- Generate high-quality instructional content in the specified format
- Create content appropriate for university-level students
- Include all required sections

Quality standards:
- Clear, academic tone
- Relevant examples
- Appropriate technical depth
- Well-structured with logical flow

Follow the exact output format specified in the task.`,
    chairman: `You are the Chairman synthesizing multiple council member responses.

Your job:
1) Review all member content responses
2) Select the highest quality content
3) Ensure completeness and coherence
4) Produce the final content in the exact format specified

Rules:
- Follow the exact output format from the task
- Choose the most accurate and pedagogically sound content
- Ensure all required sections are present
- Maintain consistent tone and depth

Produce content in the exact format specified in the original task.`
  },
  stage5: {
    member: `You are a course assembly specialist participating in a council deliberation.

Your role:
- Follow the user's task instructions EXACTLY
- Output ONLY valid JSON matching the schema in the task
- Integrate all previous stage artifacts coherently
- Ensure all cross-references are valid

Quality standards:
- All components must be present and properly linked
- Metadata must be complete
- Accreditation requirements documented
- No broken references

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`,
    chairman: `You are the Chairman synthesizing multiple council member responses.

Your job:
1) Review all member JSON responses (course packages)
2) Select the most complete and consistent integration
3) Verify all cross-references and dependencies
4) Produce ONE final JSON that matches the task's required schema exactly

Rules:
- Output ONLY valid JSON
- Use the SAME schema structure as the original task requested
- Ensure complete integration of all stages
- Verify accreditation compliance

Output ONLY valid JSON. No markdown, no explanations, no text before or after the JSON.`
  }
};

// Default council configuration
const defaultCouncil: CouncilConfig = {
  councilModels: [],
  chairmanModel: 'anthropic/claude-sonnet-4',
  memberSystemPrompt: DEFAULT_MEMBER_SYSTEM_PROMPT,
  chairmanSystemPrompt: DEFAULT_CHAIRMAN_SYSTEM_PROMPT
};

// Default per-stage execution (LEGACY - all default to single/council-of-1)
const defaultStageExecution: StageExecution = {
  stage1: 'single',
  stage2: 'single',
  stage3: 'single',
  stage4: 'single',
  stage5: 'single'
};

// Default per-stage configurations (NEW) with stage-specific prompts
const defaultStageConfigs: StageConfigs = {
  stage1: {
    mode: 'single',
    singleModel: 'anthropic/claude-sonnet-4',
    councilModels: [],
    chairmanModel: 'anthropic/claude-sonnet-4',
    memberSystemPrompt: STAGE_PROMPTS.stage1.member,
    chairmanSystemPrompt: STAGE_PROMPTS.stage1.chairman,
    taskPrompt: STAGE1_EXTRACTION_PROMPT,
    taskPrompt2: STAGE1_CLO_ANALYSIS_PROMPT
  },
  stage2: {
    mode: 'single',
    singleModel: 'anthropic/claude-sonnet-4',
    councilModels: [],
    chairmanModel: 'anthropic/claude-sonnet-4',
    memberSystemPrompt: STAGE_PROMPTS.stage2.member,
    chairmanSystemPrompt: STAGE_PROMPTS.stage2.chairman,
    taskPrompt: STAGE2_DECOMPOSITION_PROMPT
  },
  stage3: {
    mode: 'single',
    singleModel: 'anthropic/claude-sonnet-4',
    councilModels: [],
    chairmanModel: 'anthropic/claude-sonnet-4',
    memberSystemPrompt: STAGE_PROMPTS.stage3.member,
    chairmanSystemPrompt: STAGE_PROMPTS.stage3.chairman,
    taskPrompt: STAGE3_ADAPTIVE_PROMPT
  },
  stage4: {
    mode: 'single',
    singleModel: 'anthropic/claude-sonnet-4',
    councilModels: [],
    chairmanModel: 'anthropic/claude-sonnet-4',
    memberSystemPrompt: STAGE_PROMPTS.stage4.member,
    chairmanSystemPrompt: STAGE_PROMPTS.stage4.chairman,
    taskPrompt: STAGE4_CONTENT_PROMPT
  },
  stage5: {
    mode: 'single',
    singleModel: 'anthropic/claude-sonnet-4',
    councilModels: [],
    chairmanModel: 'anthropic/claude-sonnet-4',
    memberSystemPrompt: STAGE_PROMPTS.stage5.member,
    chairmanSystemPrompt: STAGE_PROMPTS.stage5.chairman
    // Stage 5 has no task prompt - it assembles outputs from previous stages
  }
};

// Default global council settings (NEW)
const defaultCouncilSettings: CouncilSettings = {
  memberSystemPrompt: DEFAULT_MEMBER_SYSTEM_PROMPT,
  chairmanSystemPrompt: DEFAULT_CHAIRMAN_SYSTEM_PROMPT
};

// Default settings
const defaultSettings: Settings = {
  aiProvider: 'openrouter',
  openrouter: {
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1'
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1'
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    options: {
      numCtx: 4096
    }
  },
  models: {
    stage1: 'anthropic/claude-sonnet-4',
    stage2: 'anthropic/claude-sonnet-4',
    stage3: 'anthropic/claude-sonnet-4',
    stage4: 'anthropic/claude-sonnet-4',
    stage5: 'anthropic/claude-sonnet-4'
  },
  neo4j: {
    uri: 'neo4j://127.0.0.1:7687',
    user: 'neo4j',
    password: ''
  },
  // NEW: Per-stage model configurations
  stageConfigs: defaultStageConfigs,
  councilSettings: defaultCouncilSettings,
  // LEGACY: kept for backward compatibility
  council: defaultCouncil,
  stageExecution: defaultStageExecution,
  stage1Layers: defaultStage1Layers,
};

// Helper to migrate old councilMode to new council structure
function migrateCouncilSettings(settings: Record<string, unknown>): Partial<CouncilConfig> {
  // Check if old councilMode exists and migrate to new council structure
  const oldCouncilMode = settings.councilMode as { enabled?: boolean; models?: string[] } | undefined;
  if (oldCouncilMode && !settings.council) {
    return {
      councilModels: oldCouncilMode.models || [],
    };
  }
  return {};
}

// Helper to overlay environment variables onto settings (env takes precedence)
function overlayEnvSecrets(settings: Settings): Settings {
  return {
    ...settings,
    openrouter: {
      ...settings.openrouter,
      apiKey: process.env.OPENROUTER_API_KEY || settings.openrouter.apiKey,
    },
    openai: {
      ...settings.openai,
      apiKey: process.env.OPENAI_API_KEY || settings.openai.apiKey,
    },
    neo4j: {
      ...settings.neo4j,
      uri: process.env.NEO4J_URI || settings.neo4j.uri,
      user: process.env.NEO4J_USER || settings.neo4j.user,
      password: process.env.NEO4J_PASSWORD || settings.neo4j.password,
    },
  };
}

// Load settings from file with deep merge for nested objects
export function loadSettings(): Settings {
  let mergedSettings = defaultSettings;
  
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, 'utf-8');
      const settings = JSON.parse(data) as Partial<Settings> & Record<string, unknown>;
      
      // Migrate old councilMode if present
      const migratedCouncil = migrateCouncilSettings(settings);
      
      // Deep merge to ensure all nested defaults are present
      mergedSettings = {
        ...defaultSettings,
        ...settings,
        aiProvider: settings.aiProvider || defaultSettings.aiProvider,
        openrouter: { ...defaultSettings.openrouter, ...settings.openrouter },
        openai: { ...defaultSettings.openai, ...settings.openai },
        ollama: { 
          ...defaultSettings.ollama, 
          ...settings.ollama,
          options: { ...defaultSettings.ollama.options, ...settings.ollama?.options }
        },
        models: { ...defaultSettings.models, ...settings.models },
        neo4j: { ...defaultSettings.neo4j, ...settings.neo4j },
        // NEW: Per-stage configs with deep merge
        stageConfigs: {
          stage1: { ...defaultStageConfigs.stage1, ...settings.stageConfigs?.stage1 },
          stage2: { ...defaultStageConfigs.stage2, ...settings.stageConfigs?.stage2 },
          stage3: { ...defaultStageConfigs.stage3, ...settings.stageConfigs?.stage3 },
          stage4: { ...defaultStageConfigs.stage4, ...settings.stageConfigs?.stage4 },
          stage5: { ...defaultStageConfigs.stage5, ...settings.stageConfigs?.stage5 },
        },
        councilSettings: { ...defaultSettings.councilSettings, ...settings.councilSettings },
        // LEGACY
        council: { 
          ...defaultSettings.council, 
          ...migratedCouncil,
          ...settings.council 
        },
        stageExecution: { ...defaultSettings.stageExecution, ...settings.stageExecution },
        stage1Layers: mergeStage1Layers(settings.stage1Layers),
      };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  
  // Overlay environment variables (env takes precedence over file values)
  return overlayEnvSecrets(mergedSettings);
}

// Save settings to file (secrets are sanitized - never written to disk)
export function saveSettings(settings: Settings): void {
  try {
    // Sanitize secrets before writing - never persist API keys or passwords to disk
    const sanitizedSettings: Settings = {
      ...settings,
      openrouter: {
        ...settings.openrouter,
        apiKey: '', // Never persist API keys
      },
      openai: {
        ...settings.openai,
        apiKey: '', // Never persist API keys
      },
      neo4j: {
        ...settings.neo4j,
        password: '', // Never persist passwords
      },
    };
    
    writeFileSync(CONFIG_PATH, JSON.stringify(sanitizedSettings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving settings:', error);
    throw new Error('Failed to save settings');
  }
}

// Get current settings (cached)
let cachedSettings: Settings | null = null;

export function getSettings(): Settings {
  if (!cachedSettings) {
    console.log('[Config] Loading settings from file (cache was empty)...');
    cachedSettings = loadSettings();
    console.log('[Config] Loaded stageConfigs:', JSON.stringify(cachedSettings.stageConfigs, null, 2));
  }
  return cachedSettings;
}

// Update settings and clear cache
export function updateSettings(newSettings: Partial<Settings>): Settings {
  const current = loadSettings();
  const updated: Settings = {
    ...current,
    ...newSettings,
    openrouter: { ...current.openrouter, ...newSettings.openrouter },
    openai: { ...current.openai, ...newSettings.openai },
    ollama: { 
      ...current.ollama, 
      ...newSettings.ollama,
      options: { ...current.ollama?.options, ...newSettings.ollama?.options }
    },
    models: { ...current.models, ...newSettings.models },
    neo4j: { ...current.neo4j, ...newSettings.neo4j },
    // NEW: Per-stage configs with deep merge
    stageConfigs: {
      stage1: { ...current.stageConfigs.stage1, ...newSettings.stageConfigs?.stage1 },
      stage2: { ...current.stageConfigs.stage2, ...newSettings.stageConfigs?.stage2 },
      stage3: { ...current.stageConfigs.stage3, ...newSettings.stageConfigs?.stage3 },
      stage4: { ...current.stageConfigs.stage4, ...newSettings.stageConfigs?.stage4 },
      stage5: { ...current.stageConfigs.stage5, ...newSettings.stageConfigs?.stage5 },
    },
    councilSettings: { ...current.councilSettings, ...newSettings.councilSettings },
    // LEGACY
    council: { ...current.council, ...newSettings.council },
    stageExecution: { ...current.stageExecution, ...newSettings.stageExecution },
    stage1Layers: newSettings.stage1Layers !== undefined
      ? mergeStage1Layers(newSettings.stage1Layers, current.stage1Layers)
      : current.stage1Layers,
  };
  saveSettings(updated);
  cachedSettings = updated;
  return updated;
}

/** Merge saved layer configs with defaults by id */
function mergeStage1Layers(
  saved?: Stage1LayerConfig[],
  previous?: Stage1LayerConfig[]
): Stage1LayerConfig[] {
  const base = defaultStage1Layers;
  const source = saved ?? previous ?? base;
  return base.map((def) => {
    const fromSaved = source.find((l) => l.id === def.id);
    return fromSaved ? { ...def, ...fromSaved } : def;
  });
}

export function getStage1LayerConfigs(): Stage1LayerConfig[] {
  const settings = getSettings();
  return [...(settings.stage1Layers ?? defaultStage1Layers)].sort((a, b) => a.order - b.order);
}

export function getStage1LayerConfig(layerId: string): Stage1LayerConfig | undefined {
  return getStage1LayerConfigs().find((l) => l.id === layerId);
}

// Clear settings cache (useful after external changes)
export function clearSettingsCache(): void {
  console.log('[Config] Clearing settings cache...');
  cachedSettings = null;
}

// Type for recommended prompts response
export interface RecommendedPromptsResponse {
  global: {
    memberSystemPrompt: string;
    chairmanSystemPrompt: string;
  };
  stages: {
    [key: string]: {
      memberSystemPrompt: string;
      chairmanSystemPrompt: string;
      taskPrompt?: string;
      taskPrompt2?: string; // Only for stage1 (CLO Analysis prompt)
    };
  };
  stage1Layers?: {
    [layerId: string]: {
      memberSystemPrompt?: string;
      chairmanSystemPrompt?: string;
      taskPrompt?: string;
    };
  };
}

// Get recommended prompts (the built-in defaults that can be loaded by users)
export function getRecommendedPrompts(): RecommendedPromptsResponse {
  return {
    global: {
      memberSystemPrompt: DEFAULT_MEMBER_SYSTEM_PROMPT,
      chairmanSystemPrompt: DEFAULT_CHAIRMAN_SYSTEM_PROMPT
    },
    stages: {
      stage1: {
        memberSystemPrompt: STAGE_PROMPTS.stage1.member,
        chairmanSystemPrompt: STAGE_PROMPTS.stage1.chairman,
        taskPrompt: STAGE1_EXTRACTION_PROMPT,
        taskPrompt2: STAGE1_CLO_ANALYSIS_PROMPT
      },
      stage2: {
        memberSystemPrompt: STAGE_PROMPTS.stage2.member,
        chairmanSystemPrompt: STAGE_PROMPTS.stage2.chairman,
        taskPrompt: STAGE2_DECOMPOSITION_PROMPT
      },
      stage3: {
        memberSystemPrompt: STAGE_PROMPTS.stage3.member,
        chairmanSystemPrompt: STAGE_PROMPTS.stage3.chairman,
        taskPrompt: STAGE3_ADAPTIVE_PROMPT
      },
      stage4: {
        memberSystemPrompt: STAGE_PROMPTS.stage4.member,
        chairmanSystemPrompt: STAGE_PROMPTS.stage4.chairman,
        taskPrompt: STAGE4_CONTENT_PROMPT
      },
      stage5: {
        memberSystemPrompt: STAGE_PROMPTS.stage5.member,
        chairmanSystemPrompt: STAGE_PROMPTS.stage5.chairman
        // Stage 5 has no task prompt
      }
    },
    stage1Layers: Object.fromEntries(
      defaultStage1Layers.map((layer) => [
        layer.id,
        {
          memberSystemPrompt: layer.memberSystemPrompt,
          chairmanSystemPrompt: layer.chairmanSystemPrompt,
          taskPrompt: layer.taskPrompt,
        },
      ])
    ),
  };
}
