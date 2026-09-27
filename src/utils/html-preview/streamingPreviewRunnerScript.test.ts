import { describe, expect, it } from 'vitest';
import { CHART_RENDERER_SCRIPT } from './chartRendererScript';
import { HTML_PREVIEW_MESSAGE_CHANNEL, HTML_PREVIEW_STREAM_RENDER_EVENT } from './previewMessageProtocol';
import { buildStreamingHtmlPreviewRenderPayload } from './previewDocument';
import { STREAMING_PREVIEW_RUNNER_SCRIPT } from './streamingPreviewRunnerScript';

const CHART_BAR = '{"type":"bar","x":["A","B"],"series":[{"y":[1,2]}]}';
const CHART_PIE = '{"type":"pie","slices":[{"name":"a","y":1}]}';

const runStreamingRunner = (): void => {
  // The exported constant is a full `<script>...</script>` string; strip the
  // tags so it can be executed against the jsdom window/document.
  const code = STREAMING_PREVIEW_RUNNER_SCRIPT.replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
  const run = new Function('window', 'document', code);
  run(window, document);
};

const runChartRenderer = (): { renderAll: () => void } => {
  const stubWindow: Record<string, unknown> = {
    document,
    MutationObserver: undefined,
    requestAnimationFrame: (fn: () => void) => fn(),
    addEventListener: () => {},
    navigator: {},
    location: { origin: 'null' },
  };
  const run = new Function('window', 'document', 'notifyDiagnostic', CHART_RENDERER_SCRIPT);
  run(stubWindow, document, undefined);
  return stubWindow.__amcChart as { renderAll: () => void };
};

const dispatchStream = (html: string): void => {
  const event = new Event('message') as Event & { data?: unknown };
  event.data = { channel: HTML_PREVIEW_MESSAGE_CHANNEL, event: HTML_PREVIEW_STREAM_RENDER_EVENT, html };
  window.dispatchEvent(event);
};

describe('streaming preview runner chart guard', () => {
  it('keeps a rendered chart SVG across attribute-unchanged stream patches and re-renders on change', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    dispatchStream(`<div data-amc-chart='${CHART_BAR}'></div>`);

    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    const chartNode = root.querySelector<HTMLElement>('[data-amc-chart]');
    expect(chartNode).not.toBeNull();

    runChartRenderer();
    expect(chartNode!.querySelector('svg')).not.toBeNull();

    // Same payload again: the guard must preserve the already-rendered SVG.
    dispatchStream(`<div data-amc-chart='${CHART_BAR}'></div>`);
    expect(chartNode!.querySelector('svg')).not.toBeNull();
    expect(chartNode!.getAttribute('data-amc-chart')).toBe(CHART_BAR);

    // Changed payload: the stale SVG is dropped by the patcher, then the
    // renderer (here invoked directly; in the iframe via its observer) rebuilds.
    dispatchStream(`<div data-amc-chart='${CHART_PIE}'></div>`);
    expect(chartNode!.querySelector('svg')).toBeNull();
    expect(chartNode!.getAttribute('data-amc-chart')).toBe(CHART_PIE);

    const { renderAll } = runChartRenderer();
    renderAll();
    expect(chartNode!.querySelector('svg')).not.toBeNull();
    expect(chartNode!.querySelectorAll('svg path')).toHaveLength(1);
  });

  it('never cross-patches a chart node with a normal div when indices shift', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    // First chunk: root has a chart node
    dispatchStream(`<div data-amc-chart='${CHART_BAR}'></div>`);
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    const chartNode = root.querySelector<HTMLElement>('[data-amc-chart]')!;
    expect(chartNode).not.toBeNull();

    runChartRenderer();
    expect(chartNode.querySelector('svg')).not.toBeNull();

    // Second chunk: index 0 is now a normal div (card)
    dispatchStream(`<div class="card"><h3>Title</h3><p>Text</p></div>`);
    const cardNode = root.querySelector<HTMLElement>('.card');
    expect(cardNode).not.toBeNull();
    // Must be completely replaced — not patched into the chart node with residual SVG
    expect(cardNode!.hasAttribute('data-amc-chart')).toBe(false);
    expect(cardNode!.querySelector('svg')).toBeNull();
    expect(cardNode!.querySelector('h3')?.textContent).toBe('Title');
    expect(cardNode!.querySelector('p')?.textContent).toBe('Text');
  });

  it('ignores dangling incomplete tag openers at the end of streaming HTML', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    dispatchStream(`<div><p>Complete</p></div><div style="display:`);
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    expect(root.querySelector('p')?.textContent).toBe('Complete');
    expect(root.querySelectorAll('div')).toHaveLength(1);
  });

  it('never strips _echarts_instance_ or data-amc-chart-sig on unchanged chart patches', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    dispatchStream(`<div data-amc-chart='${CHART_BAR}'></div>`);
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    const chartNode = root.querySelector<HTMLElement>('[data-amc-chart]')!;
    expect(chartNode).not.toBeNull();

    // Simulate ECharts stamping runtime attributes
    chartNode.setAttribute('_echarts_instance_', 'ec_test_123');
    chartNode.setAttribute('data-amc-chart-sig', 'sig_test_456');
    chartNode.setAttribute('data-amc-chart-rendered', '1');

    // Re-dispatch identical stream patch
    dispatchStream(`<div data-amc-chart='${CHART_BAR}'></div>`);

    // All runtime attributes must survive
    expect(chartNode.getAttribute('_echarts_instance_')).toBe('ec_test_123');
    expect(chartNode.getAttribute('data-amc-chart-sig')).toBe('sig_test_456');
    expect(chartNode.getAttribute('data-amc-chart-rendered')).toBe('1');
  });

  it('disposes and wipes nested descendant charts when a parent card is replaced', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    let disposedId: string | null = null;
    (window as any).echarts = {
      getInstanceByDom(el: HTMLElement) {
        if (el.getAttribute('_echarts_instance_') === 'ec_nested') {
          return {
            dispose() {
              disposedId = 'ec_nested';
            },
          };
        }
        return undefined;
      },
    };

    dispatchStream(`<div class="card"><div data-amc-chart='${CHART_BAR}'></div></div>`);
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    const chartNode = root.querySelector<HTMLElement>('[data-amc-chart]')!;
    chartNode.setAttribute('_echarts_instance_', 'ec_nested');
    const mockSvg = document.createElement('svg');
    chartNode.appendChild(mockSvg);

    // Now card is replaced by a table
    dispatchStream(`<div class="table-container"><table><tbody><tr><td>Data</td></tr></tbody></table></div>`);

    expect(disposedId).toBe('ec_nested');
    expect(root.querySelector('[data-amc-chart]')).toBeNull();
    expect(root.querySelector('svg')).toBeNull();
    expect(root.querySelector('td')?.textContent).toBe('Data');
  });

  it('guarantees single ECharts instance and no SVG stacking across incremental stream chunks', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    let ecInitCount = 0;
    const instances = new Map<string, any>();
    (window as any).echarts = {
      getInstanceByDom(el: HTMLElement) {
        const id = el.getAttribute('_echarts_instance_');
        return id ? instances.get(id) : undefined;
      },
      init(el: HTMLElement) {
        ecInitCount += 1;
        const id = `ec_${ecInitCount}`;
        el.setAttribute('_echarts_instance_', id);
        const svg = document.createElement('svg');
        el.appendChild(svg);
        const inst = {
          dispose() {
            instances.delete(id);
            el.removeAttribute('_echarts_instance_');
          },
        };
        instances.set(id, inst);
        return inst;
      },
    };

    // Dispatch chart chunk
    dispatchStream(`<div><div data-amc-chart='${CHART_BAR}'></div></div>`);
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    const chartNode = root.querySelector<HTMLElement>('[data-amc-chart]')!;

    // Trigger initial render
    (window as any).echarts.init(chartNode);
    chartNode.setAttribute('data-amc-chart-sig', 'sig_bar');
    expect(ecInitCount).toBe(1);
    expect(chartNode.querySelectorAll('svg')).toHaveLength(1);

    // Stream subsequent chunks that append tables and paragraphs
    dispatchStream(`<div><div data-amc-chart='${CHART_BAR}'></div><h3>Section 2</h3></div>`);
    dispatchStream(`<div><div data-amc-chart='${CHART_BAR}'></div><h3>Section 2</h3><p>Table chunk</p></div>`);
    dispatchStream(
      `<div><div data-amc-chart='${CHART_BAR}'></div><h3>Section 2</h3><p>Table chunk</p><div>Footer</div></div>`,
    );

    // The chart node was never re-initialized and SVG was not duplicated
    expect(ecInitCount).toBe(1);
    expect(root.querySelectorAll('svg')).toHaveLength(1);
    expect(chartNode.getAttribute('_echarts_instance_')).toBe('ec_1');
    expect(chartNode.getAttribute('data-amc-chart-sig')).toBe('sig_bar');
  });

  it('preserves an incomplete streaming graphviz node containing -> arrow and apostrophe', () => {
    document.body.innerHTML = '<div data-amc-stream-preview-root="true"></div>';
    runStreamingRunner();

    // Incomplete stream chunk where -> has appeared and label has an apostrophe,
    // processed via buildStreamingHtmlPreviewRenderPayload as LiveUiFrame does.
    dispatchStream(
      buildStreamingHtmlPreviewRenderPayload(
        `<div><h3>Process</h3><div data-amc-graphviz='digraph { A [label="User\\'s request"] -> B`,
      ),
    );
    const root = document.querySelector('[data-amc-stream-preview-root]')!;
    expect(root.querySelector('h3')?.textContent).toBe('Process');

    const graphvizNode = root.querySelector<HTMLElement>('[data-amc-graphviz]');
    expect(graphvizNode).not.toBeNull();
    expect(graphvizNode!.getAttribute('data-amc-graphviz')).toBe(`digraph { A [label="User's request"] -> B`);
  });
});
