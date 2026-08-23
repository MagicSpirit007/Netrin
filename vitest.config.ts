import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      'services/netrin-ai-orchestrator/**',
    ],
  },
})
