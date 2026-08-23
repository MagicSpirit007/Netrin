import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { AppearanceRuntime } from './appearance/AppearanceRuntime'
import { appearanceScreenForPath } from './appearance/contract'
import { BottomNav } from './components/domain/BottomNav'
import { DocumentMetadata } from './components/domain/DocumentMetadata'
import { tabItems } from './manifest'
import { screenForTab, pathForTab } from './routes'
import { NetrinStateProvider } from './state/NetrinState'
import { AuthProvider } from './auth/AuthProvider'

const AuthScreen = lazy(() =>
  import('./screens/AuthScreen').then((module) => ({ default: module.AuthScreen }))
)
const AdminScreen = lazy(() =>
  import('./screens/AdminScreen').then((module) => ({ default: module.AdminScreen }))
)
const AppearanceStudioScreen = lazy(() =>
  import('./screens/AppearanceStudioScreen').then((module) => ({ default: module.AppearanceStudioScreen }))
)
const RouteDetailScreen = lazy(() =>
  import('./screens/RouteDetailScreen').then((module) => ({ default: module.RouteDetailScreen }))
)
const WorkshopScreen = lazy(() =>
  import('./screens/WorkshopScreen').then((module) => ({ default: module.WorkshopScreen }))
)
const GuideScreen = lazy(() =>
  import('./screens/GuideScreen').then((module) => ({ default: module.GuideScreen }))
)
const CreateEditorScreen = lazy(() =>
  import('./screens/CreateScreen').then((module) => ({ default: module.CreateScreen }))
)
const AiRouteCreateScreen = lazy(() =>
  import('./screens/AiRouteCreateScreen').then((module) => ({ default: module.AiRouteCreateScreen }))
)
const LegalScreen = lazy(() =>
  import('./screens/LegalScreen').then((module) => ({ default: module.LegalScreen }))
)

// Mobile-first app shell (390x844 frame). Routes AND the bottom tabs are both
// generated from manifest.navigation.items (Cell Contract Rule 2). Home is the
// full-bleed map surface; the other tabs scroll. Public route sharing is
// moderated publication, not a social graph, so creator and message routes do not exist.
export function App() {
  const location = useLocation()
  const { t } = useTranslation()
  const isGuide = location.pathname.startsWith('/guide/')
  const isMapSurface = location.pathname === pathForTab('home') || isGuide
  const isAppearanceStudio = location.pathname === '/appearance-studio'
  const appearanceScreen = appearanceScreenForPath(location.pathname)

  return (
    <AuthProvider>
      <NetrinStateProvider>
        <DocumentMetadata />
        <AppearanceRuntime />
        <div
          className={`app-frame ${isAppearanceStudio ? 'app-frame--appearance-studio' : ''}`}
          data-appearance-hook="app-shell"
        >
          <main
            className={`app-content ${
              isAppearanceStudio
                ? 'app-content--scroll app-content--appearance-studio'
                : isMapSurface
                  ? 'app-content--fixed'
                  : 'app-content--scroll'
            }`}
            data-appearance-hook="screen-content"
            data-appearance-screen={appearanceScreen}
          >
            <Suspense fallback={<p className="app-loading" role="status">{t('common.loading')}</p>}>
              <Routes>
                {tabItems.map((id) => {
                  const Screen = screenForTab[id]
                  return Screen ? <Route key={id} path={pathForTab(id)} element={<Screen />} /> : null
                })}
                <Route path="/workshop" element={<WorkshopScreen />} />
                <Route path="/create/ai" element={<AiRouteCreateScreen />} />
                <Route path="/create/:draftId" element={<CreateEditorScreen />} />
                <Route path="/auth" element={<AuthScreen />} />
                <Route path="/admin" element={<AdminScreen />} />
                <Route path="/appearance-studio" element={<AppearanceStudioScreen />} />
                <Route path="/route/:routeId" element={<RouteDetailScreen />} />
                <Route path="/guide/:routeId" element={<GuideScreen />} />
                <Route path="/legal" element={<LegalScreen />} />
                <Route path="/legal/:documentType" element={<LegalScreen />} />
                <Route path="*" element={<Navigate to={pathForTab('home')} replace />} />
              </Routes>
            </Suspense>
          </main>
          {isAppearanceStudio || isGuide ? null : <BottomNav />}
        </div>
      </NetrinStateProvider>
    </AuthProvider>
  )
}
