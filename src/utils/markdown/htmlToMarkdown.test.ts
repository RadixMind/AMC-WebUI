import { describe, expect, it } from 'vitest';
import { convertHtmlToMarkdown } from './htmlToMarkdown';

describe('convertHtmlToMarkdown', () => {
  it('keeps ordered-number punctuation readable in converted markdown headings', () => {
    const markdown = convertHtmlToMarkdown('<h3>5. 带有双下划线（常用于 Python 特殊方法）</h3>');

    expect(markdown).toBe('### 5. 带有双下划线（常用于 Python 特殊方法）');
  });

  it('keeps ordered-number punctuation escaped in ordinary paragraphs', () => {
    const markdown = convertHtmlToMarkdown('<p>5. 带有双下划线（常用于 Python 特殊方法）</p>');

    expect(markdown).toBe('5\\. 带有双下划线（常用于 Python 特殊方法）');
  });

  it('converts Discourse lightbox wrappers into a single markdown image', () => {
    const markdown = convertHtmlToMarkdown(`
      <a class="lightbox" href="https://cdn.example.com/original.avif">
        <img src="https://cdn.example.com/optimized.avif" alt="chart">
        <div class="meta">1440x418 67.2 KB</div>
      </a>
    `);

    expect(markdown).toBe('![chart](https://cdn.example.com/optimized.avif)');
    expect(markdown).not.toContain('1440x418');
    expect(markdown).not.toContain('original.avif');
  });

  it('uses srcset when an image has no src', () => {
    const markdown = convertHtmlToMarkdown(
      '<img alt="shot" srcset="https://cdn.example.com/a.png 1x, https://cdn.example.com/a2.png 2x">',
    );

    expect(markdown).toBe('![shot](https://cdn.example.com/a.png)');
  });

  it('repairs spaced image markdown left over from HTML conversion', () => {
    const markdown = convertHtmlToMarkdown(
      '<p>[![] (https://cdn.example.com/optimized.avif)](https://cdn.example.com/original.avif)</p>',
    );

    expect(markdown).toContain('![](https://cdn.example.com/optimized.avif)');
    expect(markdown).not.toContain('![] (');
  });

  it('converts data-amc-graphviz containers into fenced graphviz markdown', () => {
    const html = '<div data-amc-graphviz="digraph { A -> B; }"><svg><g></g></svg></div>';
    const markdown = convertHtmlToMarkdown(html);

    expect(markdown).toContain('```graphviz\ndigraph { A -> B; }\n```');
    expect(markdown).not.toContain('<svg');
  });

  it('converts pre[data-amc-graphviz] with child textContent into fenced graphviz markdown', () => {
    const html = '<pre data-amc-graphviz>digraph { X -> Y; }</pre>';
    const markdown = convertHtmlToMarkdown(html);

    expect(markdown).toContain('```graphviz\ndigraph { X -> Y; }\n```');
  });

  it('converts data-amc-chart containers into fenced echarts markdown', () => {
    const html = '<div data-amc-chart=\'{"series":[{"data":[1]}]}\'></div>';
    const markdown = convertHtmlToMarkdown(html);

    expect(markdown).toContain('```echarts\n{"series":[{"data":[1]}]}\n```');
  });

  it('strips copy buttons and inline SVGs cleanly', () => {
    const html =
      '<div><code>shortcuts run "Test"</code><button data-amc-copy="shortcuts run &quot;Test&quot;">复制命令</button><svg><circle /></svg></div>';
    const markdown = convertHtmlToMarkdown(html);

    expect(markdown).toContain('`shortcuts run "Test"`');
    expect(markdown).not.toContain('复制命令');
    expect(markdown).not.toContain('<svg');
  });
});
