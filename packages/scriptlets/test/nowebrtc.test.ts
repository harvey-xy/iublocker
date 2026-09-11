import { describe, expect, it } from 'vitest';
import def from '../src/nowebrtc';
import { inject, makeWindow } from './_inject';

describe('nowebrtc', () => {
  it('replaces RTCPeerConnection with an inert stub', () => {
    const win = makeWindow();
    win.eval('window.RTCPeerConnection = function Native() { throw new Error("real"); };');
    inject(win, def);
    const pc = win.eval('new window.RTCPeerConnection({})');
    expect(pc).toBeTruthy();
    expect(win.eval('typeof new window.RTCPeerConnection().createDataChannel')).toBe('function');
    expect(win.eval('new window.RTCPeerConnection().getSenders().length')).toBe(0);
    expect(win.eval('String(new window.RTCPeerConnection())')).toBe('[object RTCPeerConnection]');
  });

  it('resolves the promise-returning methods', async () => {
    const win = makeWindow();
    win.eval('window.RTCPeerConnection = function () {};');
    inject(win, def);
    await expect(win.eval('new window.RTCPeerConnection().createOffer()')).resolves.toBeUndefined();
  });

  it('does nothing when the page has no WebRTC', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.RTCPeerConnection).toBeUndefined();
  });

  it('is idempotent', () => {
    const win = makeWindow();
    win.eval('window.RTCPeerConnection = function () {};');
    inject(win, def);
    const first = win.RTCPeerConnection;
    inject(win, def);
    expect(win.RTCPeerConnection).toBe(first);
  });
});
