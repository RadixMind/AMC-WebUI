import { describe, expect, it } from 'vitest';
import { normalizeDotSource, normalizeJsonSource, normalizeLiveUiHtmlForPreview } from './liveUiHtmlNormalizer';

describe('normalizeDotSource', () => {
  it('converts single-quoted labels to double-quoted labels', () => {
    const dot = "digraph { A [label='User Request']; }";
    expect(normalizeDotSource(dot)).toBe('digraph { A [label="User Request"]; }');
  });

  it("converts single-quoted labels with escaped quotes label=\\'...\\' to double quotes", () => {
    const dot = "digraph { A [label=\\'User Request\\']; }";
    expect(normalizeDotSource(dot)).toBe('digraph { A [label="User Request"]; }');
  });

  it('escapes inner single quotes inside double-quoted labels to &#39;', () => {
    const dot = 'digraph { A [label="User\'s Request"]; B [label="Don\'t stop"]; A -> B; }';
    expect(normalizeDotSource(dot)).toBe(
      'digraph { A [label="User&#39;s Request"]; B [label="Don&#39;t stop"]; A -> B; }',
    );
  });

  it("escapes inner \\' inside double-quoted labels to &#39;", () => {
    const dot = 'digraph { A [label="User\\\'s Request"]; }';
    expect(normalizeDotSource(dot)).toBe('digraph { A [label="User&#39;s Request"]; }');
  });

  it('handles single quotes inside HTML-like labels <...>', () => {
    const dot = 'digraph { A [label=<<table border="0"><tr><td>User\'s Profile</td></tr></table>>]; }';
    expect(normalizeDotSource(dot)).toBe(
      'digraph { A [label=<<table border="0"><tr><td>User&#39;s Profile</td></tr></table>>]; }',
    );
  });

  it('preserves line and block comments without breaking', () => {
    const dot = "digraph { // comment with ' apostrophe\n A -> B; /* block ' comment */ }";
    expect(normalizeDotSource(dot)).toBe("digraph { // comment with ' apostrophe\n A -> B; /* block ' comment */ }");
  });

  it('preserves multiple space-separated double-quoted attributes without corrupting quotes', () => {
    const dot =
      'node [shape=box style="rounded,filled" fontname="sans-serif" fontsize=11 margin="0.15,0.08"]; c_bridge [label="Task 1: C Bridge" fillcolor="#F8FAFC"];';
    expect(normalizeDotSource(dot)).toBe(dot);
  });
});

describe('normalizeJsonSource', () => {
  it('escapes raw single quotes inside JSON string values', () => {
    const json = '{"title":"User\'s Sales","series":[{"name":"Today\'s"}]}';
    expect(normalizeJsonSource(json)).toBe('{"title":"User&#39;s Sales","series":[{"name":"Today&#39;s"}]}');
  });

  it("escapes \\' inside JSON string values to &#39;", () => {
    const json = '{"title":"User\\\'s Sales"}';
    expect(normalizeJsonSource(json)).toBe('{"title":"User&#39;s Sales"}');
  });
});

describe('normalizeLiveUiHtmlForPreview', () => {
  describe('static HTML normalization', () => {
    it('escapes inner single quotes in data-amc-graphviz so DOMParser does not truncate the attribute', () => {
      const html = `<div data-amc-graphviz='digraph { A [label="User\\'s request"]; B [label="Don\\'t stop"]; A -> B; }'></div>`;
      const normalized = normalizeLiveUiHtmlForPreview(html);
      expect(normalized).toBe(
        `<div data-amc-graphviz='digraph { A [label="User&#39;s request"]; B [label="Don&#39;t stop"]; A -> B; }'></div>`,
      );

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-graphviz')).toBe(
        `digraph { A [label="User's request"]; B [label="Don't stop"]; A -> B; }`,
      );
    });

    it('normalizes single-quoted labels in data-amc-graphviz to double-quoted valid DOT labels', () => {
      const html = `<div data-amc-graphviz='digraph { A [label=\\'User Request\\']; }'></div>`;
      const normalized = normalizeLiveUiHtmlForPreview(html);
      expect(normalized).toBe(`<div data-amc-graphviz='digraph { A [label="User Request"]; }'></div>`);

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-graphviz')).toBe(`digraph { A [label="User Request"]; }`);
    });

    it('normalizes outer double-quoted attributes to outer single quotes with safe inner quotes', () => {
      const html = `<div data-amc-graphviz="digraph { A [label=\\"User's request\\"]; }"></div>`;
      const normalized = normalizeLiveUiHtmlForPreview(html);
      expect(normalized).toBe(`<div data-amc-graphviz='digraph { A [label="User&#39;s request"]; }'></div>`);

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-graphviz')).toBe(`digraph { A [label="User's request"]; }`);
    });

    it('preserves other attributes such as class, id, and style on declarative containers', () => {
      const html = `<div id="diagram-1" class="border rounded" data-amc-graphviz='digraph { A -> B; }' style="overflow: auto"></div>`;
      const normalized = normalizeLiveUiHtmlForPreview(html);

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('id')).toBe('diagram-1');
      expect(el!.getAttribute('class')).toBe('border rounded');
      expect(el!.getAttribute('style')).toBe('overflow: auto');
      expect(el!.getAttribute('data-amc-graphviz')).toBe('digraph { A -> B; }');
    });

    it('escapes single quotes in data-amc-chart, data-amc-echarts, and data-amc-followup JSON', () => {
      const chartHtml = `<div data-amc-chart='{"type":"bar","title":"User\\'s Sales","x":["Q1"],"series":[{"y":[1]}]}'></div>`;
      const normalizedChart = normalizeLiveUiHtmlForPreview(chartHtml);
      const chartDoc = new DOMParser().parseFromString(normalizedChart, 'text/html');
      const chartEl = chartDoc.querySelector('[data-amc-chart]');
      expect(chartEl).not.toBeNull();
      expect(JSON.parse(chartEl!.getAttribute('data-amc-chart')!)).toEqual({
        type: 'bar',
        title: "User's Sales",
        x: ['Q1'],
        series: [{ y: [1] }],
      });

      const followupHtml = `<div data-amc-followup='["What\\'s next?","How\\'s it working?"]'></div>`;
      const normalizedFollowup = normalizeLiveUiHtmlForPreview(followupHtml);
      const followupDoc = new DOMParser().parseFromString(normalizedFollowup, 'text/html');
      const followupEl = followupDoc.querySelector('[data-amc-followup]');
      expect(followupEl).not.toBeNull();
      expect(JSON.parse(followupEl!.getAttribute('data-amc-followup')!)).toEqual(["What's next?", "How's it working?"]);
    });

    it('leaves standard HTML without declarative attributes unchanged', () => {
      const html = '<div class="card"><h3>Title</h3><p>Hello world</p></div>';
      expect(normalizeLiveUiHtmlForPreview(html)).toBe(html);
    });
  });

  describe('streaming HTML normalization', () => {
    it('safely auto-closes incomplete data-amc-graphviz tags even when -> arrow is present', () => {
      const incompleteHtml = `<div><h3>Process</h3><div data-amc-graphviz='digraph { A -> B`;
      const normalized = normalizeLiveUiHtmlForPreview(incompleteHtml, { isStreaming: true });

      expect(normalized).toBe(`<div><h3>Process</h3><div data-amc-graphviz='digraph { A -> B'></div>`);

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      expect(doc.querySelector('h3')?.textContent).toBe('Process');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-graphviz')).toBe('digraph { A -> B');
    });

    it('escapes inner quotes in incomplete streaming graphviz tags', () => {
      const incompleteHtml = `<div><div data-amc-graphviz='digraph { A [label="User\\'s request"] -> B`;
      const normalized = normalizeLiveUiHtmlForPreview(incompleteHtml, { isStreaming: true });

      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-graphviz]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-graphviz')).toBe(`digraph { A [label="User's request"] -> B`);
    });

    it('safely auto-closes incomplete data-amc-chart streaming tags', () => {
      const incompleteHtml = `<div><div data-amc-chart='{"type":"bar","x":["A","B"],`;
      const normalized = normalizeLiveUiHtmlForPreview(incompleteHtml, { isStreaming: true });

      expect(normalized).toBe(`<div><div data-amc-chart='{"type":"bar","x":["A","B"],'></div>`);
      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      const el = doc.querySelector('[data-amc-chart]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-amc-chart')).toBe('{"type":"bar","x":["A","B"],');
    });

    it('strips dangling non-declarative tag openers at EOF during streaming', () => {
      const htmlWithDangling = `<div><p>Complete</p></div><div style="display:`;
      const normalized = normalizeLiveUiHtmlForPreview(htmlWithDangling, { isStreaming: true });

      expect(normalized).toBe(`<div><p>Complete</p></div>`);
    });

    it('strips dangling incomplete element opener at EOF during streaming', () => {
      const htmlWithDangling = `<div><p>Complete</p></div><div`;
      const normalized = normalizeLiveUiHtmlForPreview(htmlWithDangling, { isStreaming: true });

      expect(normalized).toBe(`<div><p>Complete</p></div>`);
    });
  });
});
