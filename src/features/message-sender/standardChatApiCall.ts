import { updateSessionById } from '@/utils/chat/sessionMutations';
import { clearPendingStreamJob } from '@/features/stream-jobs/amcStreamJobs';
import { resolveChatApiRoute, isUnavailableThirdPartyRoute } from '@/utils/chat/chatApiRoute';
import { prepareStandardChatContext } from './standardChatContext';
import { executeThirdPartyChat } from './standardChatThirdParty';
import { executeGeminiChat } from './standardChatGemini';
import type {
  ChatMessage,
  ChatSettings as IndividualChatSettings,
  NonStreamMessageCompleteHandler,
  UploadedFile,
} from '@/types';
import type { ContentPart } from '@/types/chat';
import type {
  GetStreamHandlers,
  SessionsUpdater,
  StandardChatProps,
  StreamHandlerFunctions,
} from './messageSenderTypes';
import type { resolveStandardChatTurn } from './standardChatTurn';

interface StandardChatApiCallContext {
  appSettings: StandardChatProps['appSettings'];
  messages: ChatMessage[];
  updateAndPersistSessions: SessionsUpdater;
  getStreamHandlers: GetStreamHandlers;
  aspectRatio: string;
  imageSize?: string;
  imageOutputMode: StandardChatProps['imageOutputMode'];
  resolveTurn: typeof resolveStandardChatTurn;
}

export interface PerformStandardChatApiCallParams extends StandardChatApiCallContext {
  finalSessionId: string;
  generationId: string;
  generationStartTime: Date;
  keyToUse: string;
  activeModelId: string;
  promptParts: ContentPart[];
  effectiveEditingId: string | null;
  isContinueMode: boolean;
  isRawMode: boolean;
  sessionToUpdate: IndividualChatSettings;
  newAbortController: AbortController;
  textToUse: string;
  enrichedFiles: UploadedFile[];
}

const createNonStreamCompleteHandler =
  ({
    streamOnPart,
    onThoughtChunk,
    streamOnComplete,
    source,
  }: Pick<StreamHandlerFunctions, 'streamOnPart' | 'onThoughtChunk' | 'streamOnComplete'> & {
    source?: 'gemini' | 'third-party';
  }): NonStreamMessageCompleteHandler =>
  (parts, thoughts, usage, grounding, urlContext) => {
    for (const part of parts) {
      streamOnPart(part, { recordFirstToken: false, source });
    }
    if (thoughts) {
      onThoughtChunk(thoughts, { recordFirstToken: false, source });
    }
    streamOnComplete(usage, grounding, urlContext);
  };

export const performStandardChatApiCall = async ({
  appSettings,
  messages,
  updateAndPersistSessions,
  getStreamHandlers,
  aspectRatio,
  imageSize,
  imageOutputMode,
  resolveTurn,
  finalSessionId,
  generationId,
  generationStartTime,
  keyToUse,
  activeModelId,
  promptParts,
  effectiveEditingId,
  isContinueMode,
  isRawMode,
  sessionToUpdate,
  newAbortController,
  textToUse,
  enrichedFiles,
}: PerformStandardChatApiCallParams): Promise<void> => {
  const apiRoute = resolveChatApiRoute(appSettings, sessionToUpdate);
  const activeProvider = apiRoute.provider ?? null;
  const apiModelId = apiRoute.modelId || activeModelId;

  const {
    baseMessagesForApi,
    finalRole,
    finalParts: turnFinalParts,
    shouldSkipApiCall,
  } = resolveTurn({
    messages,
    promptParts,
    textToUse,
    enrichedFiles,
    effectiveEditingId,
    isContinueMode,
    isRawMode,
    apiModelId,
  });

  if (shouldSkipApiCall) {
    return;
  }

  const {
    appLanguage,
    isVisualFormattingActive,
    shouldStripThinking,
    alwaysKeepThinking,
    finalParts,
    historyForChat,
    effectiveSystemInstruction,
    standardClientFunctions,
    mcpClientFunctions,
    combinedClientFunctions,
  } = await prepareStandardChatContext({
    appSettings,
    sessionToUpdate,
    apiModelId,
    activeProvider,
    baseMessagesForApi,
    finalRole,
    turnFinalParts,
    isContinueMode,
    isRawMode,
    enrichedFiles,
    textToUse,
    abortSignal: newAbortController.signal,
  });

  const { streamOnError, streamOnComplete, streamOnPart, onThoughtChunk } = getStreamHandlers(
    finalSessionId,
    generationId,
    newAbortController,
    generationStartTime,
    sessionToUpdate,
    finalParts,
  );

  if (isUnavailableThirdPartyRoute(apiRoute)) {
    streamOnError(
      new Error(
        apiRoute.unavailable === 'disabled'
          ? 'Third-party connection is disabled.'
          : 'Third-party connection is unavailable.',
      ),
    );
    return;
  }

  const wrappedStreamOnComplete: typeof streamOnComplete = (...args) => {
    clearPendingStreamJob(finalSessionId);
    streamOnComplete(...args);
  };

  const nonStreamOnComplete = createNonStreamCompleteHandler({
    streamOnPart,
    onThoughtChunk,
    streamOnComplete: wrappedStreamOnComplete,
    source: activeProvider ? 'third-party' : 'gemini',
  });

  const insertInternalToolMessages = (toolMessages: ChatMessage[]) => {
    updateAndPersistSessions(
      (prev) =>
        updateSessionById(prev, finalSessionId, (session) => ({
          ...session,
          messages: session.messages.flatMap((message) => {
            if (message.id !== generationId) {
              return [message];
            }
            return [...toolMessages, { ...message }];
          }),
        })),
      { persist: false },
    );
  };

  if (activeProvider) {
    await executeThirdPartyChat({
      activeProvider,
      apiModelId,
      keyToUse,
      effectiveSystemInstruction,
      sessionToUpdate,
      historyForChat,
      finalRole,
      finalParts,
      combinedClientFunctions,
      newAbortController,
      generationId,
      insertInternalToolMessages,
      streamOnPart,
      onThoughtChunk,
      streamOnError,
      streamOnComplete,
      wrappedStreamOnComplete,
      nonStreamOnComplete,
      isStreamingEnabled: Boolean(appSettings.isStreamingEnabled),
    });
    return;
  }

  const mcpFunctionDeclarations = Object.values(mcpClientFunctions).map(({ declaration }) => declaration);

  await executeGeminiChat({
    appSettings,
    sessionToUpdate,
    apiModelId,
    keyToUse,
    effectiveSystemInstruction,
    aspectRatio,
    imageSize,
    imageOutputMode,
    standardClientFunctions,
    mcpFunctionDeclarations,
    combinedClientFunctions,
    historyForChat,
    finalRole,
    finalParts,
    finalSessionId,
    generationId,
    generationStartTime,
    newAbortController,
    isContinueMode,
    isRawMode,
    promptParts,
    textToUse,
    enrichedFiles,
    effectiveEditingId,
    resolveTurn,
    shouldStripThinking,
    alwaysKeepThinking,
    isVisualFormattingActive,
    appLanguage,
    updateAndPersistSessions,
    insertInternalToolMessages,
    streamOnPart,
    onThoughtChunk,
    streamOnError,
    streamOnComplete,
    wrappedStreamOnComplete,
    nonStreamOnComplete,
  });
};
