import { ECHARTS_RENDERER_SCRIPT } from './echartsRendererScript';
import { GRAPHVIZ_RENDERER_SCRIPT } from './graphvizRendererScript';
import {
  HTML_PREVIEW_COPY_EVENT,
  HTML_PREVIEW_DIAGNOSTIC_EVENT,
  HTML_PREVIEW_MEDIA_SEEK_EVENT,
  HTML_PREVIEW_MESSAGE_CHANNEL,
} from './previewMessageProtocol';

export const PREVIEW_BRIDGE_SCRIPT = `<script>
(() => {
  const channel = ${JSON.stringify(HTML_PREVIEW_MESSAGE_CHANNEL)};
  const notify = (event, payload) => {
    try {
      parent.postMessage(payload === undefined ? { channel, event } : { channel, event, payload }, '*');
    } catch {
      // Ignored if parent window is unmounted or cross-origin restrictions apply
    }
  };
  const notifyDiagnostic = (payload) => notify(${JSON.stringify(HTML_PREVIEW_DIAGNOSTIC_EVENT)}, payload);
  const readResourceUrl = (element) => {
    if (!(element instanceof Element)) return undefined;
    return element.getAttribute('src') || element.getAttribute('href') || element.getAttribute('poster') || undefined;
  };
  const isSupportedResourceError = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;

    const tagName = target.tagName.toLowerCase();
    if (!['img', 'script', 'link', 'video', 'audio', 'source'].includes(tagName)) {
      return false;
    }

    notifyDiagnostic({
      type: 'resource-error',
      tagName,
      url: readResourceUrl(target),
    });
    return true;
  };
  window.addEventListener('error', (event) => {
    if (isSupportedResourceError(event)) return;

    notifyDiagnostic({
      type: 'runtime-error',
      message: event.message || 'Unknown preview runtime error',
      source: event.filename || undefined,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    });
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    notifyDiagnostic({
      type: 'runtime-error',
      message: reason && typeof reason.message === 'string' ? reason.message : String(reason || 'Unhandled promise rejection'),
    });
  });
  window.addEventListener('securitypolicyviolation', (event) => {
    const directive = event.effectiveDirective || event.violatedDirective || 'CSP';
    notifyDiagnostic({
      type: 'csp-violation',
      message: directive + ': ' + (event.blockedURI || 'blocked resource'),
      blockedURI: event.blockedURI,
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
    });
  });
  // Measure intrinsic content height — never use body/html offsetHeight.
  // Those equal the iframe viewport once the parent sets a fixed height, which
  // creates a ratchet (height only grows) and large blank regions under short content.
  // Also briefly neutralize height/min-height on the document shell so model CSS
  // like min-height:100vh cannot lock the reported height to the current iframe size.
  let isMeasuringHeight = false;
  const measureContentHeight = () => {
    const body = document.body;
    const root = document.documentElement;
    if (!body || !root) return 0;

    const restored = [];
    const neutralizeSize = (targetElement) => {
      if (!(targetElement instanceof HTMLElement)) return;
      restored.push([targetElement, targetElement.style.height, targetElement.style.minHeight, targetElement.style.maxHeight]);
      targetElement.style.height = 'auto';
      targetElement.style.minHeight = '0';
      targetElement.style.maxHeight = 'none';
    };

    isMeasuringHeight = true;
    try {
      neutralizeSize(root);
      neutralizeSize(body);

      const children = body.children;
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const childElement = children[childIndex];
        if (!(childElement instanceof HTMLElement)) continue;
        if (childElement.tagName === 'SCRIPT' || childElement.tagName === 'STYLE' || childElement.tagName === 'LINK') continue;
        neutralizeSize(childElement);
      }

      let contentBottom = 0;
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const childElement = children[childIndex];
        if (!(childElement instanceof HTMLElement)) continue;
        if (childElement.tagName === 'SCRIPT' || childElement.tagName === 'STYLE' || childElement.tagName === 'LINK') continue;

        const style = window.getComputedStyle(childElement);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const rect = childElement.getBoundingClientRect();
        const marginBottom = parseFloat(style.marginBottom) || 0;
        let bottom;
        if (style.position === 'fixed') {
          // Fixed fullscreen shell (inset:0 + overflow:hidden) clips content.
          // Use scrollHeight so the parent stretches the iframe past the clip zone.
          bottom = rect.top + (window.scrollY || 0) + Math.max(childElement.scrollHeight, rect.height) + marginBottom;
        } else {
          bottom = rect.bottom + (window.scrollY || 0) + marginBottom;
        }
        if (bottom > contentBottom) contentBottom = bottom;
      }

      const bodyStyle = window.getComputedStyle(body);
      const paddingBottom = parseFloat(bodyStyle.paddingBottom) || 0;
      const borderBottom = parseFloat(bodyStyle.borderBottomWidth) || 0;

      if (contentBottom > 0) {
        return Math.ceil(contentBottom + paddingBottom + borderBottom);
      }

      // Empty/sparse documents: fall back to scrollHeight only (not offsetHeight).
      return Math.max(body.scrollHeight || 0, root.scrollHeight || 0);
    } finally {
      for (let restoredIndex = restored.length - 1; restoredIndex >= 0; restoredIndex -= 1) {
        const [restoredElement, height, minHeight, maxHeight] = restored[restoredIndex];
        restoredElement.style.height = height;
        restoredElement.style.minHeight = minHeight;
        restoredElement.style.maxHeight = maxHeight;
      }
      isMeasuringHeight = false;
    }
  };

  const notifyResize = () => {
    try {
      const height = measureContentHeight();
      parent.postMessage({ channel, event: 'resize', height }, '*');
    } catch {
      // Ignored if parent window is unmounted or detached
    }
  };

  let resizeFrame = 0;
  const scheduleResize = () => {
    if (isMeasuringHeight || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (isMeasuringHeight) return;
      notifyResize();
    });
  };

  const notifyReady = () => {
    notify('ready');
    scheduleResize();
  };

  if (document.readyState === 'complete') {
    Promise.resolve().then(notifyReady);
  } else {
    window.addEventListener('load', notifyReady, { once: true });
  }

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(scheduleResize);
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }

  if ('MutationObserver' in window) {
    const observer = new MutationObserver((mutations) => {
      // Skip style-only attribute mutations: measuring temporarily writes inline
      // styles and restoring them would re-trigger → infinite loop.
      if (mutations.some((mutation) => !(mutation.type === 'attributes' && mutation.attributeName === 'style'))) {
        scheduleResize();
      }
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });
  }

  window.addEventListener('resize', scheduleResize);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      notify('escape');
    }
  });

  const isEditableElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
  };

  const getElementForNode = (node) => {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  };

  const notifySelection = () => {
    try {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        notify('selection', null);
        return;
      }

      const range = selection.getRangeAt(0);
      const targetElement = getElementForNode(range.commonAncestorContainer);
      if (isEditableElement(targetElement)) {
        notify('selection', null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        notify('selection', null);
        return;
      }

      const rect = range.getBoundingClientRect();
      notify('selection', {
        text,
        copyText: text,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        },
      });
    } catch {
      notify('selection', null);
    }
  };

  let selectionFrame = 0;
  const scheduleSelection = () => {
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      notifySelection();
    });
  };

  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('mouseup', scheduleSelection);
  document.addEventListener('keyup', scheduleSelection);

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.channel !== channel || event.data.event !== 'clear-selection') {
      return;
    }

    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      // Ignored if window selection is unavailable or detached
    }
  });

  const parseFollowupPayload = (rawPayload) => {
    const trimmedPayload = rawPayload.trim();
    if (!trimmedPayload) return null;

    try {
      const parsedPayload = JSON.parse(trimmedPayload);
      if (typeof parsedPayload === 'string') {
        const instruction = parsedPayload.trim();
        return instruction ? { instruction } : null;
      }
      return parsedPayload;
    } catch (parseError) {
      if (/^[{[]/.test(trimmedPayload)) {
        console.warn('Invalid Live Artifact follow-up payload.', parseError);
        return null;
      }

      return { instruction: trimmedPayload };
    }
  };

  const readFollowupPayload = (target) => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest('[data-amc-followup]');
    if (!trigger) return null;

    const rawPayload = trigger.getAttribute('data-amc-followup');
    if (!rawPayload) return null;

    const payload = parseFollowupPayload(rawPayload);
    return payload ? mergeFollowupState(payload, collectFollowupState(trigger)) : null;
  };

  const resolveFollowupScope = (trigger) => {
    const scopeSelector = trigger.getAttribute('data-amc-followup-scope');
    if (scopeSelector && scopeSelector.trim()) {
      try {
        return document.querySelector(scopeSelector) || trigger.closest(scopeSelector) || document;
      } catch {
        return document;
      }
    }

    return trigger.closest('[data-amc-followup-scope]') || document;
  };

  const readStateValue = (element) => {
    if (element instanceof HTMLInputElement) {
      const inputType = element.type.toLowerCase();
      if (inputType === 'checkbox') return element.checked;
      if (inputType === 'radio') return element.checked ? element.value || true : undefined;
      if (inputType === 'number' || inputType === 'range') {
        return element.value === '' || Number.isNaN(element.valueAsNumber) ? element.value : element.valueAsNumber;
      }
      return element.value;
    }

    if (element instanceof HTMLSelectElement) {
      if (element.multiple) {
        return Array.from(element.selectedOptions).map((option) => option.value);
      }
      return element.value;
    }

    if (element instanceof HTMLTextAreaElement) return element.value;

    const stateValue = element.getAttribute('data-amc-state-value');
    if (stateValue !== null) {
      const isToggleLike =
        element.hasAttribute('aria-pressed') ||
        element.hasAttribute('aria-selected') ||
        element.hasAttribute('aria-checked');
      if (!isToggleLike) return stateValue;

      const isActive =
        element.getAttribute('aria-pressed') === 'true' ||
        element.getAttribute('aria-selected') === 'true' ||
        element.getAttribute('aria-checked') === 'true';
      return isActive ? stateValue : undefined;
    }

    const textValue = element.textContent ? element.textContent.trim() : '';
    return textValue || undefined;
  };

  const appendStateValue = (state, key, value) => {
    if (value === undefined) return;

    if (Object.prototype.hasOwnProperty.call(state, key)) {
      state[key] = Array.isArray(state[key]) ? [...state[key], value] : [state[key], value];
      return;
    }

    state[key] = value;
  };

  const collectFollowupState = (trigger) => {
    const scope = resolveFollowupScope(trigger);
    const state = {};
    const stateElements = [];

    if (scope instanceof Element && scope.matches('[data-amc-state-key]')) {
      stateElements.push(scope);
    }

    stateElements.push(...Array.from(scope.querySelectorAll('[data-amc-state-key]')));

    stateElements.forEach((element) => {
      const key = element.getAttribute('data-amc-state-key');
      if (!key || element.disabled) return;

      appendStateValue(state, key, readStateValue(element));
    });

    return state;
  };

  const mergeFollowupState = (payload, collectedState) => {
    if (!collectedState || Object.keys(collectedState).length === 0) return payload;

    const existingState =
      payload && typeof payload.state === 'object' && !Array.isArray(payload.state)
        ? payload.state
        : payload && payload.state !== undefined
          ? { value: payload.state }
          : {};

    return {
      ...payload,
      state: {
        ...existingState,
        ...collectedState,
      },
    };
  };

  const readCopyText = (target) => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest('[data-amc-copy]');
    if (!trigger) return null;
    const value = trigger.getAttribute('data-amc-copy');
    if (value !== null && value.trim()) return value.trim();

    // Contextual lookup: when data-amc-copy has no explicit value (e.g. <button data-amc-copy>Copy</button>),
    // automatically find and extract the code from the enclosing container or sibling code block.
    const container = trigger.closest('div, section, figure') || trigger.parentElement;
    const codeEl = container ? (container.querySelector('pre > code') || container.querySelector('code')) : null;
    if (codeEl && codeEl.textContent && codeEl.textContent.trim()) {
      return codeEl.textContent.trim();
    }

    const label = trigger.textContent ? trigger.textContent.trim() : '';
    return label || null;
  };

  const parseBox2d = (value) => {
    if (!value) return undefined;
    const parts = String(value).split(',').map((part) => parseFloat(part.trim())).filter((parsedNumber) => !Number.isNaN(parsedNumber));
    return parts.length === 4 ? parts : undefined;
  };

  const parsePoint = (value) => {
    if (!value) return undefined;
    const parts = String(value).split(',').map((part) => parseFloat(part.trim())).filter((parsedNumber) => !Number.isNaN(parsedNumber));
    return parts.length === 2 ? parts : undefined;
  };

  const parseTimestampSeconds = (timeStr) => {
    if (!timeStr) return undefined;
    const trimmed = String(timeStr).trim();
    if (!trimmed) return undefined;
    const directNum = parseFloat(trimmed);
    if (!Number.isNaN(directNum) && !trimmed.includes(':')) {
      return directNum;
    }
    const parts = trimmed.split(':').map((part) => parseFloat(part.trim()));
    if (parts.some((part) => Number.isNaN(part))) return undefined;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return undefined;
  };

  const readMediaSeekPayload = (target) => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest(
      '[data-amc-seek-page],[data-seek-page],[data-amc-seek-time],[data-seek-time],[data-amc-seek-image],[data-seek-image],[data-amc-seek-kind],[data-seek-kind],a[href^="#amc-seek:"],a[href^="#seek:"],image-locate,pdf-locate,video-locate,audio-locate'
    );
    if (!trigger) return null;

    let kind = trigger.getAttribute('data-amc-seek-kind') || trigger.getAttribute('data-seek-kind') || undefined;
    let pageRaw = trigger.getAttribute('data-amc-seek-page') || trigger.getAttribute('data-seek-page');
    let timeRaw = trigger.getAttribute('data-amc-seek-time') || trigger.getAttribute('data-seek-time');
    let imageRaw = trigger.getAttribute('data-amc-seek-image') || trigger.getAttribute('data-seek-image');
    let doc = trigger.getAttribute('data-amc-seek-doc') || trigger.getAttribute('data-seek-doc') || undefined;
    let boxRaw = trigger.getAttribute('data-amc-seek-box') || trigger.getAttribute('data-seek-box');
    let pointRaw = trigger.getAttribute('data-amc-seek-point') || trigger.getAttribute('data-seek-point');
    let arrow = trigger.getAttribute('data-amc-seek-arrow') || trigger.getAttribute('data-seek-arrow') || undefined;
    let label = trigger.getAttribute('data-amc-seek-label') || trigger.getAttribute('data-seek-label') || undefined;
    let snippet = trigger.getAttribute('data-amc-seek-snippet') || trigger.getAttribute('data-seek-snippet') || trigger.textContent?.trim() || undefined;

    const tagName = trigger.tagName.toLowerCase();
    if (tagName === 'image-locate') {
      kind = 'image';
      doc = trigger.getAttribute('file') || trigger.getAttribute('image') || trigger.getAttribute('doc') || doc;
      boxRaw = trigger.getAttribute('box') || trigger.getAttribute('box_2d') || boxRaw;
      pointRaw = trigger.getAttribute('point') || pointRaw;
      arrow = trigger.getAttribute('arrow') || arrow;
      label = trigger.getAttribute('label') || label;
      snippet = trigger.getAttribute('snippet') || trigger.textContent?.trim() || snippet;
    } else if (tagName === 'pdf-locate') {
      kind = 'pdf';
      pageRaw = trigger.getAttribute('page') || pageRaw;
      doc = trigger.getAttribute('doc') || trigger.getAttribute('file') || doc;
      boxRaw = trigger.getAttribute('box') || trigger.getAttribute('box_2d') || boxRaw;
      pointRaw = trigger.getAttribute('point') || pointRaw;
      snippet = trigger.getAttribute('snippet') || trigger.textContent?.trim() || snippet;
    } else if (tagName === 'video-locate') {
      kind = 'video';
      timeRaw = trigger.getAttribute('start') || trigger.getAttribute('time') || timeRaw;
      doc = trigger.getAttribute('video') || trigger.getAttribute('doc') || trigger.getAttribute('file') || doc;
      boxRaw = trigger.getAttribute('box') || trigger.getAttribute('box_2d') || boxRaw;
      pointRaw = trigger.getAttribute('point') || pointRaw;
      snippet = trigger.getAttribute('snippet') || trigger.textContent?.trim() || snippet;
    } else if (tagName === 'audio-locate') {
      kind = 'audio';
      timeRaw = trigger.getAttribute('start') || trigger.getAttribute('time') || timeRaw;
      doc = trigger.getAttribute('audio') || trigger.getAttribute('doc') || trigger.getAttribute('file') || doc;
      snippet = trigger.getAttribute('snippet') || trigger.textContent?.trim() || snippet;
    }

    const href = trigger.getAttribute('href');
    if (href && (href.startsWith('#amc-seek:') || href.startsWith('#seek:'))) {
      const match = href.replace(/^#(amc-)?seek:/, '').split(':');
      if (match.length >= 2) {
        const prefix = match[0].toLowerCase();
        const value = match[1];
        if (prefix === 'pdf' || prefix === 'page') {
          kind = kind || 'pdf';
          pageRaw = pageRaw || value;
        } else if (prefix === 'video' || prefix === 'time') {
          kind = kind || 'video';
          timeRaw = timeRaw || value;
        } else if (prefix === 'audio') {
          kind = kind || 'audio';
          timeRaw = timeRaw || value;
        } else if (prefix === 'image') {
          kind = kind || 'image';
          imageRaw = imageRaw || value;
        }
      }
    }

    const page = pageRaw ? parseInt(pageRaw, 10) : undefined;
    const seconds = timeRaw ? parseTimestampSeconds(timeRaw) : undefined;
    const box2d = parseBox2d(boxRaw);
    const point = parsePoint(pointRaw);

    if (page !== undefined && !Number.isNaN(page)) {
      return { kind: kind || 'pdf', page, doc, box2d, point, snippet };
    }
    if (seconds !== undefined && !Number.isNaN(seconds)) {
      return { kind: kind || 'video', seconds, doc, box2d, point, snippet };
    }
    if (imageRaw !== undefined || kind === 'image' || box2d !== undefined || point !== undefined || arrow !== undefined) {
      return { kind: 'image', doc: doc || imageRaw, box2d, point, arrow, label, snippet };
    }

    return null;
  };

  document.addEventListener('click', (event) => {
    // Only honor real user gestures. A preview's own script can dispatch a
    // synthetic click (element.click()) — without this check it could trigger a
    // followup/copy on the parent page without the user touching anything.
    if (!event.isTrusted) {
      return;
    }

    const copyText = readCopyText(event.target);
    if (copyText) {
      event.preventDefault();
      notify(${JSON.stringify(HTML_PREVIEW_COPY_EVENT)}, { text: copyText });
      return;
    }

    const seekPayload = readMediaSeekPayload(event.target);
    if (seekPayload) {
      event.preventDefault();
      notify(${JSON.stringify(HTML_PREVIEW_MEDIA_SEEK_EVENT)}, seekPayload);
      return;
    }

    const payload = readFollowupPayload(event.target);
    if (!payload) return;

    event.preventDefault();
    notify('followup', payload);
  });
${ECHARTS_RENDERER_SCRIPT}
${GRAPHVIZ_RENDERER_SCRIPT}
})();
</script>`;
