import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,  // 60s for e2e tests against Mem0
    hookTimeout: 60000,  // 60s for beforeAll/afterAll hooks
  },
})
