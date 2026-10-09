import { WorldGen } from '../src/world/worldGen.ts';
import { defaultWorldConfig } from '../src/world/types.ts';

const gen = new WorldGen(defaultWorldConfig(12345));
let maxJump = 0, mx = 0, mz = 0, dir = '';
for (let z = -2000; z <= 2000; z += 2) {
  let last = gen.height(-2000, z);
  for (let x = -1998; x <= 2000; x += 2) {
    const h = gen.height(x, z);
    const d = Math.abs(h - last);
    if (d > maxJump) { maxJump = d; mx = x; mz = z; dir = 'x'; }
    last = h;
  }
}
for (let x = -2000; x <= 2000; x += 2) {
  let last = gen.height(x, -2000);
  for (let z = -1998; z <= 2000; z += 2) {
    const h = gen.height(x, z);
    const d = Math.abs(h - last);
    if (d > maxJump) { maxJump = d; mx = x; mz = z; dir = 'z'; }
    last = h;
  }
}
console.log('max jump', maxJump.toFixed(1), 'at', mx, mz, dir);

// Broad survey over several far-apart windows, multiple seeds
for (const seed of [1, 42, 12345, 777777]) {
  const g = new WorldGen(defaultWorldConfig(seed));
  let ocean = 0, land = 0, mount = 0, n = 0, hmin = 1e9, hmax = -1e9;
  for (let z = -8000; z <= 8000; z += 100) {
    for (let x = -8000; x <= 8000; x += 100) {
      const h = g.height(x, z);
      hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
      if (h < -0.5) ocean++;
      else { land++; if (h > 150) mount++; }
      n++;
    }
  }
  console.log(`seed ${seed}: land ${(100*land/n).toFixed(0)}% (mountain ${(100*mount/n).toFixed(0)}%), ocean ${(100*ocean/n).toFixed(0)}%, h ${hmin.toFixed(0)}..${hmax.toFixed(0)}`);
}
