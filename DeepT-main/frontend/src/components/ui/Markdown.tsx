import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * Shared renderer for AI-generated markdown text (reports, rubrics, policies…).
 *
 * The app does not ship the `@tailwindcss/typography` plugin, so `prose-*`
 * utilities are no-ops. To guarantee that headers, bold text, lists, tables,
 * etc. are always visually formatted, every element is styled explicitly here.
 */

const components: Components = {
  h1: ({ node, ...props }) => (
    <h1
      className="mt-6 mb-3 border-b border-border pb-2 text-xl font-bold tracking-tight text-foreground first:mt-0"
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      className="mt-6 mb-2.5 flex items-center gap-2 text-lg font-bold text-primary first:mt-0"
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      className="mt-5 mb-1.5 text-sm font-semibold uppercase tracking-wide text-foreground/80 first:mt-0"
      {...props}
    />
  ),
  h4: ({ node, ...props }) => (
    <h4 className="mt-4 mb-1 text-sm font-semibold text-foreground first:mt-0" {...props} />
  ),
  p: ({ node, ...props }) => (
    <p className="my-2.5 text-sm leading-relaxed text-foreground/90 first:mt-0 last:mb-0" {...props} />
  ),
  strong: ({ node, ...props }) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
  em: ({ node, ...props }) => <em className="italic text-foreground/90" {...props} />,
  a: ({ node, ...props }) => (
    <a
      className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  ul: ({ node, ...props }) => (
    <ul className="my-2.5 ml-1 list-none space-y-1.5 text-sm text-foreground/90" {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className="my-2.5 ml-5 list-decimal space-y-1.5 text-sm text-foreground/90 marker:text-primary marker:font-semibold" {...props} />
  ),
  li: ({ node, children, ...props }) => (
    <li
      className="relative pl-5 leading-relaxed before:absolute before:left-0 before:top-[0.55em] before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full before:bg-primary/60 [ol_&]:pl-1 [ol_&]:before:hidden"
      {...props}
    >
      {children}
    </li>
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-3 border-l-4 border-primary/40 bg-muted/40 py-1 pl-4 pr-3 text-sm italic text-muted-foreground"
      {...props}
    />
  ),
  hr: ({ node, ...props }) => <hr className="my-5 border-border" {...props} />,
  code: ({ node, className, children, ...props }) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code className={cn('font-mono text-[13px]', className)} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ node, ...props }) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 text-[13px] leading-relaxed text-foreground"
      {...props}
    />
  ),
  table: ({ node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-muted/60" {...props} />,
  th: ({ node, ...props }) => (
    <th
      className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-foreground"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td className="border-b border-border px-3 py-2 align-top text-foreground/90" {...props} />
  ),
  tr: ({ node, ...props }) => <tr className="even:bg-muted/20" {...props} />,
}

export interface MarkdownProps {
  children: string | null | undefined
  className?: string
}

function MarkdownImpl({ children, className }: MarkdownProps) {
  if (!children?.trim()) return null
  return (
    <div className={cn('text-sm text-foreground/90', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = memo(MarkdownImpl)
export default Markdown
