import { HTML_PREVIEW_MESSAGE_CHANNEL, HTML_PREVIEW_STREAM_RENDER_EVENT } from './previewMessageProtocol';
import { STREAM_SANITIZER_SCRIPT } from './previewSanitizer';

export const STREAMING_PREVIEW_RUNNER_SCRIPT = `<script>
(() => {
  const channel = ${JSON.stringify(HTML_PREVIEW_MESSAGE_CHANNEL)};
  const streamRenderEvent = ${JSON.stringify(HTML_PREVIEW_STREAM_RENDER_EVENT)};
  const root = document.querySelector('[data-amc-stream-preview-root]');
${STREAM_SANITIZER_SCRIPT}
  const PROTECTED_ATTRIBUTES = new Set(['_echarts_instance_']);
  const isProtectedAttribute = (name) =>
    PROTECTED_ATTRIBUTES.has(name) ||
    name.startsWith('data-amc-chart-') ||
    name.startsWith('data-amc-graphviz-') ||
    name === 'data-amc-followup-bound';

  const syncAttributes = (currentElement, nextElement) => {
    Array.from(currentElement.attributes).forEach((attribute) => {
      if (isProtectedAttribute(attribute.name)) return;
      if (!nextElement.hasAttribute(attribute.name)) {
        currentElement.removeAttribute(attribute.name);
      }
    });

    Array.from(nextElement.attributes).forEach((attribute) => {
      if (currentElement.getAttribute(attribute.name) !== attribute.value) {
        currentElement.setAttribute(attribute.name, attribute.value);
      }
    });
  };

  const isChartNode = (node) =>
    node && node.nodeType === Node.ELEMENT_NODE && (node.hasAttribute('data-amc-chart') || node.hasAttribute('data-amc-echarts'));
  const chartAttr = (node) => (node.getAttribute('data-amc-chart') || node.getAttribute('data-amc-echarts') || '');
  const chartAttrEqual = (firstNode, secondNode) => chartAttr(firstNode) === chartAttr(secondNode);

  // Rendered graphviz is patched in asynchronously through the parent bridge,
  // so its sig/state attributes and SVG subtree must survive attribute-unchanged
  // patches. Unlike the chart branch, we do NOT syncAttributes here: the patch
  // would overwrite the runtime-added data-amc-graphviz-sig/-state attributes
  // back to nothing and force a pointless re-request.
  const isGraphvizNode = (node) => node && node.nodeType === Node.ELEMENT_NODE && node.hasAttribute('data-amc-graphviz');
  const getGraphvizDot = (node) => (node.getAttribute('data-amc-graphviz') || node.textContent || '').trim();
  const graphvizAttrEqual = (firstNode, secondNode) =>
    getGraphvizDot(firstNode) === getGraphvizDot(secondNode);

  const canPatchNode = (currentNode, nextNode) => {
    if (currentNode.nodeType !== nextNode.nodeType) return false;
    if (currentNode.nodeType === Node.ELEMENT_NODE) {
      if (currentNode.nodeName !== nextNode.nodeName) return false;
      if (isChartNode(currentNode) !== isChartNode(nextNode)) return false;
      if (isGraphvizNode(currentNode) !== isGraphvizNode(nextNode)) return false;
      return true;
    }
    return true;
  };

  const disposeSpecialNode = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    const chartNodes = isChartNode(node) ? [node] : [];
    if (node.querySelectorAll) {
      node.querySelectorAll('[data-amc-chart], [data-amc-echarts]').forEach((child) => {
        chartNodes.push(child);
      });
    }
    chartNodes.forEach((chartEl) => {
      try {
        if (window.echarts && window.echarts.getInstanceByDom(chartEl)) {
          window.echarts.getInstanceByDom(chartEl).dispose();
        }
      } catch {
        // Safe to ignore disposal errors if instance is already cleaned up
      }
      chartEl.replaceChildren();
    });
  };

  const patchNode = (currentNode, nextNode) => {
    if (!canPatchNode(currentNode, nextNode)) {
      disposeSpecialNode(currentNode);
      currentNode.replaceWith(nextNode);
      return;
    }

    // Rendered charts are patched in by the chart renderer, not by the stream:
    // their SVG subtree must survive attribute-unchanged patches. When the
    // chart payload is unchanged, do NOT sync attributes (which would wipe
    // runtime attributes like _echarts_instance_ and data-amc-chart-sig).
    // When the chart payload changes, clear old children and dispose instance
    // so the renderer's attribute observer re-renders cleanly from the new spec.
    if (
      isChartNode(currentNode) &&
      isChartNode(nextNode)
    ) {
      if (chartAttrEqual(currentNode, nextNode)) {
        return;
      }
      disposeSpecialNode(currentNode);
      currentNode.replaceChildren();
      syncAttributes(currentNode, nextNode);
      return;
    }

    // Graphviz nodes keep the same dot: leave the node completely untouched so
    // the in-flight render response (or the already-injected SVG) is preserved.
    if (
      isGraphvizNode(currentNode) &&
      isGraphvizNode(nextNode) &&
      graphvizAttrEqual(currentNode, nextNode)
    ) {
      return;
    }

    if (currentNode.nodeType === Node.TEXT_NODE) {
      if (currentNode.nodeValue !== nextNode.nodeValue) {
        currentNode.nodeValue = nextNode.nodeValue;
      }
      return;
    }

    if (currentNode.nodeType !== Node.ELEMENT_NODE) {
      currentNode.replaceWith(nextNode);
      return;
    }

    syncAttributes(currentNode, nextNode);
    patchChildren(currentNode, nextNode);
  };

  const patchChildren = (currentParent, nextParent) => {
    const currentChildren = Array.from(currentParent.childNodes);
    const nextChildren = Array.from(nextParent.childNodes);
    const maxLength = Math.max(currentChildren.length, nextChildren.length);

    for (let index = 0; index < maxLength; index += 1) {
      const currentChild = currentChildren[index];
      const nextChild = nextChildren[index];

      if (!nextChild) {
        disposeSpecialNode(currentChild);
        currentChild.remove();
        continue;
      }

      if (!currentChild) {
        currentParent.appendChild(nextChild);
        continue;
      }

      patchNode(currentChild, nextChild);
    }
  };

  const buildRenderableFragment = (parsedDocument) => {
    const fragment = document.createDocumentFragment();
    parsedDocument.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      fragment.appendChild(document.importNode(node, true));
    });
    Array.from(parsedDocument.body.childNodes).forEach((node) => {
      fragment.appendChild(document.importNode(node, true));
    });
    return fragment;
  };

  const syncDocumentAttributes = (parsedDocument) => {
    if (document.documentElement && parsedDocument.documentElement) {
      syncAttributes(document.documentElement, parsedDocument.documentElement);
    }

    if (document.body && parsedDocument.body) {
      syncAttributes(document.body, parsedDocument.body);
    }
  };

  const renderHtml = (html) => {
    if (!root || typeof html !== 'string') return;

    try {
      const sanitizedHtml = html.replace(/<[a-zA-Z][^>]*$/, '');
      const parser = new DOMParser();
      const parsedDocument = parser.parseFromString(sanitizedHtml, 'text/html');
      sanitizeElementTree(parsedDocument);
      syncDocumentAttributes(parsedDocument);
      const fragment = buildRenderableFragment(parsedDocument);
      if (!root.hasChildNodes()) {
        root.replaceChildren(fragment);
        return;
      }
      patchChildren(root, fragment);
    } catch {}
  };

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.channel !== channel || event.data.event !== streamRenderEvent) {
      return;
    }

    renderHtml(event.data.html);
  });

  try {
    parent.postMessage({ channel, event: 'ready' }, '*');
  } catch {}
})();
</script>`;
