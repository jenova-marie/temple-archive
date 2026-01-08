/**
 * Unit tests for snake_case → camelCase transformation utilities
 */

import { describe, it, expect } from 'vitest'
import {
  snakeToCamel,
  transformKeys,
  transformMemory,
  transformSearchResult,
  transformAddResult,
  transformMemories,
  transformSearchResults,
} from '../src/transform.js'

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    expect(snakeToCamel('user_id')).toBe('userId')
    expect(snakeToCamel('agent_id')).toBe('agentId')
    expect(snakeToCamel('created_at')).toBe('createdAt')
    expect(snakeToCamel('updated_at')).toBe('updatedAt')
    expect(snakeToCamel('run_id')).toBe('runId')
  })

  it('should handle already camelCase strings', () => {
    expect(snakeToCamel('userId')).toBe('userId')
    expect(snakeToCamel('id')).toBe('id')
    expect(snakeToCamel('memory')).toBe('memory')
  })

  it('should handle multiple underscores', () => {
    expect(snakeToCamel('some_long_field_name')).toBe('someLongFieldName')
  })
})

describe('transformKeys', () => {
  it('should transform object keys from snake_case to camelCase', () => {
    const input = {
      user_id: 'user-123',
      agent_id: 'agent-1',
      created_at: '2024-01-01',
    }

    const result = transformKeys(input)

    expect(result).toEqual({
      userId: 'user-123',
      agentId: 'agent-1',
      createdAt: '2024-01-01',
    })
  })
})

describe('transformMemory', () => {
  it('should transform snake_case API response to camelCase', () => {
    const raw = {
      id: 'mem-123',
      memory: 'User likes pizza',
      hash: 'abc123',
      user_id: 'user-123',
      agent_id: 'agent-1',
      run_id: 'run-1',
      metadata: { source: 'test' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    }

    const result = transformMemory(raw)

    expect(result).toEqual({
      id: 'mem-123',
      memory: 'User likes pizza',
      hash: 'abc123',
      userId: 'user-123',
      agentId: 'agent-1',
      runId: 'run-1',
      metadata: { source: 'test' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    })
  })

  it('should handle already camelCase fields (pass-through)', () => {
    const raw = {
      id: 'mem-123',
      memory: 'Test',
      hash: 'abc',
      userId: 'user-123', // Already camelCase
      metadata: {},
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    }

    const result = transformMemory(raw)

    expect(result.userId).toBe('user-123')
  })

  it('should default metadata to empty object if missing', () => {
    const raw = {
      id: 'mem-123',
      memory: 'Test',
      hash: 'abc',
      user_id: 'user-123',
    }

    const result = transformMemory(raw)

    expect(result.metadata).toEqual({})
  })
})

describe('transformSearchResult', () => {
  it('should include score along with memory fields', () => {
    const raw = {
      id: 'mem-123',
      memory: 'User likes pizza',
      hash: 'abc123',
      user_id: 'user-123',
      metadata: {},
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      score: 0.95,
    }

    const result = transformSearchResult(raw)

    expect(result.score).toBe(0.95)
    expect(result.userId).toBe('user-123')
    expect(result.memory).toBe('User likes pizza')
  })
})

describe('transformAddResult', () => {
  it('should transform add result', () => {
    const raw = {
      id: 'mem-123',
      memory: 'User likes pizza',
      event: 'ADD',
      metadata: { source: 'test' },
    }

    const result = transformAddResult(raw)

    expect(result).toEqual({
      id: 'mem-123',
      memory: 'User likes pizza',
      event: 'ADD',
      metadata: { source: 'test' },
    })
  })
})

describe('transformMemories', () => {
  it('should transform array of memories', () => {
    const rawArray = [
      { id: 'mem-1', memory: 'Fact 1', hash: 'a', user_id: 'user-123', metadata: {}, created_at: '2024-01-01', updated_at: '2024-01-01' },
      { id: 'mem-2', memory: 'Fact 2', hash: 'b', user_id: 'user-123', metadata: {}, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]

    const results = transformMemories(rawArray)

    expect(results).toHaveLength(2)
    expect(results[0].userId).toBe('user-123')
    expect(results[1].userId).toBe('user-123')
  })

  it('should handle empty array', () => {
    const results = transformMemories([])
    expect(results).toEqual([])
  })
})

describe('transformSearchResults', () => {
  it('should transform array of search results with scores', () => {
    const rawArray = [
      { id: 'mem-1', memory: 'Fact 1', hash: 'a', user_id: 'user-123', metadata: {}, created_at: '2024-01-01', updated_at: '2024-01-01', score: 0.95 },
      { id: 'mem-2', memory: 'Fact 2', hash: 'b', user_id: 'user-123', metadata: {}, created_at: '2024-01-01', updated_at: '2024-01-01', score: 0.82 },
    ]

    const results = transformSearchResults(rawArray)

    expect(results).toHaveLength(2)
    expect(results[0].score).toBe(0.95)
    expect(results[0].userId).toBe('user-123')
    expect(results[1].score).toBe(0.82)
  })
})
