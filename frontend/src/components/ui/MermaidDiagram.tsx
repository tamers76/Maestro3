import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { AlertTriangle, Code2 } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

let mermaidInitializedFor: string | null = null

/**
 * Configure mermaid once per theme. `startOnLoad` is off because we render
 * imperatively via `mermaid.render`, and `securityLevel: 'strict'` keeps
 * LLM-authored diagram text from injecting markup/scripts.
 */
function ensureMermaidInitialized(theme: 'dark' | 'light') {
  if (mermaidInitializedFor === theme) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'inherit',
  })
  mermaidInitializedFor = theme
}

export interface MermaidDiagramProps {
  /** Mermaid diagram source (e.g. an LLM-generated `flowchart`, `pie`, `gantt`). */
  chart: string
  className?: string
  /** Show the raw source in a collapsible block when rendering fails. */
  showSourceOnError?: boolean
}

/**
 * Renders a Mermaid diagram from source text to inline SVG.
 *
 * Rendering is async (mermaid v10+ returns a promise) and fail-soft: malformed
 * syntax (common with LLM output) surfaces a friendly error + the offending
 * source instead of throwing. Re-renders when the chart text or theme changes.
 */
export function MermaidDiagram({ chart, className, showSourceOnError = true }: MermaidDiagramProps) {
  const { theme } = useTheme()
  const reactId = useId()
  // Mermaid needs a DOM-id-safe, unique id per render target.
  const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9-]/g, '')}`
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const source = chart?.trim()

    if (!source) {
      setSvg('')
      setError(null)
      return
    }

    async function render() {
      try {
        ensureMermaidInitialized(theme)
        // Validate first so a syntax error is caught before render side effects.
        await mermaid.parse(source)
        const { svg: out } = await mermaid.render(renderId, source)
        if (!cancelled) {
          setSvg(out)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setSvg('')
          setError(e instanceof Error ? e.message : 'Failed to render diagram')
        }
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [chart, theme, renderId])

  if (error) {
    return (
      <div className="space-y-2 rounded-[6px] border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Diagram could not be rendered
        </div>
        <p className="text-muted-foreground">{error}</p>
        {showSourceOnError && (
          <details>
            <summary className="flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
              <Code2 className="h-3 w-3" /> Show diagram source
            </summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground">
              {chart}
            </pre>
          </details>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('mermaid-diagram flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto', className)}
      // SVG is produced by mermaid with securityLevel: 'strict' (sanitized).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default MermaidDiagram
