import { describe, expect, it } from 'vitest';
import def from '../src/trusted-json-edit';
import { inject, makeWindow } from './_inject';

const parse = (win: any, text: string): any => win.eval(`JSON.parse(${JSON.stringify(text)})`);

describe('trusted-json-edit', () => {
  it('writes a boolean value', () => {
    const win = makeWindow();
    inject(win, def, '..showAds=false');
    const out = parse(win, '{"deep":{"showAds":true}}');
    expect(out.deep.showAds).toBe(false);
  });

  it('writes through a filter', () => {
    const win = makeWindow();
    inject(win, def, '.features.*[?.slug=="adblock-detection"].enabled=false');
    const out = parse(
      win,
      '{"features":[{"slug":"adblock-detection","enabled":true},{"slug":"x","enabled":true}]}',
    );
    expect(out.features[0].enabled).toBe(false);
    expect(out.features[1].enabled).toBe(true);
  });

  it('writes a JSON object literal', () => {
    const win = makeWindow();
    inject(win, def, '.ads={"movie":false}');
    const out = parse(win, '{"ads":{"movie":true}}');
    expect(out.ads).toEqual({ movie: false });
  });

  it('merges with `+=`', () => {
    const win = makeWindow();
    inject(win, def, '.client+={"clientScreen":"CHANNEL"}');
    const out = parse(win, '{"client":{"clientName":"WEB"}}');
    expect(out.client).toEqual({ clientName: 'WEB', clientScreen: 'CHANNEL' });
  });

  it('still removes when no action is given', () => {
    const win = makeWindow();
    inject(win, def, '.EnableAdmiral');
    const out = parse(win, '{"EnableAdmiral":true,"keep":1}');
    expect(out.EnableAdmiral).toBeUndefined();
    expect(out.keep).toBe(1);
  });

  it('leaves non-matching documents untouched', () => {
    const win = makeWindow();
    inject(win, def, '.check=false');
    const out = parse(win, '{"other":1}');
    expect(out).toEqual({ other: 1 });
  });
});
