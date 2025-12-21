import { useCallback, useMemo } from 'react'
import { detectAudioCapabilities } from '@/lib/audio/browser-detection'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useMediaRecorderSTT } from './useMediaRecorderSTT'
import type { SpeechRecognitionErrorCode } from '@/types/speech-recognition'

export type VoiceInputErrorType =
  | 'permission-denied'
  | 'no-microphone'
  | 'no-speech'
  | 'network'
  | 'not-supported'
  | 'unknown'

export interface VoiceInputError {
  type: VoiceInputErrorType
  message: string
}

export interface UseVoiceInputOptions {
  language?: string
  onTranscript: (text: string) => void
  onError?: (error: VoiceInputError) => void
}

export interface UseVoiceInputReturn {
  isSupported: boolean
  isListening: boolean
  isProcessing: boolean
  method: 'web-speech' | 'media-recorder' | null
  duration: number
  interimTranscript: string
  error: VoiceInputError | null
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  cancelListening: () => void
}

function mapSpeechRecognitionError(error: SpeechRecognitionErrorCode): VoiceInputError | null {
  switch (error) {
    case 'not-allowed':
      return { type: 'permission-denied', message: 'Microphone access denied' }
    case 'audio-capture':
      return { type: 'no-microphone', message: 'No microphone found' }
    case 'no-speech':
      return { type: 'no-speech', message: 'No speech detected' }
    case 'network':
      return { type: 'network', message: 'Network error during transcription' }
    case 'service-not-available':
      return { type: 'network', message: 'Speech service unavailable' }
    case 'aborted':
      // User cancelled - not an error
      return null
    default:
      return { type: 'unknown', message: `Speech recognition error: ${error}` }
  }
}

function mapMediaRecorderError(error: Error): VoiceInputError {
  const message = error.message.toLowerCase()

  if (message.includes('permission') || message.includes('not allowed')) {
    return { type: 'permission-denied', message: 'Microphone access denied' }
  }
  if (message.includes('not found') || message.includes('no device')) {
    return { type: 'no-microphone', message: 'No microphone found' }
  }
  if (message.includes('network') || message.includes('fetch')) {
    return { type: 'network', message: 'Network error during transcription' }
  }

  return { type: 'unknown', message: error.message }
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputReturn {
  const { language = 'en-US', onTranscript, onError } = options

  const capabilities = useMemo(() => detectAudioCapabilities(), [])

  // Web Speech API hook
  const speechRecognition = useSpeechRecognition({
    language,
    onResult: onTranscript,
    onError: (code, _message) => {
      const error = mapSpeechRecognitionError(code)
      if (error) {
        onError?.(error)
      }
    },
  })

  // MediaRecorder fallback hook
  const mediaRecorder = useMediaRecorderSTT({
    language,
    onResult: onTranscript,
    onError: (err) => {
      onError?.(mapMediaRecorderError(err))
    },
  })

  const method = capabilities.preferredMethod === 'none' ? null : capabilities.preferredMethod
  const isSupported = method !== null

  // Determine current state based on active method
  const isListening =
    method === 'web-speech' ? speechRecognition.isListening : mediaRecorder.isRecording

  const isProcessing = method === 'media-recorder' ? mediaRecorder.isProcessing : false

  const duration = method === 'media-recorder' ? mediaRecorder.duration : 0

  const interimTranscript =
    method === 'web-speech' ? speechRecognition.interimTranscript : ''

  const error: VoiceInputError | null = (() => {
    if (method === 'web-speech' && speechRecognition.error) {
      return mapSpeechRecognitionError(speechRecognition.error) ?? null
    }
    if (method === 'media-recorder' && mediaRecorder.error) {
      return mapMediaRecorderError(mediaRecorder.error)
    }
    return null
  })()

  const startListening = useCallback(async () => {
    if (method === 'web-speech') {
      speechRecognition.startListening()
    } else if (method === 'media-recorder') {
      await mediaRecorder.startRecording()
    }
  }, [method, speechRecognition, mediaRecorder])

  const stopListening = useCallback(async () => {
    if (method === 'web-speech') {
      speechRecognition.stopListening()
    } else if (method === 'media-recorder') {
      await mediaRecorder.stopRecording()
    }
  }, [method, speechRecognition, mediaRecorder])

  const cancelListening = useCallback(() => {
    if (method === 'web-speech') {
      speechRecognition.cancelListening()
    } else if (method === 'media-recorder') {
      mediaRecorder.cancelRecording()
    }
  }, [method, speechRecognition, mediaRecorder])

  return {
    isSupported,
    isListening,
    isProcessing,
    method,
    duration,
    interimTranscript,
    error,
    startListening,
    stopListening,
    cancelListening,
  }
}
