import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AVAILABLE_THEMES } from '@/constants/themeRegistry';
import { DOT_MAX_CHARS, DOT_MAX_EDGES, DOT_MAX_NODES } from './graphvizLimits';
import {
  applyThemeAndLayout,
  buildThemeDefaults,
  compensateCjkNodeWidths,
  ensureFilledStyleOnFillcolor,
  estimateCjkNodeWidth,
  flattenGraphvizFill,
  getContrastFontColor,
  getGraphvizCacheKey,
  isCjkText,
  normalizeGraphvizColor,
  renderDotToSvg,
  renderDotToSvgCached,
  resolveCssVariablesInDot,
  resolveDotLayout,
  hydrateGraphvizIntoDocument,
} from './vizRuntime';

// Real theme colors (pearl = light) so assertions track the actual registry.
const PEARL = AVAILABLE_THEMES.find((theme) => theme.id === 'pearl')!.colors;

// Provide a fake viz runtime so no WASM is fetched in tests. The returned SVG
// records the processed DOT in a data-code attribute, letting tests assert on
// theme injection / layout rewriting without real layout.
const fakeInstance = {
  renderSVGElement: vi.fn(async (code: string) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-code', code);
    return svg;
  }),
};

vi.mock('@viz-js/viz', () => ({
  instance: vi.fn(async () => fakeInstance),
}));

beforeEach(() => {
  fakeInstance.renderSVGElement.mockClear();
});

// The fake viz stores the processed DOT in a data-code attribute; outerHTML
// serialization HTML-escapes the inner double quotes, so decode via DOMParser
// before asserting on the theme injection / layout rewriting.
const readProcessedCode = (svgString: string): string => {
  const parsed = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  return parsed.documentElement.getAttribute('data-code') ?? '';
};

describe('resolveDotLayout', () => {
  it('defaults to TB when no rankdir present', () => {
    expect(resolveDotLayout('digraph { A -> B }')).toBe('TB');
  });

  it('honors an explicit rankdir', () => {
    expect(resolveDotLayout('digraph { rankdir=TB; A -> B }')).toBe('TB');
  });

  it('forced layout wins over an explicit rankdir', () => {
    expect(resolveDotLayout('digraph { rankdir=TB; A -> B }', 'LR')).toBe('LR');
  });

  it('treats RL/BT as horizontal/vertical families', () => {
    expect(resolveDotLayout('digraph { rankdir=RL; A -> B }')).toBe('LR');
    expect(resolveDotLayout('digraph { rankdir=BT; A -> B }')).toBe('TB');
  });
});

describe('getGraphvizCacheKey', () => {
  it('includes theme, layout, and dot hash', () => {
    const key = getGraphvizCacheKey('digraph { A -> B }', { themeId: 'pearl' });
    expect(key).toContain('pearl');
    expect(key).toContain('TB');
  });

  it('prefixes the key with the render style version', () => {
    expect(getGraphvizCacheKey('digraph { A -> B }')).toMatch(/^v14:/);
  });

  it('differs when the artifact font size differs for the same dot', () => {
    // The themed DOT embeds a scaled fontsize, so a cached SVG rendered at 16px
    // must not be reused for a 24px artifact.
    const baseline = getGraphvizCacheKey('digraph { A -> B }', { themeId: 'pearl', baseFontSize: 16 });
    const scaled = getGraphvizCacheKey('digraph { A -> B }', { themeId: 'pearl', baseFontSize: 24 });

    expect(baseline).not.toBe(scaled);
  });

  it('normalizes style="rounded" to style="rounded,filled" so fill is preserved', () => {
    const code = applyThemeAndLayout('digraph { node[style="rounded"]; n1[fillcolor=accent] }', { themeId: 'pearl' });
    expect(code).toContain('style="rounded,filled"');
    expect(code).not.toMatch(/style="rounded"(?!,)/);
  });

  it('differs when layout differs for the same dot', () => {
    const lr = getGraphvizCacheKey('digraph { rankdir=TB; A -> B }', { layout: 'LR' });
    const tb = getGraphvizCacheKey('digraph { rankdir=TB; A -> B }', { layout: 'TB' });
    expect(lr).not.toBe(tb);
  });

  it('differs when author-color preservation differs for the same dot', () => {
    const scrubbed = getGraphvizCacheKey('digraph { A [fillcolor="#000"] }', {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    const preserved = getGraphvizCacheKey('digraph { A [fillcolor="#000"] }', {
      themeId: 'pearl',
    });
    expect(scrubbed).not.toBe(preserved);
  });
});

describe('normalizeGraphvizColor', () => {
  it('converts integer-channel rgba() to 8-digit hex (#RRGGBBAA)', () => {
    expect(normalizeGraphvizColor('rgba(37, 99, 235, 0.06)')).toBe('#2563eb0f');
    expect(normalizeGraphvizColor('rgba(22, 163, 74, 0.1)')).toBe('#16a34a1a');
    expect(normalizeGraphvizColor('rgba(6, 78, 59, 0.25)')).toBe('#064e3b40');
  });

  it('drops the alpha channel when rgb() has none (opaque)', () => {
    expect(normalizeGraphvizColor('rgb(255, 0, 0)')).toBe('#ff0000ff');
  });

  it('rounds fractional alpha to the nearest byte', () => {
    expect(normalizeGraphvizColor('rgba(120, 53, 15, 0.28)')).toBe('#78350f47');
  });

  it('passes Graphviz-safe colors through untouched', () => {
    expect(normalizeGraphvizColor('#fef2f2')).toBe('#fef2f2');
    expect(normalizeGraphvizColor('transparent')).toBe('transparent');
    expect(normalizeGraphvizColor('white')).toBe('white');
    expect(normalizeGraphvizColor('#2563eb')).toBe('#2563eb');
  });

  it('clamps out-of-range positive channels and alpha to the byte range', () => {
    expect(normalizeGraphvizColor('rgba(300, 10, 20, 2)')).toBe('#ff0a14ff');
  });

  it('passes non-integer-channel CSS functions through untouched', () => {
    // Negative channels are not valid CSS rgb() input; the normalizer only owns
    // well-formed integer channels and leaves anything else alone.
    expect(normalizeGraphvizColor('rgba(999, -5, 300, 2)')).toBe('rgba(999, -5, 300, 2)');
  });

  it('does not mangle non-rgba CSS values or prose', () => {
    expect(normalizeGraphvizColor('hsl(220 80% 50%)')).toBe('hsl(220 80% 50%)');
    expect(normalizeGraphvizColor('var(--amc-info)')).toBe('var(--amc-info)');
  });
});

describe('flattenGraphvizFill', () => {
  it('composites translucent surfaces onto an opaque base with a minimum alpha', () => {
    // pearl bgSuccess is 10% green; Graphviz nodes need a stronger opaque mint.
    expect(flattenGraphvizFill('rgba(22, 163, 74, 0.1)', '#ffffff')).toBe('#ccebd7');
  });

  it('leaves already-opaque hex unchanged', () => {
    expect(flattenGraphvizFill('#ffffff', '#000000')).toBe('#ffffff');
    expect(flattenGraphvizFill('#141418', '#000000')).toBe('#141418');
  });
});

describe('buildThemeDefaults', () => {
  it('injects clean theme defaults matching native Graphviz without forced card shape', () => {
    const defaults = buildThemeDefaults(PEARL);
    expect(defaults).not.toContain('shape="box"');
    expect(defaults).not.toContain('style="rounded,filled"');
    expect(defaults).not.toContain('splines="curved"');
    expect(defaults).toContain('color="#d5d5dc"'); // pearl borderSecondary
    expect(defaults).toContain('pad="0.2"');
    expect(defaults).toContain('fontname="Helvetica"');
  });

  it('uses a single sans-serif font, not a CSS font stack', () => {
    const defaults = buildThemeDefaults(PEARL);
    expect(defaults).not.toContain('system-ui');
    expect(defaults).toContain('fontname="Helvetica"');
  });

  it('keeps the 16px baseline type scale (graphviz default 14pt)', () => {
    // The defaults must not change what a 16px artifact renders today; they only
    // need to follow the font size setting from there.
    expect(buildThemeDefaults(PEARL)).toContain('fontsize="14"');
    expect(buildThemeDefaults(PEARL, 16)).toContain('fontsize="14"');
  });

  it('scales node, edge, and cluster type with the artifact font size', () => {
    expect(buildThemeDefaults(PEARL, 24)).toContain('fontsize="21"');
    expect(buildThemeDefaults(PEARL, 10)).toContain('fontsize="9"');

    const clustered = applyThemeAndLayout('digraph { subgraph cluster_lane { A } }', {
      themeId: 'pearl',
      baseFontSize: 24,
    });
    expect(clustered).toContain('fontsize="17"'); // lane labels: round(24 * 0.6875)
  });
});

describe('applyThemeAndLayout (clean theme defaults)', () => {
  it('injects clean font/theme defaults and does not inject forced rankdir for bare DOT', () => {
    const code = applyThemeAndLayout('digraph { A -> B }', { themeId: 'pearl' });
    expect(code).not.toContain('shape="box"');
    expect(code).not.toContain('style="rounded,filled"');
    expect(code).not.toContain('splines="curved"');
    expect(code).toContain('color="#d5d5dc"'); // pearl borderSecondary node stroke
    expect(code).toContain('pad="0.2"');
    expect(code).not.toContain('rankdir=');
  });

  it('maps semantic fills to opaque composites and pairs matching stroke/text', () => {
    const code = applyThemeAndLayout('digraph { n1[fillcolor=success]; n2[fillcolor=warning] }', { themeId: 'pearl' });
    const successFill = flattenGraphvizFill(PEARL.bgSuccess, PEARL.bgInput);
    const warningFill = flattenGraphvizFill(PEARL.bgWarning, PEARL.bgInput);
    expect(code).toContain(`fillcolor="${successFill}"`);
    expect(code).toContain(`fillcolor="${warningFill}"`);
    expect(code).toContain('color="#16a34a"'); // pearl textSuccess paired onto n1
    expect(code).toContain('fontcolor="#1a1a1f"'); // pearl textPrimary paired for high-contrast readability
    expect(code).toContain('color="#825f0a"'); // pearl textWarning paired onto n2
    expect(code).not.toContain('rgba(');
    expect(code).not.toMatch(/fillcolor="#[0-9a-fA-F]{8}"/);
  });

  it('maps semantic strokes and text to readable text colors', () => {
    const code = applyThemeAndLayout('digraph { n1[color=accent]; n2[fontcolor=muted] }', { themeId: 'pearl' });
    expect(code).toContain('color="#2563eb"'); // pearl textLink
    expect(code).toContain('fontcolor="#4a4a55"'); // pearl textSecondary
  });

  it('maps the accent fill from its rgba surface color, and strokes stay 6-digit hex', () => {
    const code = applyThemeAndLayout('digraph { a[fillcolor=accent]; b[color=accent] }', { themeId: 'pearl' });
    const accentFill = flattenGraphvizFill(PEARL.bgInfo, PEARL.bgInput);
    expect(code).toContain(`fillcolor="${accentFill}"`);
    expect(code).toContain('color="#2563eb"'); // pearl textLink
    expect(code).not.toContain('rgba(');
  });

  it('uses onyx surface colors for the dark theme', () => {
    const ONYX = AVAILABLE_THEMES.find((theme) => theme.id === 'onyx')!.colors;
    const code = applyThemeAndLayout('digraph { n1; n2[fillcolor=success] }', { themeId: 'onyx' });
    expect(code).toContain(`fillcolor="${flattenGraphvizFill(ONYX.bgSuccess, ONYX.bgInput)}"`);
  });

  it('keeps an explicit rankdir untouched when no forced layout is requested', () => {
    expect(applyThemeAndLayout('digraph { rankdir=TB; A -> B }', {})).toContain('rankdir=TB');
    expect(applyThemeAndLayout('digraph { rankdir=RL; A -> B }', {})).toContain('rankdir=RL');
    expect(applyThemeAndLayout('digraph { rankdir=LR; A -> B }', {})).toContain('rankdir=LR');
    expect(applyThemeAndLayout('digraph { rankdir=BT; A -> B }', {})).toContain('rankdir=BT');
  });

  it('rewrites rankdir when options.layout is passed', () => {
    expect(applyThemeAndLayout('digraph { rankdir=TB; A -> B }', { layout: 'LR' })).toContain('rankdir="LR"');
    expect(applyThemeAndLayout('digraph { A -> B }', { layout: 'LR' })).toContain('rankdir="LR"');
  });

  it('strips hardcoded hex fills when preserveAuthorColors is false', () => {
    const code = applyThemeAndLayout('digraph { workMode[label="wm" fillcolor="#0a0a0a"] }', {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    expect(code).not.toContain('fillcolor="#0a0a0a"');
  });

  it('strips hardcoded rgb() and named color values when preserveAuthorColors is false', () => {
    const code = applyThemeAndLayout('digraph { n1[color="rgb(0,0,0)"]; n2[fontcolor=black] }', {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    expect(code).not.toContain('rgb(0,0,0)');
    expect(code).not.toContain('fontcolor=black');
    expect(code).not.toMatch(/color="rgb\(0,0,0\)"/);
  });

  it('falls both fill and font back to defaults instead of light-on-light when scrubbed', () => {
    const code = applyThemeAndLayout('digraph { n1[fillcolor="#000000" fontcolor="#ffffff"] }', {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    expect(code).not.toContain('fillcolor="#000000"');
    expect(code).not.toContain('fontcolor="#ffffff"');
    expect(code).toContain('fontcolor="#1a1a1f"'); // pearl default node text
  });

  it('keeps semantic color names through the scrub and maps them to theme colors', () => {
    const code = applyThemeAndLayout('digraph { n1[fillcolor=success]; n2[fontcolor=muted] }', {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    expect(code).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgSuccess, PEARL.bgInput)}"`);
    expect(code).toContain('fontcolor="#4a4a55"'); // pearl textSecondary
  });

  it('handles single-quoted hardcoded colors and leaves the label untouched when scrubbed', () => {
    const code = applyThemeAndLayout(`digraph { n1[label="black box" fillcolor='#000000'] }`, {
      themeId: 'pearl',
      preserveAuthorColors: false,
    });
    expect(code).not.toContain('#000000');
    expect(code).toContain('black box'); // label prose is preserved
  });

  it('does not strip theme-default attrs injected into node defaults', () => {
    const code = applyThemeAndLayout('digraph { A -> B }', { themeId: 'pearl' });
    expect(code).toContain('color="#d5d5dc"');
    expect(code).toContain('fontcolor="#1a1a1f"');
  });

  it('does not rewrite a color word inside a label', async () => {
    const result = await renderDotToSvg('digraph { LabelNode[label="accent is blue"] }', { themeId: 'pearl' });
    expect(result.ok).toBe(true);
    expect(readProcessedCode((result as { ok: true; svg: string }).svg)).toContain('accent is blue');
  });

  it('preserves author hex colors by default instead of scrubbing them', () => {
    const source =
      'digraph { task [label="入口", fillcolor="#F8FAFC", color="#64748B", fontcolor="#0F172A", shape=ellipse] }';
    const code = applyThemeAndLayout(source, { themeId: 'pearl' });
    expect(code).toContain('fillcolor="#F8FAFC"');
    expect(code).toContain('color="#64748B"');
    expect(code).toContain('fontcolor="#0F172A"');
    expect(code).not.toMatch(/,\s*,/);
  });

  it('does not leave empty comma attributes after stripping hardcoded colors', () => {
    const source =
      'digraph { task [label="入口, 保留逗号", fillcolor="#F8FAFC", color="#64748B", fontcolor="#0F172A", shape=ellipse] }';
    const code = applyThemeAndLayout(source, { themeId: 'pearl', preserveAuthorColors: false });
    expect(code).not.toContain('fillcolor="#F8FAFC"');
    expect(code).not.toMatch(/,\s*,/);
    expect(code).toContain('label="入口, 保留逗号"');
    expect(code).toContain('shape=ellipse');
  });

  it('lets an explicit semantic stroke on the same node win over fill pairing', () => {
    const code = applyThemeAndLayout('digraph { n1[fillcolor=success color=accent] }', { themeId: 'pearl' });
    expect(code).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgSuccess, PEARL.bgInput)}"`);
    const nodeAttr = code.slice(code.indexOf('n1['), code.indexOf(']', code.indexOf('n1[')) + 1);
    expect(nodeAttr.lastIndexOf('color="#2563eb"')).toBeGreaterThan(nodeAttr.indexOf('color="#16a34a"'));
  });

  it('injects clean theme defaults into cluster subgraphs without forced dashed style', () => {
    const code = applyThemeAndLayout('digraph { subgraph cluster_infer { label="推理"; n1; } }', { themeId: 'pearl' });
    const clusterBody = code.slice(code.indexOf('subgraph cluster_infer'));
    expect(clusterBody).not.toContain('style="rounded,dashed"');
    expect(clusterBody).toContain('color="#d5d5dc"');
    expect(clusterBody).toContain('label="推理"');
    expect(clusterBody).toContain('margin="16"');
  });
});

describe('ensureFilledStyleOnFillcolor', () => {
  it('adds style="filled" when fillcolor is present and style is missing', () => {
    const dot = 'digraph { WAF [label="WAF" fillcolor=warning color=warning]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('style="filled"');
    expect(processed).toContain('fillcolor=warning');
  });

  it('prepends filled to an existing style without filled', () => {
    const dot = 'digraph { nodeB [label="B" style="rounded" fillcolor="#FEF3C7"]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('style="filled,rounded"');
  });

  it('leaves style alone when filled is already present', () => {
    const dot = 'digraph { nodeC [label="C" style="filled,rounded" fillcolor="#FEF3C7"]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('style="filled,rounded"');
    expect(processed).not.toContain('style="filled,filled,rounded"');
  });

  it('does not falsely trigger on fillcolor mentioned in label text', () => {
    const dot = 'digraph { nodeD [label="Note: fillcolor=none" shape=box]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).not.toContain('style=');
  });

  it('ensures style="filled" on cluster subgraphs with fillcolor', () => {
    const dot = 'digraph { subgraph cluster_0 { fillcolor="#F1F5F9"; a -> b; } }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('style="filled"');
    expect(processed).toContain('fillcolor="#F1F5F9"');
  });

  it('ensures style="filled" across all levels of nested clusters with fillcolor', () => {
    const dot = `digraph {
      subgraph cluster_outer {
        label="Outer";
        fillcolor="#F1F5F9";
        subgraph cluster_inner {
          label="Inner";
          fillcolor="#FEF3C7";
          A -> B;
        }
      }
    }`;
    const processed = ensureFilledStyleOnFillcolor(dot);
    const outerMatch = processed.match(/subgraph cluster_outer \{[\s\S]*?fillcolor="#F1F5F9"/);
    const innerMatch = processed.match(/subgraph cluster_inner \{[\s\S]*?fillcolor="#FEF3C7"/);
    expect(outerMatch).not.toBeNull();
    expect(innerMatch).not.toBeNull();
    expect(processed).toContain('fillcolor="#F1F5F9"; style="filled"');
    expect(processed).toContain('fillcolor="#FEF3C7"; style="filled"');
  });

  it('injects high-contrast fontcolor for hex fills when explicit fontcolor is missing', () => {
    const dot =
      'digraph { lightNode [label="Light" fillcolor="#FEF3C7"]; darkNode [label="Dark" fillcolor="#0F172A"]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('fontcolor="#0F172A"');
    expect(processed).toContain('fontcolor="#F8FAFC"');
  });

  it('preserves author-specified fontcolor alongside hex fills', () => {
    const dot = 'digraph { customNode [label="Custom" fillcolor="#FEF3C7" fontcolor="#2563EB"]; }';
    const processed = ensureFilledStyleOnFillcolor(dot);
    expect(processed).toContain('fontcolor="#2563EB"');
    expect(processed).not.toContain('fontcolor="#0F172A"');
  });
});

describe('getContrastFontColor', () => {
  it('returns dark text for light and pastel hex backgrounds', () => {
    expect(getContrastFontColor('#FEF3C7')).toBe('#0F172A'); // soft yellow
    expect(getContrastFontColor('#E0E7FF')).toBe('#0F172A'); // soft indigo
    expect(getContrastFontColor('#FEE2E2')).toBe('#0F172A'); // soft red
    expect(getContrastFontColor('#DCFCE7')).toBe('#0F172A'); // soft green
    expect(getContrastFontColor('#FFFFFF')).toBe('#0F172A'); // white
    expect(getContrastFontColor('#FFF')).toBe('#0F172A'); // shorthand white
  });

  it('returns light text for dark hex backgrounds', () => {
    expect(getContrastFontColor('#0F172A')).toBe('#F8FAFC'); // slate 900
    expect(getContrastFontColor('#1E293B')).toBe('#F8FAFC'); // slate 800
    expect(getContrastFontColor('#000000')).toBe('#F8FAFC'); // black
    expect(getContrastFontColor('#000')).toBe('#F8FAFC'); // shorthand black
  });
});

describe('renderDotToSvg', () => {
  it('returns empty for blank DOT', async () => {
    const result = await renderDotToSvg('   \n  ');
    expect(result).toEqual({ ok: false, error: 'empty' });
  });

  it('returns too-large when the DOT exceeds char or edge limits', async () => {
    const longDot = `digraph { ${'a'.repeat(DOT_MAX_CHARS + 10)} }`;
    expect(await renderDotToSvg(longDot)).toMatchObject({ ok: false, error: 'too-large' });

    const manyEdges = `digraph { ${'A->B; '.repeat(DOT_MAX_EDGES + 1)} }`;
    expect(await renderDotToSvg(manyEdges)).toMatchObject({ ok: false, error: 'too-large' });
  });

  it('returns too-large when the DOT exceeds the node limit', async () => {
    const dot = `digraph { ${Array.from({ length: DOT_MAX_NODES + 1 }, (_, i) => `n${i}`).join('; ')}; }`;
    expect(await renderDotToSvg(dot)).toMatchObject({ ok: false, error: 'too-large' });
  });

  it('returns render-failed when viz throws', async () => {
    fakeInstance.renderSVGElement.mockRejectedValueOnce(new Error('WASM failed'));
    const result = await renderDotToSvg('digraph { Fail -> Test }');
    expect(result).toMatchObject({ ok: false, error: 'render-failed', message: 'WASM failed' });
  });

  it('injects a transparent theme background for bare DOT', async () => {
    const result = await renderDotToSvg('digraph { Theme -> Test }', { themeId: 'pearl' });
    expect(result.ok).toBe(true);
    const code = readProcessedCode((result as { ok: true; svg: string }).svg);
    expect(code).toContain('bgcolor="transparent"');
    // Pearl primary text is near-black; the injected graph fontcolor must match.
    expect(code).toContain('#1a1a1f');
  });

  it('injects clean defaults through the render path without forced card shape', async () => {
    const result = await renderDotToSvg('digraph { Theme -> Test }', { themeId: 'pearl' });
    expect(result.ok).toBe(true);
    const code = readProcessedCode((result as { ok: true; svg: string }).svg);
    expect(code).not.toContain('shape="box"');
    expect(code).not.toContain('style="rounded,filled"');
    expect(code).toContain('fontname="Helvetica"');
    expect(code).not.toContain('system-ui');
  });

  it('injects edge label text halo attributes for high readability', async () => {
    fakeInstance.renderSVGElement.mockImplementationOnce(async (code: string) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-code', code);
      const edgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      edgeG.setAttribute('class', 'edge');
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.textContent = 'FlowsTo';
      edgeG.appendChild(text);
      svg.appendChild(edgeG);
      return svg;
    });

    const result = await renderDotToSvg('digraph { A -> B [label="FlowsTo"] }', { themeId: 'pearl' });
    expect(result.ok).toBe(true);
    const svg = (result as { ok: true; svg: string }).svg;
    expect(svg).toContain('paint-order="stroke fill"');
    expect(svg).toContain('stroke-width="3.5px"');
  });

  it('rewrites Helvetica in the SVG to a CJK-capable font stack', async () => {
    fakeInstance.renderSVGElement.mockImplementationOnce(async (code: string) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-code', code);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('font-family', 'Helvetica');
      text.textContent = '节点';
      svg.appendChild(text);
      return svg;
    });

    const result = await renderDotToSvg('digraph { Font -> Test }');
    expect(result.ok).toBe(true);
    const svg = (result as { ok: true; svg: string }).svg;
    expect(svg).toContain('PingFang SC');
    expect(svg).not.toMatch(/font-family="Helvetica"/);
  });

  it('rewrites an explicit rankdir when a layout is forced', async () => {
    const result = await renderDotToSvg('digraph { rankdir=TB; ForceLayout -> Test }', { layout: 'LR' });
    expect(result.ok).toBe(true);
    expect(readProcessedCode((result as { ok: true; svg: string }).svg)).toContain('rankdir="LR"');
  });

  it('maps semantic color names to theme values', async () => {
    const result = await renderDotToSvg(
      'digraph { ColorNode[color=success]; WarnNode[fontcolor=warning]; ColorNode->WarnNode; }',
      {
        themeId: 'onyx',
      },
    );
    expect(result.ok).toBe(true);
    const code = readProcessedCode((result as { ok: true; svg: string }).svg);
    expect(code).toContain('#4ade80'); // onyx textSuccess
    expect(code).toContain('#fbbf24'); // onyx textWarning
  });

  it('does not rewrite a color word inside a label', async () => {
    const result = await renderDotToSvg('digraph { LabelNode[label="accent is blue"] }', { themeId: 'pearl' });
    expect(result.ok).toBe(true);
    expect(readProcessedCode((result as { ok: true; svg: string }).svg)).toContain('accent is blue');
  });

  it('sanitizes injected script/event-handler/javascript hrefs out of viz output', async () => {
    fakeInstance.renderSVGElement.mockImplementationOnce(async () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('onload', 'alert(1)');
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'script'));
      const badAnchor = document.createElementNS('http://www.w3.org/2000/svg', 'a');
      badAnchor.setAttribute('href', 'javascript:alert(2)');
      svg.appendChild(badAnchor);
      return svg;
    });

    const result = await renderDotToSvg('digraph { Sanitize -> Test }');
    expect(result.ok).toBe(true);
    const svg = (result as { ok: true; svg: string }).svg;
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('javascript:');
    expect(svg).not.toContain('<a');
  });
});

describe('renderDotToSvgCached', () => {
  it('serves the second call from cache without re-rendering', async () => {
    const first = await renderDotToSvgCached('digraph { CacheHit -> Test }', { themeId: 'pearl' });
    expect(first.ok).toBe(true);
    const rendersAfterFirst = fakeInstance.renderSVGElement.mock.calls.length;

    const second = await renderDotToSvgCached('digraph { CacheHit -> Test }', { themeId: 'pearl' });
    expect(second.ok).toBe(true);
    expect(fakeInstance.renderSVGElement.mock.calls.length).toBe(rendersAfterFirst);
  });

  it('keeps distinct entries for distinct theme/layout combos', async () => {
    await renderDotToSvgCached('digraph { DistinctA -> Test }', { themeId: 'pearl', layout: 'LR' });
    await renderDotToSvgCached('digraph { DistinctB -> Test }', { themeId: 'onyx', layout: 'TB' });
    expect(fakeInstance.renderSVGElement.mock.calls.length).toBe(2);
  });

  it('does not cache a failed render', async () => {
    fakeInstance.renderSVGElement.mockRejectedValueOnce(new Error('boom'));
    const first = await renderDotToSvgCached('digraph { NoCacheFail -> Test }', { themeId: 'pearl' });
    expect(first).toMatchObject({ ok: false, error: 'render-failed' });

    const second = await renderDotToSvgCached('digraph { NoCacheFail -> Test }', { themeId: 'pearl' });
    expect(second.ok).toBe(true);
  });
});

describe('hydrateGraphvizIntoDocument', () => {
  it('injects static SVG into data-amc-graphviz nodes', async () => {
    const doc = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><body><div data-amc-graphviz="digraph { Hydrate -> Test }"></div></body></html>',
      'text/html',
    );
    await hydrateGraphvizIntoDocument(doc, { themeId: 'pearl' });

    const node = doc.querySelector('[data-amc-graphviz]') as HTMLElement;
    expect(node.querySelector('svg')).not.toBeNull();
    expect(node.style.overflowX).toBe('auto');
    expect(node.style.maxWidth).toBe('100%');
    expect(node.style.cursor).toBe('zoom-in');
    expect(node.getAttribute('data-amc-graphviz-state')).toBe('rendered');
    expect(node.getAttribute('title')).toContain('放大');
  });

  it('leaves nodes untouched when rendering fails', async () => {
    fakeInstance.renderSVGElement.mockRejectedValue(new Error('boom'));
    const doc = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><body><div data-amc-graphviz="digraph { HydrateFail -> Test }">placeholder</div></body></html>',
      'text/html',
    );
    await hydrateGraphvizIntoDocument(doc, { themeId: 'pearl' });

    const node = doc.querySelector('[data-amc-graphviz]')!;
    expect(node.querySelector('svg')).toBeNull();
    expect(node.textContent).toContain('placeholder');
  });

  it('hydrates pre[data-amc-graphviz] with DOT in textContent into static SVG', async () => {
    fakeInstance.renderSVGElement.mockImplementation(async (code: string) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-code', code);
      return svg;
    });
    const doc = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><body><pre data-amc-graphviz>digraph { A -> B }</pre></body></html>',
      'text/html',
    );
    await hydrateGraphvizIntoDocument(doc, { themeId: 'pearl' });

    const node = doc.querySelector('[data-amc-graphviz]') as HTMLElement;
    expect(node.querySelector('svg')).not.toBeNull();
    expect(node.getAttribute('data-amc-graphviz-state')).toBe('rendered');
  });
});

describe('compensateCjkNodeWidths and CJK metrics', () => {
  it('identifies Cjk characters and punctuation accurately', () => {
    expect(isCjkText('中央能量电池')).toBe(true);
    expect(isCjkText('Hello World')).toBe(false);
    expect(isCjkText('（离子鲨 / 意志之力）')).toBe(true);
    expect(isCjkText('123456')).toBe(false);
  });

  it('estimates node width with comfortable breathing room for CJK text', () => {
    const batteryWidth = estimateCjkNodeWidth('中央能量电池 (离子鲨 / 意志之力)', 14);
    // 13 CJK characters + 5 ASCII characters should require at least 3.4 inches
    expect(batteryWidth).toBeGreaterThan(3.2);

    const shortWidth = estimateCjkNodeWidth('开始', 14);
    expect(shortWidth).toBeGreaterThanOrEqual(0.75);
  });

  it('handles multi-line labels by taking the widest line', () => {
    const single = estimateCjkNodeWidth('短文本', 14);
    const multi = estimateCjkNodeWidth('短文本\\n较长的一行中文字符测试', 14);
    expect(multi).toBeGreaterThan(single);
  });

  it('injects width attribute on CJK node declarations', () => {
    const dot = 'digraph { n1[label="中央能量电池 (离子鲨 / 意志之力)" shape=box]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).toMatch(/n1\[label="中央能量电池 \(离子鲨 \/ 意志之力\)" shape=box width="[0-9.]+"\]/);
  });

  it('leaves Latin-only node declarations untouched', () => {
    const dot = 'digraph { n1[label="Only English Text" shape=box]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).not.toContain('width=');
  });

  it('does not add width to edge declarations with CJK labels', () => {
    const dot = 'digraph { A -> B [label="流向分支"]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).not.toContain('width=');
  });

  it('expands an existing width that is too small for CJK text', () => {
    const dot = 'digraph { n1[label="中央能量电池 (离子鲨 / 意志之力)" width="1.0"]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).not.toContain('width="1.0"');
    expect(processed).toMatch(/width="[3-9]\.[0-9]+"/);
  });

  it('preserves an existing width that is already generously sized', () => {
    const dot = 'digraph { n1[label="中央能量电池 (离子鲨 / 意志之力)" width="8.5"]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).toContain('width="8.5"');
  });

  it('correctly handles brackets inside quoted labels without breaking the attribute block', () => {
    const dot = 'digraph { sys[label="[系统] 核心机密" shape=box]; }';
    const processed = compensateCjkNodeWidths(dot);
    expect(processed).toContain('[系统] 核心机密');
    expect(processed).toContain('width=');
  });

  it('applies CJK width compensation end-to-end through applyThemeAndLayout', () => {
    const dot = 'digraph { battery[label="中央能量电池 (离子鲨 / 意志之力)" shape=box]; }';
    const processed = applyThemeAndLayout(dot, { themeId: 'pearl' });
    expect(processed).toMatch(/battery\[label="中央能量电池 \(离子鲨 \/ 意志之力\)" shape=box width="[0-9.]+"\]/);
  });
});

describe('resolveCssVariablesInDot (Live UI & CSS variable resilience)', () => {
  it('resolves Live UI surface and text CSS variables to valid hex colors', () => {
    const dot = `digraph {
      node [fillcolor="var(--amc-live-artifact-surface-muted)" color="var(--amc-live-artifact-border)"];
      title [fontcolor="var(--amc-live-artifact-text)"];
      route [fillcolor="var(--amc-live-artifact-accent-surface)"];
      success [fillcolor="var(--amc-live-artifact-success-surface)"];
    }`;
    const resolved = resolveCssVariablesInDot(dot, PEARL);

    expect(resolved).not.toContain('var(--amc-live-artifact-surface-muted)');
    expect(resolved).not.toContain('var(--amc-live-artifact-border)');
    expect(resolved).not.toContain('var(--amc-live-artifact-text)');
    expect(resolved).not.not.toBeUndefined();
    expect(resolved).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgSurfaceMuted, PEARL.bgInput)}"`);
    expect(resolved).toContain(`color="${normalizeGraphvizColor(PEARL.borderSecondary)}"`);
    expect(resolved).toContain(`fontcolor="${normalizeGraphvizColor(PEARL.textPrimary)}"`);
    expect(resolved).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgInfo, PEARL.bgInput)}"`);
    expect(resolved).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgSuccess, PEARL.bgInput)}"`);
  });

  it('safely falls back for unknown CSS variables so Graphviz WASM never defaults to black', () => {
    const dot = 'digraph { n1 [fillcolor="var(--unknown-token)" color="var(--unknown-border)"]; }';
    const resolved = resolveCssVariablesInDot(dot, PEARL);

    expect(resolved).not.toContain('var(--unknown-token)');
    expect(resolved).not.toContain('#000000');
    expect(resolved).toContain(`fillcolor="${flattenGraphvizFill(PEARL.bgSurfaceMuted, PEARL.bgInput)}"`);
    expect(resolved).toContain(`color="${normalizeGraphvizColor(PEARL.textPrimary)}"`);
  });

  it('normalizes author rgb() and rgba() in color attributes to hex', () => {
    const dot = 'digraph { n1 [fillcolor="rgb(240, 245, 250)" color="rgba(30, 41, 59, 0.8)"]; }';
    const resolved = resolveCssVariablesInDot(dot, PEARL);

    expect(resolved).not.toContain('rgb(');
    expect(resolved).not.toContain('rgba(');
    expect(resolved).toContain('fillcolor="#f0f5fa"');
  });

  it('processes user VoiceHotkey flowchart end-to-end without black nodes or CSS variables', () => {
    const userDot = `digraph {
      rankdir=LR;
      node [shape=box, style="rounded,filled", fillcolor="var(--amc-live-artifact-surface-muted)", fontname="sans-serif", fontsize=11, margin="0.15,0.08"];
      voice [label="按键说话 (语音输入)" shape=ellipse];
      route [label="触发判定" shape=diamond style="filled" fillcolor="var(--amc-live-artifact-accent-surface)"];
      local [label="方式一：精准口令库\\n(本地离线 / 0延迟)" style="filled" fillcolor="var(--amc-live-artifact-success-surface)"];
      llm [label="方式二：意图大模型\\n(自然语言语义解析)"];
      exec [label="/usr/bin/shortcuts run" style="filled" fillcolor="var(--amc-live-artifact-accent-surface)"];
      target [label="macOS 自动化完成" shape=ellipse style="filled" fillcolor="var(--amc-live-artifact-success-surface)"];
      voice -> route;
      route -> local [label="命中词库"];
      route -> llm [label="泛化语句"];
      local -> exec;
      llm -> exec;
      exec -> target;
    }`;

    const processed = applyThemeAndLayout(userDot, { themeId: 'pearl' });

    // Must eliminate all raw CSS variables
    expect(processed).not.toContain('var(--amc-live-artifact');
    // Must not produce #000000 (black) fill on nodes
    expect(processed).not.toContain('fillcolor="#000000"');
    expect(processed).not.toContain('fillcolor="#000"');
    // Muted surface fill on node declaration
    const mutedFill = flattenGraphvizFill(PEARL.bgSurfaceMuted, PEARL.bgInput);
    expect(processed).toContain(`fillcolor="${mutedFill}"`);
    // Contrast fontcolor is injected on light cards
    const accentFill = flattenGraphvizFill(PEARL.bgInfo, PEARL.bgInput);
    const contrastFont = getContrastFontColor(accentFill);
    expect(processed).toContain(`fontcolor="${contrastFont}"`);
  });
});
