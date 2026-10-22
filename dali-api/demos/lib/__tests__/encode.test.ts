import { describe, expect, it } from 'vitest';
import { demoBaseName, demoName } from '../encode';

describe('demoBaseName', () => {
  it('keeps the whole file name, however long', () => {
    expect(demoBaseName('/repo/dali-api/demos/application-late-note.demo.ts')).toBe('application-late-note');
    expect(demoBaseName('/repo/dali-api/demos/release-notes.demo.ts')).toBe('release-notes');
  });
});

describe('demoName', () => {
  it('suffixes a second test from the same file', () => {
    const seen = new Map<string, number>();
    expect(demoName('release-notes', seen)).toBe('release-notes');
    expect(demoName('application-late-note', seen)).toBe('application-late-note');
    expect(demoName('release-notes', seen)).toBe('release-notes-2');
  });
});
