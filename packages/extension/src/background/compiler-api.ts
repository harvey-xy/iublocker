/**
 * Single import point for the parts of `@iublocker/compiler` the service worker uses
 * (the browser build: no Node built-ins). Keeping them behind one module documents the
 * worker's dependency on the compiler and gives the unit tests one thing to `vi.mock`.
 */
export {
  compileUserFilters,
  lookupCosmetic,
  lookupScriptlets,
  mergeCosmeticDB,
  mergeScriptletDB,
} from '@iublocker/compiler';
