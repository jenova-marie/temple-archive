// Utilities
export { cn } from "./utils.js";

// NOTE: Container paths (getContainerRoot, containerPath, ContainerPaths)
// are NOT exported here because they use Node.js APIs.
// Import from '@siri/shared/server' for server-side code.

// Guides
export { GUIDES, DEFAULT_GUIDE_ID } from "./guides.js";
export type { Guide } from "./guides.js";

// WebSocket types
export type { ClientMessage, ServerMessage } from "./websocket.js";

// Audio/Transcription
export { MAX_AUDIO_SIZE_BYTES, SUPPORTED_AUDIO_TYPES } from "./audio.js";
export type {
  Transcription,
  TranscribeResponse,
  HistoryResponse,
  ErrorResponse,
} from "./audio.js";
