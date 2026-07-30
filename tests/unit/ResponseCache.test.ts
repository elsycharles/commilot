import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cacheKey, clearCache, readCache, writeCache } from '../../src/core/ResponseCache.js';

const key = () => cacheKey({ provider: 'p', model: 'm', system: 's', user: 'u' });

beforeEach(() => clearCache());
afterEach(() => clearCache());

describe('cacheKey', () => {
  it('is stable for identical prompts and differs otherwise', () => {
    expect(cacheKey({ provider: 'p', model: 'm', system: 's', user: 'u' })).toBe(key());
    expect(cacheKey({ provider: 'p', model: 'm', system: 's', user: 'other' })).not.toBe(key());
    expect(cacheKey({ provider: 'p', model: 'other', system: 's', user: 'u' })).not.toBe(key());
  });

  it('does not contain the prompt, so no source code is written to disk', () => {
    const k = cacheKey({ provider: 'p', model: 'm', system: 'SECRET', user: 'CODE' });
    expect(k).not.toContain('SECRET');
    expect(k).not.toContain('CODE');
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('read and write', () => {
  it('returns what was stored', () => {
    writeCache(key(), '{"type":"feat"}', 60);
    expect(readCache(key(), 60)).toBe('{"type":"feat"}');
  });

  it('misses when nothing was stored', () => {
    expect(readCache(key(), 60)).toBeUndefined();
  });

  it('misses once the entry is older than the ttl', () => {
    writeCache(key(), 'stale', 60);
    // A ttl of 0 minutes makes any entry stale, and also disables writing.
    expect(readCache(key(), 0)).toBeUndefined();
  });

  it('writes nothing when the cache is disabled', () => {
    writeCache(key(), 'ignored', 0);
    expect(readCache(key(), 60)).toBeUndefined();
  });
});
