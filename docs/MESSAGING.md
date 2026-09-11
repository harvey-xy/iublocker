# Messaging Protocol

All runtime messages go through `chrome.runtime.sendMessage` / `onMessage` with a single
typed router in the service worker. Types live in `packages/shared/src/messages.ts`
and are the contract between the background, content scripts, and UI. **Do not add
ad‑hoc message shapes; extend the union.**

```ts
type Request = { type: 'cosmetic:get'; hostname: string; topHostname: string; frameId: number }
             | { type: 'scriptlets:getDynamic'; hostname: string }
             | { type: 'tab:getState'; tabId?: number }          // popup
             | { type: 'site:setMode'; hostname: string; mode: SiteMode | null }
             | { type: 'settings:get' } | { type: 'settings:set'; patch: Partial<Settings> }
             | { type: 'lists:get' } | { type: 'lists:setEnabled'; listId: string; enabled: boolean }
             | { type: 'lists:update' }                            // trigger delta update now
             | { type: 'filters:getUser' } | { type: 'filters:setUser'; text: string }
             | { type: 'filters:addUser'; lines: string[] }        // picker / popup
             | { type: 'picker:start'; tabId: number }
             | { type: 'stats:get'; tabId?: number } | { type: 'stats:reset' }
             | { type: 'logger:get'; tabId: number }
             | { type: 'blocked:getForTab' }                      // content script: URLs blocked in this frame (for collapse)
             | { type: 'debug:dumpState' };
```

Every request has exactly one response type (`Response<T>`), all defined next to the
request. Errors are returned as `{ ok: false, error: string }`; never thrown across the
boundary. The router is `handle(msg, sender): Promise<ResponseFor<msg>>`.

Conventions:
- Content scripts must include `sender.frameId`‑dependent data only via the router's
  `sender` argument, never trust a client‑supplied `tabId`.
- UI pages may pass `tabId` (obtained from `chrome.tabs.query`).
- Long‑running work (list update) responds immediately with `{ ok: true, started: true }`
  and progress is broadcast via `chrome.runtime.sendMessage({ type: 'event:listsUpdated', … })`
  to all extension pages (events are a separate union `Event`).
- The worker may be asleep; senders must tolerate `runtime.lastError` "receiving end does
  not exist" by retrying once after 100 ms.

`SiteMode` = `'off' | 'basic' | 'optimal' | 'complete'`.

`TabState` (popup) = `{ tabId, url, hostname, mode, effectiveMode, blockedCount,
listsEnabled: number, hasScriptlets: boolean, hasCosmetic: boolean, isInternal: boolean }`.
