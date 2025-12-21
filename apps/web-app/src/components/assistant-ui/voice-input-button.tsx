"use client";

import { type FC, useState, useCallback, useRef, useEffect } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useComposerRuntime } from "@assistant-ui/react";
import { useVoiceInput, type VoiceInputError } from "@/hooks/useVoiceInput";
import { TooltipIconButton } from "./tooltip-icon-button";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getErrorMessage(error: VoiceInputError): string {
  switch (error.type) {
    case "permission-denied":
      return "Please allow microphone access";
    case "no-microphone":
      return "No microphone found";
    case "no-speech":
      return "No speech detected";
    case "network":
      return "Network error";
    default:
      return "Voice input failed";
  }
}

export const VoiceInputButton: FC = () => {
  const composer = useComposerRuntime();
  const [showError, setShowError] = useState(false);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTranscript = useCallback(
    (text: string) => {
      const currentText = composer.getState().text;
      const newText = currentText ? `${currentText} ${text}` : text;
      composer.setText(newText);
    },
    [composer],
  );

  const handleError = useCallback((error: VoiceInputError) => {
    console.error("Voice input error:", error);
    setShowError(true);

    // Clear previous timeout
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }

    // Hide error after 3 seconds
    errorTimeoutRef.current = setTimeout(() => {
      setShowError(false);
    }, 4000);
  }, []);

  const {
    isSupported,
    isListening,
    isProcessing,
    duration,
    interimTranscript,
    error,
    startListening,
    stopListening,
    cancelListening,
  } = useVoiceInput({
    onTranscript: handleTranscript,
    onError: handleError,
  });

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  // Don't render if voice input is not supported
  if (!isSupported) {
    return null;
  }

  // Hold-to-record handlers
  const handlePointerDown = () => {
    if (!isProcessing) {
      setShowError(false);
      startListening();
    }
  };

  const handlePointerUp = () => {
    if (isListening) {
      stopListening();
    }
  };

  const handlePointerLeave = () => {
    if (isListening) {
      cancelListening();
    }
  };

  // Keyboard accessibility - toggle mode
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (isListening) {
        stopListening();
      } else if (!isProcessing) {
        setShowError(false);
        startListening();
      }
    } else if (e.key === "Escape" && isListening) {
      e.preventDefault();
      cancelListening();
    }
  };

  // Determine current state for UI
  const hasError = showError && error;

  const getTooltip = () => {
    if (hasError) return getErrorMessage(error);
    if (isProcessing) return "Transcribing...";
    if (isListening) return "Recording... Release to send";
    return "Hold to record";
  };

  const getAriaLabel = () => {
    if (isProcessing) return "Transcribing speech";
    if (isListening) return `Recording, ${formatDuration(duration)}`;
    return "Hold to record voice message";
  };

  return (
    <div className="relative">
      <TooltipIconButton
        tooltip={getTooltip()}
        side="top"
        variant="ghost"
        size="icon"
        className={cn(
          "aui-voice-input size-[34px] rounded-full p-1 transition-colors",
          isListening &&
            "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400",
          isProcessing && "text-muted-foreground",
          hasError && "text-destructive",
        )}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
        disabled={isProcessing}
        aria-label={getAriaLabel()}
        aria-pressed={isListening}
      >
        {isProcessing ? (
          <Loader2 className="size-5 animate-spin" />
        ) : hasError ? (
          <MicOff className="size-5" />
        ) : (
          <Mic className="size-5" />
        )}
      </TooltipIconButton>

      {/* Recording indicator */}
      {isListening && (
        <div className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full bg-red-500 px-1.5 py-0.5">
          <span className="size-1.5 animate-pulse rounded-full bg-white" />
          <span className="text-[10px] font-medium text-white">
            {formatDuration(duration)}
          </span>
        </div>
      )}

      {/* Interim transcript preview */}
      {interimTranscript && (
        <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
          {interimTranscript}
        </div>
      )}

      {/* Screen reader announcements */}
      <div className="sr-only" aria-live="assertive">
        {isListening && "Recording audio"}
        {isProcessing && "Transcribing speech"}
        {hasError && `Error: ${getErrorMessage(error)}`}
      </div>
    </div>
  );
};
