import { parseTimeOffsetSecondsOrZero } from '@/utils/media/timeOffset';

export interface WordAnnotation {
  text: string;
  start_offset: string; // e.g. "1.200s"
  end_offset: string; // e.g. "1.550s"
  speaker?: string;
}

export interface SubtitleCue {
  id: number;
  startSeconds: number;
  endSeconds: number;
  startTimeSrt: string; // "00:00:01,200"
  endTimeSrt: string; // "00:00:01,550"
  startTimeVtt: string; // "00:00:01.200"
  endTimeVtt: string; // "00:00:01.550"
  text: string;
  speaker?: string;
  translation?: string;
}

export type SubtitleDisplayMode = 'original' | 'bilingual' | 'translation';

/**
 * Parses offset string (e.g. "1.250s", "12s") to float seconds, defaulting to 0.
 */
export const parseOffsetSeconds = parseTimeOffsetSecondsOrZero;

/**
 * Formats seconds into SRT timestamp format: HH:MM:SS,mmm
 */
export function formatTimestampSrt(seconds: number): string {
  return formatTimestamp(seconds, ',');
}

/**
 * Formats seconds into WebVTT timestamp format: HH:MM:SS.mmm
 */
export function formatTimestampVtt(seconds: number): string {
  return formatTimestamp(seconds, '.');
}

function formatTimestamp(totalSeconds: number, millisecondSeparator: string): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds % 1) * 1000);

  const formattedHours = String(hours).padStart(2, '0');
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  const formattedMilliseconds = String(milliseconds).padStart(3, '0');

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}${millisecondSeparator}${formattedMilliseconds}`;
}

const TERMINAL_PUNCTUATION_REGEX = /[.?!。？！]$/;
const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff]/;

/**
 * Groups fine-grained word annotations from Gemini 3.5 Transcribe into natural subtitle lines.
 */
export function groupWordsIntoCues(words: WordAnnotation[]): SubtitleCue[] {
  if (!words || words.length === 0) return [];

  const cues: SubtitleCue[] = [];
  let currentWords: WordAnnotation[] = [];

  const flushCurrentWords = () => {
    if (currentWords.length === 0) return;

    const firstWord = currentWords[0];
    const lastWord = currentWords[currentWords.length - 1];

    const startSeconds = parseOffsetSeconds(firstWord.start_offset);
    const endSeconds = Math.max(startSeconds, parseOffsetSeconds(lastWord.end_offset));

    // Combine words cleanly (avoid spaces between adjacent CJK characters)
    let combinedText = '';
    for (const annotation of currentWords) {
      const wordText = annotation.text.trim();
      if (!wordText) continue;

      if (combinedText.length === 0) {
        combinedText = wordText;
      } else {
        const lastChar = combinedText[combinedText.length - 1];
        const firstChar = wordText[0];
        const isBothCjk = CJK_REGEX.test(lastChar) && CJK_REGEX.test(firstChar);
        combinedText += isBothCjk ? wordText : ` ${wordText}`;
      }
    }

    cues.push({
      id: cues.length + 1,
      startSeconds,
      endSeconds,
      startTimeSrt: formatTimestampSrt(startSeconds),
      endTimeSrt: formatTimestampSrt(endSeconds),
      startTimeVtt: formatTimestampVtt(startSeconds),
      endTimeVtt: formatTimestampVtt(endSeconds),
      text: combinedText,
      speaker: firstWord.speaker,
    });

    currentWords = [];
  };

  for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
    const word = words[wordIndex];

    if (currentWords.length > 0) {
      const previousWord = currentWords[currentWords.length - 1];
      const previousEnd = parseOffsetSeconds(previousWord.end_offset);
      const currentStart = parseOffsetSeconds(word.start_offset);

      const silenceGap = currentStart - previousEnd;
      const isPauseBreak = silenceGap > 0.45;
      const isPunctuationBreak = TERMINAL_PUNCTUATION_REGEX.test(previousWord.text.trim());
      const isSpeakerChange = Boolean(word.speaker && previousWord.speaker && word.speaker !== previousWord.speaker);

      const firstStart = parseOffsetSeconds(currentWords[0].start_offset);
      const isDurationLimit = currentStart - firstStart >= 5.5;
      const textLength = currentWords.reduce((totalLength, currentWord) => totalLength + currentWord.text.length, 0);
      const isLengthLimit = textLength >= 60;

      if (isPauseBreak || isPunctuationBreak || isSpeakerChange || isDurationLimit || isLengthLimit) {
        flushCurrentWords();
      }
    }

    currentWords.push(word);
  }

  flushCurrentWords();
  return cues;
}

/**
 * Serializes SubtitleCue[] into standard SubRip (.srt) format.
 * Supports bilingual (original + translation) or translation-only output.
 */
export function generateSrtContent(cues: SubtitleCue[], options?: { mode?: SubtitleDisplayMode }): string {
  const mode = options?.mode || 'original';
  return cues
    .map((cue) => {
      const speakerPrefix = cue.speaker ? `[${cue.speaker}] ` : '';
      let contentText = `${speakerPrefix}${cue.text}`;
      if (mode === 'bilingual' && cue.translation) {
        contentText = `${speakerPrefix}${cue.text}\n${cue.translation}`;
      } else if (mode === 'translation' && cue.translation) {
        contentText = `${speakerPrefix}${cue.translation}`;
      }
      return `${cue.id}\n${cue.startTimeSrt} --> ${cue.endTimeSrt}\n${contentText}\n`;
    })
    .join('\n');
}

/**
 * Serializes SubtitleCue[] into standard WebVTT (.vtt) format.
 * Supports line positioning (defaults to line:84% so cues float above video control bars)
 * and bilingual / translation-only modes.
 */
export function generateVttContent(
  cues: SubtitleCue[],
  options?: { line?: string; mode?: SubtitleDisplayMode },
): string {
  const lineParam = options?.line !== undefined ? options.line : '84%';
  const lineSuffix = lineParam ? ` line:${lineParam}` : '';
  const mode = options?.mode || 'original';

  const cuesBody = cues
    .map((cue) => {
      const speakerPrefix = cue.speaker ? `<v ${cue.speaker}>` : '';
      const speakerSuffix = cue.speaker ? '</v>' : '';
      let contentLines = `${speakerPrefix}${cue.text}${speakerSuffix}`;
      if (mode === 'bilingual' && cue.translation) {
        contentLines = `${speakerPrefix}${cue.text}${speakerSuffix}\n${cue.translation}`;
      } else if (mode === 'translation' && cue.translation) {
        contentLines = `${speakerPrefix}${cue.translation}${speakerSuffix}`;
      }
      return `${cue.id}\n${cue.startTimeVtt} --> ${cue.endTimeVtt}${lineSuffix}\n${contentLines}\n`;
    })
    .join('\n');

  return `WEBVTT\n\n${cuesBody}`;
}

/**
 * Triggers a browser file download for text/blob content.
 */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = filename;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  document.body.removeChild(downloadAnchor);
  URL.revokeObjectURL(url);
}
