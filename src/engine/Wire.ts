import type { Pin } from "./Pin";

export class Wire {
  readonly id: string;
  readonly a: Pin;
  readonly b: Pin;

  constructor(id: string, a: Pin, b: Pin) {
    this.id = id;
    this.a = a;
    this.b = b;
  }
}
