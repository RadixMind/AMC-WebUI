/**
 * Declarative chart DSL renderer injected into Live Artifacts.
 *
 * The model emits `<div data-amc-chart='{"type":"bar",...}'></div>` nodes; this
 * script renders them as dependency-free SVG using the iframe's
 * `--amc-live-artifact-*` theme variables. The same string is embedded inside
 * the sandboxed iframe (via PREVIEW_BRIDGE_SCRIPT) and executed on the parent
 * side (via `new Function`) for PNG export hydration, so both render paths
 * share a single implementation.
 *
 * Defensive constraints shared by both runtimes:
 * - no getComputedStyle (unreliable on detached nodes): colors are always
 *   `var(--amc-live-artifact-*)` references, never hardcoded hex values
 * - window APIs are feature-guarded so the script runs synchronously to
 *   completion against a stub window (the export path registers no observer)
 * - `notifyDiagnostic` is bridge-scope only and is guarded with `typeof`, so a
 *   missing binding in the `new Function` scope cannot throw (a bad chart spec
 *   must never break an entire PNG export)
 */
import { buildEchartsThemeFromCssVars, normalizeEchartsOption } from './echartsRendererScript';

export const CHART_RENDERER_SCRIPT = `
(() => {
  const SELECTOR = '[data-amc-chart]';
  const SIG_ATTR = 'data-amc-chart-sig';
  const PENDING_ATTR = 'data-amc-chart-pending';
  const ERROR_ATTR = 'data-amc-chart-error';
  const RENDERED_ATTR = 'data-amc-chart-rendered';

  const hash = (sourceString) => {
    let hashValue = 0;
    for (let index = 0; index < sourceString.length; index += 1) hashValue = (hashValue * 31 + sourceString.charCodeAt(index)) | 0;
    return (hashValue >>> 0).toString(36);
  };
  const clamp = (value, lowerBound, upperBound) => Math.min(upperBound, Math.max(lowerBound, value));
  const isFiniteNum = (value) => typeof value === 'number' && Number.isFinite(value);

  // d3-style tick step: 1/2/5 x 10^k.
  function tickStep(min, max, count) {
    const span = max - min || 1;
    const step0 = Math.abs(span) / Math.max(1, count);
    let step1 = Math.pow(10, Math.floor(Math.log(step0) / Math.LN10));
    const err = step0 / step1;
    if (err >= Math.sqrt(50)) step1 *= 10;
    else if (err >= Math.sqrt(10)) step1 *= 5;
    else if (err >= Math.sqrt(2)) step1 *= 2;
    return step1;
  }

  const niceTicks = (min, max, count = 4) => {
    if (min === max) max = min + 1;
    const step = tickStep(min, max, count);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let tickValue = lo; tickValue <= hi + step * 1e-9; tickValue += step) ticks.push(Number(tickValue.toFixed(6)));
    return { lo, hi, step, ticks };
  };

  const formatTick = (tickValue) => {
    const abs = Math.abs(tickValue);
    return abs >= 1000
      ? tickValue.toLocaleString('en-US', { maximumFractionDigits: 1 })
      : Number(tickValue.toFixed(2)).toString();
  };

  const NS = 'http://www.w3.org/2000/svg';
  const createSvgElement = (elementName, attributes = {}, textContent) => {
    const node = document.createElementNS(NS, elementName);
    for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    if (textContent != null) node.textContent = textContent;
    return node;
  };
  const TEXT_MUTED = 'var(--amc-live-artifact-muted)';
  const BORDER = 'var(--amc-live-artifact-border)';
  const FONT = 'system-ui, sans-serif';
  const W = 560;

  const SEMANTIC_COLORS = {
    accent: 'var(--amc-live-artifact-accent)',
    success: 'var(--amc-live-artifact-success)',
    warning: 'var(--amc-live-artifact-warning)',
    danger: 'var(--amc-live-artifact-danger)',
    muted: 'var(--amc-live-artifact-muted)',
    subtle: 'var(--amc-live-artifact-subtle)',
  };
  const SURFACE_COLORS = {
    accent: 'var(--amc-live-artifact-accent-surface)',
    success: 'var(--amc-live-artifact-success-surface)',
    warning: 'var(--amc-live-artifact-warning-surface)',
    danger: 'var(--amc-live-artifact-danger-surface)',
  };
  const PALETTE = ['accent', 'success', 'warning', 'danger', 'muted', 'subtle'];
  const PALETTE_COLORS = PALETTE.map((paletteKey) => SEMANTIC_COLORS[paletteKey]);

  const colorKey = (series, index) => {
    const key = series && typeof series.color === 'string' && series.color ? series.color : PALETTE[index % PALETTE.length];
    return SEMANTIC_COLORS[key] || key;
  };
  const seriesColor = (series, index) => colorKey(series, index);
  const seriesSurface = (series, index) => {
    const key = colorKey(series, index);
    return SURFACE_COLORS[key] || SEMANTIC_COLORS[key] || key;
  };

  const VALID_TYPES = ['bar', 'grouped-bar', 'stacked-bar', 'line', 'area', 'pie', 'donut', 'scatter'];

  // Returns a normalized spec, or null when the payload is invalid.
  function normalizeSpec(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!VALID_TYPES.includes(raw.type)) return null;

    const spec = {
      type: raw.type,
      title: typeof raw.title === 'string' ? raw.title : undefined,
      height: isFiniteNum(raw.height) ? clamp(Math.round(raw.height), 120, 480) : 240,
      legend: raw.legend === undefined ? undefined : Boolean(raw.legend),
      xLabel: typeof raw.xLabel === 'string' ? raw.xLabel : undefined,
      yLabel: typeof raw.yLabel === 'string' ? raw.yLabel : undefined,
    };

    if (spec.type === 'pie' || spec.type === 'donut') {
      if (!Array.isArray(raw.slices) || !raw.slices.length) return null;
      const slices = [];
      for (const slice of raw.slices) {
        if (!slice || typeof slice !== 'object' || !isFiniteNum(slice.y)) return null;
        slices.push({
          name: typeof slice.name === 'string' ? slice.name : '',
          y: slice.y,
          color: typeof slice.color === 'string' ? slice.color : undefined,
        });
      }
      spec.slices = slices;
      return spec;
    }

    if (spec.type === 'scatter') {
      if (!Array.isArray(raw.series) || !raw.series.length) return null;
      const series = [];
      for (const s of raw.series) {
        if (!s || typeof s !== 'object' || !Array.isArray(s.points) || !s.points.length) return null;
        const points = [];
        for (const point of s.points) {
          if (!Array.isArray(point) || point.length < 2 || !isFiniteNum(point[0]) || !isFiniteNum(point[1])) {
            return null;
          }
          points.push([point[0], point[1]]);
        }
        series.push({
          name: typeof s.name === 'string' ? s.name : undefined,
          color: typeof s.color === 'string' ? s.color : undefined,
          points,
        });
      }
      spec.series = series;
      return spec;
    }

    // bar / grouped-bar / stacked-bar / line / area
    if (!Array.isArray(raw.x) || !raw.x.length) return null;
    const x = raw.x.map((xValue) => (isFiniteNum(xValue) ? xValue : typeof xValue === 'string' ? xValue : null));
    if (x.some((xValue) => xValue === null)) return null;
    if (!Array.isArray(raw.series) || !raw.series.length) return null;
    const series = [];
    for (const s of raw.series) {
      if (!s || typeof s !== 'object' || !Array.isArray(s.y) || s.y.length !== x.length) return null;
      if (s.y.some((yValue) => !isFiniteNum(yValue))) return null;
      series.push({
        name: typeof s.name === 'string' ? s.name : undefined,
        color: typeof s.color === 'string' ? s.color : undefined,
        y: s.y.slice(),
      });
    }
    spec.x = x;
    spec.series = series;
    return spec;
  }

  function collectYValues(spec) {
    if (spec.type === 'scatter') {
      const values = [];
      for (const s of spec.series) for (const p of s.points) values.push(p[1]);
      return values;
    }
    const values = [];
    for (const s of spec.series) for (const v of s.y) values.push(v);
    return values;
  }

  function collectXValues(spec) {
    if (spec.type === 'scatter') {
      const values = [];
      for (const s of spec.series) for (const p of s.points) values.push(p[0]);
      return values;
    }
    const values = [];
    for (const v of spec.x) if (isFiniteNum(v)) values.push(v);
    return values;
  }

  function plotBox(spec, h, hasLegend) {
    const values = collectYValues(spec);
    let longest = 0;
    for (const v of values) longest = Math.max(longest, formatTick(v).length);
    const padL = clamp(longest * 7 + 14, 36, 64);
    return {
      x: padL,
      y: spec.title ? 30 : 16,
      w: W - padL - 16,
      h: h - (spec.title ? 30 : 16) - (hasLegend ? 48 : 30),
    };
  }

  function makeYScale(values, plot, forceZero) {
    if (!values.length) return { lo: 0, hi: 1, ticks: [0], yAt: () => plot.y + plot.h };
    let min = values[0];
    let max = values[0];
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (forceZero) {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
    const { lo, hi, ticks } = niceTicks(min, max, 4);
    const range = hi - lo || 1;
    return { lo, hi, ticks, yAt: (value) => plot.y + plot.h - ((value - lo) / range) * plot.h };
  }

  function makeXScale(values, plot) {
    if (!values.length) return { lo: 0, hi: 1, ticks: [0], xAt: () => plot.x };
    let min = values[0];
    let max = values[0];
    for (const value of values) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const { lo, hi, ticks } = niceTicks(min, max, 6);
    const range = hi - lo || 1;
    return { lo, hi, ticks, xAt: (value) => plot.x + ((value - lo) / range) * plot.w };
  }

  function makeCategoryXScale(categoryCount, plot) {
    const band = plot.w / categoryCount;
    return { kind: 'category', n: categoryCount, band, xAt: (categoryIndex) => plot.x + (categoryIndex + 0.5) * band };
  }

  function drawAxes(spec, plot, xScale, yScale, svg) {
    for (const tick of yScale.ticks) {
      const y = yScale.yAt(tick);
      svg.appendChild(createSvgElement('line', { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: BORDER, 'stroke-width': 1 }));
      svg.appendChild(createSvgElement('text', { x: plot.x - 6, y: y + 3, fill: TEXT_MUTED, 'font-size': 10, 'text-anchor': 'end', 'font-family': FONT }, formatTick(tick)));
    }
    if (xScale.kind === 'category') {
      for (let categoryIndex = 0; categoryIndex < spec.x.length; categoryIndex += 1) {
        const label = String(spec.x[categoryIndex]);
        const short = label.length > 12 ? label.slice(0, 11) + '…' : label;
        svg.appendChild(createSvgElement('text', { x: xScale.xAt(categoryIndex), y: plot.y + plot.h + 14, fill: TEXT_MUTED, 'font-size': 10, 'text-anchor': 'middle', 'font-family': FONT }, short));
      }
    } else {
      for (const tick of xScale.ticks) {
        svg.appendChild(createSvgElement('text', { x: xScale.xAt(tick), y: plot.y + plot.h + 14, fill: TEXT_MUTED, 'font-size': 10, 'text-anchor': 'middle', 'font-family': FONT }, formatTick(tick)));
      }
    }
    if (spec.xLabel) {
      svg.appendChild(createSvgElement('text', { x: plot.x + plot.w / 2, y: plot.y + plot.h + 28, fill: TEXT_MUTED, 'font-size': 11, 'text-anchor': 'middle', 'font-family': FONT }, spec.xLabel));
    }
    if (spec.yLabel) {
      const cy = plot.y + plot.h / 2;
      svg.appendChild(createSvgElement('text', { x: 12, y: cy, fill: TEXT_MUTED, 'font-size': 11, 'text-anchor': 'middle', 'font-family': FONT, transform: 'rotate(-90 12 ' + cy + ')' }, spec.yLabel));
    }
  }

  function renderBars(spec, plot, xScale, yScale, svg) {
    const categoryCount = spec.x.length;
    const groupW = plot.w / categoryCount;
    const isStacked = spec.type === 'stacked-bar';
    const seriesCount = spec.series.length;
    const barW = Math.max(2, Math.min(40, groupW * (isStacked ? 0.6 : 0.8 / seriesCount)));
    const baselineY = yScale.yAt(0);
    for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
      const groupLeft = plot.x + categoryIndex * groupW;
      if (isStacked) {
        let accumulatedHeight = 0;
        for (let seriesIndex = 0; seriesIndex < spec.series.length; seriesIndex += 1) {
          const currentSeries = spec.series[seriesIndex];
          const seriesValue = currentSeries.y[categoryIndex];
          const yTop = yScale.yAt(accumulatedHeight + seriesValue);
          const yBottom = yScale.yAt(accumulatedHeight);
          svg.appendChild(createSvgElement('rect', {
            x: groupLeft + (groupW - barW) / 2,
            y: Math.min(yTop, yBottom),
            width: barW,
            height: Math.max(0, Math.abs(yBottom - yTop)),
            rx: 2,
            fill: seriesColor(currentSeries, seriesIndex),
          }));
          accumulatedHeight += seriesValue;
        }
      } else {
        const perGroup = groupW * 0.8;
        const barWidth = Math.max(1, perGroup / seriesCount - 1);
        for (let seriesIndex = 0; seriesIndex < spec.series.length; seriesIndex += 1) {
          const currentSeries = spec.series[seriesIndex];
          const seriesValue = currentSeries.y[categoryIndex];
          const yTop = yScale.yAt(seriesValue);
          svg.appendChild(createSvgElement('rect', {
            x: groupLeft + (groupW - perGroup) / 2 + seriesIndex * (perGroup / seriesCount),
            y: Math.min(yTop, baselineY),
            width: barWidth,
            height: Math.max(0, Math.abs(baselineY - yTop)),
            rx: 1,
            fill: seriesColor(currentSeries, seriesIndex),
          }));
        }
      }
    }
  }

  function renderLines(spec, plot, xScale, yScale, svg) {
    const isArea = spec.type === 'area';
    const baselineY = yScale.yAt(0);
    for (let seriesIndex = 0; seriesIndex < spec.series.length; seriesIndex += 1) {
      const currentSeries = spec.series[seriesIndex];
      const color = seriesColor(currentSeries, seriesIndex);
      const points = [];
      for (let pointIndex = 0; pointIndex < currentSeries.y.length; pointIndex += 1) {
        const x = xScale.kind === 'category' ? xScale.xAt(pointIndex) : xScale.xAt(spec.x[pointIndex]);
        points.push([x, yScale.yAt(currentSeries.y[pointIndex])]);
      }
      if (isArea && points.length) {
        const fill = seriesSurface(currentSeries, seriesIndex);
        const fillOpacity = fill === color ? 0.15 : undefined;
        const last = points[points.length - 1];
        const first = points[0];
        let pathData = 'M';
        for (const p of points) pathData += p[0].toFixed(2) + ',' + p[1].toFixed(2) + ' L';
        pathData += last[0].toFixed(2) + ',' + baselineY.toFixed(2) + ' L' + first[0].toFixed(2) + ',' + baselineY.toFixed(2) + ' Z';
        const attrs = { d: pathData, fill };
        if (fillOpacity !== undefined) attrs['fill-opacity'] = String(fillOpacity);
        svg.appendChild(createSvgElement('path', attrs));
      }
      if (points.length >= 2) {
        svg.appendChild(createSvgElement('polyline', {
          points: points.map(([pointX, pointY]) => pointX.toFixed(2) + ',' + pointY.toFixed(2)).join(' '),
          fill: 'none',
          stroke: color,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }));
      }
      for (const [x, y] of points) {
        svg.appendChild(createSvgElement('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 2.5, fill: color }));
      }
    }
  }

  function renderScatter(spec, plot, xScale, yScale, svg) {
    for (let seriesIndex = 0; seriesIndex < spec.series.length; seriesIndex += 1) {
      const currentSeries = spec.series[seriesIndex];
      const color = seriesColor(currentSeries, seriesIndex);
      for (const [x, y] of currentSeries.points) {
        svg.appendChild(createSvgElement('circle', { cx: xScale.xAt(x).toFixed(2), cy: yScale.yAt(y).toFixed(2), r: 2.5, fill: color }));
      }
    }
  }

  function arcPath(cx, cy, r, r0, a0, a1) {
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    if (r0 > 0) {
      const ix0 = cx + Math.cos(a0) * r0;
      const iy0 = cy + Math.sin(a0) * r0;
      const ix1 = cx + Math.cos(a1) * r0;
      const iy1 = cy + Math.sin(a1) * r0;
      return 'M' + x0 + ',' + y0 + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x1 + ',' + y1 + ' L' + ix1 + ',' + iy1 + ' A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + ix0 + ',' + iy0 + ' Z';
    }
    return 'M' + cx + ',' + cy + ' L' + x0 + ',' + y0 + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x1 + ',' + y1 + ' Z';
  }

  function renderPie(spec, svg, chartHeight, hasLegend, isDonut) {
    const total = spec.slices.reduce((sum, slice) => sum + slice.y, 0) || 1;
    const cx = W / 2;
    const cy = hasLegend ? (chartHeight - 40) / 2 + 6 : chartHeight / 2;
    const outerRadius = Math.min(110, (hasLegend ? chartHeight - 50 : chartHeight - 20) / 2);
    const innerRadius = isDonut ? outerRadius * 0.55 : 0;
    const startAngle = -Math.PI / 2;
    let angle = startAngle;
    for (let sliceIndex = 0; sliceIndex < spec.slices.length; sliceIndex += 1) {
      const slice = spec.slices[sliceIndex];
      const sweep = (slice.y / total) * Math.PI * 2;
      const a0 = angle;
      // Force the final slice to end exactly where the first began so floating
      // point accumulation can never leave a visible gap in the circle.
      const a1 = sliceIndex === spec.slices.length - 1 ? startAngle + Math.PI * 2 : angle + sweep;
      svg.appendChild(createSvgElement('path', {
        d: arcPath(cx, cy, outerRadius, innerRadius, a0, a1),
        fill: slice.color ? SEMANTIC_COLORS[slice.color] || slice.color : PALETTE_COLORS[sliceIndex % PALETTE.length],
      }));
      angle = a1;
    }
    if (isDonut) {
      svg.appendChild(createSvgElement('text', { x: cx, y: cy + 4, fill: TEXT_MUTED, 'font-size': 14, 'text-anchor': 'middle', 'font-weight': 600, 'font-family': FONT }, formatTick(total)));
    }
    if (hasLegend) {
      const entries = spec.slices.map((slice, sliceIndex) => ({
        name: slice.name,
        color: slice.color ? SEMANTIC_COLORS[slice.color] || slice.color : PALETTE_COLORS[sliceIndex % PALETTE.length],
        percent: slice.y / total,
      }));
      appendLegend(svg, entries, chartHeight, true);
    }
  }

  function appendLegend(svg, entries, svgHeight, withPercent) {
    const rowHeight = 22;
    const gap = 14;
    let currentX = 16;
    let row = 0;
    for (const entry of entries) {
      const label = withPercent ? entry.name + ' ' + (entry.percent * 100).toFixed(0) + '%' : entry.name;
      const textWidth = label.length * 6.5 + 14;
      if (currentX + textWidth > W - 8) {
        currentX = 16;
        row += 1;
      }
      const legendY = svgHeight - 20 - row * rowHeight;
      svg.appendChild(createSvgElement('rect', { x: currentX, y: legendY + 2, width: 10, height: 10, rx: 2, fill: entry.color, 'data-amc-legend': '1' }));
      svg.appendChild(createSvgElement('text', { x: currentX + 15, y: legendY + 10, fill: TEXT_MUTED, 'font-size': 11, 'font-family': FONT }, label));
      currentX += textWidth + gap;
    }
  }

  function renderCartesian(spec, svg, chartHeight) {
    const hasLegend = spec.legend !== undefined ? spec.legend : spec.series.length > 1;
    const plot = plotBox(spec, chartHeight, hasLegend);
    const isBar = spec.type === 'bar' || spec.type === 'grouped-bar' || spec.type === 'stacked-bar';
    const yScale = makeYScale(collectYValues(spec), plot, isBar);
    const numericX =
      spec.type === 'scatter' || (spec.x.length > 0 && spec.x.every((xValue) => isFiniteNum(xValue)));
    const xScale = numericX ? makeXScale(collectXValues(spec), plot) : makeCategoryXScale(spec.x.length, plot);

    if (spec.type === 'scatter') {
      renderScatter(spec, plot, xScale, yScale, svg);
    } else if (isBar) {
      renderBars(spec, plot, xScale, yScale, svg);
    } else {
      renderLines(spec, plot, xScale, yScale, svg);
    }
    drawAxes(spec, plot, xScale, yScale, svg);
    if (hasLegend) appendLegend(svg, spec.series.map((currentSeries, seriesIndex) => ({ name: currentSeries.name || 'Series ' + (seriesIndex + 1), color: seriesColor(currentSeries, seriesIndex) })), chartHeight, false);
  }

  function buildChart(spec) {
    const { svg, chartHeight } = buildSvgRoot(spec);
    if (spec.type === 'pie' || spec.type === 'donut') {
      const hasLegend = spec.legend !== undefined ? spec.legend : true;
      renderPie(spec, svg, chartHeight, hasLegend, spec.type === 'donut');
    } else {
      renderCartesian(spec, svg, chartHeight);
    }
    return svg;
  }

  const buildSvgRoot = (spec) => {
    const chartHeight = clamp(spec.height || 240, 120, 480);
    const svg = createSvgElement('svg', {
      viewBox: '0 0 ' + W + ' ' + chartHeight,
      width: '100%',
      role: 'img',
      'aria-label': spec.title || 'chart',
      style: 'font-family:' + FONT + ';display:block;height:auto;',
    });
    if (spec.title) svg.appendChild(createSvgElement('title', {}, spec.title));
    return { svg, chartHeight };
  };

  function renderChartElement(node) {
    const attr = node.getAttribute('data-amc-chart') || '';
    const sig = hash(attr);
    if (node.getAttribute(SIG_ATTR) === sig) return;

    let raw;
    try {
      raw = JSON.parse(attr);
    } catch {
      // Incomplete JSON mid-stream: stay silent and retry on the next mutation.
      node.setAttribute(PENDING_ATTR, '1');
      return;
    }

    const spec = normalizeSpec(raw);
    node.setAttribute(SIG_ATTR, sig);
    node.removeAttribute(PENDING_ATTR);
    node.textContent = '';
    if (!spec) {
      node.setAttribute(ERROR_ATTR, '1');
      node.removeAttribute(RENDERED_ATTR);
      if (typeof notifyDiagnostic === 'function') {
        notifyDiagnostic({ type: 'chart-error', message: 'Invalid chart spec', snippet: attr.slice(0, 200) });
      }
      return;
    }
    node.removeAttribute(ERROR_ATTR);
    node.setAttribute(RENDERED_ATTR, '1');
    node.appendChild(buildChart(spec));
  }

  function renderAll() {
    document.querySelectorAll(SELECTOR).forEach(renderChartElement);
  }

  let frame = 0;
  const scheduleScan = () => {
    if (frame) return;
    frame = (window.requestAnimationFrame || ((fn) => fn()))(() => {
      frame = 0;
      renderAll();
    });
  };

  renderAll();
  if (window.MutationObserver) {
    new MutationObserver(scheduleScan).observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-amc-chart'],
    });
  }

  window.__amcChart = { renderAll, renderChartElement };
})();
`;

interface HydrateChartsIntoDocumentOptions {
  /**
   * Pre-built Live Artifacts theme style (see buildPreviewThemeStyle with
   * `varsOnly`). Injected into the target document so chart SVG colors resolve
   * on the parent page, which does not define `--amc-live-artifact-*` on its own.
   */
  themeStyle?: string;
}

/**
 * Renders every `data-amc-chart` node in `doc` as static SVG.
 *
 * Uses Apache ECharts SSR SVG renderer to produce crisp, publication-ready vector
 * graphics for PNG snapshots and offline export previews.
 *
 * Async by design: ECharts is imported lazily below so the ~1.1 MB library stays
 * off the application's startup graph and is only fetched when a document actually
 * contains charts. Both call sites are already async.
 */
export const hydrateChartsIntoDocument = async (
  doc: Document,
  options: HydrateChartsIntoDocumentOptions = {},
): Promise<void> => {
  if (options.themeStyle) {
    const normalized = options.themeStyle.replace(/<\/?style[^>]*>/g, '');
    if (doc.head && !doc.head.querySelector('[data-amc-live-artifact-theme]')) {
      const styleElement = doc.createElement('style');
      styleElement.setAttribute('data-amc-live-artifact-theme', 'true');
      styleElement.textContent = normalized;
      doc.head.appendChild(styleElement);
    }
  }

  const cssVars: Record<string, string> = {};
  if (options.themeStyle) {
    const matches = options.themeStyle.matchAll(/(--amc-live-artifact-[a-z-]+)\s*:\s*([^;]+)/g);
    for (const match of matches) {
      cssVars[match[1]] = match[2].trim();
    }
  }
  const theme = buildEchartsThemeFromCssVars(cssVars);

  const nodes = doc.querySelectorAll('[data-amc-chart], [data-amc-echarts]');
  if (nodes.length === 0) {
    // Nothing to hydrate: skip the lazy ECharts fetch entirely.
    return;
  }

  const echarts = await import('echarts');

  nodes.forEach((node) => {
    const attr = node.getAttribute('data-amc-chart') || node.getAttribute('data-amc-echarts') || '';
    let raw: unknown;
    try {
      raw = JSON.parse(attr);
    } catch {
      node.setAttribute('data-amc-chart-error', '1');
      return;
    }

    const option = normalizeEchartsOption(raw);
    if (!option) {
      node.setAttribute('data-amc-chart-error', '1');
      return;
    }

    const htmlElement = node as HTMLElement;
    const widthMatch = htmlElement.style?.width?.match(/^(\d+(?:\.\d+)?)px$/);
    const heightMatch = htmlElement.style?.height?.match(/^(\d+(?:\.\d+)?)px$/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : 700;
    const height = heightMatch ? parseFloat(heightMatch[1]) : 280;

    try {
      const chart = echarts.init(null, theme, {
        renderer: 'svg',
        ssr: true,
        width,
        height,
      });
      chart.setOption(option);
      const svgString = chart.renderToSVGString();
      chart.dispose();

      node.innerHTML = svgString;
      node.setAttribute('data-amc-chart-rendered', '1');
      node.removeAttribute('data-amc-chart-error');
      node.removeAttribute('data-amc-chart-pending');

      const svg = node.querySelector('svg');
      if (svg) {
        svg.style.width = '100%';
        svg.style.height = `${height}px`;
      }
    } catch {
      node.setAttribute('data-amc-chart-error', '1');
    }
  });
};
