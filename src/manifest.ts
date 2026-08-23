// neuron.manifest.json is the runtime source of truth (Cell Contract Rule 2).
// Screens, navigation, and content types derive from here — not from hardcoded copy.
import manifest from '../neuron.manifest.json'

export const tabItems: string[] = manifest.navigation.items

export default manifest
