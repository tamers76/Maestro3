import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { Toaster } from './components/ui/Toaster'
import { ThemeProvider } from './contexts/ThemeContext'
import { RoleProvider } from './contexts/RoleContext'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import CourseDetail from './pages/CourseDetail'
import Settings from './pages/Settings'
import NewCourse from './pages/NewCourse'
import HeroSection from './components/HeroSection'
import CourseWizard from './components/wizard/CourseWizard'
import { LEGACY_STAGES_ENABLED } from './config/featureFlags'

function App() {
  return (
    <ThemeProvider>
      <RoleProvider>
      <Router>
        <Routes>
          {/* Home page hero header — standalone landing (no app shell) */}
          <Route path="/" element={<HeroSection />} />

          {/* Application routes — wrapped in the shared Layout */}
          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/courses/new" element={<Layout><NewCourse /></Layout>} />
          {/* V1: routed Course Architect → Node Engine wizard. The legacy
              single-scroll CourseDetail stays reachable behind the flag. */}
          <Route
            path="/courses/:code/*"
            element={<Layout>{LEGACY_STAGES_ENABLED ? <CourseDetail /> : <CourseWizard />}</Layout>}
          />
          <Route path="/settings" element={<Layout><Settings /></Layout>} />
        </Routes>
        <Toaster />
      </Router>
      </RoleProvider>
    </ThemeProvider>
  )
}

export default App
