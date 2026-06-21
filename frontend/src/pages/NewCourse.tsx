import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { showToast } from '@/components/ui/Toaster'
import { createCourse, createCourseFromForm } from '@/services/api'
import { Upload, FileText, Loader2, Plus, X, ArrowRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function NewCourse() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    course_code: '',
    title: '',
    description: '',
    credit_hours: 3,
    clos: [''],
  })
  const [submitting, setSubmitting] = useState(false)

  function openFilePicker() {
    if (uploading) return
    const input = fileInputRef.current
    if (!input) return

    // Prefer the native picker API when available; fall back to click for older browsers.
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }
    input.click()
  }
  
  // File upload handlers
  async function handleFileUpload(file: File) {
    if (!file) return
    
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    // Browsers (especially on Windows) often report an empty or generic MIME
    // type for .docx files, so fall back to the file extension.
    const name = file.name.toLowerCase()
    const hasValidExtension = name.endsWith('.pdf') || name.endsWith('.docx')
    const hasValidMime = validTypes.includes(file.type)
    
    if (!hasValidExtension && !hasValidMime) {
      showToast({
        title: 'Invalid File',
        description: 'Please upload a PDF or DOCX file',
        variant: 'destructive',
      })
      return
    }
    
    try {
      setUploading(true)
      const result = await createCourse(file)
      
      if (result.success) {
        showToast({
          title: 'Course Created',
          description: result.message,
          variant: 'success',
        })
        const courseCode = (result.data as { course_code: string })?.course_code
        if (courseCode) {
          navigate(`/courses/${encodeURIComponent(courseCode)}`)
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to process file'
      const friendly =
        msg.includes('401') || msg.includes('Authentication') || msg.includes('API key')
          ? 'AI API key missing or invalid. Add OPENAI_API_KEY or OPENROUTER_API_KEY to the repo-root .env and restart the app (npm run dev).'
          : msg
      showToast({
        title: 'Upload Failed',
        description: friendly,
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }
  
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileUpload(file)
  }
  
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
    // Allow re-selecting the same file name to trigger onChange again.
    e.target.value = ''
  }
  
  // Form handlers
  function addCLO() {
    setFormData(prev => ({ ...prev, clos: [...prev.clos, ''] }))
  }
  
  function removeCLO(index: number) {
    setFormData(prev => ({
      ...prev,
      clos: prev.clos.filter((_, i) => i !== index),
    }))
  }
  
  function updateCLO(index: number, value: string) {
    setFormData(prev => ({
      ...prev,
      clos: prev.clos.map((clo, i) => (i === index ? value : clo)),
    }))
  }
  
  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    const validCLOs = formData.clos.filter(clo => clo.trim())
    if (validCLOs.length === 0) {
      showToast({
        title: 'Validation Error',
        description: 'Please add at least one Course Learning Outcome',
        variant: 'destructive',
      })
      return
    }
    
    try {
      setSubmitting(true)
      const result = await createCourseFromForm({
        ...formData,
        clos: validCLOs,
      })
      
      if (result.success) {
        showToast({
          title: 'Course Created',
          description: result.message,
          variant: 'success',
        })
        navigate(`/courses/${encodeURIComponent(formData.course_code)}`)
      }
    } catch (error) {
      showToast({
        title: 'Creation Failed',
        description: error instanceof Error ? error.message : 'Failed to create course',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }
  
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground flex items-center gap-3">
          Create New Course
          <Sparkles className="h-6 w-6 text-primary" />
        </h1>
        <p className="mt-1 text-muted-foreground">
          Upload a syllabus document or enter course details manually
        </p>
      </div>
      
      <Tabs defaultValue="upload" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Syllabus
          </TabsTrigger>
          <TabsTrigger value="manual" className="gap-2">
            <FileText className="h-4 w-4" />
            Manual Entry
          </TabsTrigger>
        </TabsList>
        
        {/* Upload Tab */}
        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle>Upload Syllabus</CardTitle>
              <CardDescription>
                Upload a PDF or DOCX file containing your course syllabus.
                The system will automatically extract course information, CLOs, and more.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  'flex h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all cursor-pointer',
                  dragOver 
                    ? 'border-primary bg-primary/5 dark:bg-primary/10' 
                    : 'border-border hover:border-primary/50 hover:bg-muted/50',
                  uploading && 'pointer-events-none opacity-50'
                )}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={openFilePicker}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openFilePicker()
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="sr-only"
                  onClick={e => {
                    // Reset before open so choosing same file still emits change.
                    ;(e.currentTarget as HTMLInputElement).value = ''
                  }}
                  onChange={handleFileInputChange}
                />
                
                {uploading ? (
                  <>
                    <div className="relative">
                      <Loader2 className="h-12 w-12 animate-spin text-primary" />
                      <div className="absolute inset-0 h-12 w-12 animate-ping rounded-full bg-primary/20" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">
                      Processing syllabus...
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This may take a minute
                    </p>
                  </>
                ) : (
                  <>
                    <div className="rounded-full bg-muted p-4">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">
                      Drop your syllabus here or click to browse
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Supports PDF and DOCX files up to 50MB
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Manual Entry Tab */}
        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>Manual Entry</CardTitle>
              <CardDescription>
                Enter course details and learning outcomes manually.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleFormSubmit} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Course Code *
                    </label>
                    <Input
                      placeholder="e.g., CS101"
                      value={formData.course_code}
                      onChange={e => setFormData(prev => ({ ...prev, course_code: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Credit Hours
                    </label>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={formData.credit_hours}
                      onChange={e => setFormData(prev => ({ ...prev, credit_hours: parseInt(e.target.value) || 3 }))}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Course Title *
                  </label>
                  <Input
                    placeholder="e.g., Introduction to Computer Science"
                    value={formData.title}
                    onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Description
                  </label>
                  <Textarea
                    placeholder="Brief course description..."
                    rows={3}
                    value={formData.description}
                    onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      Course Learning Outcomes (CLOs) *
                    </label>
                    <Button type="button" variant="outline" size="sm" onClick={addCLO}>
                      <Plus className="mr-1 h-3 w-3" />
                      Add CLO
                    </Button>
                  </div>
                  
                  <div className="space-y-3">
                    {formData.clos.map((clo, index) => (
                      <div key={index} className="flex gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground">
                          {index + 1}
                        </div>
                        <Textarea
                          placeholder="e.g., Students will be able to analyze algorithms and determine their time complexity..."
                          rows={2}
                          value={clo}
                          onChange={e => updateCLO(index, e.target.value)}
                          className="flex-1"
                        />
                        {formData.clos.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCLO(index)}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button type="submit" disabled={submitting} className="gap-2 shadow-lg shadow-primary/25 dark:shadow-primary/10">
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    Create Course
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
