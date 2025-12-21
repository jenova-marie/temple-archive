import { useMicVAD } from '@ricky0123/vad-react'
import { useCallback, useRef } from 'react'
import { float32ToWav, blobToBase64 } from '@/lib/audio/encoding'

interface UseVADOptions {
  /** Called when speech ends with base64-encoded audio and segment ID */
  onSpeechEnd: (audioBase64: string, segmentId: number) => void
  /** Called when speech starts */
  onSpeechStart?: () => void
  /** Called on VAD error */
  onError?: (error: Error) => void
}

interface UseVADReturn {
  /** Whether VAD is actively listening for speech */
  isListening: boolean
  /** Whether user is currently speaking */
  isSpeaking: boolean
  /** Whether VAD is loading/initializing */
  isLoading: boolean
  /** VAD error if any */
  error: Error | null
  /** Start listening for speech */
  start: () => void
  /** Stop listening for speech */
  stop: () => void
  /** Toggle listening state */
  toggle: () => void
}

/**
 * Voice Activity Detection hook using @ricky0123/vad-react
 * Automatically detects when user starts and stops speaking
 */
export function useVAD({ onSpeechEnd, onSpeechStart, onError }: UseVADOptions): UseVADReturn {
  const segmentIdRef = useRef(0)

  const vad = useMicVAD({
    startOnLoad: false,
    // Use CDN for VAD assets (works reliably with Vite)
    baseAssetPath: "https://unpkg.com/@ricky0123/vad-web@0.0.30/dist/",
    onnxWASMBasePath: "https://unpkg.com/onnxruntime-web@1.23.2/dist/",
    // Tuned thresholds for reliable detection
    positiveSpeechThreshold: 0.8,
    negativeSpeechThreshold: 0.65,
    redemptionMs: 100, // Prevent false stops (8 frames * ~12ms = ~100ms)
    preSpeechPadMs: 250, // Padding before speech
    minSpeechMs: 250, // Minimum speech duration
    onSpeechStart: () => {
      onSpeechStart?.()
    },
    onSpeechEnd: async (audio: Float32Array) => {
      try {
        // Convert audio to WAV and then to base64
        const wavBlob = float32ToWav(audio, 16000) // VAD uses 16kHz
        const base64 = await blobToBase64(wavBlob)

        const currentSegmentId = segmentIdRef.current++
        onSpeechEnd(base64, currentSegmentId)
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error('Failed to process audio'))
      }
    },
    onVADMisfire: () => {
      // Speech was too short, ignore
    },
  })

  const start = useCallback(() => {
    vad.start()
  }, [vad])

  const stop = useCallback(() => {
    vad.pause()
  }, [vad])

  const toggle = useCallback(() => {
    if (vad.listening) {
      vad.pause()
    } else {
      vad.start()
    }
  }, [vad])

  return {
    isListening: vad.listening,
    isSpeaking: vad.userSpeaking,
    isLoading: vad.loading,
    error: vad.errored
      ? new Error(typeof vad.errored === 'string' ? vad.errored : 'VAD initialization failed')
      : null,
    start,
    stop,
    toggle,
  }
}
