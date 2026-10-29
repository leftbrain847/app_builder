import { describe, expect, it } from 'vitest';
import { indexPage, parseApps } from '../src/platform';

describe('platform index', () => {
  it('lists only well-formed apps, and escapes titles', () => {
    const apps = parseApps(JSON.stringify([{ id: 'settlers', title: 'Settlers' }, { id: '../x', title: 'bad' }, { id: 'x', title: 5 }, { id: 'evil', title: '<script>alert(1)</script>' }]));
    expect(apps.map((a) => a.id)).toEqual(['settlers', 'evil']);
    const html = indexPage(apps);
    expect(html).toContain('<a href="/settlers/">Settlers</a>');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/style=|<style/);
  });

  it('treats a broken APPS value as no apps', () => {
    expect(parseApps('{not json')).toEqual([]);
    expect(parseApps(undefined)).toEqual([]);
  });
});
