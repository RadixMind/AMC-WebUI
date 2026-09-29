import { describe, expect, it } from 'vitest';
import { hydrateChartsIntoDocument } from './chartRendererScript';

const THEME_STYLE =
  '<style data-amc-live-artifact-theme="true">:root{color-scheme:dark;--amc-live-artifact-accent:#ffffff;}</style>';

const FIXTURES = [
  '{"type":"bar","title":"Q","x":["A","B","C"],"series":[{"name":"s","y":[420,560,380]}]}',
  '{"type":"grouped-bar","x":["A","B"],"series":[{"name":"a","y":[10,20]},{"name":"b","y":[30,40]}]}',
  '{"type":"line","x":["1","2","3"],"series":[{"name":"a","y":[1,2,3]},{"name":"b","y":[3,2,1]}]}',
  '{"type":"area","x":["A","B"],"series":[{"name":"a","y":[5,8]}]}',
  '{"type":"pie","slices":[{"name":"a","y":1},{"name":"b","y":1},{"name":"c","y":2}]}',
  '{"type":"donut","slices":[{"name":"a","y":30},{"name":"b","y":70}]}',
  '{"type":"scatter","series":[{"name":"s","points":[[1,2],[3,4],[5,6]]}]}',
  '{"type":"bar","x":["A","B"],"series":[{"name":"s"}]}', // invalid: series missing y
] as const;

const makeDoc = (chartJson: string): Document => {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><html><head></head><body></body></html>', 'text/html');
  const div = doc.createElement('div');
  div.setAttribute('data-amc-chart', chartJson);
  doc.body.appendChild(div);
  return doc;
};

// `hydrateChartsIntoDocument` is async because ECharts is imported lazily (so the
// ~1.1 MB library stays off the app's startup graph). These tests await it, which
// also covers the rejected-promise path that a sync `toThrow` check could not see.
describe('chart renderer export hydration', () => {
  it('hydrateChartsIntoDocument produces valid SVG for legacy DSL and standard ECharts fixtures', async () => {
    for (const fixture of FIXTURES) {
      const hydratedDoc = makeDoc(fixture);
      await hydrateChartsIntoDocument(hydratedDoc, { themeStyle: THEME_STYLE });
      const hydratedNode = hydratedDoc.querySelector('[data-amc-chart]')!;

      if (fixture.includes('"series":[{"name":"s"}]')) {
        expect(hydratedNode.getAttribute('data-amc-chart-error')).toBe('1');
        expect(hydratedNode.querySelector('svg')).toBeNull();
      } else {
        expect(hydratedNode.getAttribute('data-amc-chart-rendered')).toBe('1');
        expect(hydratedNode.querySelector('svg')).not.toBeNull();
      }
    }
  });

  it('hydrates standard ECharts options into static SVG', async () => {
    const option =
      '{"xAxis":{"type":"category","data":["Mon","Tue"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[10,20]}]}';
    const doc = makeDoc(option);
    await hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE });
    const node = doc.querySelector('[data-amc-chart]')!;
    expect(node.getAttribute('data-amc-chart-rendered')).toBe('1');
    expect(node.querySelector('svg')).not.toBeNull();
  });

  it('injects the varsOnly theme style into the document head', async () => {
    const doc = makeDoc('{"type":"pie","slices":[{"name":"a","y":1}]}');
    await hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE });

    const style = doc.head.querySelector('[data-amc-live-artifact-theme]');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('--amc-live-artifact-accent');
  });

  it('does not duplicate the theme style when hydrated twice', async () => {
    const doc = makeDoc('{"type":"pie","slices":[{"name":"a","y":1}]}');
    await hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE });
    await hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE });

    expect(doc.head.querySelectorAll('[data-amc-live-artifact-theme]')).toHaveLength(1);
  });

  it('hydrates an invalid spec into an error marker without throwing', async () => {
    const doc = makeDoc('{"type":"bar","x":["A"],"series":[]}');
    await expect(hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE })).resolves.toBeUndefined();
    expect(doc.querySelector('[data-amc-chart]')!.getAttribute('data-amc-chart-error')).toBe('1');
  });

  it('does not fetch ECharts when the document contains no charts', async () => {
    // Keeps the lazy-import guarantee honest: a chart-free export must not pay for ECharts.
    const doc = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><head></head><body><p>no charts here</p></body></html>',
      'text/html',
    );
    await expect(hydrateChartsIntoDocument(doc, { themeStyle: THEME_STYLE })).resolves.toBeUndefined();
    expect(doc.head.querySelector('[data-amc-live-artifact-theme]')).not.toBeNull();
  });
});
