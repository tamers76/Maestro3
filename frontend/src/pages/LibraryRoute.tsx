import { useAuth } from '@/contexts/AuthContext'
import LibraryPage from './admin/LibraryPage'
import LibraryBrowsePage from './LibraryBrowsePage'

/**
 * /library dispatcher: admins get the full curation page (review, approve, add),
 * everyone else gets the read-only browse + read experience.
 */
export default function LibraryRoute() {
  const { user } = useAuth()
  return user?.role === 'admin' ? <LibraryPage /> : <LibraryBrowsePage />
}
