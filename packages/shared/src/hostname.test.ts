import { describe, expect, it } from 'vitest';
import { hostnameWalk, hostnameMatchesDomain, isValidHostname } from './hostname';

describe('hostname helpers', () => {
  it('walks suffixes', () => {
    expect(hostnameWalk('a.b.example.com')).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
      'com',
    ]);
  });
  it('matches domains', () => {
    expect(hostnameMatchesDomain('a.example.com', 'example.com')).toBe(true);
    expect(hostnameMatchesDomain('notexample.com', 'example.com')).toBe(false);
    expect(hostnameMatchesDomain('example.com', 'example.com')).toBe(true);
  });
  it('validates hostnames', () => {
    expect(isValidHostname('example.com')).toBe(true);
    expect(isValidHostname('bad host')).toBe(false);
  });
});
