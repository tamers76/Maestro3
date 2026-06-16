import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  listReferences,
  uploadReference,
  uploadReferenceFromLink,
  deleteReference,
  type ReferenceDocument,
  type ReferenceSourceType,
} from '@/services/api'
import { Loader2, Upload, Trash2, BookOpen, FileText, Link as LinkIcon, AlertTriangle } from 'lucide-react'

const SOURCE_TYPE_OPTIONS: { value: ReferenceSourceType; label: string }[] = [
  { value: 'textbook_chapter', label: 'Textbook chapter' },
  { value: 'paper', label: 'Paper' },
  { value: 'other', label: 'Other' },
]

interface ReferenceMaterialsPanelProps {
  courseCode: string
  /** When true, render without the outer card chrome/header so it can sit inside another card. */
  embedded?: boolean
  /** Notify the parent when the ingested-document count changes (e.g. to drive warnings). */
  onDocsChange?: (count: number) => void
}

/**
 * SME panel to upload (or link) institutionally-licensed reference materials
 * (PDF/DOCX) for a course. Ingestion runs the RAG pipeline (extract -> chunk ->
 * embed -> index) on the backend so generation can be grounded in actual text.
 */
export default function ReferenceMaterialsPanel({
  courseCode,
  embedded = false,
  onDocsChange,
}: ReferenceMaterialsPanelProps) {
  const [docs, setDocs] = useState<ReferenceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [titleEdited, setTitleEdited] = useState(false)
  const [sourceType, setSourceType] = useState<ReferenceSourceType>('textbook_chapter')
  const [linkUrl, setLinkUrl] = useState('')
  const [linking, setLinking] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const result = await listReferences(courseCode)
      setDocs(result)
      onDocsChange?.(result.length)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load reference materials',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode, onDocsChange])

  useEffect(() => {
    load()
  }, [load])

  // Auto-capture a sensible title from the file name (without extension),
  // unless the SME has manually edited the title field.
  const handleFileChange = (selected: File | null) => {
    setFile(selected)
    if (selected && !titleEdited) {
      setTitle(selected.name.replace(/\.[^.]+$/, ''))
    }
  }

  const resetForm = () => {
    setFile(null)
    setTitle('')
    setTitleEdited(false)
    setSourceType('textbook_chapter')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleUpload = async () => {
    if (!file) {
      showToast({ title: 'No file', description: 'Choose a PDF or DOCX first.', variant: 'destructive' })
      return
    }
    try {
      setUploading(true)
      const doc = await uploadReference(courseCode, file, {
        title: title.trim() || undefined,
        source_type: sourceType,
      })
      showToast({
        title: 'Reference ingested',
        description: `${doc.title} — ${doc.chunk_count} passages indexed`,
        variant: 'success',
      })
      resetForm()
      await load()
    } catch (error) {
      showToast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to ingest reference',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  const handleLink = async () => {
    const url = linkUrl.trim()
    if (!url) {
      showToast({ title: 'No link', description: 'Paste a PDF URL first.', variant: 'destructive' })
      return
    }
    try {
      setLinking(true)
      const doc = await uploadReferenceFromLink(courseCode, url, { source_type: sourceType })
      showToast({
        title: 'Reference ingested',
        description: `${doc.title} — ${doc.chunk_count} passages indexed`,
        variant: 'success',
      })
      setLinkUrl('')
      await load()
    } catch (error) {
      showToast({
        title: 'Link ingest failed',
        description: error instanceof Error ? error.message : 'Failed to ingest reference link',
        variant: 'destructive',
      })
    } finally {
      setLinking(false)
    }
  }

  const handleDelete = async (docId: string) => {
    try {
      await deleteReference(courseCode, docId)
      setDocs((prev) => {
        const next = prev.filter((d) => d.doc_id !== docId)
        onDocsChange?.(next.length)
        return next
      })
      showToast({ title: 'Removed', description: 'Reference deleted', variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete reference',
        variant: 'destructive',
      })
    }
  }

  const body = (
    <div className={embedded ? 'space-y-5' : 'p-6 space-y-5'}>
      {/* No-textbook warning (non-blocking) */}
      {!loading && docs.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="text-xs">
            No textbook ingested yet — Course Architect layers (especially Layers 2 and 6) will run
            without textbook grounding. Upload or link a textbook to ground them.
          </p>
        </div>
      )}

      {/* Upload / link form */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Title (auto-filled from file, editable)
            </label>
            <Input
              className="h-8 text-sm"
              placeholder="Captured from the uploaded file name"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleEdited(true)
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Source type
            </label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as ReferenceSourceType)}
            >
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleUpload} disabled={uploading || !file} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Ingesting…' : 'Upload & ingest'}
          </Button>
        </div>

        {/* Add from link (PDF URL) */}
        <div className="border-t border-border pt-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
            Add from link (PDF URL)
          </label>
          <div className="flex items-start gap-2">
            <Input
              className="h-8 flex-1 text-sm"
              placeholder="https://example.com/chapter.pdf"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleLink()
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleLink}
              disabled={linking || !linkUrl.trim()}
              className="gap-2"
            >
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              {linking ? 'Fetching…' : 'Add link'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Direct PDF links only. If the link is protected or requires login, download the file and
            upload it instead.
          </p>
        </div>
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reference materials uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.doc_id}
              className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div className="flex items-start gap-2 min-w-0">
                <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.chunk_count} passages ·{' '}
                    {SOURCE_TYPE_OPTIONS.find((o) => o.value === doc.source_type)?.label}
                    {doc.scope.clo_ids?.length ? ` · CLOs: ${doc.scope.clo_ids.join(', ')}` : ''}
                    {doc.scope.subtopic_ids?.length
                      ? ` · Subtopics: ${doc.scope.subtopic_ids.join(', ')}`
                      : ''}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={() => handleDelete(doc.doc_id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-primary" />
          <h4 className="font-semibold text-sm">Grounding materials (textbook / readings)</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Upload or link licensed readings (PDF/DOCX). Their actual text is chunked and indexed so
          Course Architect generation can be grounded in the source material.
        </p>
        {body}
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-6 py-4 border-b bg-muted/30">
        <BookOpen className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-base">Reference Materials</h3>
        <span className="text-sm text-muted-foreground">
          Upload licensed readings (PDF/DOCX) to ground generation in their actual text
        </span>
      </div>
      {body}
    </div>
  )
}
