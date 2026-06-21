/**
 * Canonical Modality Mapping for Stage 4 Content Generation
 * 
 * Maps learning node types to their appropriate content modalities,
 * video script types, and assessment configurations.
 * 
 * Updated for canonical 6-type taxonomy:
 * concept, principle, procedure, application, metacognitive, transfer
 */

import { NodeType, ContentModality, VideoScriptType, Stage4AssessmentType } from '../models/schemas';

// Modality configuration for each node type
export interface ModalityConfig {
  nodeType: string;
  primaryModalities: ContentModality[];
  videoType: VideoScriptType | null;
  hasVideo: boolean;
  assessmentTypes: Stage4AssessmentType[];
  contentFocus: string;
  estimatedMinutes: {
    content: number;
    video: number;
    assessment: number;
    practice: number;
  };
}

/**
 * Canonical modality mapping based on node type
 * 
 * | Node Type      | Primary Modalities           | Video Type      |
 * |----------------|------------------------------|-----------------|
 * | concept        | text, visual                 | explainer       |
 * | principle      | text, visual, interactive    | walkthrough     |
 * | procedure      | text, visual, interactive    | demonstration   |
 * | application    | text, interactive            | feedback        |
 * | metacognitive  | text, reflection             | explainer       |
 * | transfer       | text, interactive            | feedback        |
 */
export const MODALITY_MAP: Record<string, ModalityConfig> = {
  concept: {
    nodeType: 'concept',
    primaryModalities: ['text', 'visual'],
    videoType: 'explainer',
    hasVideo: true,
    assessmentTypes: ['pre_knowledge', 'formative_diagnostic', 'mastery_evidence'],
    contentFocus: 'Clear explanations with visual diagrams; foundational understanding',
    estimatedMinutes: {
      content: 20,
      video: 8,
      assessment: 15,
      practice: 10
    }
  },
  
  principle: {
    nodeType: 'principle',
    primaryModalities: ['text', 'visual', 'interactive'],
    videoType: 'walkthrough',
    hasVideo: true,
    assessmentTypes: ['pre_knowledge', 'formative_diagnostic', 'mastery_evidence'],
    contentFocus: 'Examples and reasoning checks; demonstrate relationships and rules',
    estimatedMinutes: {
      content: 25,
      video: 10,
      assessment: 20,
      practice: 15
    }
  },
  
  procedure: {
    nodeType: 'procedure',
    primaryModalities: ['text', 'visual', 'interactive'],
    videoType: 'demonstration',
    hasVideo: true,
    assessmentTypes: ['pre_knowledge', 'formative_diagnostic', 'mastery_evidence'],
    contentFocus: 'Step-by-step guided practice; procedural fluency',
    estimatedMinutes: {
      content: 30,
      video: 12,
      assessment: 20,
      practice: 25
    }
  },
  
  application: {
    nodeType: 'application',
    primaryModalities: ['text', 'interactive'],
    videoType: 'feedback',
    hasVideo: true,
    assessmentTypes: ['formative_diagnostic', 'mastery_evidence'],
    contentFocus: 'Scenario-based learning with justification; real-world context',
    estimatedMinutes: {
      content: 25,
      video: 8,
      assessment: 25,
      practice: 20
    }
  },
  
  metacognitive: {
    nodeType: 'metacognitive',
    primaryModalities: ['text', 'reflection'],
    videoType: null,              // Video not required per canonical spec
    hasVideo: false,              // Video not required per canonical spec
    assessmentTypes: ['formative_diagnostic'],
    contentFocus: 'Self-regulation, planning, and monitoring strategies; reflection prompts',
    estimatedMinutes: {
      content: 15,
      video: 0,
      assessment: 10,
      practice: 15
    }
  },
  
  transfer: {
    nodeType: 'transfer',
    primaryModalities: ['text', 'interactive'],
    videoType: null,              // Video not required per canonical spec
    hasVideo: false,              // Video not required per canonical spec
    assessmentTypes: ['formative_diagnostic', 'mastery_evidence'],
    contentFocus: 'Cross-domain application; novel scenario adaptation and synthesis',
    estimatedMinutes: {
      content: 25,
      video: 0,
      assessment: 20,
      practice: 20
    }
  }
};

// Default config for unknown/legacy node types
const DEFAULT_CONFIG: ModalityConfig = {
  nodeType: 'concept',
  primaryModalities: ['text', 'visual'],
  videoType: 'explainer',
  hasVideo: true,
  assessmentTypes: ['pre_knowledge', 'formative_diagnostic', 'mastery_evidence'],
  contentFocus: 'General instructional content',
  estimatedMinutes: {
    content: 20,
    video: 8,
    assessment: 15,
    practice: 10
  }
};

/**
 * Get modality configuration for a node type (handles legacy types gracefully)
 */
export function getModalityConfig(nodeType: string): ModalityConfig {
  return MODALITY_MAP[nodeType] || DEFAULT_CONFIG;
}

/**
 * Check if a node type should have video content
 */
export function shouldHaveVideo(nodeType: string): boolean {
  return getModalityConfig(nodeType).hasVideo;
}

/**
 * Get the video script type for a node type (or null if no video)
 */
export function getVideoScriptType(nodeType: string): VideoScriptType | null {
  return getModalityConfig(nodeType).videoType;
}

/**
 * Get assessment types appropriate for a node type
 */
export function getAssessmentTypes(nodeType: string): Stage4AssessmentType[] {
  return getModalityConfig(nodeType).assessmentTypes;
}

/**
 * Get content modalities for a node type
 */
export function getContentModalities(nodeType: string): ContentModality[] {
  return getModalityConfig(nodeType).primaryModalities;
}

/**
 * Get content focus description for a node type
 */
export function getContentFocus(nodeType: string): string {
  return getModalityConfig(nodeType).contentFocus;
}

/**
 * Estimate time-on-task for a node based on its type
 * Returns time in minutes
 */
export function estimateNodeTime(nodeType: string): number {
  const config = getModalityConfig(nodeType);
  return (
    config.estimatedMinutes.content +
    config.estimatedMinutes.video +
    config.estimatedMinutes.assessment +
    config.estimatedMinutes.practice
  );
}

/**
 * Get detailed time breakdown for a node type
 */
export function getTimeBreakdown(nodeType: string): {
  content: number;
  video: number;
  assessment: number;
  practice: number;
  total: number;
} {
  const config = getModalityConfig(nodeType);
  return {
    ...config.estimatedMinutes,
    total: estimateNodeTime(nodeType)
  };
}

/**
 * Video script type descriptions for prompts
 */
export const VIDEO_TYPE_DESCRIPTIONS: Record<VideoScriptType, string> = {
  explainer: 'An educational explainer video that introduces and explains the concept in an engaging, visual way. Focus on building understanding through clear narration and visual aids.',
  walkthrough: 'A walkthrough video that demonstrates the principle through step-by-step reasoning and examples. Show how the rule or relationship works in practice.',
  demonstration: 'A demonstration video showing the procedure being performed step-by-step. Include common mistakes to avoid and tips for success.',
  feedback: 'A feedback video that provides guidance on applying knowledge to scenarios. Include examples of good and poor applications with constructive feedback.'
};

/**
 * Assessment type descriptions for prompts
 */
export const ASSESSMENT_TYPE_DESCRIPTIONS: Record<Stage4AssessmentType, {
  name: string;
  purpose: string;
  adaptiveFunction: string;
  questionTypes: string[];
}> = {
  pre_knowledge: {
    name: 'Pre-Knowledge Check (Type A)',
    purpose: 'Determine whether learners already possess sufficient understanding to safely reduce repetition.',
    adaptiveFunction: 'May allow skipping or shortening of eligible content only where risk allows.',
    questionTypes: ['multiple_choice', 'true_false', 'short_answer']
  },
  formative_diagnostic: {
    name: 'Formative Diagnostic Check (Type B)',
    purpose: 'Interpret learner struggle during learning and identify the cause of misunderstanding.',
    adaptiveFunction: 'Route learners to targeted support paths.',
    questionTypes: ['multiple_choice', 'scenario', 'short_answer', 'reflection']
  },
  mastery_evidence: {
    name: 'Mastery Evidence Assessment (Type C)',
    purpose: 'Confirm that learners can demonstrate the capability defined in the learning outcome.',
    adaptiveFunction: 'Determine whether competence has been achieved.',
    questionTypes: ['scenario', 'short_answer', 'reflection', 'multiple_choice']
  }
};

/**
 * Get full modality summary for a node (used in prompts)
 */
export function getModalitySummary(nodeType: string): string {
  const config = getModalityConfig(nodeType);
  const parts: string[] = [];
  
  parts.push(`Primary Modalities: ${config.primaryModalities.join(', ')}`);
  parts.push(`Content Focus: ${config.contentFocus}`);
  
  if (config.hasVideo && config.videoType) {
    parts.push(`Video Type: ${config.videoType} - ${VIDEO_TYPE_DESCRIPTIONS[config.videoType]}`);
  }
  
  parts.push(`Assessment Types: ${config.assessmentTypes.map(t => ASSESSMENT_TYPE_DESCRIPTIONS[t].name).join(', ')}`);
  parts.push(`Estimated Time: ${estimateNodeTime(nodeType)} minutes total`);
  
  return parts.join('\n');
}
