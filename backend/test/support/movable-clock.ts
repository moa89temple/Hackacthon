import type { Clock } from "../../src/clock.ts";

export class MovableClock implements Clock {
  #now: Date;

  constructor(start: string) {
    this.#now = new Date(start);
  }

  now(): Date {
    return new Date(this.#now);
  }

  moveForward(milliseconds: number): void {
    this.#now = new Date(this.#now.getTime() + milliseconds);
  }
}
