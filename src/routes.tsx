import { lazy, type ComponentType } from 'react'

const HomeScreen = lazy(() => import('./screens/HomeScreen').then((module) => ({ default: module.HomeScreen })))
const DiscoverScreen = lazy(() => import('./screens/DiscoverScreen').then((module) => ({ default: module.DiscoverScreen })))
const CreateScreen = lazy(() => import('./screens/CreateScreen').then((module) => ({ default: module.CreateScreen })))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen').then((module) => ({ default: module.ProfileScreen })))

// Maps a manifest navigation id -> its screen component and route path.
// Both the <Routes> and the <BottomTabBar> iterate manifest.navigation.items,
// so adding/removing a tab in the manifest changes the app shell.
export const screenForTab: Record<string, ComponentType> = {
  home: HomeScreen,
  discover: DiscoverScreen,
  create: CreateScreen,
  profile: ProfileScreen
}

export const pathForTab = (id: string): string => (id === 'home' ? '/' : `/${id}`)
