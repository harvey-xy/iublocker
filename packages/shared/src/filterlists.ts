import type { ListGroup } from './rulesets';

/** Entry in tools/filterlists.json */
export interface FilterListSource {
  id: string;
  title: string;
  urls: string[];
  /**
   * Fallback source sets, tried in order when `urls` cannot be fetched (e.g. the primary
   * host is unreachable or a file moved). Every entry is a complete alternative to `urls`:
   * a list assembled from several part files has mirrors made of several part files too,
   * and a mirror only counts as usable when every URL in it is fetched successfully.
   */
  mirrors?: string[][];
  group: ListGroup;
  lang?: string[];
  defaultEnabled: boolean;
  trusted?: boolean;
  homepage?: string;
  license?: string;
  /** 'abp' (default) or 'hosts' */
  format?: 'abp' | 'hosts';
  expires?: string;
}

export interface FilterListsConfig {
  lists: FilterListSource[];
}
