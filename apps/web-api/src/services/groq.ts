import Groq from 'groq-sdk';
import { env } from '../env.js';

const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = 'audio.webm'
): Promise<TranscriptionResult> {
  const file = new File([audioBuffer], filename, { type: 'audio/webm' });

  const transcription = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    response_format: 'verbose_json',
  });

  // verbose_json response includes duration but the SDK types may not reflect it
  const response = transcription as { text: string; duration?: number };

  return {
    text: response.text,
    duration: response.duration,
  };
}
