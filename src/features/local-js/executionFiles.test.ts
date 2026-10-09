import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { collectLocalJsInputFiles } from './executionFiles';

describe('collectLocalJsInputFiles', () => {
  it('collects text content from user messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'analyze this',
        timestamp: new Date(),
        files: [
          {
            id: 'file-1',
            name: 'data.csv',
            type: 'text/csv',
            size: 100,
            textContent: 'a,b,c\n1,2,3',
          },
        ],
      },
      {
        id: 'msg-2',
        role: 'model',
        content: 'analyzing...',
        timestamp: new Date(),
      },
    ];

    const files = collectLocalJsInputFiles(messages);
    expect(files).toEqual({
      'data.csv': 'a,b,c\n1,2,3',
    });
  });

  it('skips model messages, error files, and generated files', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        timestamp: new Date(),
        files: [
          {
            id: 'file-1',
            name: 'generated-plot.png',
            type: 'image/png',
            size: 100,
            textContent: 'binary',
          },
          {
            id: 'file-2',
            name: 'error.txt',
            type: 'text/plain',
            size: 10,
            error: 'Failed to upload',
            textContent: 'err',
          },
        ],
      },
      {
        id: 'msg-2',
        role: 'model',
        content: 'response',
        timestamp: new Date(),
        files: [
          {
            id: 'file-3',
            name: 'output.json',
            type: 'application/json',
            size: 10,
            textContent: '{"a": 1}',
          },
        ],
      },
    ];

    const files = collectLocalJsInputFiles(messages);
    expect(files).toEqual({});
  });

  it('preserves user text files with empty textContent', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'check empty file',
        timestamp: new Date(),
        files: [
          {
            id: 'file-empty',
            name: 'empty.txt',
            type: 'text/plain',
            size: 0,
            textContent: '',
          },
        ],
      },
    ];

    const files = collectLocalJsInputFiles(messages);
    expect(files).toEqual({
      'empty.txt': '',
    });
  });
});
