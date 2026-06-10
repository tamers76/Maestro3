import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cn } from '@/lib/utils'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

type ToastProps = {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'success' | 'destructive'
}

type ToastContextType = {
  toasts: ToastProps[]
  addToast: (toast: Omit<ToastProps, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextType | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

export function toast(props: Omit<ToastProps, 'id'>) {
  // This is a simplified toast - in production use a proper toast library
  console.log('Toast:', props)
}

const variantStyles = {
  default: 'border-border bg-card text-card-foreground dark:border-border dark:bg-card',
  success: 'border-emerald-500/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-500/30',
  destructive: 'border-red-500/30 bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-100 dark:border-red-500/30',
}

const variantIcons = {
  default: Info,
  success: CheckCircle,
  destructive: AlertCircle,
}

export function Toaster() {
  const [toasts, setToasts] = React.useState<ToastProps[]>([])

  const addToast = React.useCallback((toast: Omit<ToastProps, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...toast, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // Expose addToast globally
  React.useEffect(() => {
    (window as unknown as { __addToast: typeof addToast }).__addToast = addToast
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      <ToastPrimitives.Provider swipeDirection="right">
        {toasts.map(t => {
          const Icon = variantIcons[t.variant || 'default']
          return (
            <ToastPrimitives.Root
              key={t.id}
              className={cn(
                'fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border p-4 shadow-lg transition-all',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-80 data-[state=open]:fade-in-0',
                'data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full',
                variantStyles[t.variant || 'default']
              )}
            >
              <Icon className={cn(
                'h-5 w-5 flex-shrink-0',
                t.variant === 'success' && 'text-emerald-600 dark:text-emerald-400',
                t.variant === 'destructive' && 'text-red-600 dark:text-red-400',
                !t.variant && 'text-primary'
              )} />
              <div className="flex-1 min-w-0">
                {t.title && <div className="font-semibold">{t.title}</div>}
                {t.description && <div className="text-sm opacity-90">{t.description}</div>}
              </div>
              <ToastPrimitives.Close className="rounded-md p-1 hover:bg-foreground/10 transition-colors">
                <X className="h-4 w-4" />
              </ToastPrimitives.Close>
            </ToastPrimitives.Root>
          )
        })}
        <ToastPrimitives.Viewport />
      </ToastPrimitives.Provider>
    </ToastContext.Provider>
  )
}

// Global toast function
export function showToast(props: Omit<ToastProps, 'id'>) {
  const addToast = (window as unknown as { __addToast?: (props: Omit<ToastProps, 'id'>) => void }).__addToast
  if (addToast) {
    addToast(props)
  }
}
