import { describe, it, expect, vi } from 'vitest';
import { act, createRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { TurnNavigator, type TurnNavigatorHandle } from './TurnNavigator';
import type { TurnNavigationItem } from './hooks/useTurnNavigationItems';

// Simple mock for t
const mockT = (key: string, params?: Record<string, string | number>) => {
  if (key === 'turnNavigationLabel') return 'Turn navigation';
  if (key === 'turnNavigationJump') return `Jump to turn ${params?.turn ?? ''}`;
  if (key === 'turnNavigationJumpLoad') return `Load and jump to turn ${params?.turn ?? ''}`;
  if (key === 'turnNavigationTurn') return `Turn ${params?.turn ?? ''}`;
  return key;
};

const sampleItems: TurnNavigationItem[] = [
  { turn: 1, messageIndex: 0, messageId: 'm1', prompt: 'First question', response: 'First response' },
  { turn: 2, messageIndex: 2, messageId: 'm2', prompt: 'Second question', response: 'Second response' },
  {
    turn: 3,
    messageIndex: 4,
    messageId: 'm3',
    prompt: 'Third question',
    response: 'Third response',
    anchor: { kind: 'unloaded', seq: 10 },
  },
];

describe('TurnNavigator', () => {
  it('renders nothing when items length is less than 2', () => {
    const { container } = render(
      <TurnNavigator items={sampleItems.slice(0, 1)} activeTurn={1} onNavigate={vi.fn()} t={mockT} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders tick marks for each turn when items length >= 2', () => {
    const { container } = render(
      <TurnNavigator items={sampleItems} activeTurn={2} busyTurn={3} onNavigate={vi.fn()} t={mockT} />,
    );

    const nav = container.querySelector('nav[aria-label="Turn navigation"]');
    expect(nav).not.toBeNull();

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(3);

    expect(buttons[0].getAttribute('aria-label')).toBe('Jump to turn 1');
    expect(buttons[1].getAttribute('aria-label')).toBe('Jump to turn 2');
    expect(buttons[1].getAttribute('aria-current')).toBe('true');
    expect(buttons[0].getAttribute('aria-current')).toBeNull();

    // Check unloaded jumpLoad label and busy state
    expect(buttons[2].getAttribute('aria-label')).toBe('Load and jump to turn 3');
    expect(buttons[2].getAttribute('aria-busy')).toBe('true');
  });

  it('calls onNavigate with item when a mark is clicked', () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <TurnNavigator items={sampleItems} activeTurn={1} onNavigate={onNavigate} t={mockT} />,
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(sampleItems[2]);
  });

  it('shows and hides preview tooltip on pointer move and leave', () => {
    const { container } = render(<TurnNavigator items={sampleItems} activeTurn={1} onNavigate={vi.fn()} t={mockT} />);

    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    const buttons = container.querySelectorAll('button');
    // Hover on second mark via pointermove
    fireEvent.pointerMove(buttons[1]);

    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain('Second question');
    expect(tooltip?.textContent).toContain('Second response');

    // Pointer leave on nav
    const nav = container.querySelector('nav');
    fireEvent.pointerLeave(nav!);

    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('supports imperative handle for activateTurn and scrollToTurn', () => {
    const onNavigate = vi.fn();
    const ref = createRef<TurnNavigatorHandle>();
    render(<TurnNavigator ref={ref} items={sampleItems} activeTurn={1} onNavigate={onNavigate} t={mockT} />);

    expect(ref.current).not.toBeNull();

    act(() => {
      ref.current?.activateTurn(2);
    });
    expect(onNavigate).toHaveBeenCalledWith(sampleItems[1]);

    act(() => {
      ref.current?.scrollToTurn(2);
    });
  });

  it('passes chatInputHeight as a CSS custom property to the slot element', () => {
    const { container } = render(
      <TurnNavigator items={sampleItems} activeTurn={1} onNavigate={vi.fn()} chatInputHeight={160} t={mockT} />,
    );

    const slot = container.firstElementChild as HTMLElement;
    expect(slot.style.getPropertyValue('--chat-input-height')).toBe('160px');
  });
});
