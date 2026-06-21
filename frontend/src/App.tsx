import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from './components/ui/Toaster'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CourseDetail from './pages/CourseDetail'
import Settings from './pages/Settings'
import NewCourse from './pages/NewCourse'
import Login from './pages/Login'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import HeroSection from './components/HeroSection'
import CourseWizard from './components/wizard/CourseWizard'
import { LEGACY_STAGES_ENABLED } from './config/featureFlags'

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
          <Route
            path="/settings"
            element={
              <ProtectedRoute roles={['admin']}>
                <Layout><Settings /></Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute roles={['admin']}>
                <Layout><Admin /></Layout>
              </ProtectedRoute>
            }
          />
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
