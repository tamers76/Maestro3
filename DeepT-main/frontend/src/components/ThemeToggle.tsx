import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  
  return (
    <button
      onClick={toggleTheme}
      className={cn(
        'relative flex h-9 w-16 items-center rounded-full p-1 transition-all duration-300',
        'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background',
        theme === 'dark' 
          ? 'bg-slate-800 border border-slate-700' 
          : 'bg-blue-100 border border-blue-200'
      )}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {/* Background glow effect */}
      <div 
        className={cn(
          'absolute inset-0 rounded-full transition-opacity duration-300',
          theme === 'dark' 
            ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 opacity-100' 
            : 'opacity-0'
        )}
      />
      
      {/* Sliding circle */}
      <div
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full shadow-md transition-all duration-300',
          theme === 'dark'
            ? 'translate-x-7 bg-slate-900 text-blue-400'
            : 'translate-x-0 bg-white text-amber-500'
        )}
      >
        {theme === 'dark' ? (
          <Moon className="h-4 w-4" />
        ) : (
          <Sun className="h-4 w-4" />
        )}
      </div>
      
      {/* Icons on track */}
      <Sun 
        className={cn(
          'absolute left-2 h-3.5 w-3.5 transition-opacity duration-300',
          theme === 'dark' ? 'opacity-30 text-slate-500' : 'opacity-0'
        )} 
      />
      <Moon 
        className={cn(
          'absolute right-2 h-3.5 w-3.5 transition-opacity duration-300',
          theme === 'dark' ? 'opacity-0' : 'opacity-30 text-blue-400'
        )} 
      />
    </button>
  )
}
