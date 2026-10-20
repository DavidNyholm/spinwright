/**
 * Random numbers for the engine.
 *
 * Two sources, one interface. Live play uses createCryptoRng (OS cryptographic randomness).
 * Simulations and QA repros use createRng, an sfc32 generator that is exactly reproducible from a
 * seed: small, fast and well tested, but not cryptographic. Neither is lab-certified for real-money
 * use, and this project does not do real money.
 */
export interface Rng {
  /** Next uniformly distributed unsigned 32-bit integer. */
  nextUint32(): number;
}

const UINT32_RANGE = 2 ** 32;
/** sfc32 starts weakly correlated with its seed; discarding a few outputs removes that. */
const WARMUP_ROUNDS = 15;

/** cyrb128: spreads a seed string over four 32-bit words of state. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** The same seed always yields the same stream. A number seed is treated as its decimal string. */
export function createRng(seed: string | number): Rng {
  const [s0, s1, s2, s3] = hashSeed(String(seed));
  let a = s0 | 0;
  let b = s1 | 0;
  let c = s2 | 0;
  let d = s3 | 0;
  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARMUP_ROUNDS; i++) nextUint32();
  return { nextUint32 };
}

const CRYPTO_BUFFER_WORDS = 256;

/**
 * Draws directly from the platform's cryptographic random source (Web Crypto), the way live play
 * should: there is no seed to leak and no internal state to recover from observed results. It cannot
 * be repeated, so simulations and QA runs use createRng with a seed instead.
 */
export function createCryptoRng(): Rng {
  // One call to the OS source fills a buffer; a call per number would be needlessly slow.
  const buffer = new Uint32Array(CRYPTO_BUFFER_WORDS);
  let next = CRYPTO_BUFFER_WORDS;
  return {
    nextUint32(): number {
      if (next === CRYPTO_BUFFER_WORDS) {
        crypto.getRandomValues(buffer);
        next = 0;
      }
      return buffer[next++]!;
    },
  };
}

/** A fresh 128-bit seed from the platform's cryptographic random source. */
export function randomSeed(): string {
  const words = new Uint32Array(4);
  crypto.getRandomValues(words);
  return Array.from(words, (w) => w.toString(16).padStart(8, "0")).join("");
}

/**
 * Uniform integer in [0, bound). Uses rejection sampling: a plain `x % bound` favours
 * small results whenever bound does not divide 2^32.
 */
export function nextInt(rng: Rng, bound: number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > UINT32_RANGE) {
    throw new RangeError(`bound must be an integer in [1, 2^32], got ${bound}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let x = rng.nextUint32();
  while (x >= limit) x = rng.nextUint32();
  return x % bound;
}
