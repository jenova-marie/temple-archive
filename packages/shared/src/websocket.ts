/**
 * WebSocket message types for transcription streaming
 */

/**
 * Message from client to server
 */
export type ClientMessage =
  | { type: "audio_segment"; data: string; segmentId: number }
  | { type: "stop_session" };

/**
 * Message from server to client
 */
export type ServerMessage =
  | { type: "transcription"; text: string; segmentId: number }
  | { type: "error"; message: string }
  | { type: "session_ended" };
