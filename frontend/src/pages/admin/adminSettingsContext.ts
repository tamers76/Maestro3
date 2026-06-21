import { useOutletContext } from 'react-router-dom'
import type { Settings } from '@/services/api'

/**
 * Shared settings state for the Admin Center configuration pages. AdminCenter
 * loads the full settings object once and exposes it (plus a save action) to every
 * nested settings page via the router Outlet context, so the pages edit slices of
 * one object and persist with a single PUT — matching the previous single-page
 * Settings behavior, just split across routes.
 */
export interface AdminSettingsContextValue {
  settings: Settings | null
  setSettings: React.Dispatch<React.SetStateAction<Settings | null>>
  patch: (partial: Partial<Settings>) => void
  save: () => Promise<void>
  saving: boolean
  loading: boolean
  reload: () => Promise<void>
}

export function useAdminSettings(): AdminSettingsContextValue {
  return useOutletContext<AdminSettingsContextValue>()
}
