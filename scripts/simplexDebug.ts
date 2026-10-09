import { simplex2 } from '../src/core/noise.ts';
import { hashCombine } from '../src/core/rng.ts';

for (const [seed, x, y] of [[1, 0.5, 0.5], [1, 100, 100], [11, 100, 100], [23, 38.4, 38.4], [11, 0.33, 0.33]] as const) {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (seed | 0) * 0x9e3779b9;
  const skew = (x + y) * F2;
  const i = Math.floor(x + skew);
  const j = Math.floor(y + skew);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const ii = i & 255;
  const jj = j & 255;
  const h = hashCombine(s, ii, jj);
  const gi = (h % 16) * 2;
  const v = simplex2(seed, x, y);
  console.log({ seed, x, y, s, i, j, x0, y0, ii, jj, h, gi, v });
}
