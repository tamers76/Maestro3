/**
 * AI Service
 * 
 * This module provides the unified AI execution interface for all stages.
 * It uses the council service under the hood, which supports both:
 * - Single model execution (council-of-1)
 * - Multi-member council with chairman synthesis
 */

import type { StageNumber, StageExecutionMode, StageModelConfig } from '../models/schemas.js';
import { 
  executeWithCouncil, 
  callModel,
  getCouncilInfo,
  getStageConfig,
  resolveStage1IntakeConfig,
  mergeIntakeConfig,
  type AIMessage, 
  type CouncilOptions,
  type CouncilProgressCallback
} from './council.service.js';

// Re-export types and functions from council service
export { AIMessage, CouncilOptions, CouncilProgressCallback } from './council.service.js';
export { callModel, getCouncilInfo, getStageConfig, resolveStage1IntakeConfig, mergeIntakeConfig } from './council.service.js';

/**
 * Main AI call function - unified entry point for all stage execution
 * 
 * This function routes through the council pipeline, which handles both:
 * - Single model execution (when stageExecution is 'single' or council has 1 member)
 * - Multi-member council execution with chairman synthesis
 * 
 * @param messages - The messages to send to the AI
 * @param stage - The stage number (1-5)
 * @param options - Additional options (maxTokens, jsonMode, progressCallback)
 * @param executionOverride - Optional override for execution mode ('single' or 'council')
 * @returns The final AI response
 */
export async function callAI(
  messages: AIMessage[],
  stage: StageNumber,
  options: {
    maxTokens?: number;
    jsonMode?: boolean;
    progressCallback?: CouncilProgressCallback;
  } = {},
  executionOverride?: StageExecutionMode,
  configOverride?: StageModelConfig
): Promise<string> {
  return executeWithCouncil(messages, stage, options, executionOverride, configOverride);
}

// Parse JSON from AI response (handles markdown code blocks, surrounding text, and common issues)
export function parseAIJson<T>(response: string): T {
  let cleaned = response.trim();
  
  // Log original response for debugging
  console.log('[parseAIJson] Raw response length:', response.length);
  
  // Handle multiple possible markdown code block formats
  // Try to find the most specific match first (```json), then generic (```)
  const jsonBlockMatch = cleaned.match(/```json\s*([\s\S]*?)```/) || 
                          cleaned.match(/```\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
    console.log('[parseAIJson] Extracted from code block');
  }
  
  // Remove common chairman synthesis prefixes/text that might appear before JSON
  // These patterns handle typical LLM explanatory text
  const prefixPatterns = [
    /^(?:Here(?:'s| is) (?:the |my )?(?:synthesized |final |combined )?(?:response|output|answer|JSON|result)[:\s]*)/i,
    /^(?:Based on (?:the )?(?:council )?(?:member )?responses?[,:\s]*)/i,
    /^(?:After (?:reviewing|analyzing|synthesizing)[^{[]*)/i,
    /^(?:The (?:synthesized |final |combined )?(?:response|output|answer|JSON|result) is[:\s]*)/i,
  ];
  
  for (const pattern of prefixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.trim();
  
  // If response still starts with explanatory text, find JSON object/array start
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart > 0) {
    console.log('[parseAIJson] Skipping', jsonStart, 'chars of preamble text');
    cleaned = cleaned.slice(jsonStart);
  } else if (jsonStart === -1) {
    console.error('[parseAIJson] No JSON structure found in response');
    console.error('[parseAIJson] Cleaned response preview:', cleaned.substring(0, 300));
    throw new Error(`No JSON object or array found in response: ${cleaned.substring(0, 200)}...`);
  }
  
  // Find the matching closing bracket to avoid grabbing extra content
  const firstChar = cleaned[0];
  if (firstChar === '{' || firstChar === '[') {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let lastValidEnd = -1;
    
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{' || char === '[') {
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth === 0) {
            lastValidEnd = i;
            break;
          }
        }
      }
    }
    
    if (lastValidEnd > 0) {
      cleaned = cleaned.slice(0, lastValidEnd + 1);
      console.log('[parseAIJson] Trimmed to', cleaned.length, 'chars');
    } else if (lastValidEnd === -1) {
      console.warn('[parseAIJson] Could not find matching closing bracket, JSON may be truncated');
    }
  }
  
  // Remove control characters that break JSON parsing (except valid whitespace)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Replace smart quotes and other Unicode quote variants with ASCII quotes
  cleaned = cleaned.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'); // Various double quotes
  cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"); // Various single quotes
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-'); // En-dash and em-dash to regular dash
  cleaned = cleaned.replace(/\u2026/g, '...'); // Ellipsis to three dots
  
  // Fix mismatched brackets (AI sometimes closes { with ] or [ with })
  cleaned = fixMismatchedBrackets(cleaned);
  
  // Try to parse
  try {
    return JSON.parse(cleaned) as T;
  } catch (firstError) {
    const errorMsg = (firstError as Error).message;
    const errorMatch = errorMsg.match(/position (\d+)/);
    const errorPos = errorMatch ? parseInt(errorMatch[1], 10) : -1;
    
    // Log context around error position for debugging
    if (errorPos > 0) {
      const contextStart = Math.max(0, errorPos - 100);
      const contextEnd = Math.min(cleaned.length, errorPos + 100);
      console.error(`[parseAIJson] JSON error at position ${errorPos}. Context:`);
      console.error('...', cleaned.substring(contextStart, errorPos), '<<<ERROR>>>', cleaned.substring(errorPos, contextEnd), '...');
    }
    
    console.log('[parseAIJson] First parse attempt failed, trying fixes...');
    
    // Try fixing common issues
    let fixed = cleaned;
    
    // Fix trailing commas before closing brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix unescaped newlines in strings (common LLM issue)
    fixed = fixed.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
      return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    });
    
    // Fix single quotes used as string delimiters (convert to double quotes)
    if (!fixed.includes('"') && fixed.includes("'")) {
      fixed = fixed.replace(/'/g, '"');
    }
    
    try {
      return JSON.parse(fixed) as T;
    } catch (secondError) {
      // Try fixing missing commas between properties
      let fixedCommas = fixed;
      fixedCommas = fixedCommas.replace(/(")\s+(")/g, '$1, $2');
      fixedCommas = fixedCommas.replace(/([}\]])\s+(")/g, '$1, $2');
      fixedCommas = fixedCommas.replace(/(\d)\s+(")/g, '$1, $2');
      fixedCommas = fixedCommas.replace(/(true|false|null)\s+(")/gi, '$1, $2');
      
      try {
        return JSON.parse(fixedCommas) as T;
      } catch (thirdError) {
        // Try position-based fix
        if (errorPos > 0 && errorPos < cleaned.length) {
          const beforeError = cleaned.substring(0, errorPos);
          const afterError = cleaned.substring(errorPos);
          const lastNonWhitespace = beforeError.trimEnd();
          const lastChar = lastNonWhitespace[lastNonWhitespace.length - 1];
          
          if (lastChar === '"' || lastChar === '}' || lastChar === ']' || 
              /[\d]/.test(lastChar) || lastNonWhitespace.endsWith('true') || 
              lastNonWhitespace.endsWith('false') || lastNonWhitespace.endsWith('null')) {
            const fixedAtPosition = lastNonWhitespace + ', ' + afterError.trimStart();
            try {
              return JSON.parse(fixedAtPosition) as T;
            } catch {
              // Continue to final fallback
            }
          }
        }
        
        // Final attempt: remove BOM/invisible chars and close unclosed brackets
        fixed = fixedCommas.replace(/^\uFEFF/, '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ');
        
        const openBraces = (fixed.match(/{/g) || []).length;
        const closeBraces = (fixed.match(/}/g) || []).length;
        const openBrackets = (fixed.match(/\[/g) || []).length;
        const closeBrackets = (fixed.match(/]/g) || []).length;
        
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          fixed += ']';
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
          fixed += '}';
        }
        
        try {
          return JSON.parse(fixed) as T;
        } catch {
          // Log detailed debugging info
          console.error('[parseAIJson] All parse attempts failed');
          console.error('[parseAIJson] First 500 chars:', cleaned.substring(0, 500));
          console.error('[parseAIJson] Last 500 chars:', cleaned.substring(Math.max(0, cleaned.length - 500)));
          console.error('[parseAIJson] First error:', firstError instanceof Error ? firstError.message : firstError);
          throw new Error(`Failed to parse JSON from response: ${cleaned.substring(0, 200)}...`);
        }
      }
    }
  }
}

/**
 * Fix mismatched brackets in JSON (e.g., { closed with ] or [ closed with })
 */
function fixMismatchedBrackets(json: string): string {
  const result: string[] = [];
  const bracketStack: { char: string; index: number }[] = [];
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    
    if (escapeNext) {
      escapeNext = false;
      result.push(char);
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      result.push(char);
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result.push(char);
      continue;
    }
    
    if (inString) {
      result.push(char);
      continue;
    }
    
    if (char === '{' || char === '[') {
      bracketStack.push({ char, index: result.length });
      result.push(char);
    } else if (char === '}' || char === ']') {
      if (bracketStack.length > 0) {
        const lastOpen = bracketStack.pop()!;
        const expectedClose = lastOpen.char === '{' ? '}' : ']';
        
        if (char !== expectedClose) {
          console.log(`[parseAIJson] Fixed bracket mismatch: expected '${expectedClose}' but found '${char}'`);
          result.push(expectedClose);
        } else {
          result.push(char);
        }
      } else {
        result.push(char);
      }
    } else {
      result.push(char);
    }
  }
  
  return result.join('');
}
