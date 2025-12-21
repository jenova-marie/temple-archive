import { describe, it, expect } from 'vitest'
import { NoOpCrisisDetector } from '../src/NoOpCrisisDetector.js'

describe('NoOpCrisisDetector', () => {
  const detector = new NoOpCrisisDetector()
  const ctx = {
    traceId: 'test',
    spanId: 'test',
    requestId: 'test',
    startTime: Date.now(),
  }

  it('should always return crisis level 1', async () => {
    const result = await detector.detect('i want to die', ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.level).toBe(1)
      expect(result.value.triggerEmergency).toBe(false)
      expect(result.value.patterns).toEqual([])
      expect(result.value.action).toBe('none')
      expect(result.value.processingTimeMs).toBe(0)
    }
  })

  it('should return safe result for any message', async () => {
    const messages = ['help', 'crisis', 'suicide', 'I am fine', 'I want to hurt myself']
    for (const msg of messages) {
      const result = await detector.detect(msg, ctx)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.level).toBe(1)
        expect(result.value.triggerEmergency).toBe(false)
      }
    }
  })

  it('should never trigger emergency', async () => {
    const result = await detector.detect('I am going to kill myself right now', ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.triggerEmergency).toBe(false)
      expect(result.value.action).toBe('none')
    }
  })
})
