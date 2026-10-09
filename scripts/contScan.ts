import { simplex2, fbm, warpedFbm } from '../src/core/noise.ts';

// Fine scan for discontinuities in simplex2 along a line in simplex space
function scan(f: (u: number, v: number) => number, u0: number, v0: number, span: number, steps: number) {
  let worst = 0, wu = 0, prev = f(u0, v0);
  for (let i = 1; i <= steps; i++) {
    const u = u0 + (span * i) / steps;
    const v = v0;
    const cur = f(u, v);
    const d = Math.abs(cur - prev);
    if (d > worst) { worst = d; wu = u; }
    prev = cur;
  }
  console.log('worst Δ', worst, 'at u=', wu, 'step', span / steps);
}

// cont field: warpedFbm(s+11, x/6000, z/6000) at z=1014 → v=0.169
scan((u, v) => warpedFbm(12356, u, v, 0.42, { octaves: 4 }), 1072 / 6000, 1014 / 6000, 4 / 6000, 4000);
scan((u, v) => fbm(12356, u, v, { octaves: 4 }), 1072 / 6000, 1014 / 6000, 4 / 6000, 4000);
scan((u, v) => simplex2(12356, u, v), 1072 / 6000, 1014 / 6000, 4 / 6000, 4000);

// Scan a dense 2D grid for simplex2 discontinuities
let worst = 0, wx = 0, wy = 0;
for (let vy = -2; vy < 2; vy += 0.05) {
  let prev = simplex2(7, -2, vy);
  for (let vx = -1.995; vx < 2; vx += 0.005) {
    const cur = simplex2(7, vx, vy);
    const d = Math.abs(cur - prev);
    if (d > worst) { worst = d; wx = vx; wy = vy; }
    prev = cur;
  }
}
console.log('simplex2 grid worst Δ over 0.005:', worst, 'at', wx, wy);
