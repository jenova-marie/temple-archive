const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export interface TranscribeResponse {
  transcript: string;
  confidence?: number;
  language?: string;
}

export interface TranscribeError {
  error: string;
  message: string;
}

export async function transcribeAudio(
  audioBlob: Blob,
  language: string = "en-US",
): Promise<TranscribeResponse> {
  const formData = new FormData();

  // Determine file extension from MIME type
  const extension = audioBlob.type.includes("webm")
    ? "webm"
    : audioBlob.type.includes("mp4")
      ? "m4a"
      : audioBlob.type.includes("ogg")
        ? "ogg"
        : "wav";

  formData.append("audio", audioBlob, `recording.${extension}`);
  formData.append("language", language);

  const response = await fetch(`${API_BASE_URL}/api/v1/transcribe`, {
    method: "POST",
    body: formData,
    // Don't set Content-Type - browser will set it with boundary for multipart
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: "unknown",
      message: `Transcription failed: ${response.status}`,
    }));
    throw new Error(errorData.message || "Transcription failed");
  }

  return response.json();
}
