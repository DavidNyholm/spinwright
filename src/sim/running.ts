/** A running mean and variance that never stores the samples (Welford's method). */
export class Running {
  count = 0;
  mean = 0;
  #m2 = 0;

  add(value: number): void {
    this.count++;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.#m2 += delta * (value - this.mean);
  }

  get variance(): number {
    return this.count > 1 ? this.#m2 / (this.count - 1) : 0;
  }

  get standardError(): number {
    return Math.sqrt(this.variance / this.count);
  }
}
