import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defineScriptlet, redirectResources, registry, registryJSON, resolveScriptlet } from '../src/index';

describe('registry', () => {
  it('keys every definition by its canonical name', () => {
    for (const [name, def] of Object.entries(registry)) {
      expect(def.name).toBe(name);
      expect(Array.isArray(def.aliases)).toBe(true);
      expect(typeof def.fn).toBe('function');
      expect(typeof def.trusted).toBe('boolean');
    }
    expect(Object.keys(registry).length).toBeGreaterThan(50);
  });

  it('has no name/alias collisions', () => {
    const owners = new Map<string, string>();
    for (const def of Object.values(registry)) {
      for (const name of [def.name, ...def.aliases]) {
        expect(owners.get(name) ?? def.name).toBe(def.name);
        owners.set(name, def.name);
      }
    }
  });

  it('has a behaviour test for every scriptlet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const missing = Object.keys(registry).filter(
      (name) => existsSync(join(here, `${name}.test.ts`)) === false,
    );
    expect(missing).toEqual([]);
  });

  it('marks every trusted-* scriptlet as trusted, and nothing else', () => {
    for (const def of Object.values(registry)) {
      expect(def.trusted).toBe(def.name.startsWith('trusted-'));
    }
  });
});

describe('resolveScriptlet', () => {
  it('resolves canonical names', () => {
    expect(resolveScriptlet('set-constant')?.name).toBe('set-constant');
  });

  it('resolves aliases', () => {
    expect(resolveScriptlet('set')?.name).toBe('set-constant');
    expect(resolveScriptlet('aopr')?.name).toBe('abort-on-property-read');
    expect(resolveScriptlet('aopw')?.name).toBe('abort-on-property-write');
    expect(resolveScriptlet('acs')?.name).toBe('abort-current-script');
    expect(resolveScriptlet('abort-current-inline-script')?.name).toBe('abort-current-script');
    expect(resolveScriptlet('aost')?.name).toBe('abort-on-stack-trace');
    expect(resolveScriptlet('nostif')?.name).toBe('no-setTimeout-if');
    expect(resolveScriptlet('setTimeout-defuser')?.name).toBe('no-setTimeout-if');
    expect(resolveScriptlet('nosiif')?.name).toBe('no-setInterval-if');
    expect(resolveScriptlet('aeld')?.name).toBe('prevent-addEventListener');
    expect(resolveScriptlet('nowoif')?.name).toBe('prevent-window-open');
    expect(resolveScriptlet('no-window-open-if')?.name).toBe('prevent-window-open');
    expect(resolveScriptlet('norafif')?.name).toBe('prevent-requestAnimationFrame');
    expect(resolveScriptlet('ra')?.name).toBe('remove-attr');
    expect(resolveScriptlet('rc')?.name).toBe('remove-class');
    expect(resolveScriptlet('rmnt')?.name).toBe('remove-node-text');
    expect(resolveScriptlet('rpnt')?.name).toBe('replace-node-text');
    expect(resolveScriptlet('nano-stb')?.name).toBe('nano-setTimeout-booster');
    expect(resolveScriptlet('nano-sib')?.name).toBe('nano-setInterval-booster');
    expect(resolveScriptlet('cookie-remover')?.name).toBe('remove-cookie');
    expect(resolveScriptlet('prevent-fetch')?.name).toBe('no-fetch-if');
    expect(resolveScriptlet('prevent-xhr')?.name).toBe('no-xhr-if');
    expect(resolveScriptlet('noeval')?.name).toBe('noeval-if');
    expect(resolveScriptlet('trusted-set')?.name).toBe('trusted-set-constant');
    expect(resolveScriptlet('trusted-rpnt')?.name).toBe('trusted-replace-node-text');
    expect(resolveScriptlet('refresh-defuser')?.name).toBe('prevent-refresh');
    expect(resolveScriptlet('acis')?.name).toBe('abort-current-script');
    expect(resolveScriptlet('fingerprintjs2')?.name).toBe('fingerprint2.js');
    expect(resolveScriptlet('fingerprintjs3')?.name).toBe('fingerprint3.js');
    expect(resolveScriptlet('google-ima3')?.name).toBe('google-ima.js');
    expect(resolveScriptlet('popads.net')?.name).toBe('popads.js');
  });

  it('resolves the library gaps closed against the uBO lists', () => {
    for (const name of [
      'href-sanitizer',
      'nowebrtc',
      'trusted-replace-argument',
      'trusted-click-element',
      'trusted-prevent-dom-bypass',
      'trusted-suppress-native-method',
      'trusted-replace-outbound-text',
      'trusted-override-element-method',
      'trusted-create-html',
      'trusted-set-attr',
      'trusted-set-session-storage-item',
      'trusted-set-cookie-reload',
      'json-edit',
      'trusted-json-edit',
      'json-edit-fetch-response',
      'json-edit-fetch-request',
      'json-edit-xhr-response',
      'jsonl-edit-xhr-response',
      'trusted-json-edit-fetch-response',
      'trusted-json-edit-xhr-response',
      'trusted-json-edit-xhr-request',
      'trusted-edit-inbound-object',
      'trusted-prevent-fetch',
      'trusted-prevent-xhr',
      'xml-prune',
      'm3u-prune',
      'prevent-innerHTML',
      'prevent-refresh',
      'prevent-canvas',
      'prevent-clipboard-write',
      'spoof-css',
      'alert-buster',
      'window-close-if',
    ]) {
      expect(resolveScriptlet(name)?.name).toBe(name);
    }
  });

  it("accepts uBO's current argument counts", () => {
    const count = (name: string): number => resolveScriptlet(name)?.args.length ?? 0;
    // Each of these dropped filters from the uBO lists before the schemas were widened.
    expect(count('replace-node-text')).toBeGreaterThanOrEqual(7);
    expect(count('remove-node-text')).toBeGreaterThanOrEqual(4);
    expect(count('remove-cookie')).toBeGreaterThanOrEqual(3);
    expect(count('prevent-addEventListener')).toBeGreaterThanOrEqual(4);
    expect(count('json-prune-fetch-response')).toBeGreaterThanOrEqual(4);
    expect(count('json-prune-xhr-response')).toBeGreaterThanOrEqual(4);
    expect(count('no-fetch-if')).toBeGreaterThanOrEqual(3);
    expect(count('no-xhr-if')).toBeGreaterThanOrEqual(3);
    expect(count('set-constant')).toBeGreaterThanOrEqual(5);
    expect(count('set-cookie')).toBeGreaterThanOrEqual(5);
    expect(count('trusted-set-cookie')).toBeGreaterThanOrEqual(6);
    // `set-constant` and `abort-on-stack-trace` are callable with one argument now.
    expect(resolveScriptlet('set-constant')?.args.filter((a) => a.optional !== true).length).toBe(1);
    expect(resolveScriptlet('abort-on-stack-trace')?.args.filter((a) => a.optional !== true).length).toBe(1);
  });

  it('accepts an optional .js suffix', () => {
    expect(resolveScriptlet('set-constant.js')?.name).toBe('set-constant');
    expect(resolveScriptlet('aopr.js')?.name).toBe('abort-on-property-read');
    expect(resolveScriptlet('googletagservices_gpt.js')?.name).toBe('googletagservices_gpt.js');
    expect(resolveScriptlet('googletagservices_gpt')?.name).toBe('googletagservices_gpt.js');
  });

  it('returns undefined for unknown names', () => {
    expect(resolveScriptlet('no-such-scriptlet')).toBeUndefined();
  });
});

describe('registryJSON', () => {
  it('is JSON-serialisable and carries no function bodies', () => {
    const json = registryJSON();
    expect(json.version).toBe(1);
    const round = JSON.parse(JSON.stringify(json));
    expect(round).toEqual(json);
    for (const meta of round.scriptlets) {
      expect(meta.fn).toBeUndefined();
      expect(typeof meta.name).toBe('string');
      expect(Array.isArray(meta.args)).toBe(true);
      for (const arg of meta.args) expect(typeof arg.name).toBe('string');
    }
    expect(round.scriptlets.length).toBe(Object.keys(registry).length);
  });

  it('exposes the redirect resource table', () => {
    const json = registryJSON();
    expect(json.redirectResources).toBe(redirectResources);
    expect(redirectResources['noopjs']).toBe('resources/noop.js');
    expect(redirectResources['noop.js']).toBe('resources/noop.js');
    expect(redirectResources['nooptext']).toBe('resources/noop.txt');
    expect(redirectResources['noopcss']).toBe('resources/noop.css');
    expect(redirectResources['noopframe']).toBe('resources/noop.html');
    expect(redirectResources['noopmp3-0.1s']).toBe('resources/noop-0.1s.mp3');
    expect(redirectResources['noopmp4-1s']).toBe('resources/noop-1s.mp4');
    expect(redirectResources['1x1-transparent.gif']).toBe('resources/1x1.gif');
    expect(redirectResources['2x2-transparent.png']).toBe('resources/2x2.png');
    expect(redirectResources['3x2.png']).toBe('resources/3x2.png');
    expect(redirectResources['32x32.png']).toBe('resources/32x32.png');
    expect(redirectResources['empty']).toBe('resources/empty');
    expect(redirectResources['click2load.html']).toBe('resources/click2load.html');
    expect(redirectResources['googletagservices_gpt.js']).toBe('resources/googletagservices_gpt.js');
    expect(redirectResources['googletagservices.com/tag/js/gpt.js']).toBe(
      'resources/googletagservices_gpt.js',
    );
    expect(redirectResources['google-analytics.com/analytics.js']).toBe(
      'resources/google-analytics_analytics.js',
    );
  });

  it('exposes the newly added redirect resources under every uBO spelling', () => {
    const json = registryJSON();
    const r = json.redirectResources;
    expect(r['noopjson']).toBe('resources/noop.json');
    expect(r['noop.json']).toBe('resources/noop.json');
    expect(r['noopvmap-1.0']).toBe('resources/noop-vmap1.0.xml');
    expect(r['noop-vmap1.0.xml']).toBe('resources/noop-vmap1.0.xml');
    expect(r['noopvast-2.0']).toBe('resources/noop-vast2.xml');
    expect(r['noopvast-3.0']).toBe('resources/noop-vast3.xml');
    expect(r['noop-vast3.xml']).toBe('resources/noop-vast3.xml');
    expect(r['google-ima.js']).toBe('resources/google-ima.js');
    expect(r['google-ima3']).toBe('resources/google-ima.js');
    expect(r['google-ima']).toBe('resources/google-ima.js');
    expect(r['fingerprint2.js']).toBe('resources/fingerprint2.js');
    expect(r['fingerprintjs2']).toBe('resources/fingerprint2.js');
    expect(r['fingerprint3.js']).toBe('resources/fingerprint3.js');
    expect(r['fingerprintjs3']).toBe('resources/fingerprint3.js');
    expect(r['amazon_apstag.js']).toBe('resources/amazon_apstag.js');
    expect(r['nobab2.js']).toBe('resources/nobab2.js');
    expect(r['ati-smarttag.js']).toBe('resources/ati-smarttag.js');
    expect(r['ati-smarttag']).toBe('resources/ati-smarttag.js');
    // Hyphenated spellings used by some lists for the existing surrogates.
    expect(r['googletagservices-gpt']).toBe('resources/googletagservices_gpt.js');
    expect(r['googlesyndication-adsbygoogle']).toBe('resources/googlesyndication_adsbygoogle.js');
  });

  it('points every surrogate scriptlet at a resource file', () => {
    for (const def of Object.values(registry)) {
      if (def.redirectResource === undefined) continue;
      expect(redirectResources[def.name]).toBe(`resources/${def.redirectResource}`);
    }
  });
});

describe('defineScriptlet', () => {
  it('derives the trusted flag and the .js-less alias', () => {
    const def = defineScriptlet({
      name: 'trusted-example.js',
      args: [{ name: 'a' }],
      fn: function () {
        /* noop */
      },
    });
    expect(def.trusted).toBe(true);
    expect(def.aliases).toContain('trusted-example');
  });
});
