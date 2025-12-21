"use client"

import { type FC, useState, useCallback, useRef, useEffect } from "react"
import { Mic, MicOff, Loader2 } from "lucide-react"
import { useComposerRuntime } from "@assistant-ui/react"
import { useVAD } from "@/hooks/useVAD"
import { useTranscriptionWebSocket } from "@/hooks/useTranscriptionWebSocket"
import { TooltipIconButton } from "./tooltip-icon-button"
import { cn } from "@/lib/utils"

interface TranscriptionSegment {
  id: number
  text: string
  pending: boolean
}

export const VADVoiceInputButton: FC = () => {
  const composer = useComposerRuntime()
  const [_segments, setSegments] = useState<TranscriptionSegment[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handle transcription results
  const handleTranscription = useCallback(
    (text: string, segmentId: number) => {
      // Update segment with transcription
      setSegments((prev) =>
        prev.map((seg) =>
          seg.id === segmentId ? { ...seg, text, pending: false } : seg
        )
      )
      setPendingCount((c) => Math.max(0, c - 1))

      // Append to composer
      const currentText = composer.getState().text
      const newText = currentText ? `${currentText} ${text}` : text
      composer.setText(newText)
    },
    [composer]
  )

  // Handle WebSocket errors
  const handleWSError = useCallback((message: string) => {
    setError(message)
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current)
    }
    errorTimeoutRef.current = setTimeout(() => setError(null), 4000)
  }, [])

  // WebSocket connection - don't auto-connect, let user initiate
  const { isConnected, sendAudioSegment, connect } = useTranscriptionWebSocket({
    onTranscription: handleTranscription,
    onError: handleWSError,
    autoConnect: false,
  })

  // Handle speech end from VAD
  const handleSpeechEnd = useCallback(
    (audioBase64: string, segmentId: number) => {
      // Add pending segment
      setSegments((prev) => [...prev, { id: segmentId, text: "", pending: true }])
      setPendingCount((c) => c + 1)

      // Send to WebSocket
      const sent = sendAudioSegment(audioBase64, segmentId)
      if (!sent) {
        handleWSError("Not connected to transcription service")
        setPendingCount((c) => Math.max(0, c - 1))
        setSegments((prev) => prev.filter((s) => s.id !== segmentId))
      }
    },
    [sendAudioSegment, handleWSError]
  )

  // VAD hook
  const {
    isListening,
    isSpeaking,
    isLoading,
    error: vadError,
    toggle,
  } = useVAD({
    onSpeechEnd: handleSpeechEnd,
    onSpeechStart: () => {
      setError(null)
    },
    onError: (err) => {
      handleWSError(err.message)
    },
  })

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current)
      }
    }
  }, [])

  // Determine UI state
  const hasError = error !== null || vadError !== null
  const errorMessage = error || vadError?.message || "Voice input error"
  const isProcessing = pendingCount > 0

  const getTooltip = () => {
    if (hasError) return errorMessage
    if (isLoading) return "Initializing..."
    if (isSpeaking) return "Listening... (speaking)"
    if (isListening) return "Listening for speech..."
    if (!isConnected) return "Not connected - click to retry"
    return "Click to start voice input"
  }

  const getAriaLabel = () => {
    if (isLoading) return "Initializing voice input"
    if (isSpeaking) return "Recording speech"
    if (isListening) return "Listening for speech"
    return "Start voice input"
  }

  return (
    <div className="relative">
      <TooltipIconButton
        tooltip={getTooltip()}
        side="top"
        variant="ghost"
        size="icon"
        className={cn(
          "aui-voice-input size-[34px] rounded-full p-1 transition-all",
          isListening &&
            "bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400",
          isSpeaking &&
            "ring-4 ring-green-500/50 bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
          isLoading && "text-muted-foreground",
          hasError && "text-destructive",
          !isConnected && !isLoading && "text-muted-foreground"
        )}
        onClick={() => {
          if (!isConnected) {
            // Try to connect first
            connect()
          }
          // Toggle VAD regardless - it will show error if WS not connected when speech ends
          toggle()
        }}
        disabled={isLoading}
        aria-label={getAriaLabel()}
        aria-pressed={isListening}
      >
        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : hasError ? (
          <MicOff className="size-5" />
        ) : isListening ? (
          <Mic className="size-5" />
        ) : (
          <Mic className="size-5" />
        )}
      </TooltipIconButton>

      {/* Listening indicator */}
      {isListening && !isSpeaking && (
        <div className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full bg-green-500 px-1.5 py-0.5">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
        </div>
      )}

      {/* Speaking indicator */}
      {isSpeaking && (
        <div className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full bg-green-500 px-1.5 py-0.5">
          <span className="size-1.5 animate-ping rounded-full bg-white" />
          <span className="text-[10px] font-medium text-white">REC</span>
        </div>
      )}

      {/* Pending segments indicator */}
      {isProcessing && !isListening && (
        <div className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5">
          <Loader2 className="size-2 animate-spin text-white" />
          <span className="text-[10px] font-medium text-white">{pendingCount}</span>
        </div>
      )}

      {/* Connection status dot */}
      <div
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-background",
          isConnected ? "bg-green-500" : "bg-red-500"
        )}
        title={isConnected ? "Connected" : "Disconnected"}
      />

      {/* Screen reader announcements */}
      <div className="sr-only" aria-live="assertive">
        {isSpeaking && "Recording speech"}
        {isListening && !isSpeaking && "Listening for speech"}
        {isProcessing && `Transcribing ${pendingCount} segments`}
        {hasError && `Error: ${errorMessage}`}
      </div>
    </div>
  )
}
