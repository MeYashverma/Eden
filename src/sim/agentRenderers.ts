/**
 * Instanced agent rendering.
 *
 * All humans share a handful of InstancedMeshes (head/hair/torso/arms/legs);
 * all animals of a species share body/head/leg instances. Per-frame matrices
 * carry position, facing and procedural animation (walk cycles, sit poses,
 * work swings, flight bob). This keeps hundreds of agents at a few dozen draw
 * calls.
 */

import * as THREE from 'three';
import { buildHumanParts, buildAnimalKit, type HumanParts, type AnimalBodyKit } from './models';
import { lerp, TAU } from '../core/math';

export type HumanActivity = 'idle' | 'walk' | 'run' | 'sit' | 'work' | 'eat' | 'sleep' | 'gesture' | 'swim';

export interface HumanRenderInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  activity: HumanActivity;
  phase: number;
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  scale: number;
}

const SKIN_TONES = [0xe8c19a, 0xd9a577, 0xc48c60, 0x9c6a44, 0x7a4f32, 0xf0d0b0];
const HAIR_TONES = [0x2a2218, 0x4a3524, 0x744a24, 0xb5854a, 0x1a1a1c, 0x8a8a8a, 0xa33c1c];
const SHIRT_TONES = [0x7b4b3a, 0x3c5a78, 0x5c7a4a, 0x8a6d3b, 0x6b4a78, 0xb0a890, 0x37474f, 0xa34c3c];
const PANTS_TONES = [0x3a3a42, 0x5a4632, 0x2e3e2e, 0x4a4a56, 0x6a5a42];

export function pickHumanColors(rng: () => number): { skin: number; hair: number; shirt: number; pants: number } {
  return {
    skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)],
    hair: HAIR_TONES[Math.floor(rng() * HAIR_TONES.length)],
    shirt: SHIRT_TONES[Math.floor(rng() * SHIRT_TONES.length)],
    pants: PANTS_TONES[Math.floor(rng() * PANTS_TONES.length)],
  };
}

export class HumanRenderer {
  readonly group = new THREE.Group();
  private parts: HumanParts;
  private meshes: Record<string, THREE.InstancedMesh> = {};
  private materials: THREE.MeshStandardMaterial[] = [];
  capacity: number;

  constructor(capacity = 72) {
    this.capacity = capacity;
    this.parts = buildHumanParts();
    const make = (geo: THREE.BufferGeometry, name: string): THREE.InstancedMesh => {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, vertexColors: true });
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `humans-${name}`;
      mesh.count = 0;
      this.materials.push(mat);
      this.meshes[name] = mesh;
      this.group.add(mesh);
      return mesh;
    };
    make(this.parts.head, 'head');
    make(this.parts.hair, 'hair');
    make(this.parts.torso, 'torso');
    make(this.parts.arm, 'armL');
    make(this.parts.arm, 'armR');
    make(this.parts.leg, 'legL');
    make(this.parts.leg, 'legR');
    make(this.parts.hat, 'hat');
    this.group.name = 'humans';
  }

  update(humans: HumanRenderInput[]): void {
    const n = Math.min(humans.length, this.capacity);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (const key of Object.keys(this.meshes)) {
      this.meshes[key].count = 0;
    }

    for (let i = 0; i < n; i++) {
      const h = humans[i];
      const s = h.scale;
      const sinY = Math.sin(h.yaw);
      const cosY = Math.cos(h.yaw);
      const skinC = color.setHex(h.skin).clone();
      const hairC = color.setHex(h.hair).clone();
      const shirtC = color.setHex(h.shirt).clone();
      const pantsC = color.setHex(h.pants).clone();

      // Animation angles
      const speedFactor = Math.min(1, h.speed / 4.2);
      const swing = Math.sin(h.phase) * (0.35 + speedFactor * 0.55);
      const bob = Math.abs(Math.sin(h.phase)) * 0.035 * speedFactor;

      let legL = swing;
      let legR = -swing;
      let armL = -swing * 0.75;
      let armR = swing * 0.75;
      let torsoTilt = speedFactor * 0.08;
      let hipY = 0.88 * s + bob;

      switch (h.activity) {
        case 'sit':
          legL = -1.25;
          legR = -1.25;
          armL = -0.35;
          armR = -0.35;
          hipY = 0.5 * s;
          torsoTilt = 0.08;
          break;
        case 'work':
          armR = -1.1 + Math.sin(h.phase * 2.4) * 0.85;
          armL = -0.35;
          torsoTilt = 0.16 + Math.sin(h.phase * 2.4) * 0.06;
          break;
        case 'eat':
          armR = -1.9 + Math.sin(h.phase * 1.4) * 0.18;
          armL = -0.25;
          break;
        case 'sleep':
          legL = -0.25;
          legR = -0.3;
          armL = -0.6;
          armR = -0.5;
          torsoTilt = 0.55;
          hipY = 0.32 * s;
          break;
        case 'gesture':
          armR = -1.7 + Math.sin(h.phase * 3) * 0.35;
          armL = swing * 0.3;
          break;
        case 'swim':
          legL = 0;
          legR = 0;
          armL = -1.5 + Math.sin(h.phase) * 0.6;
          armR = -1.5 - Math.sin(h.phase) * 0.6;
          torsoTilt = 1.15;
          hipY = 0.35 * s;
          break;
        case 'run':
          legL = swing * 1.55;
          legR = -swing * 1.55;
          armL = -swing * 1.25;
          armR = swing * 1.25;
          break;
        default:
          break;
      }

      // Torso
      {
        const m = this.meshes.torso;
        dummy.position.set(h.x, h.y + hipY, h.z);
        dummy.rotation.set(torsoTilt, h.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, shirtC);
        m.count++;
      }
      // Head
      {
        const m = this.meshes.head;
        const headY = h.y + hipY + 0.42 * s + torsoTilt * 0.1;
        dummy.position.set(h.x + Math.sin(h.yaw) * torsoTilt * -0.2, headY, h.z + Math.cos(h.yaw) * torsoTilt * -0.2);
        dummy.rotation.set(torsoTilt * 0.6, h.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, skinC);
        m.count++;
      }
      // Hair
      {
        const m = this.meshes.hair;
        const headY = h.y + hipY + 0.42 * s + torsoTilt * 0.1;
        dummy.position.set(h.x + Math.sin(h.yaw) * torsoTilt * -0.2, headY, h.z + Math.cos(h.yaw) * torsoTilt * -0.2);
        dummy.rotation.set(torsoTilt * 0.6, h.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, hairC);
        m.count++;
      }
      // Arms (pivot at shoulder)
      for (const [name, angle, side] of [['armL', armL, -1], ['armR', armR, 1]] as const) {
        const m = this.meshes[name];
        const shoulderY = h.y + hipY + 0.34 * s;
        const offX = Math.cos(h.yaw) * 0.185 * s * side;
        const offZ = -Math.sin(h.yaw) * 0.185 * s * side;
        dummy.position.set(h.x + offX, shoulderY, h.z + offZ);
        dummy.rotation.set(angle, h.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, shirtC);
        m.count++;
      }
      // Legs (pivot at hip)
      for (const [name, angle, side] of [['legL', legL, -1], ['legR', legR, 1]] as const) {
        const m = this.meshes[name];
        const offX = Math.cos(h.yaw) * 0.085 * s * side;
        const offZ = -Math.sin(h.yaw) * 0.085 * s * side;
        dummy.position.set(h.x + offX, h.y + hipY, h.z + offZ);
        dummy.rotation.set(angle, h.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, pantsC);
        m.count++;
      }
    }

    for (const mesh of Object.values(this.meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------

export type AnimalActivity = 'idle' | 'walk' | 'run' | 'graze' | 'flee' | 'hunt' | 'rest' | 'fly' | 'swim' | 'dead';

export interface AnimalRenderInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  activity: AnimalActivity;
  phase: number;
  scale: number;
  tint: THREE.Color;
}

export class AnimalRenderer {
  readonly group = new THREE.Group();
  private kit: AnimalBodyKit;
  private meshes: Record<string, THREE.InstancedMesh> = {};
  species: string;
  capacity: number;

  constructor(species: string, capacity = 48) {
    this.species = species;
    this.capacity = capacity;
    this.kit = buildAnimalKit(species);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, vertexColors: true });
    const legMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, vertexColors: true });

    const body = new THREE.InstancedMesh(this.kit.body, bodyMat, capacity);
    const head = new THREE.InstancedMesh(this.kit.head, bodyMat, capacity);
    const legs: THREE.InstancedMesh[] = [];
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.InstancedMesh(this.kit.leg, legMat, capacity);
      leg.castShadow = true;
      legs.push(leg);
      this.group.add(leg);
    }
    body.castShadow = true;
    body.receiveShadow = true;
    head.castShadow = true;
    for (const m of [body, head]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.meshes.body = body;
    this.meshes.head = head;
    this.meshes.leg0 = legs[0];
    this.meshes.leg1 = legs[1];
    this.meshes.leg2 = legs[2];
    this.meshes.leg3 = legs[3];
    this.group.name = `animals-${species}`;
  }

  update(animals: AnimalRenderInput[]): void {
    const n = Math.min(animals.length, this.capacity);
    const dummy = new THREE.Object3D();
    const kit = this.kit;

    for (const mesh of Object.values(this.meshes)) mesh.count = 0;

    for (let i = 0; i < n; i++) {
      const a = animals[i];
      const s = a.scale;
      const speedFactor = Math.min(1, a.speed / (kit.animSpeed > 0 ? 4 : 4));
      const moving = a.speed > 0.12;

      let bodyBob = 0;
      let legPhase = 0;
      let headPitch = 0;

      switch (a.activity) {
        case 'graze':
          headPitch = 1.05 + Math.sin(a.phase * 0.8) * 0.12;
          legPhase = 0;
          break;
        case 'run':
        case 'flee':
        case 'hunt':
          legPhase = Math.sin(a.phase * 1.9) * (0.65 + speedFactor * 0.55);
          bodyBob = Math.abs(Math.sin(a.phase * 1.9)) * 0.05;
          break;
        case 'fly':
          bodyBob = Math.sin(a.phase * 2.2) * 0.35;
          headPitch = -0.18;
          break;
        case 'swim':
          bodyBob = Math.sin(a.phase * 1.6) * 0.06;
          headPitch = -0.15;
          break;
        case 'rest':
          bodyBob = -0.12 * kit.legLength;
          legPhase = 0;
          break;
        case 'dead':
          bodyBob = -0.35 * kit.legLength;
          headPitch = 0.6;
          break;
        default:
          legPhase = moving ? Math.sin(a.phase * 1.35) * (0.3 + speedFactor * 0.35) : 0;
          bodyBob = moving ? Math.abs(Math.sin(a.phase * 1.35)) * 0.018 : 0;
      }

      const baseY = a.y + kit.legLength * s + bodyBob * s;

      // Body
      {
        const m = this.meshes.body;
        dummy.position.set(a.x, baseY, a.z);
        const roll = a.activity === 'dead' || a.activity === 'rest' ? Math.PI / 2.2 : 0;
        dummy.rotation.set(roll, a.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, a.tint);
        m.count++;
      }
      // Head — offset toward body front
      {
        const m = this.meshes.head;
        const fx = Math.cos(a.yaw) * kit.bodyLength * 0.42;
        const fz = -Math.sin(a.yaw) * kit.bodyLength * 0.42;
        dummy.position.set(a.x + fx * s, baseY + 0.1 * s, a.z + fz * s);
        dummy.rotation.set(headPitch, a.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, a.tint);
        m.count++;
      }
      // Legs
      const lx = kit.bodyLength * 0.3 * s;
      const lz = kit.bodyWidth * 0.42;
      const legPos: Array<[number, number, number]> = [
        [lx, -0.13 * s, legPhase],
        [lx, 0.13 * s, -legPhase],
        [-lx, -0.13 * s, -legPhase],
        [-lx, 0.13 * s, legPhase],
      ];
      for (let li = 0; li < 4; li++) {
        const m = this.meshes[`leg${li}`];
        const [ox, oz, ang] = legPos[li];
        // rotate offset by yaw
        const rx = ox * Math.cos(a.yaw) + oz * Math.sin(a.yaw);
        const rz = -ox * Math.sin(a.yaw) + oz * Math.cos(a.yaw);
        dummy.position.set(a.x + rx, baseY - 0.02 * s, a.z + rz);
        const fold = a.activity === 'rest' || a.activity === 'dead' ? 1.15 : ang;
        dummy.rotation.set(fold, a.yaw, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        m.setMatrixAt(m.count, dummy.matrix);
        m.setColorAt(m.count, a.tint);
        m.count++;
      }
    }

    for (const mesh of Object.values(this.meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
