import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import {
  login as apiLogin,
  fetchMe,
  updateProfile as apiUpdateProfile,
  uploadAvatar as apiUploadAvatar,
  type AuthUser,
  type UserRole,
  type ProfileUpdate,
} from '@/services/api'
import {
  getToken,
  setToken as persistToken,
  clearToken,
  installAuthFetch,
} from '@/services/authToken'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => void
  refreshMe: () => Promise<void>
  updateProfile: (patch: ProfileUpdate) => Promise<AuthUser>
  uploadAvatar: (file: File) => Promise<AuthUser>
  hasRole: (...roles: UserRole[]) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Install the fetch interceptor as early as possible (module load).
installAuthFetch()

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      return
    }
    try {
      const me = await fetchMe()
      setUser(me)
    } catch {
      clearToken()
      setUser(null)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password)
    persistToken(result.token)
    setUser(result.user)
    return result.user
  }, [])

  const updateProfile = useCallback(async (patch: ProfileUpdate) => {
    const updated = await apiUpdateProfile(patch)
    setUser(updated)
    return updated
  }, [])

  const uploadAvatar = useCallback(async (file: File) => {
    const updated = await apiUploadAvatar(file)
    setUser(updated)
    return updated
  }, [])

  // Validate any persisted token on first load.
  useEffect(() => {
    let active = true
    ;(async () => {
      await refreshMe()
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [refreshMe])

  // React to global 401s (token expired / account deactivated).
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null)
    }
    window.addEventListener('maestro:unauthorized', onUnauthorized)
    return () => window.removeEventListener('maestro:unauthorized', onUnauthorized)
  }, [])

  const hasRole = useCallback(
    (...roles: UserRole[]) => (user ? roles.includes(user.role) : false),
    [user]
  )

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refreshMe, updateProfile, uploadAvatar, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
