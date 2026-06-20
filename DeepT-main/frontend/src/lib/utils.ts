import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Register our custom font-size tokens (see tailwind.config.js `fontSize`) with
// tailwind-merge. Without this, classes like `text-caption`/`text-fine-print`
// are mistaken for text-color utilities and conflict with `text-white` /
// `text-primary`, silently stripping the color (e.g. black text on blue buttons).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['body', 'caption', 'fine-print'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const STAGE_NAMES = [
  '',
  'Extraction & Contract',
  'Node Decomposition',
  'Adaptive Logic',
  'Content Generation',
  'Assembly & Export',
]

export const NODE_TYPE_COLORS: Record<string, string> = {
  concept: 'bg-blue-500',
  principle: 'bg-purple-500',
  procedure: 'bg-orange-500',
  application: 'bg-green-500',
  practice: 'bg-yellow-500',
  assessment: 'bg-red-500',
  remediation: 'bg-pink-500',
}

export const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
]

export const KNOWLEDGE_TYPES = [
  'Factual',
  'Conceptual',
  'Procedural',
  'Metacognitive',
]
