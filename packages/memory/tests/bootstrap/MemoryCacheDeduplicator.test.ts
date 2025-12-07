/**
 * MemoryCacheDeduplicator Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  MemoryCacheDeduplicator,
  StubMemoryCacheDeduplicator,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../../src/bootstrap/index.js'

// Mock Anthropic client
const createMockClient = (response: string) => ({
  messages: {
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: response }],
    }),
  },
})

const mockCtx = {
  traceId: 'trace-1',
  spanId: 'span-1',
  requestId: 'req-1',
  startTime: Date.now(),
}

describe('MemoryCacheDeduplicator', () => {
  describe('deduplicate', () => {
    it('should deduplicate entries using LLM', async () => {
      const mockResponse = `- Mike:person -> User's sponsor, supportive
- Tuesday:event -> AA meeting day`

      const client = createMockClient(mockResponse)
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await deduplicator.deduplicate(
        [
          '- Mike:person -> sponsor',
          '- Mike:person -> User\'s sponsor, supportive',
          '- Tuesday:event -> AA meeting day',
        ],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })

    it('should return empty array for empty input', async () => {
      const client = createMockClient('')
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await deduplicator.deduplicate([], mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual([])
    })

    it('should return original entries when no client', async () => {
      const deduplicator = new MemoryCacheDeduplicator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const entries = ['- Mike:person -> sponsor', '- Tuesday:event -> meeting']
      const result = await deduplicator.deduplicate(entries, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual(entries)
    })

    it('should keep original entries if LLM returns empty', async () => {
      const client = createMockClient('') // Empty response
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const entries = ['- Mike:person -> sponsor']
      const result = await deduplicator.deduplicate(entries, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual(entries)
    })
  })

  describe('merge', () => {
    it('should merge L1 and L2 entries using LLM', async () => {
      const mockResponse = `- Mike:person -> User's sponsor, met at AA
- Tuesday:event -> AA meeting day
- Stress:trigger -> work deadlines`

      const client = createMockClient(mockResponse)
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await deduplicator.merge(
        ['- Mike:person -> sponsor'],
        ['- Tuesday:event -> meeting', '- Stress:trigger -> work'],
        50,
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
    })

    it('should return L1 if L2 is empty', async () => {
      const client = createMockClient('')
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const l1 = ['- Mike:person -> sponsor']
      const result = await deduplicator.merge(l1, [], 50, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual(l1)
    })

    it('should return limited L2 if L1 is empty', async () => {
      const client = createMockClient('')
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const l2 = ['- A:type -> a', '- B:type -> b', '- C:type -> c']
      const result = await deduplicator.merge([], l2, 2, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })

    it('should do simple merge without client', async () => {
      const deduplicator = new MemoryCacheDeduplicator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const l1 = ['- A:type -> a']
      const l2 = ['- B:type -> b', '- C:type -> c']
      const result = await deduplicator.merge(l1, l2, 50, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
    })

    it('should respect cache limit in simple merge', async () => {
      const deduplicator = new MemoryCacheDeduplicator(null, DEFAULT_BOOTSTRAP_CONFIG)

      const l1 = ['- A:type -> a', '- B:type -> b']
      const l2 = ['- C:type -> c', '- D:type -> d']
      const result = await deduplicator.merge(l1, l2, 3, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(3)
    })

    it('should keep L1 if LLM returns empty', async () => {
      const client = createMockClient('invalid response without entries')
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const l1 = ['- Mike:person -> sponsor']
      const result = await deduplicator.merge(l1, ['- Old:type -> data'], 50, mockCtx)

      expect(result.ok).toBe(true)
      expect(result.value).toEqual(l1)
    })
  })

  describe('entry parsing', () => {
    it('should only parse valid entry format', async () => {
      const mockResponse = `- Valid:type -> description
Invalid line without format
- Another:type -> valid entry
Just some text`

      const client = createMockClient(mockResponse)
      const deduplicator = new MemoryCacheDeduplicator(client as any, DEFAULT_BOOTSTRAP_CONFIG)

      const result = await deduplicator.deduplicate(
        ['- Entry:type -> data'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2) // Only valid entries
      expect(result.value?.[0]).toContain('Valid:type')
      expect(result.value?.[1]).toContain('Another:type')
    })
  })
})

describe('StubMemoryCacheDeduplicator', () => {
  const deduplicator = new StubMemoryCacheDeduplicator()

  describe('deduplicate', () => {
    it('should remove exact duplicates', async () => {
      const result = await deduplicator.deduplicate(
        ['- A:type -> a', '- B:type -> b', '- A:type -> a'],
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })
  })

  describe('merge', () => {
    it('should concatenate and limit', async () => {
      const result = await deduplicator.merge(
        ['- A:type -> a'],
        ['- B:type -> b', '- C:type -> c'],
        2,
        mockCtx
      )

      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })
  })
})
