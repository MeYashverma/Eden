import { simplex2, fbm, ridged, warpedFbm, billow, smoothstep, clamp, lerp } from '../src/core/noise.ts';
import { hashCombine } from '../src/core/rng.ts';

console.log('simplex', simplex2(1, 0.5, 0.5), simplex2(11, 12.3, -7.7));
console.log('fbm', fbm(11, 100, 100));
console.log('ridged', ridged(71, 100, 100));
console.log('warped', warpedFbm(11, 100, 100, 0.42));
console.log('billow', billow(97, 100, 100));
console.log('hashCombine', hashCombine(1, 2, 3));
console.log('smoothstep', smoothstep(-0.16, 0.32, 0.1));

// re-implement baseHeight pieces
const s = 12345;
const sc = 1;
const x = 100, z = 100;
const nx = (x * sc) / 6000;
const nz = (z * sc) / 6000;
const cont = warpedFbm(s + 11, nx, nz, 0.42, { octaves: 4, frequency: 1 });
const land = smoothstep(-0.16, 0.32, cont);
const plains = fbm(s + 23, (x * sc) / 2600, (z * sc) / 2600, { octaves: 4 }) * 36;
const hills = warpedFbm(s + 37, (x * sc) / 820, (z * sc) / 820, 0.5, { octaves: 5 }) * 24;
const rangeMask = smoothstep(0.16, 0.78, warpedFbm(s + 53, (x * sc) / 3900, (z * sc) / 3900, 0.35, { octaves: 3 }));
const ridge = ridged(s + 71, (x * sc) / 1450, (z * sc) / 1450, { octaves: 5, gain: 0.52 });
console.log({ cont, land, plains, hills, rangeMask, ridge });
const mountains = Math.pow(ridge, 1.65) * 240 * rangeMask * 1;
console.log('mountains', mountains);
