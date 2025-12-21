import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@pippa/shared";

interface UseTranscriptionWebSocketOptions {
  /** API base URL (defaults to VITE_TRANSCRIPTION_API_URL or VITE_API_BASE_URL) */
  apiBaseUrl?: string;
  /** Called when transcription is received */
  onTranscription: (text: string, segmentId: number) => void;
  /** Called on WebSocket error */
  onError: (message: string) => void;
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
}

interface UseTranscriptionWebSocketReturn {
  /** Whether WebSocket is connected */
  isConnected: boolean;
  /** Connect to WebSocket server */
  connect: () => void;
  /** Disconnect from WebSocket server */
  disconnect: () => void;
  /** Send audio segment for transcription */
  sendAudioSegment: (audioBase64: string, segmentId: number) => boolean;
  /** Signal end of session */
  stopSession: () => void;
}

/**
 * WebSocket hook for real-time audio transcription
 * Connects to the @pippa/api WebSocket endpoint
 */
export function useTranscriptionWebSocket({
  apiBaseUrl,
  onTranscription,
  onError,
  autoConnect = true,
}: UseTranscriptionWebSocketOptions): UseTranscriptionWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const hadSuccessfulConnectionRef = useRef(false);

  // Derive WebSocket URL from API base URL
  const getWebSocketUrl = useCallback(() => {
    // Use transcription-specific URL, fall back to general API URL
    const baseUrl =
      apiBaseUrl ||
      import.meta.env.VITE_TRANSCRIPTION_API_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:61665";
    const url = new URL(baseUrl);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}/ws/stream`;
  }, [apiBaseUrl]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = getWebSocketUrl();
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      hadSuccessfulConnectionRef.current = true;
      console.log("[TranscriptionWS] Connected");
    };

    ws.onmessage = (event) => {
      try {
        const message: ServerMessage = JSON.parse(event.data);

        if (message.type === "transcription") {
          onTranscription(message.text, message.segmentId);
        } else if (message.type === "error") {
          onError(message.message);
        }
      } catch (err) {
        console.error("[TranscriptionWS] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log("[TranscriptionWS] Disconnected");

      // Only auto-reconnect if we had a successful connection before
      // (i.e., connection was lost, not failed to establish)
      if (hadSuccessfulConnectionRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    ws.onerror = (error) => {
      console.error("[TranscriptionWS] Error:", error);
    };

    wsRef.current = ws;
  }, [getWebSocketUrl, onTranscription, onError]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendAudioSegment = useCallback(
    (audioBase64: string, segmentId: number) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("[TranscriptionWS] Not connected");
        return false;
      }

      const message: ClientMessage = {
        type: "audio_segment",
        data: audioBase64,
        segmentId,
      };

      wsRef.current.send(JSON.stringify(message));
      return true;
    },
    [],
  );

  const stopSession = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    const message: ClientMessage = { type: "stop_session" };
    wsRef.current.send(JSON.stringify(message));
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
    sendAudioSegment,
    stopSession,
  };
}
