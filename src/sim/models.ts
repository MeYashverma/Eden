/**
 * Procedural character and animal part geometry.
 *
 * Bodies are built from merged multi-part meshes (not single primitives):
 * humans have head, hair, torso, arms, legs; animals have body, neck, head,
 * ears, tail and four legs with species-specific proportions. Parts animate
 * through per-instance transforms in the agent renderers.
 */

import * as THREE from 'three';

export interface HumanParts {
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  /** accessory: hat/helmet etc */
  hat: THREE.BufferGeometry;
}

function baked(geo: THREE.BufferGeometry, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0, s = 1): THREE.BufferGeometry {
  const g = geo.clone();
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(dx, dy, dz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s),
  );
  g.applyMatrix4(m);
  return g;
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const geo of geos) {
    const pos = geo.getAttribute('position');
    const norm = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      positions.push(v.x, v.y, v.z);
      if (norm) {
        n.fromBufferAttribute(norm, i);
        normals.push(n.x, n.y, n.z);
      } else normals.push(0, 1, 0);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return out;
}

/**
 * Human part geometries. Origin of each part is at its joint so instance
 * matrices can rotate limbs naturally.
 */
export function buildHumanParts(): HumanParts {
  // Head: slightly ovoid sphere with a nose bump.
  const headMain = new THREE.SphereGeometry(0.135, 10, 8);
  headMain.scale(1, 1.12, 1.02);
  const nose = new THREE.BoxGeometry(0.035, 0.05, 0.045);
  const head = mergeGeos([baked(headMain, 0, 0, 0), baked(nose, 0, -0.01, 0.13)]);

  // Hair: shell over the top/back of the head.
  const hairMain = new THREE.SphereGeometry(0.148, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const hairBack = new THREE.BoxGeometry(0.22, 0.16, 0.1);
  const hair = mergeGeos([baked(hairMain, 0, 0.012, -0.008), baked(hairBack, 0, -0.02, -0.085)]);

  // Torso: chest + abdomen + shoulder caps.
  const chest = new THREE.BoxGeometry(0.32, 0.3, 0.18);
  chest.translate(0, 0.15, 0);
  const abdomen = new THREE.BoxGeometry(0.28, 0.26, 0.16);
  abdomen.translate(0, -0.12, 0);
  const shoulderL = new THREE.SphereGeometry(0.075, 6, 5);
  const shoulderR = shoulderL.clone();
  const torso = mergeGeos([
    chest,
    abdomen,
    baked(shoulderL, -0.185, 0.26, 0),
    baked(shoulderR, 0.185, 0.26, 0),
  ]);

  // Arm: origin at shoulder joint, hangs down.
  const upper = new THREE.CylinderGeometry(0.045, 0.04, 0.3, 6);
  upper.translate(0, -0.15, 0);
  const lower = new THREE.CylinderGeometry(0.038, 0.033, 0.28, 6);
  lower.translate(0, -0.42, 0);
  const hand = new THREE.SphereGeometry(0.045, 6, 5);
  hand.translate(0, -0.58, 0);
  const arm = mergeGeos([upper, lower, hand]);

  // Leg: origin at hip joint.
  const thigh = new THREE.CylinderGeometry(0.062, 0.052, 0.42, 6);
  thigh.translate(0, -0.21, 0);
  const shin = new THREE.CylinderGeometry(0.048, 0.04, 0.4, 6);
  shin.translate(0, -0.6, 0);
  const foot = new THREE.BoxGeometry(0.085, 0.05, 0.16);
  foot.translate(0, -0.82, 0.035);
  const leg = mergeGeos([thigh, shin, foot]);

  // Simple hat (apron/trader cap) reused as job accessory.
  const brim = new THREE.CylinderGeometry(0.16, 0.17, 0.02, 10);
  const cap = new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const hat = mergeGeos([baked(brim, 0, 0.1, 0), baked(cap, 0, 0.1, 0)]);

  return { head, hair, torso, arm, leg, hat };
}

// ---------------------------------------------------------------------------
// Animal body kits
// ---------------------------------------------------------------------------

export interface AnimalBodyKit {
  body: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  /** shoulder height when standing (m) */
  legLength: number;
  bodyLength: number;
  bodyWidth: number;
  animSpeed: number;
}

interface SpeciesBodySpec {
  bodyL: number;
  bodyH: number;
  bodyW: number;
  neck: number;
  neckAngle: number;
  headSize: number;
  ear: number;
  tailLen: number;
  tailUp: number;
  legLength: number;
  legRadius: number;
  snout: number;
  horns: boolean;
  winged: boolean;
}

const BODY_SPECS: Record<string, SpeciesBodySpec> = {
  deer: { bodyL: 1.15, bodyH: 0.42, bodyW: 0.36, neck: 0.55, neckAngle: -0.9, headSize: 0.16, ear: 0.12, tailLen: 0.22, tailUp: 0.5, legLength: 0.85, legRadius: 0.045, snout: 0.12, horns: true, winged: false },
  rabbit: { bodyL: 0.32, bodyH: 0.18, bodyW: 0.18, neck: 0.1, neckAngle: -0.7, headSize: 0.1, ear: 0.16, tailLen: 0.06, tailUp: 0.9, legLength: 0.2, legRadius: 0.022, snout: 0.05, horns: false, winged: false },
  wolf: { bodyL: 1.05, bodyH: 0.38, bodyW: 0.32, neck: 0.3, neckAngle: -0.35, headSize: 0.17, ear: 0.1, tailLen: 0.42, tailUp: -0.5, legLength: 0.62, legRadius: 0.045, snout: 0.16, horns: false, winged: false },
  fox: { bodyL: 0.72, bodyH: 0.28, bodyW: 0.24, neck: 0.22, neckAngle: -0.35, headSize: 0.13, ear: 0.11, tailLen: 0.42, tailUp: -0.2, legLength: 0.4, legRadius: 0.03, snout: 0.13, horns: false, winged: false },
  boar: { bodyL: 1.1, bodyH: 0.5, bodyW: 0.5, neck: 0.22, neckAngle: -0.15, headSize: 0.2, ear: 0.08, tailLen: 0.16, tailUp: 0.3, legLength: 0.42, legRadius: 0.06, snout: 0.18, horns: false, winged: false },
  bear: { bodyL: 1.5, bodyH: 0.72, bodyW: 0.68, neck: 0.28, neckAngle: -0.15, headSize: 0.24, ear: 0.09, tailLen: 0.1, tailUp: 0.1, legLength: 0.62, legRadius: 0.11, snout: 0.16, horns: false, winged: false },
  bird: { bodyL: 0.2, bodyH: 0.12, bodyW: 0.12, neck: 0.06, neckAngle: -0.5, headSize: 0.06, ear: 0.02, tailLen: 0.14, tailUp: 0.15, legLength: 0.06, legRadius: 0.008, snout: 0.05, horns: false, winged: true },
  fish: { bodyL: 0.32, bodyH: 0.1, bodyW: 0.07, neck: 0.02, neckAngle: 0, headSize: 0.05, ear: 0, tailLen: 0.12, tailUp: 0, legLength: 0, legRadius: 0, snout: 0.04, horns: false, winged: false },
  sheep: { bodyL: 0.85, bodyH: 0.38, bodyW: 0.38, neck: 0.18, neckAngle: -0.3, headSize: 0.13, ear: 0.08, tailLen: 0.1, tailUp: 0.2, legLength: 0.38, legRadius: 0.035, snout: 0.08, horns: false, winged: false },
  chicken: { bodyL: 0.26, bodyH: 0.16, bodyW: 0.15, neck: 0.1, neckAngle: -0.8, headSize: 0.06, ear: 0, tailLen: 0.12, tailUp: 0.7, legLength: 0.13, legRadius: 0.012, snout: 0.04, horns: false, winged: true },
  dog: { bodyL: 0.6, bodyH: 0.26, bodyW: 0.22, neck: 0.18, neckAngle: -0.4, headSize: 0.12, ear: 0.08, tailLen: 0.26, tailUp: 0.3, legLength: 0.34, legRadius: 0.028, snout: 0.1, horns: false, winged: false },
  cat: { bodyL: 0.42, bodyH: 0.18, bodyW: 0.16, neck: 0.1, neckAngle: -0.35, headSize: 0.1, ear: 0.07, tailLen: 0.3, tailUp: 0.6, legLength: 0.22, legRadius: 0.018, snout: 0.05, horns: false, winged: false },
};

export function buildAnimalKit(species: keyof typeof BODY_SPECS | string): AnimalBodyKit {
  const spec = BODY_SPECS[species] ?? BODY_SPECS.deer;

  // Body: ovoid + chest rump volume
  const bodyMain = new THREE.SphereGeometry(0.5, 10, 8);
  bodyMain.scale(spec.bodyL, spec.bodyH, spec.bodyW);
  const rump = new THREE.SphereGeometry(0.32, 8, 6);
  rump.scale(spec.bodyL * 0.6, spec.bodyH * 1.05, spec.bodyW * 1.02);
  rump.translate(-spec.bodyL * 0.32, 0.01, 0);
  const chest = new THREE.SphereGeometry(0.3, 8, 6);
  chest.scale(spec.bodyL * 0.55, spec.bodyH * 0.95, spec.bodyW * 0.9);
  chest.translate(spec.bodyL * 0.3, 0.01, 0);

  // Neck + head + snout + ears
  const neck = new THREE.CylinderGeometry(spec.headSize * 0.75, spec.bodyH * 0.55, spec.neck, 7);
  const neckTop = spec.neck * 0.5;
  const headCenter = new THREE.Vector3(
    spec.bodyL * 0.48 + Math.cos(spec.neckAngle) * spec.neck * 0.75,
    spec.bodyH * 0.45 + neckTop * 1.2,
    0,
  );
  const head = new THREE.SphereGeometry(spec.headSize, 8, 7);
  head.scale(1.15, 1, 0.92);
  head.translate(headCenter.x, headCenter.y, 0);
  const snout = new THREE.CylinderGeometry(spec.headSize * 0.42, spec.headSize * 0.62, spec.snout, 7);
  snout.rotateZ(-Math.PI / 2);
  snout.translate(headCenter.x + spec.headSize * 0.8 + spec.snout * 0.4, headCenter.y - spec.headSize * 0.18, 0);

  const earL = new THREE.ConeGeometry(spec.ear * 0.42, spec.ear, 5);
  const earR = earL.clone();
  earL.translate(headCenter.x - spec.headSize * 0.15, headCenter.y + spec.headSize * 0.85, spec.headSize * 0.5);
  earR.translate(headCenter.x - spec.headSize * 0.15, headCenter.y + spec.headSize * 0.85, -spec.headSize * 0.5);

  const headParts: THREE.BufferGeometry[] = [neck, head, snout, earL, earR];
  if (spec.horns) {
    const hornL = new THREE.CylinderGeometry(0.014, 0.026, 0.34, 5);
    const hornR = hornL.clone();
    hornL.rotateZ(0.5);
    hornR.rotateZ(-0.5);
    hornL.rotateX(0.25);
    hornR.rotateX(-0.25);
    hornL.translate(headCenter.x - 0.08, headCenter.y + 0.24, 0.08);
    hornR.translate(headCenter.x - 0.08, headCenter.y + 0.24, -0.08);
    headParts.push(hornL, hornR);
    // Antler tines
    for (let i = 0; i < 3; i++) {
      const tine = new THREE.CylinderGeometry(0.008, 0.015, 0.14, 4);
      tine.rotateZ(0.7 + i * 0.4);
      tine.translate(headCenter.x - 0.12 + i * 0.03, headCenter.y + 0.3 + i * 0.05, 0.1 + i * 0.02);
      headParts.push(tine);
      const tine2 = tine.clone();
      tine2.translate(0, 0, -0.2 - i * 0.04);
      headParts.push(tine2);
    }
  }

  // Tail
  const tail = new THREE.CylinderGeometry(spec.tailLen * 0.12, spec.tailLen * 0.05, spec.tailLen, 6);
  tail.rotateZ(Math.PI / 2 + spec.tailUp);
  tail.translate(-spec.bodyL * 0.62, spec.bodyH * 0.35, 0);

  // Wings for birds/chicken (merged into body so they read at distance)
  const bodyParts: THREE.BufferGeometry[] = [bodyMain, rump, chest, tail];
  if (spec.winged) {
    const wingL = new THREE.BoxGeometry(spec.bodyL * 0.7, 0.025, spec.bodyW * 1.15);
    const wingR = wingL.clone();
    wingL.translate(0, spec.bodyH * 0.18, spec.bodyW * 0.72);
    wingR.translate(0, spec.bodyH * 0.18, -spec.bodyW * 0.72);
    bodyParts.push(wingL, wingR);
  }

  // Leg: origin at hip/shoulder joint pointing down.
  const leg = new THREE.CylinderGeometry(spec.legRadius * 0.8, spec.legRadius, spec.legLength, 5);
  leg.translate(0, -spec.legLength / 2, 0);
  const hoof = new THREE.SphereGeometry(spec.legRadius * 1.15, 5, 4);
  hoof.translate(0, -spec.legLength, 0);
  const legGeo = mergeGeos([leg, hoof]);

  return {
    body: mergeGeos(bodyParts),
    leg: legGeo,
    head: mergeGeos(headParts),
    tail: mergeGeos([new THREE.SphereGeometry(spec.tailLen * 0.18, 5, 4).scale(1, 1, 1)]),
    legLength: spec.legLength,
    bodyLength: spec.bodyL,
    bodyWidth: spec.bodyW,
    animSpeed: 1 / Math.max(0.3, spec.bodyL),
  };
}

export const ANIMAL_SPECIES = Object.keys(BODY_SPECS);
