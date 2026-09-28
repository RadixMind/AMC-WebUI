import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/types';
import { useTurnNavigation } from './useTurnNavigation';
import { renderHook } from '@/test/render/renderer';

const createSampleMessages = (): ChatMessage[] => [
  {
    id: 'm-1',
    role: 'user',
    content: 'First question',
    timestamp: new Date('2026-04-15T00:00:00.000Z'),
  },
  {
    id: 'm-2',
    role: 'model',
    content: 'First answer',
    timestamp: new Date('2026-04-15T00:00:01.000Z'),
  },
  {
    id: 'm-3',
    role: 'user',
    content: 'Second question',
    timestamp: new Date('2026-04-15T00:00:02.000Z'),
  },
  {
    id: 'm-4',
    role: 'model',
    content: 'Second answer',
    timestamp: new Date('2026-04-15T00:00:03.000Z'),
  },
];

const setElementBox = (element: Element, top: number, height = 40) => {
  element.getBoundingClientRect = vi.fn(() => ({
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }));
};

describe('useTurnNavigation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns empty items and null activeTurn when messages are empty', () => {
    const scrollToTurn = vi.fn();
    const { result } = renderHook(() =>
      useTurnNavigation({
        messages: [],
        scroller: null,
        atBottom: true,
        scrollToTurn,
      }),
    );

    expect(result.current.turnItems).toEqual([]);
    expect(result.current.activeTurn).toBeNull();
    expect(result.current.busyTurn).toBeNull();
  });

  it('builds messageTurnMap and defaults activeTurn to last turn when atBottom is true', () => {
    const scrollToTurn = vi.fn();
    const messages = createSampleMessages();
    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller: null,
        atBottom: true,
        scrollToTurn,
      }),
    );

    expect(result.current.turnItems).toHaveLength(2);
    expect(result.current.turnItems[0].turn).toBe(1);
    expect(result.current.turnItems[1].turn).toBe(2);

    expect(result.current.messageTurnMap.get('m-1')).toBe(1);
    expect(result.current.messageTurnMap.get('m-2')).toBe(1);
    expect(result.current.messageTurnMap.get('m-3')).toBe(2);
    expect(result.current.messageTurnMap.get('m-4')).toBe(2);

    expect(result.current.activeTurn).toBe(2);
  });

  it('immediately updates activeTurn and calls scrollToTurn on handleNavigateTurn', () => {
    const scrollToTurn = vi.fn();
    const messages = createSampleMessages();
    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller: null,
        atBottom: false,
        scrollToTurn,
      }),
    );

    expect(result.current.activeTurn).toBe(1);

    act(() => {
      result.current.handleNavigateTurn(result.current.turnItems[1]);
    });

    expect(result.current.activeTurn).toBe(2);
    expect(scrollToTurn).toHaveBeenCalledWith(result.current.turnItems[1]);
  });

  it('detects busyTurn when the last model message is loading', () => {
    const scrollToTurn = vi.fn();
    const messages: ChatMessage[] = [
      ...createSampleMessages(),
      {
        id: 'm-5',
        role: 'user',
        content: 'Third question',
        timestamp: new Date('2026-04-15T00:00:04.000Z'),
      },
      {
        id: 'm-6',
        role: 'model',
        content: '',
        isLoading: true,
        timestamp: new Date('2026-04-15T00:00:05.000Z'),
      },
    ];

    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller: null,
        atBottom: true,
        scrollToTurn,
      }),
    );

    expect(result.current.turnItems).toHaveLength(3);
    expect(result.current.busyTurn).toBe(3);
  });

  it('probes visible turn using reading line from scroller DOM elements', () => {
    const scrollToTurn = vi.fn();
    const messages = createSampleMessages();

    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      scrollTop: { value: 100, writable: true },
      scrollHeight: { value: 2000, writable: true },
      clientHeight: { value: 500, writable: true },
    });
    // scroller top is at 50, reading line = 50 + min(96, 500 * 0.2) = 50 + 96 = 146
    setElementBox(scroller, 50, 500);

    const row1 = document.createElement('div');
    row1.setAttribute('data-chat-turn', '1');
    setElementBox(row1, -50, 100); // above viewport
    scroller.appendChild(row1);

    const row2 = document.createElement('div');
    row2.setAttribute('data-chat-turn', '2');
    setElementBox(row2, 100, 200); // 100 <= 146 (reading line)
    scroller.appendChild(row2);

    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller,
        atBottom: false,
        scrollToTurn,
      }),
    );

    act(() => {
      result.current.probeVisibleTurn();
      vi.runAllTimers();
    });

    expect(result.current.activeTurn).toBe(2);
  });

  it('cancels navigation lock on user interaction event such as wheel', () => {
    const scrollToTurn = vi.fn();
    const messages = createSampleMessages();

    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      scrollTop: { value: 50, writable: true },
      scrollHeight: { value: 2000, writable: true },
      clientHeight: { value: 500, writable: true },
    });
    // reading line = 0 + 96 = 96
    setElementBox(scroller, 0, 500);

    const row1 = document.createElement('div');
    row1.setAttribute('data-chat-turn', '1');
    setElementBox(row1, 20, 100);
    scroller.appendChild(row1);

    const row2 = document.createElement('div');
    row2.setAttribute('data-chat-turn', '2');
    setElementBox(row2, 200, 100);
    scroller.appendChild(row2);

    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller,
        atBottom: false,
        scrollToTurn,
      }),
    );

    // Navigate to turn 2
    act(() => {
      result.current.handleNavigateTurn(result.current.turnItems[1]);
    });
    expect(result.current.activeTurn).toBe(2);

    // User scrolls wheel -> cancels navigation lock
    act(() => {
      scroller.dispatchEvent(new Event('wheel', { bubbles: true }));
      result.current.probeVisibleTurn();
      vi.runAllTimers();
    });

    expect(result.current.activeTurn).toBe(1);
  });

  it('settles navigation and probes visible turn on scrollend', () => {
    const scrollToTurn = vi.fn();
    const messages = createSampleMessages();

    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      scrollTop: { value: 200, writable: true },
      scrollHeight: { value: 2000, writable: true },
      clientHeight: { value: 500, writable: true },
    });
    setElementBox(scroller, 0, 500);

    const row1 = document.createElement('div');
    row1.setAttribute('data-chat-turn', '1');
    setElementBox(row1, -100, 100);
    scroller.appendChild(row1);

    const row2 = document.createElement('div');
    row2.setAttribute('data-chat-turn', '2');
    setElementBox(row2, 30, 200); // <= 96
    scroller.appendChild(row2);

    const { result } = renderHook(() =>
      useTurnNavigation({
        messages,
        scroller,
        atBottom: false,
        scrollToTurn,
      }),
    );

    act(() => {
      result.current.handleNavigateTurn(result.current.turnItems[1]);
      scroller.dispatchEvent(new Event('scrollend'));
      vi.runAllTimers();
    });

    expect(result.current.activeTurn).toBe(2);
  });
});
