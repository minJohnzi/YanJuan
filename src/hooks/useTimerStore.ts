import { useSyncExternalStore } from 'react';

export interface TimerStoreSnapshot {
  attemptId: string | null;
  elapsedSeconds: number;
  paused: boolean;
}

class ExamTimerStore {
  private snapshot: TimerStoreSnapshot = {
    attemptId: null,
    elapsedSeconds: 0,
    paused: true,
  };

  private listeners = new Set<() => void>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private persistCallback: ((attemptId: string, elapsedSeconds: number) => void) | null = null;
  private secondsSinceLastPersist = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TimerStoreSnapshot => {
    return this.snapshot;
  };

  setPersistCallback(cb: ((attemptId: string, elapsedSeconds: number) => void) | null): void {
    this.persistCallback = cb;
  }

  syncAttempt(attemptId: string | null, initialSeconds: number, paused: boolean): void {
    if (!attemptId) {
      this.stopInterval();
      if (this.snapshot.attemptId !== null) {
        this.snapshot = { attemptId: null, elapsedSeconds: 0, paused: true };
        this.emit();
      }
      return;
    }

    const switchingAttempt = this.snapshot.attemptId !== attemptId;
    if (switchingAttempt && this.snapshot.attemptId) {
      this.flushPersist();
    }

    const nextSeconds = switchingAttempt
      ? Math.max(0, initialSeconds)
      : Math.max(initialSeconds, this.snapshot.elapsedSeconds);

    const changed =
      this.snapshot.attemptId !== attemptId ||
      this.snapshot.elapsedSeconds !== nextSeconds ||
      this.snapshot.paused !== paused;

    this.snapshot = {
      attemptId,
      elapsedSeconds: nextSeconds,
      paused,
    };

    if (paused) {
      this.stopInterval();
    } else {
      this.ensureInterval();
    }

    if (changed) {
      this.emit();
    }
  }

  setPaused(paused: boolean): void {
    if (!this.snapshot.attemptId || this.snapshot.paused === paused) return;
    if (paused) {
      this.stopInterval();
      this.flushPersist();
    } else {
      this.ensureInterval();
    }
    this.snapshot = {
      ...this.snapshot,
      paused,
    };
    this.emit();
  }

  getElapsedForAttempt(attemptId: string, fallbackSeconds: number): number {
    if (this.snapshot.attemptId === attemptId) {
      return Math.max(fallbackSeconds, this.snapshot.elapsedSeconds);
    }
    return fallbackSeconds;
  }

  flushPersist(): void {
    if (this.snapshot.attemptId && this.persistCallback) {
      this.persistCallback(this.snapshot.attemptId, this.snapshot.elapsedSeconds);
      this.secondsSinceLastPersist = 0;
    }
  }

  private ensureInterval(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      if (this.snapshot.paused || !this.snapshot.attemptId) return;
      const nextSeconds = this.snapshot.elapsedSeconds + 1;
      this.snapshot = {
        ...this.snapshot,
        elapsedSeconds: nextSeconds,
      };
      this.secondsSinceLastPersist += 1;
      if (this.secondsSinceLastPersist >= 5) {
        this.flushPersist();
      }
      this.emit();
    }, 1000);
  }

  private stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const examTimerStore = new ExamTimerStore();

export function useTimerSnapshot(): TimerStoreSnapshot {
  return useSyncExternalStore(
    examTimerStore.subscribe,
    examTimerStore.getSnapshot,
    examTimerStore.getSnapshot
  );
}
