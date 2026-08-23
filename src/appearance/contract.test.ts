import { describe, expect, it } from 'vitest'
import manifestSchema from '../../appearance/appearance.manifest.schema.json'
import interfaceContract from '../../ui-contract/interface-contract.json'
import previewSource from './AppearancePreview.tsx?raw'
import workbenchSource from './AppearanceDevWorkbench.tsx?raw'
import homeSource from '../screens/HomeScreen.tsx?raw'
import serverAudit from '../../supabase/functions/_shared/appearance-audit.ts?raw'
import {
  APPEARANCE_INTERFACE_CONTRACT_VERSION,
  APPEARANCE_REVIEW_ROUTES,
  REQUIRED_APPEARANCE_COMPONENTS,
  REQUIRED_APPEARANCE_SCREENS,
  STABLE_APPEARANCE_SLOTS,
  appearanceScreenForPath
} from './contract'

describe('appearance interface contract v2 consistency', () => {
  it('maps all ten real route families through the shared runtime contract', () => {
    expect(APPEARANCE_INTERFACE_CONTRACT_VERSION).toBe(2)
    expect(REQUIRED_APPEARANCE_SCREENS).toHaveLength(10)
    expect(interfaceContract.schemaVersion).toBe(2)
    expect(interfaceContract.screens.map((screen) => screen.id)).toEqual([...REQUIRED_APPEARANCE_SCREENS])
    expect([
      '/', '/discover', '/route/example', '/create', '/create/ai', '/profile', '/appearance-studio', '/auth', '/legal/privacy', '/admin'
    ].map(appearanceScreenForPath)).toEqual([...REQUIRED_APPEARANCE_SCREENS])
    expect(REQUIRED_APPEARANCE_SCREENS.map((screen) => appearanceScreenForPath(APPEARANCE_REVIEW_ROUTES[screen])))
      .toEqual([...REQUIRED_APPEARANCE_SCREENS])
  })

  it('ships one isolated fixture for each of the 21 stable hooks', () => {
    expect(REQUIRED_APPEARANCE_COMPONENTS).toHaveLength(21)
    expect(interfaceContract.components.map((component) => component.id)).toEqual([...REQUIRED_APPEARANCE_COMPONENTS])
    REQUIRED_APPEARANCE_COMPONENTS.forEach((id) => expect(previewSource).toContain(`data-appearance-hook="${id}"`))
  })

  it('shares four stable brand slots across the contract, real home route and workbench fixture', () => {
    expect(STABLE_APPEARANCE_SLOTS).toHaveLength(4)
    expect(interfaceContract.slots.map((slot) => slot.id)).toEqual([...STABLE_APPEARANCE_SLOTS])
    STABLE_APPEARANCE_SLOTS.forEach((id) => {
      expect(homeSource).toContain(`data-appearance-slot="${id}"`)
      expect(previewSource).toContain(`data-appearance-slot="${id}"`)
    })
    expect(workbenchSource).toContain('STABLE_APPEARANCE_SLOTS')
    expect(workbenchSource).toContain('coverage.slots')
    expect(previewSource.match(/data-brand-slot-fixture="brand-[^"]+"/g)).toHaveLength(4)
    expect(workbenchSource).toContain('data-appearance-coverage-source')
    expect(workbenchSource).toContain("styledBy: source('data-appearance-slot', id)")
  })

  it('keeps v3 schema and server audit on the shared version boundary', () => {
    expect(manifestSchema.properties.schemaVersion.const).toBe(3)
    expect(manifestSchema.properties.interfaceContractVersion.const).toBe(2)
    expect(manifestSchema.properties).not.toHaveProperty('screens')
    expect(manifestSchema.properties).not.toHaveProperty('components')
    expect(serverAudit).toContain("from '../../../appearance/contract.ts'")
  })
})
