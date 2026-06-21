import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HeyGenAvatarCharacter } from '@/services/api'
import { getCharacterPreviewImages } from '@/components/nodeEngine/heygenAvatarGroups'

interface HeyGenCharacterCardProps {
  character: HeyGenAvatarCharacter
  onOpen: () => void
  selected?: boolean
}

export function HeyGenCharacterCard({ character, onOpen, selected = false }: HeyGenCharacterCardProps) {
  const { main, thumbs } = getCharacterPreviewImages(character)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'group rounded-2xl p-1 relative isolate overflow-hidden cursor-pointer transition-transform hover:scale-[1.01]',
        'bg-white/5 dark:bg-black/90',
        'bg-gradient-to-br from-black/5 to-black/[0.02] dark:from-white/5 dark:to-white/[0.02]',
        'backdrop-blur-xl backdrop-saturate-[180%]',
        'border border-black/10 dark:border-white/10',
        'shadow-[0_4px_12px_rgb(0_0_0_/_0.12)] dark:shadow-[0_4px_12px_rgb(0_0_0_/_0.2)]',
        'hover:border-primary/25',
        selected && 'ring-2 ring-primary/50 border-primary/40'
      )}
    >
      <div
        className={cn(
          'rounded-xl overflow-hidden',
          'bg-gradient-to-br from-black/[0.04] to-transparent dark:from-white/[0.06] dark:to-transparent',
          'border border-black/[0.05] dark:border-white/[0.08]'
        )}
      >
        <div className="flex gap-1 p-1.5">
          <div className="relative flex-[3] min-w-0 aspect-[3/4] rounded-lg overflow-hidden bg-muted">
            {main ? (
              <img
                src={main}
                alt={character.name}
                className="h-full w-full object-cover object-top"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <User className="h-10 w-10 opacity-40" />
              </div>
            )}
          </div>
          <div className="flex flex-[2] min-w-0 flex-col gap-1">
            {[0, 1].map((index) => {
              const thumb = thumbs[index]
              return (
                <div
                  key={index}
                  className="relative flex-1 min-h-0 rounded-lg overflow-hidden bg-muted"
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      className="h-full w-full object-cover object-top"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-full w-full bg-muted/80" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <p className="text-sm font-semibold truncate text-foreground">{character.name}</p>
          <p className="text-[10px] text-muted-foreground shrink-0">
            {character.looks_count} look{character.looks_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  )
}
