/**
 * Prototype-safe access to records whose keys come from filter lists.
 *
 * Every map the compiler builds from list data is keyed by list-controlled text —
 * hostnames, id/class tokens, selectors, scriptlet names, `! Key:` metadata names — and a
 * plain `record[key]` lookup does *not* return `undefined` for `constructor`, `toString`
 * or `__proto__`: it returns the `Object.prototype` member. Downstream code then iterates
 * a function (a `TypeError` in the service worker) or writes a junk field. Assigning
 * `record['__proto__'] = …` is worse still: it replaces the object's prototype instead of
 * adding an entry, so the data silently disappears.
 *
 * `getEntry` / `setEntry` are the only way these records should be read and written.
 */

const hasOwn = Object.prototype.hasOwnProperty;

/** `record[key]`, but `undefined` for anything that is not an own property. */
export function getEntry<T>(record: Record<string, T>, key: string): T | undefined {
  return hasOwn.call(record, key) ? record[key] : undefined;
}

/** `record[key] = value` as a real own property, `__proto__` included. */
export function setEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
}
