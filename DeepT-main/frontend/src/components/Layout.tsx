import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { 
  Settings, 
  Plus, 
  LayoutDashboard,
  Sparkles,
  Search,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Moon,
  Sun
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  
  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/courses/new', icon: Plus, label: 'New Course' },
  ]

  const secondaryNavItems = [
    { path: '/settings', icon: Settings, label: 'Settings' },
  ]
  
  return (
    <div className="flex min-h-screen bg-[#f5f6fa] dark:bg-background">
      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out',
        'bg-gradient-to-b from-[#6c3aed] to-[#5b21b6]',
        'dark:from-[#1e1b4b] dark:to-[#0f0a2e]',
        collapsed ? 'w-[80px]' : 'w-[270px]'
      )}>
        {/* Logo Area */}
        <Link
          to="/dashboard"
          className={cn(
            'flex items-center border-b border-white/10 px-5 hover:bg-white/5 transition-colors cursor-pointer',
            collapsed ? 'h-20 justify-center' : 'h-20 gap-3'
          )}
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Wand2 className="h-6 w-6 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-lg font-bold text-white truncate leading-tight">
                Maestro
              </h1>
              <p className="text-xs text-white/60 truncate leading-tight">
                Curriculum Intelligence
              </p>
            </div>
          )}
        </Link>

        {/* Search */}
        {!collapsed && (
          <div className="px-4 py-4">
            <div className="flex items-center gap-2.5 rounded-lg bg-white/10 px-3.5 py-2.5 text-white/60">
              <Search className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm">Search...</span>
            </div>
          </div>
        )}

        {/* Main Navigation */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {!collapsed && (
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Application
            </p>
          )}
          <nav className="flex flex-col gap-1.5">
            {navItems.map(item => {
              const isActive = item.path === '/' 
                ? location.pathname === '/' 
                : location.pathname.startsWith(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold transition-all duration-200',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'bg-white/20 text-white shadow-lg shadow-black/10'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className={cn('h-6 w-6 flex-shrink-0', isActive && 'drop-shadow-sm')} />
                  {!collapsed && <span>{item.label}</span>}
                  {isActive && !collapsed && (
                    <div className="ml-auto h-2.5 w-2.5 rounded-full bg-white shadow-sm shadow-white/50" />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Divider */}
          <div className="my-5 border-t border-white/10" />

          {!collapsed && (
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              Others
            </p>
          )}
          <nav className="flex flex-col gap-1.5">
            {secondaryNavItems.map(item => {
              const isActive = location.pathname === item.path
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold transition-all duration-200',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'bg-white/20 text-white shadow-lg shadow-black/10'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-6 w-6 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Theme Toggle & Collapse */}
        <div className="border-t border-white/10 p-3 space-y-2">
          <button
            onClick={toggleTheme}
            className={cn(
              'flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 w-full',
              collapsed && 'justify-center px-2'
            )}
            title={collapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined}
          >
            {theme === 'dark' ? <Sun className="h-6 w-6 flex-shrink-0" /> : <Moon className="h-6 w-6 flex-shrink-0" />}
            {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'flex items-center gap-3 rounded-xl px-4 py-3 text-base font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-all duration-200 w-full',
              collapsed && 'justify-center px-2'
            )}
          >
            {collapsed ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
      
      {/* Main Content */}
      <div className={cn(
        'flex-1 flex flex-col min-h-screen transition-all duration-300',
        collapsed ? 'ml-[80px]' : 'ml-[270px]'
      )}>
        {/* Top Bar */}
        <header className={cn(
          'sticky top-0 z-40 flex h-20 items-center justify-between border-b px-8 backdrop-blur-md',
          'bg-white/80 border-slate-200',
          'dark:bg-background/80 dark:border-border'
        )}>
          <div className="flex items-center gap-4">
            <img 
              src="/hbmsu-logo.png" 
              alt="HBMSU Logo" 
              className="h-12 object-contain"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-black dark:text-foreground">
              <Sparkles className="h-5 w-5 text-violet-500" />
              <span className="hidden sm:inline font-semibold">Adaptive Curriculum Intelligence System v2.5.4</span>
            </div>
          </div>
        </header>
        
        {/* Page Content */}
        <main className="flex-1 p-8 relative z-10">
          {children}
        </main>
        
        {/* Footer */}
        <footer className={cn(
          'border-t py-5 px-8',
          'bg-white/50 border-slate-200 text-black/60',
          'dark:bg-background/50 dark:border-border dark:text-muted-foreground'
        )}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Developed by the-Code.ai Labs</span>
            <span className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4" />
              ACIS v2.5.4
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
