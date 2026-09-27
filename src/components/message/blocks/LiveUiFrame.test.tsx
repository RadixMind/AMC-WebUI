import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { logService } from '@/services/logService';
import { setupTestRenderer } from '@/test/render/renderer';
import { renderDotToSvgCached } from '@/features/graphviz/vizRuntime';
import {
  HTML_PREVIEW_CLEAR_SELECTION_EVENT,
  HTML_PREVIEW_COPY_EVENT,
  HTML_PREVIEW_DIAGNOSTIC_EVENT,
  HTML_PREVIEW_DIAGRAM_CLICK_EVENT,
  HTML_PREVIEW_GRAPHVIZ_RENDER_REQUEST_EVENT,
  HTML_PREVIEW_GRAPHVIZ_RENDER_RESPONSE_EVENT,
  HTML_PREVIEW_MESSAGE_CHANNEL,
  HTML_PREVIEW_STREAM_RENDER_EVENT,
  loadKatex,
} from '@/utils/html-preview/previewDocument';
import { LiveUiFrame } from './LiveUiFrame';
import { useSettingsStore } from '@/stores/settingsStore';

vi.mock('@/features/graphviz/vizRuntime', () => ({
  renderDotToSvgCached: vi.fn(),
}));

// KaTeX is loaded lazily so the math chunk is not pulled into every markdown
// message. Tests that assert rendered `class="katex"` output need it in memory.
beforeAll(async () => {
  await loadKatex();
});

const createRect = (overrides: Partial<DOMRect> = {}): DOMRect =>
  ({
    width: 320,
    height: 180,
    top: 100,
    left: 50,
    right: 370,
    bottom: 280,
    x: 50,
    y: 100,
    toJSON: () => ({}),
    ...overrides,
  }) as DOMRect;

describe('LiveUiFrame', () => {
  const renderer = setupTestRenderer();

  beforeEach(() => {
    vi.mocked(renderDotToSvgCached).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects the configured base font size into static artifact documents', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" baseFontSize={18} />);
    });

    const iframe = renderer.container.querySelector('iframe');

    expect(iframe?.getAttribute('srcdoc')).toContain('data-amc-live-artifact-base-font-size="true"');
    expect(iframe?.getAttribute('srcdoc')).toContain('--amc-live-artifact-font-size:18px');
  });

  it('offers a larger preview that keeps the sanitized Live Artifact engine', () => {
    const onOpenPreview = vi.fn();

    act(() => {
      renderer.root.render(
        <LiveUiFrame html="<section><p>Artifact text</p></section>" onOpenPreview={onOpenPreview} />,
      );
    });

    const openButton = renderer.container.querySelector('button[title="Open larger preview"]') as HTMLButtonElement;
    expect(openButton).not.toBeNull();

    act(() => {
      openButton.click();
    });

    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });

  it('hides the larger-preview action while the artifact is still streaming', () => {
    act(() => {
      renderer.root.render(
        <LiveUiFrame html="<section><p>Artifact text</p></section>" isLoading onOpenPreview={vi.fn()} />,
      );
    });

    expect(renderer.container.querySelector('button[title="Open larger preview"]')).toBeNull();
  });

  it('does not render a copy source button on the artifact frame', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" onOpenPreview={vi.fn()} />);
    });

    expect(renderer.container.querySelector('button[title="Copy"]')).toBeNull();
    expect(renderer.container.querySelector('button[aria-label="Copy"]')).toBeNull();
  });

  it('injects transparent Live Artifact theme tokens into static artifact documents', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" themeId="onyx" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    const srcDoc = iframe?.getAttribute('srcdoc') ?? '';

    expect(srcDoc).toContain('data-amc-live-artifact-theme="true"');
    expect(srcDoc).toContain(
      'html,body{margin:0;padding:0;height:auto!important;min-height:0!important;max-height:none!important;background:transparent',
    );
    expect(srcDoc).toContain('--amc-live-artifact-text:#f5f5f7');
    expect(srcDoc).toContain('--amc-live-artifact-surface:#1c1c20');
    expect(srcDoc).toContain('--amc-live-artifact-border:#2c2c34');
    expect(srcDoc).toContain('--amc-live-artifact-accent:#6ba3fc');
  });

  it('injects the configured base font size into streaming artifact documents', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" baseFontSize={20} isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');

    expect(iframe?.getAttribute('srcdoc')).toContain('data-amc-live-artifact-base-font-size="true"');
    expect(iframe?.getAttribute('srcdoc')).toContain('--amc-live-artifact-font-size:20px');
    expect(iframe?.getAttribute('srcdoc')).toContain('data-amc-stream-preview-root');
  });

  it('injects transparent Live Artifact theme tokens into streaming artifact documents', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" themeId="graphite" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    const srcDoc = iframe?.getAttribute('srcdoc') ?? '';

    expect(srcDoc).toContain('data-amc-live-artifact-theme="true"');
    expect(srcDoc).toContain(
      'html,body{margin:0;padding:0;height:auto!important;min-height:0!important;max-height:none!important;background:transparent',
    );
    expect(srcDoc).toContain('--amc-live-artifact-text:#f2f2f4');
    expect(srcDoc).toContain('--amc-live-artifact-surface:#3c3c40');
    expect(srcDoc).toContain('--amc-live-artifact-border:#4c4c52');
    expect(srcDoc).toContain('--amc-live-artifact-accent:#6ba3fc');
    expect(srcDoc).toContain('data-amc-stream-preview-root');
  });

  it('relays iframe text selections to the parent selection toolbar event', () => {
    const handleSelection = vi.fn();
    window.addEventListener('amc-live-artifact-selection', handleSelection);

    try {
      act(() => {
        renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" />);
      });

      const iframe = renderer.container.querySelector('iframe');
      expect(iframe).not.toBeNull();
      iframe!.getBoundingClientRect = () => createRect();

      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              channel: HTML_PREVIEW_MESSAGE_CHANNEL,
              event: 'selection',
              payload: {
                text: 'Artifact text',
                copyText: 'Artifact text',
                rect: {
                  top: 20,
                  left: 30,
                  width: 90,
                  height: 18,
                  bottom: 38,
                },
              },
            },
            source: iframe!.contentWindow,
            origin: 'null',
          }),
        );
      });

      expect(handleSelection).toHaveBeenCalledTimes(1);
      const event = handleSelection.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({
        text: 'Artifact text',
        copyText: 'Artifact text',
        rect: {
          top: 120,
          left: 80,
          width: 90,
          height: 18,
          bottom: 138,
        },
      });
    } finally {
      window.removeEventListener('amc-live-artifact-selection', handleSelection);
    }
  });

  it('keeps streaming iframe srcdoc stable and posts html updates to the runner', () => {
    vi.useFakeTimers();

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>First chunk</section>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const initialSrcDoc = iframe!.getAttribute('srcdoc');
    expect(initialSrcDoc).toContain('data-amc-stream-preview-root');

    const postMessage = vi.fn();
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Second chunk</section>" isLoading />);
    });

    expect(iframe!.getAttribute('srcdoc')).toBe(initialSrcDoc);
    expect(postMessage).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(iframe!.getAttribute('srcdoc')).toBe(initialSrcDoc);
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_STREAM_RENDER_EVENT,
        html: '<section>Second chunk</section>',
      },
      '*',
    );
  });

  it('reposts the latest streaming html when the sandboxed iframe reports ready', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Ready payload</section>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.fn();
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: 'ready',
          },
          source: iframe!.contentWindow,
          origin: 'null',
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_STREAM_RENDER_EVENT,
        html: '<section>Ready payload</section>',
      },
      '*',
    );
  });

  it('retries posting streaming html after contentWindow becomes available', () => {
    vi.useFakeTimers();

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Deferred chunk</section>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    // First flush has no contentWindow yet.
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: null,
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const postMessage = vi.fn();
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_STREAM_RENDER_EVENT,
        html: '<section>Deferred chunk</section>',
      },
      '*',
    );
  });

  it('posts KaTeX-rendered html updates while streaming formulas', () => {
    vi.useFakeTimers();

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Starting</section>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const postMessage = vi.fn();
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      renderer.root.render(<LiveUiFrame html={String.raw`<section><p>Action \(a_t\)</p></section>`} isLoading />);
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const postedMessage = postMessage.mock.calls.at(-1)?.[0];
    expect(postedMessage).toMatchObject({
      channel: HTML_PREVIEW_MESSAGE_CHANNEL,
      event: HTML_PREVIEW_STREAM_RENDER_EVENT,
    });
    expect(postedMessage.html).toContain('class="katex"');
    expect(postedMessage.html).toContain('a_t');
    expect(postedMessage.html).toContain('data-amc-katex');
    expect(postedMessage.html).not.toContain(String.raw`\(a_t\)`);
  });

  it('flushes the latest streaming html during continuous updates', () => {
    vi.useFakeTimers();

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Chunk 1</section>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    const postMessage = vi.fn();
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Chunk 2</section>" isLoading />);
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Chunk 3</section>" isLoading />);
    });

    act(() => {
      vi.advanceTimersByTime(60);
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_STREAM_RENDER_EVENT,
        html: '<section>Chunk 3</section>',
      },
      '*',
    );
  });

  it('asks the sandboxed iframe to clear selection without reading cross-origin selection state', () => {
    const postMessage = vi.fn();
    const contentWindowStub = {
      postMessage,
      getSelection: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
    } as unknown as Window;

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: contentWindowStub,
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('amc-live-artifact-clear-selection'));
    });

    expect(contentWindowStub.getSelection).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_CLEAR_SELECTION_EVENT,
      },
      '*',
    );
  });

  it('writes data-amc-copy text to the clipboard from the parent when the sandbox reports a copy event', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact</p></section>" />);
    });

    const iframe = renderer.container.querySelector('iframe');

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: HTML_PREVIEW_COPY_EVENT,
            payload: { text: 'npm install katex' },
          },
          source: iframe!.contentWindow,
          origin: 'null',
        }),
      );
    });

    expect(writeText).toHaveBeenCalledWith('npm install katex');
  });

  it('logs preview diagnostics reported by the sandboxed iframe', () => {
    const warnSpy = vi.spyOn(logService, 'warn').mockImplementation(() => {});

    try {
      act(() => {
        renderer.root.render(
          <LiveUiFrame html="<section><img src='https://example.com/missing.png' alt='Missing'></section>" />,
        );
      });

      const iframe = renderer.container.querySelector('iframe');

      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              channel: HTML_PREVIEW_MESSAGE_CHANNEL,
              event: HTML_PREVIEW_DIAGNOSTIC_EVENT,
              payload: {
                type: 'resource-error',
                tagName: 'img',
                url: 'https://example.com/missing.png',
              },
            },
            source: iframe!.contentWindow,
            origin: 'null',
          }),
        );
      });

      expect(warnSpy).toHaveBeenCalledWith('Live Artifact preview diagnostic:', {
        type: 'resource-error',
        tagName: 'img',
        url: 'https://example.com/missing.png',
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('renders graphviz on the parent page and posts the sanitized SVG reply to the iframe', async () => {
    vi.mocked(renderDotToSvgCached).mockResolvedValueOnce({
      ok: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    });

    const postMessage = vi.fn();
    const iframeWindowStub = { postMessage } as unknown as Window;

    act(() => {
      renderer.root.render(<LiveUiFrame html="<div data-amc-graphviz='digraph { A -> B }'></div>" themeId="pearl" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: iframeWindowStub,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: HTML_PREVIEW_GRAPHVIZ_RENDER_REQUEST_EVENT,
            payload: { id: 'amc-gv-1', dot: 'digraph { A -> B }' },
          },
          source: iframeWindowStub,
          origin: 'null',
        }),
      );
    });

    expect(renderDotToSvgCached).toHaveBeenCalledWith('digraph { A -> B }', {
      themeId: 'pearl',
      preserveAuthorColors: true,
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_GRAPHVIZ_RENDER_RESPONSE_EVENT,
        payload: {
          id: 'amc-gv-1',
          ok: true,
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
        },
      },
      '*',
    );
  });

  it('reports a render error back to the iframe when graphviz fails', async () => {
    vi.mocked(renderDotToSvgCached).mockResolvedValueOnce({ ok: false, error: 'too-large' });

    const postMessage = vi.fn();
    const iframeWindowStub = { postMessage } as unknown as Window;

    act(() => {
      renderer.root.render(<LiveUiFrame html="<div data-amc-graphviz='digraph { A -> B }'></div>" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: iframeWindowStub,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: HTML_PREVIEW_GRAPHVIZ_RENDER_REQUEST_EVENT,
            payload: { id: 'amc-gv-2', dot: 'digraph { A -> B }' },
          },
          source: iframeWindowStub,
          origin: 'null',
        }),
      );
    });

    expect(postMessage).toHaveBeenCalledWith(
      {
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_GRAPHVIZ_RENDER_RESPONSE_EVENT,
        payload: { id: 'amc-gv-2', ok: false, error: 'too-large' },
      },
      '*',
    );
  });

  it('ignores graphviz requests with a malformed payload', async () => {
    const postMessage = vi.fn();
    const iframeWindowStub = { postMessage } as unknown as Window;

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Text</section>" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: iframeWindowStub,
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: HTML_PREVIEW_GRAPHVIZ_RENDER_REQUEST_EVENT,
            payload: { id: 42 }, // missing dot
          },
          source: iframeWindowStub,
          origin: 'null',
        }),
      );
    });

    expect(renderDotToSvgCached).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('relays diagram clicks to onImageClick with an UploadedFile', async () => {
    const onImageClick = vi.fn();
    const postMessage = vi.fn();
    const iframeWindowStub = { postMessage } as unknown as Window;

    act(() => {
      renderer.root.render(<LiveUiFrame html="<section>Diagram</section>" onImageClick={onImageClick} />);
    });

    const iframe = renderer.container.querySelector('iframe');
    Object.defineProperty(iframe!, 'contentWindow', {
      configurable: true,
      value: iframeWindowStub,
    });

    const svgString = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: HTML_PREVIEW_DIAGRAM_CLICK_EVENT,
            payload: { svg: svgString, title: 'Network Topology' },
          },
          source: iframeWindowStub,
          origin: 'null',
        }),
      );
    });

    expect(onImageClick).toHaveBeenCalledTimes(1);
    const uploadedFile = onImageClick.mock.calls[0][0];
    expect(uploadedFile).toMatchObject({
      name: 'Network Topology.svg',
      type: 'image/svg+xml',
      uploadState: 'active',
    });
    expect(uploadedFile.dataUrl).toContain('data:image/svg+xml;base64,');
  });

  it('preserves the iframe DOM node and flushes final html in-place when transitioning from streaming to final mode', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Chunk 1</p>" isLoading cacheKey="msg-1" />);
    });

    const streamingIframe = renderer.container.querySelector('iframe');
    expect(streamingIframe).not.toBeNull();
    const initialSrcDoc = streamingIframe!.getAttribute('srcdoc');

    const postMessage = vi.fn();
    Object.defineProperty(streamingIframe!, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    });

    // Streaming updates keep the same iframe DOM node
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Chunk 1 and 2</p>" isLoading cacheKey="msg-1" />);
    });

    const streamingIframe2 = renderer.container.querySelector('iframe');
    expect(streamingIframe2).toBe(streamingIframe);

    // Finishing the stream preserves the iframe node and posts final html in-place (no reload/flicker)
    act(() => {
      renderer.root.render(
        <LiveUiFrame html="<p>Chunk 1 and 2 with math $x$</p>" isLoading={false} cacheKey="msg-1" />,
      );
    });

    const finalIframe = renderer.container.querySelector('iframe');
    expect(finalIframe).not.toBeNull();
    expect(finalIframe).toBe(streamingIframe);
    expect(finalIframe?.getAttribute('srcdoc')).toBe(initialSrcDoc);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: HTML_PREVIEW_MESSAGE_CHANNEL,
        event: HTML_PREVIEW_STREAM_RENDER_EVENT,
        html: expect.stringContaining('class="katex"'),
      }),
      '*',
    );
  });

  it('keeps measured height strictly stable when streaming completes even without cacheKey', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Streaming chunk</p>" isLoading />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: 'resize',
            height: 780,
          },
          source: iframe!.contentWindow,
          origin: 'null',
        }),
      );
    });

    const viewport = renderer.container.querySelector<HTMLElement>('[data-live-artifact-viewport="true"]');
    expect(viewport?.style.height).toBe('780px');

    // Finish streaming without a cacheKey
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Streaming completed</p>" isLoading={false} />);
    });

    // Height must remain 780px and never collapse to 320px
    expect(viewport?.style.height).toBe('780px');
  });

  it('keeps iframe node and measured height strictly stable when cacheKey changes on stream completion', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Streaming chunk</p>" isLoading cacheKey="msg-1:20" />);
    });

    const initialIframe = renderer.container.querySelector('iframe');
    expect(initialIframe).not.toBeNull();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            channel: HTML_PREVIEW_MESSAGE_CHANNEL,
            event: 'resize',
            height: 850,
          },
          source: initialIframe!.contentWindow,
          origin: 'null',
        }),
      );
    });

    const viewport = renderer.container.querySelector<HTMLElement>('[data-live-artifact-viewport="true"]');
    expect(viewport?.style.height).toBe('850px');

    // Finish streaming with shifted offset cacheKey
    act(() => {
      renderer.root.render(
        <LiveUiFrame html="<p>Streaming chunk completed</p>" isLoading={false} cacheKey="msg-1:55" />,
      );
    });

    const finalIframe = renderer.container.querySelector('iframe');
    expect(finalIframe).toBe(initialIframe);
    expect(viewport?.style.height).toBe('850px');
  });

  it('disables pointer events on the iframe during streaming to prevent swallowing parent scroll gestures', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Streaming chunk</p>" isLoading />);
    });

    let iframe = renderer.container.querySelector('iframe');
    expect(iframe?.className).toContain('pointer-events-none');

    act(() => {
      renderer.root.render(<LiveUiFrame html="<p>Streaming chunk</p>" isLoading={false} />);
    });

    iframe = renderer.container.querySelector('iframe');
    expect(iframe?.className).not.toContain('pointer-events-none');
  });

  it('injects serif reading font variable into iframe when readingFontFamily is serif', () => {
    act(() => {
      renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" readingFontFamily="serif" />);
    });

    const iframe = renderer.container.querySelector('iframe');
    expect(iframe?.getAttribute('srcdoc')).toContain('--app-font-reading:var(--app-font-serif)');
    expect(iframe?.getAttribute('srcdoc')).toContain('font-family:var(--app-font-reading)');
  });

  it('uses appSettings readingFontFamily when readingFontFamily prop is omitted', () => {
    const originalFont = useSettingsStore.getState().appSettings.readingFontFamily;
    act(() => {
      useSettingsStore.setState((s) => ({
        appSettings: { ...s.appSettings, readingFontFamily: 'serif' },
      }));
    });

    try {
      act(() => {
        renderer.root.render(<LiveUiFrame html="<section><p>Artifact text</p></section>" />);
      });

      const iframe = renderer.container.querySelector('iframe');
      expect(iframe?.getAttribute('srcdoc')).toContain('--app-font-reading:var(--app-font-serif)');
    } finally {
      act(() => {
        useSettingsStore.setState((s) => ({
          appSettings: { ...s.appSettings, readingFontFamily: originalFont },
        }));
      });
    }
  });
});
