import { type AppSettings, type ChatSettings as IndividualChatSettings, type UploadedFile } from '@/types';
import { transcribeAudioApi } from '@/services/api/generation/audioApi';
import { prepareAudioForGeminiTranscription } from '@/features/audio/audioCompression';
import { getAudioDurationSeconds } from '@/features/audio/audioDuration';
import { isAudioMimeType, isVideoMimeType } from '@/utils/file/fileTypeClassification';
import { extractAudioFromVideo } from '@/utils/video-subtitles/extractAudioFromVideo';
import { transcribeAudioWithGemini } from '@/utils/video-subtitles/geminiTranscribeService';
import {
  type SubtitleCue,
  groupWordsIntoCues,
  generateSrtContent,
  generateVttContent,
} from '@/utils/video-subtitles/subtitleFormatter';
import { getCachedSubtitles, saveCachedSubtitles } from '@/utils/video-subtitles/subtitleCacheService';
import { formatDuration } from '@/utils/format/durationFormat';
import { runOptimisticMessagePipeline, type MessageLifecycleRunner } from './messagePipeline';
import type { MessageSenderTranslator, SessionsUpdater } from './messageSenderTypes';

/** Gemini 3.5 Transcribe hard caps: 1h per request, 30min with diarization/timestamps enabled. */
const MAX_TRANSCRIPTION_DURATION_SECONDS = 60 * 60;
const MAX_FEATURE_DURATION_SECONDS = 30 * 60;

const enforceTranscriptionDurationLimit = async (
  file: File,
  settings: IndividualChatSettings,
  t: MessageSenderTranslator,
) => {
  const durationSeconds = await getAudioDurationSeconds(file);
  if (durationSeconds === null) {
    return;
  }

  // Word-level timestamps and speaker diarization halve the documented per-request limit.
  const hasLimitingFeatures = Boolean(settings.transcriptionWordTimestamps || settings.transcriptionSpeakerLabels);
  const limitSeconds = hasLimitingFeatures ? MAX_FEATURE_DURATION_SECONDS : MAX_TRANSCRIPTION_DURATION_SECONDS;

  if (durationSeconds > limitSeconds) {
    throw new Error(t('messageSenderTranscribeDurationExceeded'));
  }
};

export interface SendTranscribeMessageParams {
  keyToUse: string;
  activeSessionId: string | null;
  generationId: string;
  abortController: AbortController;
  appSettings: AppSettings;
  currentChatSettings: IndividualChatSettings;
  text: string;
  files: UploadedFile[];
  shouldLockKey?: boolean;
  updateAndPersistSessions: SessionsUpdater;
  setActiveSessionId: (id: string | null) => void;
  runMessageLifecycle: MessageLifecycleRunner;
  t: MessageSenderTranslator;
}

export const sendTranscribeMessage = async ({
  keyToUse,
  activeSessionId,
  generationId,
  abortController,
  appSettings,
  currentChatSettings,
  text,
  files,
  shouldLockKey,
  updateAndPersistSessions,
  setActiveSessionId,
  runMessageLifecycle,
  t,
}: SendTranscribeMessageParams) => {
  const mediaFiles = files.filter((file) => isAudioMimeType(file.type) || isVideoMimeType(file.type));
  if (mediaFiles.length === 0) {
    throw new Error(t('messageSenderTranscribeRequiresMedia') || t('messageSenderTranscribeRequiresAudio'));
  }

  await runOptimisticMessagePipeline({
    activeSessionId,
    appSettings,
    currentChatSettings,
    updateAndPersistSessions,
    setActiveSessionId,
    text,
    files,
    generationId,
    shouldLockKey,
    keyToLock: keyToUse,
    abortController,
    errorPrefix: t('messageSenderTranscribeErrorPrefix'),
    runMessageLifecycle,
    execute: async () => {
      const results: string[] = [];

      for (const mediaFile of mediaFiles) {
        if (abortController.signal.aborted) {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const isVideo = isVideoMimeType(mediaFile.type);
        const shouldOutputSubtitles = isVideo || Boolean(currentChatSettings.transcriptionOutputSubtitles);

        if (shouldOutputSubtitles) {
          let cues: SubtitleCue[];
          let srtContent: string;
          let durationSeconds: number;
          let isFromCache = false;

          const cached = await getCachedSubtitles(mediaFile);
          if (cached && cached.cues.length > 0) {
            cues = cached.cues;
            srtContent = cached.srtContent;
            durationSeconds = cached.durationSeconds ?? 0;
            isFromCache = true;
          } else {
            let audioBlobToTranscribe: Blob;
            let resolvedDurationSeconds: number;

            if (isVideo) {
              if (!(mediaFile.rawFile instanceof Blob)) {
                throw new Error(`Video file data for "${mediaFile.name}" is missing or could not be loaded.`);
              }

              const extracted = await extractAudioFromVideo(mediaFile.rawFile, abortController.signal);
              audioBlobToTranscribe = extracted.audioBlob;
              resolvedDurationSeconds = extracted.durationSeconds;
            } else {
              let fileToTranscribe: File;
              if (mediaFile.rawFile instanceof File) {
                fileToTranscribe = await prepareAudioForGeminiTranscription(mediaFile.rawFile, abortController.signal);
              } else if (mediaFile.rawFile instanceof Blob) {
                const named = new File([mediaFile.rawFile], mediaFile.name || 'audio.mp3', {
                  type: mediaFile.type || mediaFile.rawFile.type || 'audio/mpeg',
                });
                fileToTranscribe = await prepareAudioForGeminiTranscription(named, abortController.signal);
              } else {
                throw new Error('Audio file data is missing or could not be loaded.');
              }

              await enforceTranscriptionDurationLimit(fileToTranscribe, currentChatSettings, t);
              const detectedDuration = await getAudioDurationSeconds(fileToTranscribe);
              resolvedDurationSeconds = detectedDuration ?? 0;
              audioBlobToTranscribe = fileToTranscribe;
            }

            durationSeconds = resolvedDurationSeconds;

            if (durationSeconds > MAX_TRANSCRIPTION_DURATION_SECONDS) {
              throw new Error(t('messageSenderTranscribeDurationExceeded'));
            }

            const annotations = await transcribeAudioWithGemini(
              keyToUse,
              audioBlobToTranscribe,
              `${mediaFile.name.replace(/\.[^/.]+$/, '')}-audio.wav`,
              abortController.signal,
              undefined,
              durationSeconds,
              {
                language: currentChatSettings.transcriptionLanguage || undefined,
                prompt: text.trim() ? text.trim() : undefined,
                systemInstruction: currentChatSettings.transcriptionSystemInstruction?.trim() || undefined,
                customVocabulary: currentChatSettings.transcriptionCustomVocabulary?.trim() || undefined,
              },
            );

            if (abortController.signal.aborted) {
              const abortError = new Error('aborted');
              abortError.name = 'AbortError';
              throw abortError;
            }

            cues = groupWordsIntoCues(annotations);
            srtContent = cues.length > 0 ? generateSrtContent(cues) : '';

            if (cues.length > 0) {
              const vttContent = generateVttContent(cues);
              void saveCachedSubtitles(mediaFile, {
                cues,
                srtContent,
                vttContent,
                durationSeconds,
              });
            }
          }

          const durationText = durationSeconds > 0 ? formatDuration(durationSeconds) : undefined;
          const defaultTitle = isVideo ? '视频字幕提取结果' : '音频字幕提取结果';
          const titleKey = isVideo ? 'transcriptionSubtitlesResultTitle' : 'transcriptionAudioSubtitlesResultTitle';
          const title = t(titleKey) || defaultTitle;
          const icon = isVideo ? '🎬' : '🎙️';

          let outputText = `### ${icon} ${title}：\`${mediaFile.name}\`\n\n`;
          if (durationText) {
            const cacheTag = isFromCache ? ` | ⚡ *(${t('loadedFromCache') || '从本地缓存加载'})*` : '';
            outputText += `> ⏱️ **时长**: ${durationText} | **字幕**: ${cues.length} 句${cacheTag}\n\n`;
          }

          if (cues.length > 0) {
            const srtBlock = `\`\`\`srt\n${srtContent}\n\`\`\``;
            const timelineList = cues
              .map((cue) => `- **[${cue.startTimeSrt} --> ${cue.endTimeSrt}]** ${cue.text}`)
              .join('\n');

            outputText += `#### 📜 SRT 字幕\n${srtBlock}\n\n#### ⏱️ 逐句时间轴\n${timelineList}`;
          } else {
            outputText += t('transcriptionEmptyResult') || '未识别到有效语音内容。';
          }

          results.push(outputText);
        } else {
          let fileToTranscribe: File;
          if (mediaFile.rawFile instanceof File) {
            fileToTranscribe = await prepareAudioForGeminiTranscription(mediaFile.rawFile, abortController.signal);
          } else if (mediaFile.rawFile instanceof Blob) {
            const named = new File([mediaFile.rawFile], mediaFile.name || 'audio.mp3', {
              type: mediaFile.type || mediaFile.rawFile.type || 'audio/mpeg',
            });
            fileToTranscribe = await prepareAudioForGeminiTranscription(named, abortController.signal);
          } else {
            throw new Error('Audio file data is missing or could not be loaded.');
          }

          await enforceTranscriptionDurationLimit(fileToTranscribe, currentChatSettings, t);

          const promptText = text.trim() ? text.trim() : undefined;
          const transcribedText = await transcribeAudioApi(keyToUse, fileToTranscribe, currentChatSettings.modelId, {
            prompt: promptText,
            systemInstruction: currentChatSettings.transcriptionSystemInstruction?.trim() || undefined,
            language: currentChatSettings.transcriptionLanguage || undefined,
            wordTimestamps: currentChatSettings.transcriptionWordTimestamps,
            speakerLabels: currentChatSettings.transcriptionSpeakerLabels,
            smartMode: currentChatSettings.transcriptionSmartMode,
            customVocabulary: currentChatSettings.transcriptionCustomVocabulary?.trim() || undefined,
            abortSignal: abortController.signal,
          });

          if (abortController.signal.aborted) {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            throw abortError;
          }

          const outputText = transcribedText.trim() || t('transcriptionEmptyResult');
          if (mediaFiles.length > 1) {
            results.push(`### 📄 ${mediaFile.name}\n\n${outputText}`);
          } else {
            results.push(outputText);
          }
        }
      }

      const finalContent = results.join('\n\n---\n\n') || t('transcriptionEmptyResult');

      return {
        patch: {
          isLoading: false,
          content: finalContent,
          generationEndTime: new Date(),
        },
        feedback: {
          notification: {
            title: t('messageSenderTranscribeReadyTitle'),
            body: t('messageSenderTranscribeReadyBody'),
          },
        },
      };
    },
  });
};
