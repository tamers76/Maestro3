import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import type { Stage1LayerConfig, AIProvider } from '@/services/api'
import { ChevronDown, ChevronRight, User, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Stage1LayersConfigProps {
  layers: Stage1LayerConfig[]
  onChange: (layers: Stage1LayerConfig[]) => void
  provider: AIProvider
}

export default function Stage1LayersConfig({ layers, onChange, provider }: Stage1LayersConfigProps) {
  const [expandedId, setExpandedId] = useState<string | null>(layers[0]?.id ?? null)

  const sorted = [...layers].sort((a, b) => a.order - b.order)

  function updateLayer(id: string, patch: Partial<Stage1LayerConfig>) {
    onChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  return (
    <div className="space-y-3">
      {sorted.map((layer) => {
        const open = expandedId === layer.id
        return (
          <div key={layer.id} className="rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-4 text-left hover:bg-muted/50"
              onClick={() => setExpandedId(open ? null : layer.id)}
            >
              <div>
                <p className="font-medium text-foreground">
                  {layer.order}. {layer.name}
                </p>
                <p className="text-sm text-muted-foreground">{layer.productOutput}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                  {layer.mode === 'council' ? 'LLM Council' : 'Single Agent'}
                </span>
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </button>

            {open && (
              <div className="space-y-4 border-t border-border p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Layer name</label>
                    <Input
                      value={layer.name}
                      onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Product output</label>
                    <Input
                      value={layer.productOutput}
                      onChange={(e) => updateLayer(layer.id, { productOutput: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={layer.description}
                    onChange={(e) => updateLayer(layer.id, { description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Output fields (comma-separated)</label>
                  <Input
                    value={layer.outputFields.join(', ')}
                    onChange={(e) =>
                      updateLayer(layer.id, {
                        outputFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.approvalRequired}
                      onChange={(e) => updateLayer(layer.id, { approvalRequired: e.target.checked })}
                    />
                    SME approval required
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.regenerateEnabled}
                      onChange={(e) => updateLayer(layer.id, { regenerateEnabled: e.target.checked })}
                    />
                    Regenerate enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.editEnabled}
                      onChange={(e) => updateLayer(layer.id, { editEnabled: e.target.checked })}
                    />
                    Manual SME edit
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.lockNextUntilApproval}
                      onChange={(e) => updateLayer(layer.id, { lockNextUntilApproval: e.target.checked })}
                    />
                    Lock next until approval
                  </label>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={layer.mode === 'single' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateLayer(layer.id, { mode: 'single' })}
                    className="gap-1"
                  >
                    <User className="h-4 w-4" /> Single Agent
                  </Button>
                  <Button
                    type="button"
                    variant={layer.mode === 'council' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateLayer(layer.id, { mode: 'council' })}
                    className="gap-1"
                  >
                    <Users className="h-4 w-4" /> LLM Council
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Single model ID</label>
                    <Input
                      value={layer.singleModel}
                      onChange={(e) => updateLayer(layer.id, { singleModel: e.target.value })}
                      placeholder="anthropic/claude-sonnet-4"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chairman model ID</label>
                    <Input
                      value={layer.chairmanModel}
                      onChange={(e) => updateLayer(layer.id, { chairmanModel: e.target.value })}
                    />
                  </div>
                </div>

                {layer.mode === 'council' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Council models (comma-separated)</label>
                    <Input
                      value={layer.councilModels.join(', ')}
                      onChange={(e) =>
                        updateLayer(layer.id, {
                          councilModels: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                        })
                      }
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Task prompt</label>
                  <Textarea
                    value={layer.taskPrompt || ''}
                    onChange={(e) => updateLayer(layer.id, { taskPrompt: e.target.value })}
                    rows={6}
                    className="font-mono text-xs"
                  />
                </div>

                {layer.mode === 'council' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Council member prompt</label>
                      <Textarea
                        value={layer.memberSystemPrompt || ''}
                        onChange={(e) => updateLayer(layer.id, { memberSystemPrompt: e.target.value })}
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Chairman prompt</label>
                      <Textarea
                        value={layer.chairmanSystemPrompt || ''}
                        onChange={(e) => updateLayer(layer.id, { chairmanSystemPrompt: e.target.value })}
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                  </>
                )}

                <p className={cn('text-xs text-muted-foreground')}>
                  Provider: {provider} · Parent stage: {layer.parentStage} · Order: {layer.order}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
