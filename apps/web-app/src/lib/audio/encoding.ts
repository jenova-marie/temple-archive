/**
 * Audio encoding utilities for VAD-based voice input
 */

/**
 * Converts Float32Array audio samples to WAV format
 * @param float32Array - Raw audio samples from VAD
 * @param sampleRate - Sample rate (typically 16000 from VAD)
 * @returns WAV blob
 */
export function float32ToWav(float32Array: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + float32Array.length * 2)
  const view = new DataView(buffer)

  // WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + float32Array.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM format
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // Mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, float32Array.length * 2, true)

  // Convert float32 to int16
  const offset = 44
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Converts a Blob to base64 string
 * @param blob - Audio blob to convert
 * @returns Promise resolving to base64 string (without data URI prefix)
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
