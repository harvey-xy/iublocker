/**
 * Test harness: inject a scriptlet the way the extension does — by serialising the
 * function and evaluating it inside a fresh page realm (docs/TESTING.md, "scriptlets").
 */
import { JSDOM } from 'jsdom';
import type { ScriptletDefinition } from '../src/_define';
import { serializeScriptletFn } from '../src/_define';

export interface PageWindow {
  [key: string]: any;
}

export function makeWindow(
  html = '<!doctype html><html><head></head><body></body></html>',
  url = 'https://example.com/page',
): PageWindow {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  return dom.window as unknown as PageWindow;
}

/** Evaluate `def.fn` in the page realm and call it with `args`, exactly as the injector does. */
export function inject(win: PageWindow, def: ScriptletDefinition, ...args: (string | undefined)[]): void {
  const source = serializeScriptletFn(def.fn, def.name);
  const fn = win.eval(`(${source})`);
  fn.apply(win, args);
}

/** Let jsdom's timers, microtasks and MutationObserver callbacks run. */
export function tick(win: PageWindow, ms = 5): Promise<void> {
  return new Promise((resolve) => {
    win.setTimeout(resolve, ms);
  });
}

/** jsdom ships no fetch/Response; install minimal stand-ins inside the page realm. */
export function installFetchStub(win: PageWindow, body = '{}', status = 200): void {
  win.eval(`
    (function () {
      function Response(body, init) {
        init = init || {};
        this._body = body === undefined || body === null ? '' : String(body);
        this.status = init.status === undefined ? 200 : init.status;
        this.statusText = init.statusText === undefined ? '' : init.statusText;
        this.headers = init.headers || {};
        this.ok = this.status >= 200 && this.status < 300;
        this.url = '';
      }
      Response.prototype.text = function () { return Promise.resolve(this._body); };
      Response.prototype.json = function () { return Promise.resolve(JSON.parse(this._body)); };
      Response.prototype.clone = function () {
        var r = new Response(this._body, { status: this.status, statusText: this.statusText, headers: this.headers });
        r.url = this.url;
        return r;
      };
      window.Response = Response;
      window.__fetchCalls = [];
      window.fetch = function (input, init) {
        window.__fetchCalls.push([input, init]);
        var r = new Response(window.__fetchBody, { status: window.__fetchStatus, statusText: 'OK' });
        r.url = typeof input === 'string' ? input : (input && input.url) || '';
        return Promise.resolve(r);
      };
    })();
  `);
  win.__fetchBody = body;
  win.__fetchStatus = status;
}

/** A fake XMLHttpRequest that answers from `win.__xhrBody` without touching the network. */
export function installXhrStub(win: PageWindow, body = '{}'): void {
  win.eval(`
    (function () {
      function FakeXHR() {
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseText = '';
        this.response = '';
        this.responseURL = '';
        this.responseType = '';
        this._listeners = {};
      }
      FakeXHR.prototype.open = function (method, url) {
        this._method = method;
        this._url = url;
        this.readyState = 1;
      };
      FakeXHR.prototype.send = function () {
        var self = this;
        window.setTimeout(function () {
          self.readyState = 4;
          self.status = 200;
          self.statusText = 'OK';
          self.responseText = window.__xhrBody;
          self.response = window.__xhrBody;
          window.__xhrSent = (window.__xhrSent || 0) + 1;
          self.dispatchEvent(new window.Event('readystatechange'));
          self.dispatchEvent(new window.Event('load'));
        }, 1);
      };
      FakeXHR.prototype.addEventListener = function (type, cb) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
      };
      FakeXHR.prototype.removeEventListener = function () {};
      FakeXHR.prototype.dispatchEvent = function (ev) {
        var list = this._listeners[ev.type] || [];
        for (var i = 0; i < list.length; i++) list[i].call(this, ev);
        var handler = this['on' + ev.type];
        if (typeof handler === 'function') handler.call(this, ev);
        return true;
      };
      window.XMLHttpRequest = FakeXHR;
      window.__xhrSent = 0;
    })();
  `);
  win.__xhrBody = body;
}
