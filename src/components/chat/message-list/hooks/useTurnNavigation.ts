import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@/types';
import { useTurnNavigationItems, type TurnNavigationItem } from './useTurnNavigationItems';

export interface UseTurnNavigationOptions {
  messages: readonly ChatMessage[];
  scroller: HTMLElement | null;
  atBottom: boolean;
  scrollToTurn: (item: TurnNavigationItem) => void;
}

const READING_INTENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

export function useTurnNavigation({ messages, scroller, atBottom, scrollToTurn }: UseTurnNavigationOptions) {
  const turnItems = useTurnNavigationItems(messages);

  const messageTurnMap = useMemo(() => {
    const map = new Map<string, number>();
    let currentTurn = 0;
    for (const message of messages) {
      if (message.role === 'user') {
        currentTurn += 1;
      }
      if (currentTurn > 0) {
        map.set(message.id, currentTurn);
      }
    }
    return map;
  }, [messages]);

  const busyTurn = useMemo(() => {
    if (turnItems.length === 0) return null;
    const lastMsg = messages[messages.length - 1];
    const isBusy = lastMsg?.role === 'model' && Boolean(lastMsg?.isLoading);
    return isBusy ? turnItems[turnItems.length - 1].turn : null;
  }, [turnItems, messages]);

  const [activeTurn, setActiveTurn] = useState<number | null>(() => {
    if (turnItems.length === 0) return null;
    return atBottom ? turnItems[turnItems.length - 1].turn : turnItems[0].turn;
  });

  // Keep activeTurn resilient to session switches or deleted messages
  const currentActiveTurn = useMemo(() => {
    if (turnItems.length === 0) return null;
    if (activeTurn !== null && turnItems.some((item) => item.turn === activeTurn)) {
      return activeTurn;
    }
    return atBottom ? turnItems[turnItems.length - 1].turn : turnItems[0].turn;
  }, [turnItems, activeTurn, atBottom]);

  const navigatedTurnRef = useRef<number | null>(null);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeFrameRef = useRef<number | null>(null);

  const probeVisibleTurn = useCallback(() => {
    if (turnItems.length === 0) {
      setActiveTurn(null);
      return;
    }

    // Preserve the clicked turn while programmatic navigation is in flight
    if (navigatedTurnRef.current !== null) {
      return;
    }

    const container = scroller instanceof HTMLElement ? scroller : null;
    if (!container) return;

    // Follow tail / latest turn when near or at bottom (matches DeepSeek Harness reading policy)
    const isNearBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= 40;
    if (isNearBottom || atBottom) {
      setActiveTurn(turnItems[turnItems.length - 1].turn);
      return;
    }

    // Reading line formula from DeepSeek Harness: top edge + min(96, clientHeight * 0.2)
    const scrollerRect = container.getBoundingClientRect();
    const readingLine = scrollerRect.top + Math.min(96, container.clientHeight * 0.2);

    const rows = container.querySelectorAll<HTMLElement>('[data-chat-turn]');
    let readingTurn: number | null = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rect = row.getBoundingClientRect();
      if (rect.top <= readingLine) {
        const val = row.getAttribute('data-chat-turn');
        const turn = val ? Number(val) : NaN;
        if (Number.isSafeInteger(turn) && turn > 0) {
          readingTurn = turn;
        }
      } else {
        break;
      }
    }

    if (readingTurn === null && rows.length > 0) {
      const firstVal = rows[0].getAttribute('data-chat-turn');
      const firstTurn = firstVal ? Number(firstVal) : NaN;
      if (Number.isSafeInteger(firstTurn) && firstTurn > 0) {
        readingTurn = firstTurn;
      }
    }

    if (readingTurn !== null) {
      setActiveTurn(readingTurn);
    } else {
      setActiveTurn(turnItems[0]?.turn ?? null);
    }
  }, [turnItems, scroller, atBottom]);

  const scheduleProbe = useCallback(() => {
    if (probeFrameRef.current !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      probeFrameRef.current = requestAnimationFrame(() => {
        probeFrameRef.current = null;
        probeVisibleTurn();
      });
    } else {
      probeVisibleTurn();
    }
  }, [probeVisibleTurn]);

  const cancelNavigation = useCallback(() => {
    navigatedTurnRef.current = null;
    if (navigationTimerRef.current) {
      clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
    }
  }, []);

  const handleNavigateTurn = useCallback(
    (item: TurnNavigationItem) => {
      cancelNavigation();
      navigatedTurnRef.current = item.turn;
      setActiveTurn(item.turn);
      scrollToTurn(item);

      // Safety fallback timer for environments/browsers lacking scrollend
      navigationTimerRef.current = setTimeout(() => {
        cancelNavigation();
        scheduleProbe();
      }, 1000);
    },
    [cancelNavigation, scrollToTurn, scheduleProbe],
  );

  // Synchronize activeTurn when turnItems or atBottom changes while not navigating
  useEffect(() => {
    if (turnItems.length === 0) {
      setActiveTurn(null);
      return;
    }
    if (navigatedTurnRef.current !== null) {
      return;
    }
    if (atBottom) {
      setActiveTurn(turnItems[turnItems.length - 1].turn);
    } else {
      scheduleProbe();
    }
  }, [turnItems, atBottom, scheduleProbe]);

  // Scroller event listeners for scroll, scrollend, and user interaction intents
  useEffect(() => {
    const container = scroller instanceof HTMLElement ? scroller : null;
    if (!container) return;

    const onIntent = () => {
      cancelNavigation();
    };

    const onScrollEnd = () => {
      cancelNavigation();
      scheduleProbe();
    };

    const onScroll = () => {
      scheduleProbe();
    };

    for (const type of READING_INTENTS) {
      container.addEventListener(type, onIntent, { capture: true, passive: true });
    }
    container.addEventListener('scroll', onScroll, { passive: true });
    container.addEventListener('scrollend', onScrollEnd, { capture: true, passive: true });

    return () => {
      for (const type of READING_INTENTS) {
        container.removeEventListener(type, onIntent, true);
      }
      container.removeEventListener('scroll', onScroll);
      container.removeEventListener('scrollend', onScrollEnd, true);
      cancelNavigation();
      if (probeFrameRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(probeFrameRef.current);
        }
        probeFrameRef.current = null;
      }
    };
  }, [scroller, cancelNavigation, scheduleProbe]);

  return {
    turnItems,
    activeTurn: currentActiveTurn,
    busyTurn,
    messageTurnMap,
    handleNavigateTurn,
    probeVisibleTurn,
    scheduleProbe,
  };
}
