import { useState, useEffect, useRef, useCallback } from 'react'

export interface TypewriterConfig {
  /** Base milliseconds per character (default: 20) */
  baseSpeed: number
  /** Extra pause after . ! ? (default: 250) */
  punctuationPause: number
  /** Pause after , ; : (default: 120) */
  commaPause: number
  /** Chance of pause before word 0-1 (default: 0.08) */
  wordPauseChance: number
  /** Duration of random word pause (default: 80) */
  wordPauseMs: number
  /** Random variance ±ms (default: 12) */
  variance: number
}

export interface UseTypewriterReturn {
  /** Text to display (gradually increases) */
  displayText: string
  /** Still typing? */
  isTyping: boolean
  /** Finished all buffered text? */
  isComplete: boolean
  /** Skip to end immediately */
  skipToEnd: () => void
}

const DEFAULT_CONFIG: TypewriterConfig = {
  baseSpeed: 20,
  punctuationPause: 250,
  commaPause: 120,
  wordPauseChance: 0.08,
  wordPauseMs: 80,
  variance: 12,
}

function getNextDelay(
  char: string,
  nextChar: string | undefined,
  config: TypewriterConfig
): number {
  let delay = config.baseSpeed

  // Add variance for natural feel
  delay += (Math.random() - 0.5) * 2 * config.variance

  // Longer pause after sentence-ending punctuation
  if (['.', '!', '?'].includes(char)) {
    delay += config.punctuationPause
  }
  // Medium pause after other punctuation
  else if ([',', ';', ':', '-'].includes(char)) {
    delay += config.commaPause
  }
  // Occasional pause before words (after space, before letter)
  else if (char === ' ' && nextChar && /[a-zA-Z]/.test(nextChar)) {
    if (Math.random() < config.wordPauseChance) {
      delay += config.wordPauseMs
    }
  }
  // Slight pause after newlines
  else if (char === '\n') {
    delay += config.commaPause
  }

  return Math.max(5, delay)
}

/**
 * Typewriter effect hook - gradually reveals text with natural timing
 *
 * @param fullText - The complete text to reveal
 * @param config - Timing configuration
 * @param enabled - Whether the effect is enabled (false = show all text immediately)
 */
export function useTypewriter(
  fullText: string,
  config?: Partial<TypewriterConfig>,
  enabled: boolean = true
): UseTypewriterReturn {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  const [displayLength, setDisplayLength] = useState(enabled ? 0 : fullText.length)
  const [isComplete, setIsComplete] = useState(!enabled || fullText.length === 0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullTextRef = useRef(fullText)

  // Track if we've skipped
  const skippedRef = useRef(false)

  const skipToEnd = useCallback(() => {
    skippedRef.current = true
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setDisplayLength(fullTextRef.current.length)
    setIsComplete(true)
  }, [])

  // Update ref when fullText changes
  useEffect(() => {
    fullTextRef.current = fullText
  }, [fullText])

  // Main typing effect
  useEffect(() => {
    // If disabled or already skipped, show everything
    if (!enabled || skippedRef.current) {
      setDisplayLength(fullText.length)
      setIsComplete(true)
      return
    }

    // If we're behind the new text length, schedule next character
    if (displayLength < fullText.length) {
      setIsComplete(false)

      const currentChar = fullText[displayLength - 1] || ''
      const nextChar = fullText[displayLength]
      const delay = getNextDelay(currentChar, nextChar, mergedConfig)

      timeoutRef.current = setTimeout(() => {
        setDisplayLength((prev) => Math.min(prev + 1, fullTextRef.current.length))
      }, delay)

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
      }
    } else {
      setIsComplete(true)
    }
  }, [displayLength, fullText, enabled, mergedConfig])

  // Handle text getting shorter (shouldn't normally happen, but be safe)
  useEffect(() => {
    if (displayLength > fullText.length) {
      setDisplayLength(fullText.length)
    }
  }, [fullText.length, displayLength])

  return {
    displayText: fullText.slice(0, displayLength),
    isTyping: !isComplete && displayLength < fullText.length,
    isComplete,
    skipToEnd,
  }
}
