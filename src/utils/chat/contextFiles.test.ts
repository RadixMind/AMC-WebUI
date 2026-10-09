import { describe, expect, it } from 'vitest';
import type { ChatMessage, UploadedFile } from '@/types';
import { collectActiveUserContextFiles } from './contextFiles';

describe('collectActiveUserContextFiles', () => {
  const createFile = (name: string, overrides?: Partial<UploadedFile>): UploadedFile => ({
    id: `id-${name}`,
    name,
    type: 'text/plain',
    size: 100,
    ...overrides,
  });

  const now = new Date();
  const messages: ChatMessage[] = [
    {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      timestamp: now,
      files: [
        createFile('doc.txt', { textContent: 'hello world' }),
        createFile('generated-chart.png'), // should skip
        createFile('error.txt', { error: 'Failed' }), // should skip
        createFile('draft.txt', { uploadState: 'pending' }), // should skip
      ],
    },
    {
      id: 'msg-2',
      role: 'model',
      content: 'hi',
      timestamp: now,
      files: [createFile('model-file.txt')], // should skip (not user)
    },
    {
      id: 'msg-3',
      role: 'user',
      content: 'next prompt',
      timestamp: now,
      files: [createFile('data.csv', { textContent: 'a,b,c' })],
    },
    {
      id: 'msg-4',
      role: 'user',
      content: 'current prompt',
      timestamp: now,
      files: [createFile('latest.txt')],
    },
  ];

  it('collects all valid files when no targetMessageId is specified', () => {
    const files = collectActiveUserContextFiles(messages);
    expect(files.map((f) => f.name)).toEqual(['doc.txt', 'data.csv', 'latest.txt']);
  });

  it('stops collecting at targetMessageId', () => {
    const files = collectActiveUserContextFiles(messages, 'msg-3');
    expect(files.map((f) => f.name)).toEqual(['doc.txt']);
  });

  it('applies custom predicate filter', () => {
    const files = collectActiveUserContextFiles(messages, undefined, (f) => f.name.endsWith('.csv'));
    expect(files.map((f) => f.name)).toEqual(['data.csv']);
  });
});
