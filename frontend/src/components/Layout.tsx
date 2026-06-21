import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  Plus,
  LayoutDashboard,
  Search,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  ShieldAlert,
  Library,
  LogOut,
  User as UserIcon,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { avatarSrc } from '@/services/api'

interface LayoutProps {
  children: React.ReactNode
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  professor: 'Professor',
  student: 'Student',
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  const canAuthor = user?.role === 'admin' || user?.role === 'professor'

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/library', icon: Library, label: 'Digital Library' },
    ...(canAuthor ? [{ path: '/courses/new', icon: Plus, label: 'New Course' }] : []),
  ]

  const secondaryNavItems = [
    ...(user?.role === 'admin'
      ? [{ path: '/admin', icon: ShieldAlert, label: 'Admin Center' }]
      : []),
  ]

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-[#101220]/85 text-white backdrop-blur-2xl border-r border-white/10 transition-all duration-300 ease-in-out',
          collapsed ? 'w-[72px]' : 'w-[240px]'
        )}
      >
        <Link
          to="/dashboard"
          className={cn(
            'flex items-center border-b border-white/10 px-4 hover:bg-white/5 transition-colors',
            collapsed ? 'h-11 justify-center' : 'h-11 gap-2.5'
          )}
        >
          {!collapsed && (
            <div className="overflow-hidden min-w-0">
              <h1 className="text-sm font-semibold text-white truncate leading-tight tracking-tight">
                Maestro
              </h1>
              <p className="text-fine-print text-white/60 truncate">
                Curriculum Intelligence
              </p>
            </div>
          )}
          {collapsed && (
            <span className="text-sm font-semibold tracking-tight">M</span>
          )}
        </Link>

        {!collapsed && (
          <div className="px-3 py-3">
            <div
              className="flex items-center gap-2 rounded-pill border border-white/10 bg-white/5 px-3 h-11 text-white/50"
            >
              <Search className="h-4 w-4 flex-shrink-0" />
              <span className="text-caption">Search</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {!collapsed && (
            <p className="mb-2 px-3 text-fine-print text-white/40 uppercase tracking-wide">
              Application
            </p>
          )}
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => {
              const isActive =
                item.path === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption font-normal transition-colors active:scale-[0.98]',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              )
            })}
          </nav>

          {secondaryNavItems.length > 0 && (
          <>
          <div className="my-4 border-t border-white/10" />

          {!collapsed && (
            <p className="mb-2 px-3 text-fine-print text-white/40 uppercase tracking-wide">
              Others
            </p>
          )}
          <nav className="flex flex-col gap-0.5">
            {secondaryNavItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption font-normal transition-colors active:scale-[0.98]',
                    collapsed && 'justify-center px-2',
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              )
            })}
          </nav>
          </>
          )}
        </div>

        <div className="border-t border-white/10 p-2 space-y-0.5">
          {user && (
            <Link
              to="/profile"
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption transition-colors w-full active:scale-[0.98]',
                location.pathname === '/profile'
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? 'Profile' : undefined}
            >
              {avatarSrc(user.avatar_url) ? (
                <img
                  src={avatarSrc(user.avatar_url)!}
                  alt={user.name || user.email}
                  className="h-5 w-5 flex-shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/15">
                  <UserIcon className="h-3 w-3" />
                </span>
              )}
              {!collapsed && (
                <span className="truncate">{user.name || user.email}</span>
              )}
            </Link>
          )}
          {user && (
            <button
              onClick={handleLogout}
              className={cn(
                'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption text-white/70 hover:bg-white/10 hover:text-white transition-colors w-full active:scale-[0.98]',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? 'Sign out' : undefined}
            >
              <LogOut className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>Sign out</span>}
            </button>
          )}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption text-white/70 hover:bg-white/10 hover:text-white transition-colors w-full active:scale-[0.98]',
              collapsed && 'justify-center px-2'
            )}
            title={collapsed ? (theme === 'dark' ? 'Light Mode' : 'Dark Mode') : undefined}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 flex-shrink-0" />
            ) : (
              <Moon className="h-4 w-4 flex-shrink-0" />
            )}
            {!collapsed && (
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            )}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'flex items-center gap-2.5 rounded-sm px-3 py-2.5 text-caption text-white/70 hover:bg-white/10 hover:text-white transition-colors w-full active:scale-[0.98]',
              collapsed && 'justify-center px-2'
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div
        className={cn(
          'flex-1 flex flex-col min-h-screen transition-all duration-300',
          collapsed ? 'ml-[72px]' : 'ml-[240px]'
        )}
      >
        {/* Top nav — frosted glass bar with hairline */}
        <header
          className={cn(
            'sticky top-0 z-40 flex h-[52px] items-center justify-between border-b px-6',
            'bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl border-border/70'
          )}
        >
          <div className="flex items-center gap-4">
            <img
              src="/hbmsu-logo.png"
              alt="HBMSU Logo"
              className="h-8 object-contain"
            />
          </div>
          <div className="flex items-center gap-4">
            <p className="text-caption text-muted-foreground hidden sm:block">
              Adaptive Curriculum Intelligence v3.1.1
            </p>
            {user && (
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <p className="text-caption font-medium text-foreground leading-tight">
                    {user.name || user.email}
                  </p>
                  <p className="text-fine-print text-muted-foreground leading-tight">
                    {ROLE_LABELS[user.role] || user.role}
                  </p>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign out"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 md:p-8 relative z-10 max-w-content mx-auto w-full">
          {children}
        </main>

        <footer
          className="border-t border-white/10 bg-[#101220]/85 backdrop-blur-xl py-8 px-6 md:px-8 text-fine-print text-white/70"
        >
          <div className="max-w-content mx-auto flex items-center justify-between">
            <span>Developed by the-Code.ai Labs</span>
            <span>ACIS v3.1.1</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
