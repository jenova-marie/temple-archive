import { useState, useCallback, useRef, useEffect } from 'react'
import { getSpeechRecognitionConstructor } from '@/lib/audio/browser-detection'
import type {
  SpeechRecognition,
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
  SpeechRecognitionErrorCode,
} from '@/types/speech-recognition'

export interface UseSpeechRecognitionOptions {
  language?: string
  onResult?: (transcript: string) => void
  onError?: (error: SpeechRecognitionErrorCode, message: string) => void
}

export interface UseSpeechRecognitionReturn {
  isSupported: boolean
  isListening: boolean
  interimTranscript: string
  error: SpeechRecognitionErrorCode | null
  startListening: () => void
  stopListening: () => void
  cancelListening: () => void
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const { language = 'en-US', onResult, onError } = options

  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [error, setError] = useState<SpeechRecognitionErrorCode | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)

  // Keep refs up to date
  useEffect(() => {
    onResultRef.current = onResult
    onErrorRef.current = onError
  }, [onResult, onError])

  const SpeechRecognitionConstructor = getSpeechRecognitionConstructor()
  const isSupported = SpeechRecognitionConstructor !== null

  // Initialize recognition instance
  useEffect(() => {
    if (!SpeechRecognitionConstructor) return

    const recognition = new SpeechRecognitionConstructor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = language
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      setInterimTranscript(interim)

      if (final) {
        onResultRef.current?.(final.trim())
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(event.error)
      setIsListening(false)
      onErrorRef.current?.(event.error, event.message)
    }

    recognition.onend = () => {
      setIsListening(false)
      setInterimTranscript('')
    }

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    recognitionRef.current = recognition

    return () => {
      recognition.abort()
      recognitionRef.current = null
    }
  }, [SpeechRecognitionConstructor, language])

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return

    setError(null)
    setInterimTranscript('')

    try {
      recognitionRef.current.start()
    } catch (err) {
      // Handle case where recognition is already started
      console.warn('Speech recognition start failed:', err)
    }
  }, [isListening])

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListening) return

    try {
      recognitionRef.current.stop()
    } catch (err) {
      console.warn('Speech recognition stop failed:', err)
    }
  }, [isListening])

  const cancelListening = useCallback(() => {
    if (!recognitionRef.current) return

    try {
      recognitionRef.current.abort()
      setIsListening(false)
      setInterimTranscript('')
    } catch (err) {
      console.warn('Speech recognition abort failed:', err)
    }
  }, [])

  return {
    isSupported,
    isListening,
    interimTranscript,
    error,
    startListening,
    stopListening,
    cancelListening,
  }
}
