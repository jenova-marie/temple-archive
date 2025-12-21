import { useState, useCallback, useRef, useEffect } from 'react'
import { getSupportedMimeType } from '@/lib/audio/browser-detection'
import { transcribeAudio } from '@/lib/audio/transcribe'

export interface UseMediaRecorderSTTOptions {
  language?: string
  onResult?: (transcript: string) => void
  onError?: (error: Error) => void
}

export interface UseMediaRecorderSTTReturn {
  isSupported: boolean
  isRecording: boolean
  isProcessing: boolean
  duration: number
  error: Error | null
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  cancelRecording: () => void
}

export function useMediaRecorderSTT(
  options: UseMediaRecorderSTTOptions = {}
): UseMediaRecorderSTTReturn {
  const { language = 'en-US', onResult, onError } = options

  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef = useRef(false)

  const mimeType = getSupportedMimeType()
  const isSupported =
    typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    navigator.mediaDevices?.getUserMedia !== undefined &&
    mimeType !== null

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (!isSupported || isRecording || isProcessing) return

    setError(null)
    setDuration(0)
    chunksRef.current = []
    cancelledRef.current = false

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const recorder = new MediaRecorder(stream, { mimeType: mimeType! })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.start(100) // Collect data every 100ms
      setIsRecording(true)

      // Track duration
      const startTime = Date.now()
      durationIntervalRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000))
      }, 100)
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to access microphone')
      setError(error)
      onError?.(error)
    }
  }, [isSupported, isRecording, isProcessing, mimeType, onError])

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecording) return

    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    return new Promise<void>((resolve) => {
      const recorder = mediaRecorderRef.current!

      recorder.onstop = async () => {
        setIsRecording(false)

        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }

        // Check if cancelled
        if (cancelledRef.current) {
          chunksRef.current = []
          resolve()
          return
        }

        // Create blob and transcribe
        if (chunksRef.current.length > 0) {
          const audioBlob = new Blob(chunksRef.current, { type: mimeType! })
          chunksRef.current = []

          setIsProcessing(true)
          try {
            const result = await transcribeAudio(audioBlob, language)
            onResult?.(result.transcript)
          } catch (err) {
            const error = err instanceof Error ? err : new Error('Transcription failed')
            setError(error)
            onError?.(error)
          } finally {
            setIsProcessing(false)
          }
        }

        resolve()
      }

      recorder.stop()
    })
  }, [isRecording, mimeType, language, onResult, onError])

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    setIsRecording(false)
    setDuration(0)
    chunksRef.current = []
  }, [isRecording])

  return {
    isSupported,
    isRecording,
    isProcessing,
    duration,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}
