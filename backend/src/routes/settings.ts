import { Router, Request, Response } from 'express';
import pg from 'pg';
import { getSettings, updateSettings, clearSettingsCache, getRecommendedPrompts } from '../config.js';
import { initNeo4j } from '../services/neo4j.service.js';
import { checkEmbeddingHealth } from '../services/embedding.service.js';
import { getPostgresStatus } from '../db/client.js';
import { recordAudit } from '../services/audit.service.js';
import type { Settings } from '../models/schemas.js';

const router = Router();

/**
 * Mask the Postgres connection for display. The connection string and password
 * are secrets, so we never echo them; we return a masked placeholder when set so
 * the UI can show "configured" without leaking the value. A masked echo on PUT is
 * treated as "no change" (see chooseSecret in config.ts).
 */
function maskPostgres(pgSettings: Settings['postgres']): Settings['postgres'] {
  return {
    ...pgSettings,
    connectionString: pgSettings.connectionString
      ? `${pgSettings.connectionString.slice(0, 12)}...${pgSettings.connectionString.slice(-4)}`
      : '',
    password: pgSettings.password ? '********' : '',
  };
}

/** Field names whose VALUES must never be written to the audit log. */
const SETTINGS_SECRET_FIELDS = new Set(['openrouter', 'openai', 'neo4j', 'postgres']);

/** Top-level setting keys present in a partial update (for audit metadata). */
function changedSettingKeys(updates: Partial<Settings>): string[] {
  return Object.keys(updates || {});
}

function neo4jCredentialsChanged(
  before: Settings['neo4j'],
  updates: Partial<Settings['neo4j']> | undefined
): boolean {
  if (!updates) return false;
  const passwordChanged =
    updates.password !== undefined &&
    updates.password !== '' &&
    updates.password !== '********' &&
    updates.password !== before.password;
  return (
    (updates.uri !== undefined && updates.uri !== before.uri) ||
    (updates.user !== undefined && updates.user !== before.user) ||
    passwordChanged
  );
}

// GET /api/settings/embedding-health - live embedding/RAG provider probe.
// Makes the silent-failure mode visible so empty grounding can never again be
// mistaken for "weak grounding" when the real cause is the embedding provider.
router.get('/embedding-health', async (_req: Request, res: Response) => {
  try {
    const health = await checkEmbeddingHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Embedding health check failed',
    });
  }
});

// GET /api/settings - Get current settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    
    // Mask sensitive data for display
    const maskedSettings = {
      ...settings,
      openrouter: {
        ...settings.openrouter,
        apiKey: settings.openrouter.apiKey 
          ? `${settings.openrouter.apiKey.substring(0, 12)}...${settings.openrouter.apiKey.slice(-4)}`
          : ''
      },
      openai: {
        ...settings.openai,
        apiKey: settings.openai?.apiKey 
          ? `${settings.openai.apiKey.substring(0, 7)}...${settings.openai.apiKey.slice(-4)}`
          : ''
      },
      ollama: settings.ollama,
      neo4j: {
        ...settings.neo4j,
        password: settings.neo4j.password ? '********' : ''
      },
      postgres: maskPostgres(settings.postgres),
    };
    
    res.json(maskedSettings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/raw - Get raw settings (for internal use)
router.get('/raw', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings - Update settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const updates: Partial<Settings> = req.body;
    const neo4jBefore = { ...getSettings().neo4j };
    
    // Log incoming model updates for debugging
    if (updates.models) {
      console.log('[Settings] Updating models:', JSON.stringify(updates.models));
    }
    
    // Log stageConfigs updates
    if (updates.stageConfigs) {
      console.log('[Settings] Updating stageConfigs:', JSON.stringify(updates.stageConfigs, null, 2));
    }
    
    // Update settings
    const updated = await updateSettings(updates);
    
    console.log('[Settings] Updated stageConfigs in memory:', JSON.stringify(updated.stageConfigs, null, 2));
    
    let warning: string | undefined;
    if (neo4jCredentialsChanged(neo4jBefore, updates.neo4j)) {
      try {
        await initNeo4j();
      } catch (neo4jError) {
        warning =
          'Neo4j reconnection failed: ' +
          (neo4jError instanceof Error ? neo4jError.message : String(neo4jError));
      }
    }
    
    // Return masked settings
    const maskedSettings = {
      ...updated,
      openrouter: {
        ...updated.openrouter,
        apiKey: updated.openrouter.apiKey 
          ? `${updated.openrouter.apiKey.substring(0, 12)}...${updated.openrouter.apiKey.slice(-4)}`
          : ''
      },
      openai: {
        ...updated.openai,
        apiKey: updated.openai?.apiKey 
          ? `${updated.openai.apiKey.substring(0, 7)}...${updated.openai.apiKey.slice(-4)}`
          : ''
      },
      ollama: updated.ollama,
      neo4j: {
        ...updated.neo4j,
        password: updated.neo4j.password ? '********' : ''
      },
      postgres: maskPostgres(updated.postgres),
    };

    const changedKeys = changedSettingKeys(updates);
    void recordAudit(req, {
      action: 'settings.update',
      category: 'settings',
      entityType: 'app_settings',
      summary: `Updated settings: ${changedKeys.join(', ') || '(none)'}`,
      metadata: {
        changed: changedKeys,
        // Flag which secret-bearing sections were touched, never their values.
        secrets_touched: changedKeys.filter((k) => SETTINGS_SECRET_FIELDS.has(k)),
      },
    });
    
    res.json({ 
      message: 'Settings updated successfully',
      settings: maskedSettings,
      warning,
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to update settings' 
    });
  }
});

// POST /api/settings/refresh - Force refresh settings cache
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    console.log('[Settings] Force refreshing settings cache...');
    clearSettingsCache();
    const settings = getSettings();
    console.log('[Settings] Refreshed stageConfigs:', JSON.stringify(settings.stageConfigs, null, 2));
    res.json({ 
      success: true, 
      message: 'Settings cache refreshed',
      stageConfigs: settings.stageConfigs
    });
  } catch (error) {
    console.error('Error refreshing settings:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to refresh settings' 
    });
  }
});

// GET /api/settings/council-debug - Debug council configuration for all stages
router.get('/council-debug', async (_req: Request, res: Response) => {
  try {
    // Force refresh to get latest settings
    clearSettingsCache();
    const settings = getSettings();
    
    const stageConfigs: Record<string, {
      mode: string;
      councilModels: string[];
      modelCount: number;
      chairmanModel: string;
      singleModel: string;
    }> = {};
    
    for (let stage = 1; stage <= 5; stage++) {
      const key = `stage${stage}` as keyof typeof settings.stageConfigs;
      const config = settings.stageConfigs[key];
      stageConfigs[key] = {
        mode: config.mode,
        councilModels: config.councilModels || [],
        modelCount: (config.councilModels || []).length,
        chairmanModel: config.chairmanModel || '',
        singleModel: config.singleModel || ''
      };
    }
    
    res.json({
      success: true,
      message: 'Council configuration for all stages',
      stages: stageConfigs,
      summary: {
        stage1Models: stageConfigs.stage1.modelCount,
        stage2Models: stageConfigs.stage2.modelCount,
        stage3Models: stageConfigs.stage3.modelCount,
        stage4Models: stageConfigs.stage4.modelCount,
        stage5Models: stageConfigs.stage5.modelCount,
      }
    });
  } catch (error) {
    console.error('Error getting council debug info:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to get council debug info' 
    });
  }
});

// GET /api/settings/recommended-prompts - Get recommended system prompts
router.get('/recommended-prompts', async (_req: Request, res: Response) => {
  try {
    const prompts = getRecommendedPrompts();
    res.json({
      success: true,
      data: prompts
    });
  } catch (error) {
    console.error('Error fetching recommended prompts:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch recommended prompts' 
    });
  }
});

// POST /api/settings/test-neo4j - Test Neo4j connection
router.post('/test-neo4j', async (_req: Request, res: Response) => {
  try {
    await initNeo4j();
    res.json({ success: true, message: 'Neo4j connection successful' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    });
  }
});

// GET /api/settings/postgres-status - Live status of the ACTIVE Postgres pool.
// The active pool is created at startup; changes saved here apply on next restart
// (we never hot-swap the live pool mid-request). This surfaces that distinction.
router.get('/postgres-status', async (_req: Request, res: Response) => {
  try {
    res.json(getPostgresStatus());
  } catch (error) {
    res.status(500).json({
      connected: false,
      last_error: error instanceof Error ? error.message : 'Failed to read status',
    });
  }
});

// POST /api/settings/test-postgres - Validate a Postgres connection WITHOUT
// touching the live pool. Accepts an optional { connectionString } in the body so
// the admin can test the value they just typed (a masked/empty value falls back
// to the stored connection). This guards against saving a value that would brick
// the next boot.
router.post('/test-postgres', async (req: Request, res: Response) => {
  let pool: pg.Pool | null = null;
  try {
    const settings = getSettings();
    const bodyConn =
      typeof req.body?.connectionString === 'string' ? req.body.connectionString.trim() : '';
    const connectionString =
      bodyConn && !bodyConn.includes('...') ? bodyConn : settings.postgres.connectionString?.trim();
    if (!connectionString) {
      throw new Error('No Postgres connection string configured. Enter a value and try again.');
    }
    pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    res.json({ success: true, message: 'Postgres connection successful' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    });
  } finally {
    if (pool) await pool.end().catch(() => undefined);
  }
});

// POST /api/settings/test-openrouter - Test OpenRouter API
// Accepts an optional { apiKey, baseUrl } in the body so the UI can validate the
// key the user just typed (even before saving). Masked/empty values fall back to
// the stored key.
router.post('/test-openrouter', async (req: Request, res: Response) => {
  try {
    const settings = getSettings();

    const bodyKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const apiKey = (bodyKey && !bodyKey.includes('...')) ? bodyKey : settings.openrouter.apiKey?.trim();
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Enter your API key and try again.');
    }
    const baseUrl = (typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim())
      || settings.openrouter.baseUrl
      || 'https://openrouter.ai/api/v1';

    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenRouter error: ${errorMessage}`);
    }
    
    res.json({ success: true, message: 'OpenRouter API connection successful' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    });
  }
});

// POST /api/settings/test-ollama - Test Ollama connection
router.post('/test-ollama', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    const ollamaUrl = settings.ollama?.baseUrl || 'http://localhost:11434';
    
    console.log(`Testing Ollama connection at: ${ollamaUrl}/api/tags`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(`${ollamaUrl}/api/tags`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }
    
    const data = await response.json() as { models?: unknown[] };
    const modelCount = data.models?.length || 0;
    
    res.json({ 
      success: true, 
      message: `Ollama connection successful. Found ${modelCount} model(s).` 
    });
  } catch (error) {
    const settings = getSettings();
    const ollamaUrl = settings.ollama?.baseUrl || 'http://localhost:11434';
    
    let errorMessage = 'Connection failed.';
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = `Connection timed out. Is Ollama running at ${ollamaUrl}?`;
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = `Connection refused. Is Ollama running at ${ollamaUrl}?`;
      } else if (error.message.includes('fetch')) {
        errorMessage = `Network error connecting to ${ollamaUrl}. Check if Ollama is running.`;
      } else {
        errorMessage = error.message;
      }
    }
    
    console.error('Ollama connection test failed:', error);
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage
    });
  }
});

// POST /api/settings/test-openai - Test OpenAI API
// Accepts an optional { apiKey, baseUrl } in the body so the UI can validate the
// key the user just typed (even before saving). Masked/empty values fall back to
// the stored key.
router.post('/test-openai', async (req: Request, res: Response) => {
  try {
    const settings = getSettings();

    const bodyKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const apiKey = (bodyKey && !bodyKey.includes('...')) ? bodyKey : settings.openai?.apiKey?.trim();
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please enter your API key and try again.');
    }
    
    const baseUrl = (typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim())
      || settings.openai?.baseUrl
      || 'https://api.openai.com/v1';
    
    console.log(`Testing OpenAI connection at: ${baseUrl}/models`);
    
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string; type?: string; code?: string } };
      const errorMessage = errorData.error?.message || `HTTP ${response.status}`;
      const errorCode = errorData.error?.code || '';
      
      console.error('OpenAI API error response:', JSON.stringify(errorData));
      
      // Show the actual error from OpenAI
      throw new Error(`OpenAI error: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`);
    }
    
    const data = await response.json() as { data?: unknown[] };
    const modelCount = data.data?.length || 0;
    
    res.json({ success: true, message: `OpenAI API connection successful. Found ${modelCount} models.` });
  } catch (error) {
    console.error('OpenAI connection test failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    });
  }
});

// OpenRouter model interface (based on OpenRouter API docs)
interface OpenRouterModel {
  id: string;
  name?: string;
  canonical_slug?: string;
  description?: string;
  context_length?: number;
  created?: number;
  pricing?: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

// Processed model for frontend
interface ProcessedModel {
  id: string;
  name: string;
  shortName: string;
  description: string;
  contextLength: number;
  maxOutput: number;
  promptPrice: number;
  completionPrice: number;
  isFree: boolean;
  provider: string;
  modality: string;
}

// Helper function to format a model name from its ID
function formatModelName(id: string, providedName?: string): { name: string; shortName: string; provider: string } {
  // Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
  const parts = id.split('/');
  const provider = parts[0] || 'unknown';
  
  // Get the model part (e.g., "gpt-4" or "gpt-4:free")
  let modelPart = parts.slice(1).join('/') || id;
  
  // Remove :free suffix for display
  const cleanModelPart = modelPart.replace(/:free$/i, '');
  
  // If we have a provided name, use it
  if (providedName && providedName.trim()) {
    return {
      name: providedName,
      shortName: cleanModelPart,
      provider
    };
  }
  
  // Otherwise, create a readable name from the ID
  // Convert "gpt-4-turbo" to "GPT 4 Turbo"
  const formattedName = cleanModelPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  return {
    name: `${provider.charAt(0).toUpperCase() + provider.slice(1)}: ${formattedName}`,
    shortName: cleanModelPart,
    provider
  };
}

// GET /api/settings/models - Get available models from OpenRouter
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    
    const response = await fetch(`${settings.openrouter.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${settings.openrouter.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json() as { data: OpenRouterModel[] };
    
    console.log(`Loaded ${data.data?.length || 0} models from OpenRouter`);
    
    // Return rich model data with pricing and metadata
    const models: ProcessedModel[] = (data.data || []).map((m: OpenRouterModel) => {
      const promptPrice = parseFloat(m.pricing?.prompt || '0');
      const completionPrice = parseFloat(m.pricing?.completion || '0');
      
      // Check if model is free:
      // 1. Model ID contains ":free" suffix (OpenRouter convention)
      // 2. Both prompt and completion prices are 0
      const hasFreeTag = m.id.toLowerCase().includes(':free');
      const zeroPricing = promptPrice === 0 && completionPrice === 0;
      const isFree = hasFreeTag || zeroPricing;
      
      // Get formatted name and provider
      const { name, shortName, provider } = formatModelName(m.id, m.name);
      
      return {
        id: m.id,
        name,
        shortName,
        description: m.description || '',
        contextLength: m.context_length || m.top_provider?.context_length || 0,
        maxOutput: m.top_provider?.max_completion_tokens || 0,
        promptPrice,
        completionPrice,
        isFree,
        provider,
        modality: m.architecture?.modality || 'text->text'
      };
    });
    
    // Sort by provider then by name
    models.sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.name.localeCompare(b.name);
    });
    
    console.log(`Returning ${models.length} processed models, ${models.filter(m => m.isFree).length} free`);
    
    res.json(models);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch models' 
    });
  }
});

// Ollama model interface
interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

// GET /api/settings/models/ollama - Get available models from Ollama
router.get('/models/ollama', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    
    const response = await fetch(`${settings.ollama.baseUrl}/api/tags`);
    
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}. Is Ollama running?`);
    }
    
    const data = await response.json() as { models: OllamaModel[] };
    
    console.log(`Loaded ${data.models?.length || 0} models from Ollama`);
    
    // Transform to match ProcessedModel format
    const models: ProcessedModel[] = (data.models || []).map((m: OllamaModel) => {
      // Extract provider/family from model name or details
      const nameParts = m.name.split(':');
      const baseName = nameParts[0];
      const tag = nameParts[1] || 'latest';
      
      // Try to determine provider from model family or name
      let provider = 'ollama';
      if (m.details?.family) {
        provider = m.details.family.toLowerCase();
      } else if (baseName.includes('/')) {
        provider = baseName.split('/')[0];
      }
      
      // Format size for display
      const sizeGB = m.size / (1024 * 1024 * 1024);
      const sizeStr = sizeGB >= 1 ? `${sizeGB.toFixed(1)}GB` : `${(m.size / (1024 * 1024)).toFixed(0)}MB`;
      
      // Try to extract context length from parameter size or default
      let contextLength = 4096;
      if (m.details?.parameter_size) {
        // Larger models typically have larger context
        const paramMatch = m.details.parameter_size.match(/(\d+)/);
        if (paramMatch) {
          const params = parseInt(paramMatch[1]);
          if (params >= 70) contextLength = 32768;
          else if (params >= 13) contextLength = 8192;
        }
      }
      
      return {
        id: m.name,
        name: `${baseName} (${tag})`,
        shortName: baseName,
        description: `${m.details?.parameter_size || 'Unknown size'} • ${m.details?.quantization_level || 'Unknown quant'} • ${sizeStr}`,
        contextLength,
        maxOutput: Math.min(contextLength, 4096),
        promptPrice: 0,
        completionPrice: 0,
        isFree: true, // Ollama is always free (local)
        provider,
        modality: 'text->text'
      };
    });
    
    // Sort by provider then by name
    models.sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.name.localeCompare(b.name);
    });
    
    console.log(`Returning ${models.length} Ollama models`);
    
    res.json(models);
  } catch (error) {
    console.error('Error fetching Ollama models:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch models. Is Ollama running?' 
    });
  }
});

// OpenAI model interface
interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

// GET /api/settings/models/openai - Get available models from OpenAI
router.get('/models/openai', async (_req: Request, res: Response) => {
  try {
    const settings = getSettings();
    
    if (!settings.openai?.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    const response = await fetch(`${settings.openai.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${settings.openai.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API returned ${response.status}`);
    }
    
    const data = await response.json() as { data: OpenAIModel[] };
    
    console.log(`Loaded ${data.data?.length || 0} models from OpenAI`);
    
    // Filter to only include GPT models (chat completion models)
    const chatModels = (data.data || []).filter((m: OpenAIModel) => 
      m.id.startsWith('gpt-') || 
      m.id.startsWith('o1') || 
      m.id.startsWith('o3') ||
      m.id.includes('chatgpt')
    );
    
    // Transform to match ProcessedModel format
    const models: ProcessedModel[] = chatModels.map((m: OpenAIModel) => {
      // Determine context length based on model name
      let contextLength = 4096;
      let maxOutput = 4096;
      
      if (m.id.includes('gpt-4o')) {
        contextLength = 128000;
        maxOutput = 16384;
      } else if (m.id.includes('gpt-4-turbo') || m.id.includes('gpt-4-1106') || m.id.includes('gpt-4-0125')) {
        contextLength = 128000;
        maxOutput = 4096;
      } else if (m.id.includes('gpt-4-32k')) {
        contextLength = 32768;
        maxOutput = 4096;
      } else if (m.id.includes('gpt-4')) {
        contextLength = 8192;
        maxOutput = 4096;
      } else if (m.id.includes('gpt-3.5-turbo-16k')) {
        contextLength = 16384;
        maxOutput = 4096;
      } else if (m.id.includes('gpt-3.5-turbo')) {
        contextLength = 16385;
        maxOutput = 4096;
      } else if (m.id.startsWith('o1') || m.id.startsWith('o3')) {
        contextLength = 128000;
        maxOutput = 32768;
      }
      
      // Format name nicely
      const formattedName = m.id
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      return {
        id: m.id,
        name: `OpenAI: ${formattedName}`,
        shortName: m.id,
        description: `Owned by: ${m.owned_by}`,
        contextLength,
        maxOutput,
        promptPrice: 0, // OpenAI doesn't expose pricing in API
        completionPrice: 0,
        isFree: false,
        provider: 'openai',
        modality: 'text->text'
      };
    });
    
    // Sort by model name
    models.sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`Returning ${models.length} OpenAI chat models`);
    
    res.json(models);
  } catch (error) {
    console.error('Error fetching OpenAI models:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch models' 
    });
  }
});

export default router;
