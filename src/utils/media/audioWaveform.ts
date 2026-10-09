import { createLruCache } from '@/utils/cache/lruCache';

// Bounded LRU cache for computed audio waveform amplitude bars
const AUDIO_WAVEFORM_CACHE_LIMIT = 50;
const audioWaveformCache = createLruCache<number[]>({ limit: AUDIO_WAVEFORM_CACHE_LIMIT });

export const readAudioWaveformCache = (id: string): number[] | undefined => audioWaveformCache.get(id);
export const writeAudioWaveformCache = (id: string, peaks: number[]): void => audioWaveformCache.set(id, peaks);

/**
 * Deterministic waveform generator: creates an aesthetic, natural-looking audio envelope from seed string.
 * Used as fallback or instant representation before audio data finishes decoding.
 */
export const generateDeterministicWaveform = (seedString: string, count = 32): number[] => {
  let hash = 0;
  for (let index = 0; index < seedString.length; index++) {
    hash = ((hash << 5) - hash + seedString.charCodeAt(index)) | 0;
  }
  const result: number[] = [];
  for (let index = 0; index < count; index++) {
    const normalizedPosition = count > 1 ? index / (count - 1) : 0.5;
    const envelope = Math.sin(Math.PI * normalizedPosition) * 0.45 + 0.35;
    const pseudo = Math.abs(Math.sin((hash + index * 137.5) * 12.9898) * 43758.5453) % 1;
    const amplitude = Math.min(0.95, Math.max(0.14, envelope + (pseudo - 0.5) * 0.4));
    result.push(Number(amplitude.toFixed(3)));
  }
  return result;
};

/**
 * Extract real amplitude peaks from an audio blob via Web Audio API (browser runtime).
 */
export const decodeAudioWaveform = async (blob: Blob, count = 32): Promise<number[] | null> => {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContextClass();
    const slice = blob.slice(0, 1024 * 1024 * 3); // 3MB slice for thorough peak extraction
    const arrayBuffer = await slice.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);
    if (!channelData || channelData.length === 0) return null;

    const blockSize = Math.floor(channelData.length / count);
    if (blockSize <= 0) return null;

    const rawPeaks: number[] = [];
    for (let index = 0; index < count; index++) {
      let sum = 0;
      const start = index * blockSize;
      const end = Math.min(start + blockSize, channelData.length);
      for (let channelIndex = start; channelIndex < end; channelIndex++) {
        sum += Math.abs(channelData[channelIndex]);
      }
      rawPeaks.push(sum / (end - start));
    }

    const maxPeak = Math.max(...rawPeaks, 0.001);
    return rawPeaks.map((peak) => Number(Math.min(1, Math.max(0.14, peak / maxPeak)).toFixed(3)));
  } catch {
    return null;
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close();
    }
  }
};
