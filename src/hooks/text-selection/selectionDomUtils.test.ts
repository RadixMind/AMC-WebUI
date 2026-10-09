import { describe, expect, it } from 'vitest';
import {
  resolveContainerElement,
  isEditableElement,
  getPlainSelectionText,
  getElementForNode,
  getContainingCodeBlock,
  isCodeSelection,
  createSelectionRect,
} from './selectionDomUtils';

describe('selectionDomUtils', () => {
  describe('resolveContainerElement', () => {
    it('handles null, RefObject, and direct HTMLElement', () => {
      expect(resolveContainerElement(null)).toBeNull();

      const element = document.createElement('div');
      expect(resolveContainerElement(element)).toBe(element);

      const refObject = { current: element };
      expect(resolveContainerElement(refObject)).toBe(element);
    });
  });

  describe('isEditableElement', () => {
    it('correctly identifies inputs, textareas, and contenteditable elements', () => {
      expect(isEditableElement(null)).toBe(false);

      const div = document.createElement('div');
      expect(isEditableElement(div)).toBe(false);

      const input = document.createElement('input');
      expect(isEditableElement(input)).toBe(true);

      const textarea = document.createElement('textarea');
      expect(isEditableElement(textarea)).toBe(true);

      const select = document.createElement('select');
      expect(isEditableElement(select)).toBe(true);

      const editableDiv = document.createElement('div');
      editableDiv.contentEditable = 'true';
      expect(isEditableElement(editableDiv)).toBe(true);
    });
  });

  describe('getPlainSelectionText', () => {
    it('extracts and trims text content', () => {
      const container = document.createElement('div');
      container.textContent = '   Hello World   \n';
      expect(getPlainSelectionText(container)).toBe('Hello World');
    });
  });

  describe('code block detection', () => {
    it('detects elements inside pre or code', () => {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const span = document.createElement('span');
      code.appendChild(span);
      pre.appendChild(code);

      expect(getElementForNode(span)).toBe(span);
      expect(getContainingCodeBlock(span)).toBe(code);

      const range = document.createRange();
      range.selectNode(span);
      expect(isCodeSelection(range)).toBe(true);

      const outsideDiv = document.createElement('div');
      expect(getContainingCodeBlock(outsideDiv)).toBeNull();
    });
  });

  describe('createSelectionRect', () => {
    it('creates a rect or returns null for empty bounds', () => {
      expect(createSelectionRect(null, window)).toBeNull();

      const bounds = {
        top: 10,
        left: 20,
        width: 100,
        height: 50,
        bottom: 60,
      };

      const rect = createSelectionRect(bounds, window);
      expect(rect).not.toBeNull();
      expect(rect?.top).toBe(10);
      expect(rect?.left).toBe(20);
      expect(rect?.width).toBe(100);
      expect(rect?.height).toBe(50);
      expect(rect?.bottom).toBe(60);
      expect(rect?.right).toBe(120);
    });
  });
});
