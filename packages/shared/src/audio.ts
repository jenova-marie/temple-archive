/**
 * Audio transcription constants and types
 */

/**
 * Maximum audio file size in bytes (25MB)
 */
export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Supported audio MIME types for transcription
 */
export const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
] as const;

/**
 * Transcription record
 */
export interface Transcription {
  id: string;
  text: string;
  duration: number | null;
  source: string;
  filename: string | null;
  createdAt: string;
}

/**
 * Response for transcription request
 */
export interface TranscribeResponse {
  transcription: Transcription;
}

/**
 * Response for transcription history
 */
export interface HistoryResponse {
  transcriptions: Transcription[];
}

/**
 * Generic error response
 */
export interface ErrorResponse {
  error: string;
}
