import type { ListGroup } from './rulesets';

/** Entry in tools/filterlists.json */
export interface FilterListSource {
  id: string;
  title: string;
  urls: string[];
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
