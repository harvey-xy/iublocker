/** Fake scriptlet registry so T2's tests do not depend on T3's library. */
import type { ScriptletMeta } from '@iublocker/shared';

export interface FakeDefinition extends ScriptletMeta {
  fn: (...args: string[]) => void;
}

interface LoggingWindow {
  __log: unknown[][];
}

declare const window: LoggingWindow;

export const fakeRegistry: Record<string, FakeDefinition> = {
  'set-constant': {
    name: 'set-constant',
    aliases: ['set'],
    args: [{ name: 'property' }, { name: 'value' }, { name: 'stack', optional: true }],
    trusted: false,
    fn: function (property: string, value: string) {
      window.__log.push(['set-constant', property, value]);
    },
  },
  'abort-on-property-read': {
    name: 'abort-on-property-read',
    aliases: ['aopr', 'abort-on-property-read.js'],
    args: [{ name: 'property' }],
    trusted: false,
    fn: function (property: string) {
      window.__log.push(['abort-on-property-read', property]);
    },
  },
  noop: {
    name: 'noop',
    aliases: [],
    args: [],
    trusted: false,
    fn: function () {
      window.__log.push(['noop']);
    },
  },
  'remove-attr': {
    name: 'remove-attr',
    aliases: ['ra'],
    args: [{ name: 'attrs' }, { name: 'selector', optional: true }, { name: 'stay', optional: true }],
    trusted: false,
    fn: function (attrs: string) {
      window.__log.push(['remove-attr', attrs]);
    },
  },
  'trusted-set-cookie': {
    name: 'trusted-set-cookie',
    aliases: [],
    args: [{ name: 'name' }, { name: 'value' }],
    trusted: true,
    fn: function (name: string, value: string) {
      window.__log.push(['trusted-set-cookie', name, value]);
    },
  },
  'log-args': {
    name: 'log-args',
    aliases: [],
    args: [{ name: 'a' }, { name: 'b', optional: true }],
    trusted: false,
    fn: function (a: string, b: string) {
      window.__log.push(['log-args', a, b]);
    },
  },
};

export const fakeResolve = (nameOrAlias: string): FakeDefinition | undefined => {
  const name = nameOrAlias.endsWith('.js') ? nameOrAlias.slice(0, -3) : nameOrAlias;
  const direct = fakeRegistry[name];
  if (direct !== undefined) return direct;
  for (const def of Object.values(fakeRegistry)) {
    if (def.aliases.some((a) => (a.endsWith('.js') ? a.slice(0, -3) : a) === name)) return def;
  }
  return undefined;
};
