import { describe, it, expect } from 'vitest'

describe('API Client', () => {
  it('should be importable', async () => {
    const { apiClient } = await import('./client')
    expect(apiClient).toBeDefined()
    expect(typeof apiClient).toBe('function')
  })
})
