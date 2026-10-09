import type { RefObject } from 'react';

export type ContainerRefLike = RefObject<HTMLElement> | HTMLElement | null;
export type SelectionBounds = Pick<DOMRect, 'top' | 'left' | 'width' | 'height' | 'bottom'>;

export const resolveContainerElement = (containerRef: ContainerRefLike): HTMLElement | null => {
  if (!containerRef) return null;
  if ('current' in containerRef) return containerRef.current;
  return containerRef;
};

/**
 * Safely determines if a DOM element is an interactive input control or contenteditable container.
 * Fully cross-document safe (supporting iframe elements), null-safe, and includes
 * INPUT, TEXTAREA, SELECT, and contenteditable elements.
 */
export const isEditableElement = (element: Element | null): boolean => {
  if (!element) return false;

  const HTMLElementCtor = element.ownerDocument?.defaultView?.HTMLElement ?? HTMLElement;
  if (!(element instanceof HTMLElementCtor)) return false;
  const htmlElement = element as HTMLElement;

  return Boolean(
    htmlElement.tagName === 'INPUT' ||
    htmlElement.tagName === 'TEXTAREA' ||
    htmlElement.tagName === 'SELECT' ||
    htmlElement.isContentEditable ||
    htmlElement.contentEditable === 'true' ||
    htmlElement.getAttribute('contenteditable') === 'true',
  );
};

const SELECTION_EXCLUDED_SELECTOR = '.select-none, [data-selection-copy="exclude"]';

export const cloneSelectionContent = (range: Range, targetDocument: Document): HTMLDivElement => {
  const container = targetDocument.createElement('div');
  container.appendChild(range.cloneContents());

  container.querySelectorAll(SELECTION_EXCLUDED_SELECTOR).forEach((element) => {
    element.remove();
  });

  return container;
};

export const getPlainSelectionText = (container: HTMLElement): string =>
  (container.innerText || container.textContent || '').trim();

export const getElementForNode = (node: Node): Element | null => {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }

  return node.parentElement;
};

export const getContainingCodeBlock = (node: Node): Element | null => {
  const element = getElementForNode(node);
  return element?.closest('pre, code') ?? null;
};

export const isCodeSelection = (range: Range): boolean => {
  const startCodeBlock = getContainingCodeBlock(range.startContainer);
  const endCodeBlock = getContainingCodeBlock(range.endContainer);

  return Boolean(
    startCodeBlock &&
    endCodeBlock &&
    (startCodeBlock === endCodeBlock || startCodeBlock.contains(endCodeBlock) || endCodeBlock.contains(startCodeBlock)),
  );
};

export const getValidSelectionRange = (targetWindow: Window, containerRef: ContainerRefLike): Range | null => {
  const selection = targetWindow.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;

  // Context checks
  const containerElement = resolveContainerElement(containerRef);
  if (containerElement && !containerElement.contains(commonAncestor)) {
    return null;
  }

  const targetElement = commonAncestor.nodeType === 1 ? (commonAncestor as HTMLElement) : commonAncestor.parentElement;
  if (isEditableElement(targetElement)) {
    return null;
  }

  return range;
};

export const createSelectionRect = (bounds: SelectionBounds | null, targetWindow: Window): DOMRect | null => {
  if (!bounds) return null;
  try {
    const DomRectCtor = (targetWindow as Window & typeof globalThis).DOMRect;
    if (typeof DomRectCtor === 'function') {
      return new DomRectCtor(bounds.left, bounds.top, bounds.width, bounds.height);
    }
  } catch {
    // fall through to plain object
  }
  return {
    top: bounds.top,
    left: bounds.left,
    width: bounds.width,
    height: bounds.height,
    bottom: bounds.bottom,
    right: bounds.left + bounds.width,
    x: bounds.left,
    y: bounds.top,
    toJSON() {
      return bounds;
    },
  } as DOMRect;
};
