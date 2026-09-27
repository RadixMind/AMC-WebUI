import { act } from 'react';
import { setupProviderTestRenderer as setupTestRenderer } from '@/test/render/providerRenderer';
import { describe, expect, it, vi } from 'vitest';
import { ApiConfigToggle } from './ApiConfigToggle';

describe('ApiConfigToggle', () => {
  const renderer = setupTestRenderer({ providers: { language: 'en' } });

  it('exposes the row as a keyboard-operable switch', () => {
    const setUseCustomApiConfig = vi.fn();

    act(() => {
      renderer.root.render(
        <ApiConfigToggle useCustomApiConfig={false} setUseCustomApiConfig={setUseCustomApiConfig} hasEnvKey={true} />,
      );
    });

    const row = renderer.container.querySelector<HTMLElement>('[role="switch"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('tabindex')).toBe('0');
    expect(row?.getAttribute('aria-checked')).toBe('false');

    act(() => {
      row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(setUseCustomApiConfig).toHaveBeenCalledWith(true);
  });

  it('shows server active badge and description when serverManagedApi is enabled', () => {
    act(() => {
      renderer.root.render(
        <ApiConfigToggle
          useCustomApiConfig={false}
          setUseCustomApiConfig={vi.fn()}
          hasEnvKey={false}
          serverManagedApi={true}
        />,
      );
    });

    expect(renderer.container.textContent).toContain('Server Key Active');
    expect(renderer.container.textContent).toContain('Using server-managed global API key');
  });

  it('shows custom settings enabled notice when serverManagedApi is active without custom key', () => {
    act(() => {
      renderer.root.render(
        <ApiConfigToggle
          useCustomApiConfig={true}
          setUseCustomApiConfig={vi.fn()}
          hasEnvKey={false}
          serverManagedApi={true}
          hasCustomKey={false}
        />,
      );
    });

    expect(renderer.container.textContent).toContain('Server Key Active');
    expect(renderer.container.textContent).toContain(
      'Custom settings enabled. No custom key entered; defaulting to server-managed key via proxy.',
    );
  });

  it('hides active server badge and shows override text when custom key is provided', () => {
    act(() => {
      renderer.root.render(
        <ApiConfigToggle
          useCustomApiConfig={true}
          setUseCustomApiConfig={vi.fn()}
          hasEnvKey={false}
          serverManagedApi={true}
          hasCustomKey={true}
        />,
      );
    });

    expect(renderer.container.textContent).not.toContain('Server Key Active');
    expect(renderer.container.textContent).toContain('Overriding the environment API key.');
  });
});
