import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from './components/ui/Toaster'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CourseDetail from './pages/CourseDetail'
import NewCourse from './pages/NewCourse'
import Login from './pages/Login'
import Profile from './pages/Profile'
import HeroSection from './components/HeroSection'
import CourseWizard from './components/wizard/CourseWizard'
import { LEGACY_STAGES_ENABLED } from './config/featureFlags'
import AdminCenter from './pages/admin/AdminCenter'
import UsersPage from './pages/admin/UsersPage'
import CourseAccessPage from './pages/admin/CourseAccessPage'
import ApiKeysPage from './pages/admin/ApiKeysPage'
import DatabasePage from './pages/admin/DatabasePage'
import ModelsPage from './pages/admin/ModelsPage'
import PromptsPage from './pages/admin/PromptsPage'
import RagPage from './pages/admin/RagPage'
import AuditPage from './pages/admin/AuditPage'
import LibraryPage from './pages/admin/LibraryPage'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
      <Router>
        <Routes>
          {/* Home page hero header — standalone landing (no app shell) */}
          <Route path="/" element={<HeroSection />} />

          {/* Public auth route */}
          <Route path="/login" element={<Login />} />

          {/* Application routes — authenticated, wrapped in the shared Layout */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout><Dashboard /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/courses/new"
            element={
              <ProtectedRoute roles={['admin', 'professor']}>
                <Layout><NewCourse /></Layout>
              </ProtectedRoute>
            }
          />
          {/* V1: routed Course Architect → Node Engine wizard. The legacy
              single-scroll CourseDetail stays reachable behind the flag. */}
          <Route
            path="/courses/:code/*"
            element={
              <ProtectedRoute roles={['admin', 'professor']}>
                <Layout>{LEGACY_STAGES_ENABLED ? <CourseDetail /> : <CourseWizard />}</Layout>
              </ProtectedRoute>
            }
          />
          {/* Digital Library — admin-only, lives in the main app shell (not the Admin Center) */}
          <Route
            path="/library"
            element={
              <ProtectedRoute roles={['admin']}>
                <Layout><LibraryPage /></Layout>
              </ProtectedRoute>
            }
          />
          {/* Compatibility redirects for the previous routes */}
          <Route path="/settings" element={<Navigate to="/admin/api-keys" replace />} />
          <Route path="/admin/library" element={<Navigate to="/library" replace />} />

          {/* Admin Center — admin-only routed shell with browsable sub-pages */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <Layout><AdminCenter /></Layout>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="access" element={<CourseAccessPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
            <Route path="database" element={<DatabasePage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="prompts" element={<PromptsPage />} />
            <Route path="rag" element={<RagPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Layout><Profile /></Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
        <Toaster />
      </Router>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
