import { createContext, useContext, useState } from 'react'

/**
 * Mock client-side role switcher for V1 demonstrability.
 *
 * There is no real authentication yet. This context only gates UI VISIBILITY
 * (e.g. which review actions a screen shows) so the review workflow can be
 * demonstrated; it never bypasses backend review or grants real permissions.
 */
export type AppRole = 'author' | 'sme' | 'admin' | 'learner'

export const APP_ROLES: { id: AppRole; label: string }[] = [
  { id: 'author', label: 'Author' },
  { id: 'sme', label: 'SME Reviewer' },
  { id: 'admin', label: 'Admin' },
  { id: 'learner', label: 'Learner' },
]

interface RoleContextType {
  role: AppRole
  setRole: (role: AppRole) => void
}

const RoleContext = createContext<RoleContextType | undefined>(undefined)

const STORAGE_KEY = 'maestro_mock_role'

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<AppRole>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as AppRole | null
    return stored ?? 'author'
  })

  const setRole = (newRole: AppRole) => {
    setRoleState(newRole)
    localStorage.setItem(STORAGE_KEY, newRole)
  }

  return <RoleContext.Provider value={{ role, setRole }}>{children}</RoleContext.Provider>
}

export function useRole() {
  const context = useContext(RoleContext)
  if (context === undefined) {
    throw new Error('useRole must be used within a RoleProvider')
  }
  return context
}
