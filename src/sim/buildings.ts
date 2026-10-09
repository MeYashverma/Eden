/**
 * Procedural architecture kit.
 *
 * Buildings are assembled from parts — walls with recessed windows and framed
 * doors, pitched or hipped roofs with overhang and ridge caps, chimneys,
 * porches with posts, signs, barrels and fences. Nothing is a bare box: every
 * structure gets trim, a real roof silhouette and small details that read at
 * walking distance.
 */

import * as THREE from 'three';
import { seededRng, type RNG } from '../core/rng';

export type BuildingType = 'house' | 'cottage' | 'barn' | 'shop' | 'tavern' | 'well' | 'tower' | 'mill' | 'warehouse' | 'dock';

export interface BuildingKitResult {
  group: THREE.Group;
  /** entrance world-offset (local space) */
  door: THREE.Vector3;
  width: number;
  depth: number;
  height: number;
}

export interface SharedBuildingMaterials {
  plaster: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofAlt: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  fabric: THREE.MeshStandardMaterial;
}

export function createBuildingMaterials(): SharedBuildingMaterials {
  return {
    plaster: new THREE.MeshStandardMaterial({ color: 0xd8cbb2, roughness: 0.92, metalness: 0 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6844, roughness: 0.88, metalness: 0 }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x4e3a28, roughness: 0.9, metalness: 0 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.95, metalness: 0 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x7a3f2c, roughness: 0.82, metalness: 0 }),
    roofAlt: new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.82, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.18, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.55, metalness: 0.65 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xb85c4a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Pitched roof from two slabs + gable triangles + ridge beam. */
function makePitchedRoof(
  w: number,
  d: number,
  wallTop: number,
  overhang: number,
  pitch: number,
  mats: SharedBuildingMaterials,
  roofMat: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const halfW = w / 2 + overhang;
  const slabLen = Math.hypot(halfW, pitch);
  const angle = Math.atan2(pitch, halfW);

  for (const side of [-1, 1]) {
    const slab = box(slabLen, 0.16, d + overhang * 2, roofMat);
    slab.rotation.z = -side * angle;
    slab.position.set(side * halfW * 0.5, wallTop + pitch * 0.5, 0);
    g.add(slab);
  }
  // Ridge beam
  g.add(box(0.24, 0.2, d + overhang * 2 + 0.1, mats.darkWood, 0, wallTop + pitch, 0));

  // Gable ends (triangles)
  const triShape = new THREE.Shape();
  triShape.moveTo(-w / 2 - 0.02, 0);
  triShape.lineTo(w / 2 + 0.02, 0);
  triShape.lineTo(0, pitch);
  triShape.closePath();
  for (const zSide of [-1, 1]) {
    const tri = new THREE.Mesh(
      new THREE.ExtrudeGeometry(triShape, { depth: 0.14, bevelEnabled: false }),
      mats.plaster,
    );
    tri.position.set(0, wallTop, zSide * (d / 2 - 0.06));
    tri.castShadow = true;
    tri.receiveShadow = true;
    g.add(tri);
  }
  return g;
}

/** Window with frame, sill and mullions. */
function makeWindow(w: number, h: number, mats: SharedBuildingMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, 0.06, mats.glass, 0, 0, 0));
  const t = 0.075;
  g.add(box(w + t * 2, t, 0.1, mats.darkWood, 0, h / 2 + t / 2, 0.01));
  g.add(box(w + t * 2, t, 0.1, mats.darkWood, 0, -h / 2 - t / 2, 0.01));
  g.add(box(t, h, 0.1, mats.darkWood, -w / 2 - t / 2, 0, 0.01));
  g.add(box(t, h, 0.1, mats.darkWood, w / 2 + t / 2, 0, 0.01));
  g.add(box(0.05, h, 0.07, mats.darkWood, 0, 0, 0.035));
  g.add(box(w, 0.05, 0.07, mats.darkWood, 0, 0, 0.035));
  // Sill
  g.add(box(w + t * 3, 0.05, 0.16, mats.darkWood, 0, -h / 2 - t, 0.06));
  return g;
}

/** Door with frame, planks, handle and step. */
function makeDoor(w: number, h: number, mats: SharedBuildingMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, h, 0.09, mats.darkWood, 0, 0, 0));
  // Plank grooves
  for (let i = -1; i <= 1; i++) {
    g.add(box(0.035, h * 0.94, 0.11, mats.wood, i * w * 0.28, 0, 0.012));
  }
  // Frame
  g.add(box(0.12, h + 0.16, 0.13, mats.wood, -w / 2 - 0.05, 0, 0.01));
  g.add(box(0.12, h + 0.16, 0.13, mats.wood, w / 2 + 0.05, 0, 0.01));
  g.add(box(w + 0.22, 0.12, 0.13, mats.wood, 0, h / 2 + 0.07, 0.01));
  // Handle
  g.add(box(0.045, 0.045, 0.1, mats.metal, w * 0.3, 0, 0.08));
  // Step
  g.add(box(w + 0.4, 0.12, 0.5, mats.stone, 0, -h / 2 - 0.02, 0.3));
  return g;
}

function makeChimney(mats: SharedBuildingMaterials, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.55, h, 0.55, mats.stone, 0, h / 2, 0));
  g.add(box(0.72, 0.14, 0.72, mats.stone, 0, h + 0.02, 0));
  g.add(box(0.2, 0.22, 0.2, mats.darkWood, 0, h + 0.16, 0));
  return g;
}

function makeBarrel(mats: SharedBuildingMaterials): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.75, 10), mats.wood);
  body.position.y = 0.375;
  body.castShadow = true;
  g.add(body);
  for (const y of [0.16, 0.38, 0.6]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.05, 10), mats.metal);
    ring.position.y = y;
    g.add(ring);
  }
  return g;
}

export interface HouseOptions {
  type: BuildingType;
  rng: RNG;
  mats: SharedBuildingMaterials;
  width?: number;
  depth?: number;
  floors?: number;
  rotation?: number;
}

export function buildStructure(opts: HouseOptions): BuildingKitResult {
  const { rng, mats } = opts;
  const group = new THREE.Group();
  const w = opts.width ?? rng.range(6.2, 9.5);
  const d = opts.depth ?? rng.range(5.4, 8.2);
  const floors = opts.floors ?? (rng.chance(0.32) ? 2 : 1);
  const floorH = 2.9;
  const wallH = floorH * floors;
  const wallMat = rng.chance(0.42) ? mats.plaster : mats.wood;

  // ---- walls with corner posts ------------------------------------------
  group.add(box(w, wallH, d, wallMat, 0, wallH / 2, 0));
  const postT = 0.22;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(box(postT, wallH + 0.08, postT, mats.darkWood, sx * (w / 2 - 0.02), wallH / 2, sz * (d / 2 - 0.02)));
    }
  }
  // Timber frame bands
  for (let f = 0; f < floors; f++) {
    group.add(box(w + 0.06, 0.16, d + 0.06, mats.darkWood, 0, f * floorH + floorH, 0));
  }
  // Stone foundation
  group.add(box(w + 0.35, 0.55, d + 0.35, mats.stone, 0, 0.27, 0));

  // ---- door (front = +z) -------------------------------------------------
  const doorH = 1.95;
  const doorW = 1.05;
  const door = makeDoor(doorW, doorH, mats);
  door.position.set(0, 0.55 + doorH / 2 - 0.28, d / 2 + 0.02);
  group.add(door);

  // ---- windows -----------------------------------------------------------
  const windowY = [];
  for (let f = 0; f < floors; f++) windowY.push(1.55 + f * floorH);
  for (const y of windowY) {
    // front
    for (const sx of [-1, 1]) {
      const win = makeWindow(0.95, 1.15, mats);
      win.position.set(sx * (w * 0.28), y, d / 2 + 0.03);
      group.add(win);
    }
    // sides
    for (const sz of [-1, 1]) {
      const win = makeWindow(0.9, 1.1, mats);
      win.position.set((sz * w) / 2 + sz * 0.03, y, 0.2);
      win.rotation.y = (sz * Math.PI) / 2;
      group.add(win);
      const win2 = makeWindow(0.9, 1.1, mats);
      win2.position.set((sz * w) / 2 + sz * 0.03, y, -d * 0.28);
      win2.rotation.y = (sz * Math.PI) / 2;
      group.add(win2);
    }
  }

  // ---- roof ---------------------------------------------------------------
  const pitch = rng.range(2.1, 3.2);
  const roof = makePitchedRoof(w, d, wallH, 0.55, pitch, mats, rng.chance(0.5) ? mats.roof : mats.roofAlt);
  group.add(roof);
  if (rng.chance(0.65)) {
    const chimney = makeChimney(mats, pitch + rng.range(1.2, 2.1));
    chimney.position.set(w * rng.range(-0.28, 0.28), wallH + 0.2, d * rng.range(-0.3, 0.1));
    group.add(chimney);
  }

  // ---- porch for houses ----------------------------------------------------
  if ((opts.type === 'house' || opts.type === 'tavern' || opts.type === 'cottage') && rng.chance(0.55)) {
    const porchW = w * 0.72;
    group.add(box(porchW, 0.18, 1.7, mats.wood, 0, 0.48, d / 2 + 0.95));
    for (const px of [-porchW / 2 + 0.2, porchW / 2 - 0.2]) {
      group.add(box(0.16, 2.35, 0.16, mats.wood, px, 1.65, d / 2 + 1.62));
    }
    const porchRoof = box(porchW + 0.4, 0.12, 2.1, mats.roofAlt, 0, 2.95, d / 2 + 1.05);
    porchRoof.rotation.x = -0.14;
    group.add(porchRoof);
  }

  // ---- type-specific details ----------------------------------------------
  switch (opts.type) {
    case 'shop': {
      const sign = box(1.7, 0.85, 0.1, mats.darkWood, 0, wallH * 0.62, d / 2 + 0.35);
      group.add(sign);
      const signFace = box(1.5, 0.65, 0.06, mats.fabric, 0, wallH * 0.62, d / 2 + 0.42);
      group.add(signFace);
      for (const sx of [-1, 1]) {
        const bracket = box(0.06, 0.55, 0.4, mats.metal, sx * 0.75, wallH * 0.62 + 0.55, d / 2 + 0.28);
        group.add(bracket);
      }
      const barrel = makeBarrel(mats);
      barrel.position.set(w * 0.36, 0.55, d / 2 + 1.15);
      group.add(barrel);
      break;
    }
    case 'barn': {
      // Big sliding door + hay loft opening.
      group.add(box(w * 0.5, wallH * 0.55, 0.14, mats.darkWood, 0, wallH * 0.3, d / 2 + 0.06));
      for (let i = -3; i <= 3; i++) {
        group.add(box(0.1, wallH * 0.52, 0.17, mats.wood, i * w * 0.07, wallH * 0.3, d / 2 + 0.09));
      }
      group.add(box(1.1, 1.1, 0.12, mats.darkWood, 0, wallH * 0.82, d / 2 + 0.06));
      break;
    }
    case 'tavern': {
      const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 12), mats.wood);
      sign.rotation.x = Math.PI / 2;
      sign.position.set(w / 2 + 0.5, wallH * 0.72, d / 2 + 0.3);
      sign.castShadow = true;
      group.add(sign);
      group.add(box(0.08, 0.9, 0.08, mats.metal, w / 2 + 0.5, wallH * 0.72 + 0.6, d / 2 + 0.3));
      const barrel1 = makeBarrel(mats);
      barrel1.position.set(-w * 0.34, 0.55, d / 2 + 1.3);
      group.add(barrel1);
      break;
    }
    case 'well': {
      // Replaced entirely by dedicated builder below.
      break;
    }
    default:
      break;
  }

  // Small crates/props beside some buildings
  if (rng.chance(0.5)) {
    const crate = box(0.75, 0.75, 0.75, mats.wood, -w * 0.38, 0.92, d / 2 + 1.05, rng.range(0, 1));
    group.add(crate);
    if (rng.chance(0.5)) {
      group.add(box(0.6, 0.6, 0.6, mats.wood, -w * 0.38 + 0.55, 0.85, d / 2 + 1.5, rng.range(0, 1)));
    }
  }

  group.rotation.y = opts.rotation ?? 0;
  return {
    group,
    door: new THREE.Vector3(0, 0.55, d / 2 + 1.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotation ?? 0),
    width: w,
    depth: d,
    height: wallH + pitch,
  };
}

/** Village well: stone ring, wooden posts, roof, bucket on a rope. */
export function buildWell(mats: SharedBuildingMaterials): BuildingKitResult {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.95, 12), mats.stone);
  ring.position.y = 0.48;
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.2, 12), mats.darkWood);
  hole.position.y = 0.92;
  group.add(hole);
  for (const sx of [-1, 1]) {
    group.add(box(0.16, 2.5, 0.16, mats.darkWood, sx * 1.0, 1.5, 0));
    const brace = box(0.12, 0.12, 1.2, mats.wood, sx * 0.55, 2.6, 0);
    brace.rotation.z = sx * 0.65;
    group.add(brace);
  }
  const roofA = box(2.6, 0.1, 1.5, mats.roof, -0.6, 3.15, 0, 0, 0, 0.5);
  const roofB = box(2.6, 0.1, 1.5, mats.roof, 0.6, 3.15, 0, 0, 0, -0.5);
  group.add(roofA, roofB);
  group.add(box(2.7, 0.12, 0.14, mats.darkWood, 0, 3.55, 0));
  // Rope + bucket
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), mats.darkWood);
  rope.position.y = 2.15;
  group.add(rope);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 8), mats.wood);
  bucket.position.y = 1.35;
  bucket.castShadow = true;
  group.add(bucket);
  return { group, door: new THREE.Vector3(0, 0, 1.6), width: 2.4, depth: 2.4, height: 3.6 };
}

/** Wooden watchtower with ladder and platform. */
export function buildTower(mats: SharedBuildingMaterials): BuildingKitResult {
  const group = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    group.add(box(0.28, 7, 0.28, mats.darkWood, Math.cos(angle) * 1.5, 3.5, Math.sin(angle) * 1.5));
  }
  group.add(box(3.6, 0.22, 3.6, mats.wood, 0, 7, 0));
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    group.add(box(3.2, 0.85, 0.12, mats.darkWood, Math.cos(angle) * 1.55, 7.5, Math.sin(angle) * 1.55, angle + Math.PI / 2));
  }
  // Ladder
  for (const sx of [-1, 1]) {
    group.add(box(0.09, 7, 0.09, mats.wood, sx * 0.28, 3.5, 1.55));
  }
  for (let i = 0; i < 13; i++) {
    group.add(box(0.62, 0.07, 0.1, mats.wood, 0, 0.45 + i * 0.52, 1.55));
  }
  // Conical roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 2, 8), mats.roofAlt);
  roof.position.y = 8.6;
  roof.castShadow = true;
  group.add(roof);
  return { group, door: new THREE.Vector3(0, 0, 2.2), width: 3.6, depth: 3.6, height: 9.6 };
}

/** Simple plank dock extending toward +z. */
export function buildDock(mats: SharedBuildingMaterials, length = 8): BuildingKitResult {
  const group = new THREE.Group();
  const planks = Math.floor(length / 0.55);
  for (let i = 0; i < planks; i++) {
    group.add(box(2.2, 0.1, 0.46, i % 2 === 0 ? mats.wood : mats.darkWood, 0, 0.35, i * 0.55 + 0.3));
  }
  for (let i = 0; i <= planks / 3; i++) {
    for (const sx of [-1, 1]) {
      group.add(box(0.18, 1.6, 0.18, mats.darkWood, sx * 1.0, -0.35, i * 1.65 + 0.3));
    }
  }
  return { group, door: new THREE.Vector3(0, 0, length * 0.8), width: 2.2, depth: length, height: 0.5 };
}

/** Farm field with rows of soil and optional crops. */
export function buildField(width: number, depth: number, cropMat: THREE.Material, growth: number): THREE.Group {
  const group = new THREE.Group();
  const soil = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), new THREE.MeshStandardMaterial({ color: 0x5c4230, roughness: 1 }));
  soil.position.y = 0.06;
  soil.receiveShadow = true;
  group.add(soil);
  const rows = Math.floor(depth / 1.15);
  const cols = Math.floor(width / 1.0);
  const geo = new THREE.ConeGeometry(0.16, 0.55, 5);
  const mesh = new THREE.InstancedMesh(geo, cropMat, rows * cols);
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const scale = 0.35 + growth * 0.85;
      dummy.position.set((c - cols / 2) * 1.0 + 0.5, 0.12 + 0.26 * scale, (r - rows / 2) * 1.15 + 0.55);
      dummy.rotation.set(0, ((r * 7 + c * 3) % 6) * 0.2, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  // Fence posts around field
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.95 });
  const step = 2.2;
  for (let x = -width / 2; x <= width / 2; x += step) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.12), postMat);
      post.position.set(x, 0.42, (sz * depth) / 2);
      post.castShadow = true;
      group.add(post);
    }
  }
  return group;
}

/** Wooden fence run along a polyline (local coords). */
export function buildFence(points: THREE.Vector2[], mats: SharedBuildingMaterials): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = a.distanceTo(b);
    const steps = Math.max(1, Math.round(len / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.y + (b.y - a.y) * t;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), mats.darkWood);
      post.position.set(x, 0.52, z);
      post.castShadow = true;
      group.add(post);
      if (s < steps) {
        const t2 = (s + 0.5) / steps;
        const mx = a.x + (b.x - a.x) * t2;
        const mz = a.y + (b.y - a.y) * t2;
        for (const h of [0.42, 0.82]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, len / steps), mats.wood);
          rail.position.set(mx, h, mz);
          rail.rotation.y = Math.atan2(b.x - a.x, b.y - a.y) + Math.PI / 2;
          rail.castShadow = true;
          group.add(rail);
        }
      }
    }
  }
  return group;
}
