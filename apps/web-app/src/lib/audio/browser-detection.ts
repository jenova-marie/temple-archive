export interface AudioCapabilities {
  webSpeechAPI: boolean
  mediaRecorder: boolean
  preferredMethod: 'web-speech' | 'media-recorder' | 'none'
}

export function detectAudioCapabilities(): AudioCapabilities {
  if (typeof window === 'undefined') {
    return { webSpeechAPI: false, mediaRecorder: false, preferredMethod: 'none' }
  }

  const webSpeechAPI = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  const mediaRecorder =
    'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia !== undefined

  // Web Speech API requires HTTPS (except localhost in some browsers, but unreliable)
  // Always prefer MediaRecorder + backend transcription for consistency
  const isSecureContext = window.isSecureContext && window.location.protocol === 'https:'

  const preferredMethod: AudioCapabilities['preferredMethod'] = mediaRecorder
    ? 'media-recorder'
    : (webSpeechAPI && isSecureContext)
      ? 'web-speech'
      : 'none'

  return { webSpeechAPI, mediaRecorder, preferredMethod }
}

export function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null

  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]

  return mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export function getSpeechRecognitionConstructor(): (new () => import('@/types/speech-recognition').SpeechRecognition) | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}
