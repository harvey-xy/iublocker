/**
 * Mutation batching (docs/ARCHITECTURE.md §9): coalesce work into an idle callback
 * with a 250 ms timeout, falling back to `setTimeout(250)`, and never run more often
 * than `minInterval`.
 */

export interface SchedulerOptions {
  /** Minimum delay between two runs, ms. */
  minInterval?: number;
  /** Idle-callback timeout / fallback delay, ms. */
  timeout?: number;
  now?: () => number;
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export class Scheduler {
  private readonly win: IdleWindow;
  private readonly task: () => void;
  private readonly minInterval: number;
  private readonly timeout: number;
  private readonly now: () => number;
  private timer: number | null = null;
  private idle: number | null = null;
  private lastRun = 0;
  private stopped = false;

  constructor(win: Window, task: () => void, options: SchedulerOptions = {}) {
    this.win = win as IdleWindow;
    this.task = task;
    this.minInterval = options.minInterval ?? 100;
    this.timeout = options.timeout ?? 250;
    this.now = options.now ?? (() => Date.now());
  }

  get pending(): boolean {
    return this.timer !== null || this.idle !== null;
  }

  schedule(): void {
    if (this.stopped || this.pending) return;
    const wait = this.minInterval - (this.now() - this.lastRun);
    if (wait > 0) {
      this.timer = this.win.setTimeout(() => this.fire(), wait);
      return;
    }
    if (typeof this.win.requestIdleCallback === 'function') {
      this.idle = this.win.requestIdleCallback(() => this.fire(), { timeout: this.timeout });
      return;
    }
    this.timer = this.win.setTimeout(() => this.fire(), this.timeout);
  }

  /** Runs the task immediately, cancelling anything pending. */
  flush(): void {
    if (this.stopped) return;
    this.cancel();
    this.fire();
  }

  cancel(): void {
    if (this.timer !== null) {
      this.win.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.idle !== null) {
      this.win.cancelIdleCallback?.(this.idle);
      this.idle = null;
    }
  }

  stop(): void {
    this.cancel();
    this.stopped = true;
  }

  private fire(): void {
    this.timer = null;
    this.idle = null;
    if (this.stopped) return;
    this.lastRun = this.now();
    try {
      this.task();
    } catch {
      /* never throw into the page */
    }
  }
}
