import { fbm, ridged, warpedFbm, billow, smoothstep } from '../src/core/noise.ts';
import { WorldGen } from '../src/world/worldGen.ts';
import { defaultWorldConfig } from '../src/world/types.ts';

function maxJump(f: (x: number, z: number) => number, x0: number, z0: number, span = 40): { d: number; ax: number; az: number; bx: number; bz: number } {
  let best = { d: 0, ax: 0, az: 0, bx: 0, bz: 0 };
  for (let z = z0 - span; z <= z0 + span; z += 2) {
    let last = f(x0 - span, z);
    for (let x = x0 - span + 2; x <= x0 + span; x += 2) {
      const v = f(x, z);
      const d = Math.abs(v - last);
      if (d > best.d) best = { d, ax: x - 2, az: z, bx: x, bz: z };
      last = v;
    }
  }
  return best;
}

const s = 12345;
const sc = 1;
const wrap = (fn: (x: number, z: number) => number) => fn;

const parts: Record<string, (x: number, z: number) => number> = {
  cont: (x, z) => warpedFbm(s + 11, (x * sc) / 6000, (z * sc) / 6000, 0.42, { octaves: 4, frequency: 1 }),
  plains: (x, z) => fbm(s + 23, (x * sc) / 2600, (z * sc) / 2600, { octaves: 4 }) * 36,
  hills: (x, z) => warpedFbm(s + 37, (x * sc) / 820, (z * sc) / 820, 0.5, { octaves: 5 }) * 24,
  rangeMask: (x, z) => smoothstep(0.16, 0.78, warpedFbm(s + 53, (x * sc) / 3900, (z * sc) / 3900, 0.35, { octaves: 3 })),
  ridge: (x, z) => Math.pow(ridged(s + 71, (x * sc) / 1450, (z * sc) / 1450, { octaves: 5, gain: 0.52 }), 1.65),
  lake: (x, z) => smoothstep(0.52, 0.82, billow(s + 97, (x * sc) / 1650, (z * sc) / 1650, { octaves: 3 })),
};

const gen = new WorldGen(defaultWorldConfig(s));
for (const [name, f] of Object.entries(parts)) {
  const j = maxJump(wrap(f), 1036, 1040);
  console.log(name, 'maxΔ over 2m:', j.d.toFixed(3), `(${j.ax},${j.az})->(${j.bx},${j.bz})`);
}
const jz = maxJump((x, z) => gen.baseHeight(x, z), 1036, 1040);
console.log('baseHeight', 'maxΔ over 2m:', jz.d.toFixed(2), `(${jz.ax},${jz.az})->(${jz.bx},${jz.bz})`);
const jr = maxJump((x, z) => gen.riverMask(x, z), 1036, 1040);
console.log('riverMask', 'maxΔ over 2m:', jr.d.toFixed(3));
const jh = maxJump((x, z) => gen.height(x, z), 1036, 1040);
console.log('height', 'maxΔ over 2m:', jh.d.toFixed(2), `(${jh.ax},${jh.az})->(${jh.bx},${jh.bz})`);
