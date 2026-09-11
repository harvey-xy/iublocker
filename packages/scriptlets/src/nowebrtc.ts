import { defineScriptlet } from './_define';

export default defineScriptlet({
  name: 'nowebrtc',
  args: [],
  fn: function () {
    try {
      const gt: any = globalThis;
      const flag = '__iub_nowebrtc';
      if (gt[flag] === true) return;
      gt[flag] = true;
      const names = [
        'RTCPeerConnection',
        'webkitRTCPeerConnection',
        'mozRTCPeerConnection',
        'RTCDataChannel',
      ];
      const noop = function (): void {
        /* the page's WebRTC calls become inert */
      };
      const resolved = function (): any {
        return Promise.resolve();
      };
      const makeStub = (original: any): any => {
        const Stub = function (this: any): void {
          try {
            this.localDescription = null;
            this.remoteDescription = null;
            this.iceConnectionState = 'new';
            this.iceGatheringState = 'new';
            this.connectionState = 'new';
            this.signalingState = 'stable';
          } catch {
            /* frozen instance */
          }
        };
        const proto: any = {
          close: noop,
          addIceCandidate: resolved,
          addStream: noop,
          addTrack: function (): any {
            return {};
          },
          createAnswer: resolved,
          createDataChannel: function (): any {
            return { close: noop, send: noop, addEventListener: noop, removeEventListener: noop };
          },
          createDTMFSender: function (): any {
            return {};
          },
          createOffer: resolved,
          getConfiguration: function (): any {
            return {};
          },
          getReceivers: function (): any[] {
            return [];
          },
          getSenders: function (): any[] {
            return [];
          },
          getStats: function (): any {
            return Promise.resolve(new Map());
          },
          getTransceivers: function (): any[] {
            return [];
          },
          removeTrack: noop,
          setConfiguration: noop,
          setLocalDescription: resolved,
          setRemoteDescription: resolved,
          addEventListener: noop,
          removeEventListener: noop,
          dispatchEvent: function (): boolean {
            return false;
          },
          toString: function (): string {
            return '[object RTCPeerConnection]';
          },
        };
        for (const k of Object.keys(proto)) {
          try {
            (Stub.prototype as any)[k] = proto[k];
          } catch {
            /* sealed prototype */
          }
        }
        try {
          if (original !== undefined && original !== null) {
            (Stub as any).generateCertificate = function (): any {
              return Promise.resolve({});
            };
          }
        } catch {
          /* nothing to mirror */
        }
        return Stub;
      };
      for (const name of names) {
        try {
          const original = gt[name];
          if (typeof original !== 'function') continue;
          const stub = makeStub(original);
          Object.defineProperty(gt, name, { value: stub, configurable: true, writable: true });
        } catch {
          /* non-configurable */
        }
      }
      try {
        const md: any = gt.navigator === undefined ? undefined : gt.navigator.mediaDevices;
        if (md !== undefined && md !== null && typeof md.getUserMedia === 'function') {
          md.getUserMedia = function (): any {
            return Promise.reject(new Error('NotAllowedError'));
          };
        }
      } catch {
        /* read-only navigator */
      }
    } catch {
      /* never throw into the page */
    }
  },
});
