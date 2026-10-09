/**
 * Player controller: first/third-person walker with terrain collision against
 * the analytic heightfield, slope-aware movement, swimming, sprint, jump,
 * plus free-fly and overview cameras. Survival needs are optional and gated
 * by game mode.
 */

import * as THREE from 'three';
import type { Input } from '../core/input';
import type { WorldGen } from '../world/worldGen';
import type { Hydrology } from '../world/hydrology';
import { clamp, lerp, moveTowards, rotateTowards, smoothDamp } from '../core/math';

export type CameraMode = 'first' | 'third' | 'fly' | 'overview';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  stamina: number;
  hunger: number;
  thirst: number;
  warmth: number;
  cameraMode: CameraMode;
  thirdDistance: number;
}

export class Player {
  position = new THREE.Vector3(0, 20, 0);
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = -0.12;
  grounded = false;
  inWater = false;
  swimming = false;
  cameraMode: CameraMode = 'third';
  thirdDistance = 7;
  eyeHeight = 1.68;
  radius = 0.42;

  // Survival (only meaningfully decayed in survival mode)
  health = 100;
  stamina = 100;
  hunger = 100;
  thirst = 100;
  warmth = 100;
  survivalEnabled = false;

  /** Movement smoothing state */
  private speedVel = 0;
  private bobPhase = 0;
  private stepTimer = 0;
  lastFootstepSurface = 'grass';

  onFootstep: ((surface: string, position: THREE.Vector3) => void) | null = null;
  onSplash: ((position: THREE.Vector3) => void) | null = null;

  constructor(
    private gen: WorldGen,
    private hydro: Hydrology,
  ) {}

  spawnAt(x: number, z: number): void {
    const y = this.gen.height(x, z);
    this.position.set(x, Math.max(y, 0.5) + 2, z);
    this.velocity.set(0, 0, 0);
    this.yaw = Math.atan2(-x, -z);
    this.pitch = -0.1;
  }

  /** Find a habitable spawn near (x,z) — dry, walkable land. */
  findSpawn(x = 0, z = 0): THREE.Vector3 {
    for (let r = 0; r < 2400; r += 40) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const h = this.gen.height(px, pz);
        if (h > 1.2 && h < 60 && this.gen.slope(px, pz) < 0.35) {
          return new THREE.Vector3(px, h, pz);
        }
      }
    }
    return new THREE.Vector3(x, Math.max(this.gen.height(x, z), 1) + 1, z);
  }

  update(dt: number, input: Input, allowMove: boolean): void {
    const gamepad = input.pollGamepad();
    const lookX = input.mouseDx * 0.0022 + gamepad.lookX * dt + input.touchLook.x * 0.0035;
    const lookY = input.mouseDy * 0.0022 + gamepad.lookY * dt + input.touchLook.y * 0.0035;

    if (allowMove && !input.uiFocused) {
      this.yaw -= lookX;
      this.pitch = clamp(this.pitch - lookY, -1.45, 1.45);
      if (input.touchActive) {
        this.yaw -= 0; // touch look already applied
      }
    }

    // ---- gather movement intent ---------------------------------------
    let mx = 0;
    let mz = 0;
    if (allowMove && !input.uiFocused) {
      if (input.actionDown('forward')) mz -= 1;
      if (input.actionDown('back')) mz += 1;
      if (input.actionDown('left')) mx -= 1;
      if (input.actionDown('right')) mx += 1;
      mx += gamepad.moveX + input.touchMove.x;
      mz += gamepad.moveY + input.touchMove.y;
      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
    }

    const terrainH = this.gen.height(this.position.x, this.position.z);
    const waterSurface = this.hydro.surfaceAt(this.position.x, this.position.z);
    const waterDepth = waterSurface !== null ? Math.max(0, waterSurface - terrainH) : 0;
    this.inWater = waterDepth > 0.35 && this.position.y < waterSurface! + 0.4;
    this.swimming = this.inWater && waterDepth > 1.25;

    // ---- camera-relative movement --------------------------------------
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const forward = new THREE.Vector3(-sinY, 0, -cosY);
    const right = new THREE.Vector3(cosY, 0, -sinY);
    const wish = new THREE.Vector3()
      .addScaledVector(forward, -mz)
      .addScaledVector(right, mx);

    const sprinting = (input.actionDown('sprint') || gamepad.run) && this.stamina > 5 && wish.lengthSq() > 0.01;
    const crouching = input.actionDown('crouch');
    let speed = this.cameraMode === 'fly' || this.cameraMode === 'overview' ? 32 : sprinting ? 9.2 : 4.6;
    if (crouching && this.grounded) speed *= 0.45;
    if (this.inWater) speed *= this.swimming ? 0.62 : 0.8;

    if (this.cameraMode === 'fly' || this.cameraMode === 'overview') {
      // Free camera: full 3D movement along view direction.
      const lookDir = this.forwardDir();
      const flyWish = new THREE.Vector3()
        .addScaledVector(lookDir, -mz)
        .addScaledVector(right, mx);
      if (input.actionDown('jump')) flyWish.y += 1;
      if (input.actionDown('crouch')) flyWish.y -= 1;
      const boost = sprinting ? 3.2 : 1;
      this.velocity.lerp(flyWish.multiplyScalar(speed * boost), clamp(dt * 6, 0, 1));
      this.position.addScaledVector(this.velocity, dt);
      // Keep overview camera high above the terrain
      if (this.cameraMode === 'overview') {
        const h = this.gen.height(this.position.x, this.position.z);
        this.position.y = Math.max(this.position.y, h + 28);
      }
      this.grounded = false;
      this.updateCamera(dt);
      this.tickSurvival(dt, false);
      return;
    }

    // ---- ground movement -----------------------------------------------
    const accel = this.grounded ? 12 : 4.2;
    const targetVx = wish.x * speed;
    const targetVz = wish.z * speed;
    this.velocity.x = moveTowards(this.velocity.x, targetVx, accel * speed * dt);
    this.velocity.z = moveTowards(this.velocity.z, targetVz, accel * speed * dt);

    // Slope resistance: steep faces slow and slide the player down.
    const slope = this.gen.slope(this.position.x, this.position.z);
    if (this.grounded && slope > 0.62) {
      const normal = this.terrainNormal();
      this.velocity.x += normal.x * 14 * dt * (slope - 0.6);
      this.velocity.z += normal.z * 14 * dt * (slope - 0.6);
    }

    // Gravity / swimming buoyancy
    if (this.swimming) {
      this.velocity.y = lerp(this.velocity.y, input.actionDown('jump') ? 2.4 : -0.6, clamp(dt * 3, 0, 1));
      if (input.actionDown('crouch')) this.velocity.y = -2.2;
    } else {
      this.velocity.y -= 22 * dt;
      if (this.grounded && (input.actionDown('jump') || gamepad.jump) && this.stamina > 3) {
        this.velocity.y = 7.6;
        this.grounded = false;
        this.stamina = Math.max(0, this.stamina - 4);
      }
    }

    // Integrate
    this.position.addScaledVector(this.velocity, dt);

    // Terrain collision: keep capsule on the heightfield.
    const ground = this.gen.height(this.position.x, this.position.z);
    const floorY = ground + (this.swimming ? 0.2 : 0.05);
    if (this.position.y <= floorY) {
      if (this.velocity.y < -12 && !this.inWater) {
        // Fall damage
        this.health = Math.max(0, this.health + this.velocity.y * 0.55);
      }
      this.position.y = floorY;
      this.velocity.y = Math.max(0, this.velocity.y * -0.12);
      if (!this.grounded && this.inWater && this.onSplash) {
        this.onSplash(this.position.clone());
      }
      this.grounded = true;
    } else if (this.position.y > floorY + 0.12) {
      this.grounded = false;
    }

    // Soft wall against extremely steep slopes while walking uphill.
    if (this.grounded) {
      const ahead = new THREE.Vector3().copy(this.position).addScaledVector(forward, 1.4);
      const hAhead = this.gen.height(ahead.x, ahead.z);
      const rise = hAhead - this.position.y;
      if (rise > 1.9 && slope > 0.7) {
        this.position.y += rise * 0.4 * dt * 60 * 0.02;
      }
    }

    // Head bob + footsteps
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded && planarSpeed > 0.6) {
      this.bobPhase += dt * (sprinting ? 11.5 : 7.6);
      this.stepTimer -= dt * planarSpeed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.4;
        this.lastFootstepSurface = this.surfaceAt();
        this.onFootstep?.(this.lastFootstepSurface, this.position);
      }
      if (sprinting) this.stamina = Math.max(0, this.stamina - dt * 9);
      else this.stamina = Math.min(100, this.stamina + dt * 4);
    } else {
      this.bobPhase *= 0.92;
      this.stamina = Math.min(100, this.stamina + dt * 10);
    }

    this.updateCamera(dt);
    this.tickSurvival(dt, true);
  }

  private tickSurvival(dt: number, active: boolean): void {
    if (!this.survivalEnabled || !active) return;
    // Game-scale decay: ~1.5 game-hours per bar unit at 1× is handled by caller
    // passing scaled dt; here we use real seconds with modest rates.
    this.hunger = clamp(this.hunger - dt * 0.55, 0, 100);
    this.thirst = clamp(this.thirst - dt * 0.75, 0, 100);
    if (this.hunger <= 0) this.health = clamp(this.health - dt * 1.4, 0, 100);
    if (this.thirst <= 0) this.health = clamp(this.health - dt * 2.1, 0, 100);
    if (this.hunger > 55 && this.thirst > 55 && this.health < 100) {
      this.health = clamp(this.health + dt * 0.8, 0, 100);
    }
    this.warmth = clamp(lerp(this.warmth, this.inWater ? 35 : 85, dt * 0.02), 0, 100);
  }

  surfaceAt(): string {
    const sample = this.gen.sample(this.position.x, this.position.z);
    if (this.inWater) return 'water';
    if (sample.slope > 0.55) return 'rock';
    if (sample.biome === 'desert' || sample.biome === 'beach') return 'sand';
    if (sample.biome === 'alpine' || sample.biome === 'tundra') return 'snow';
    return 'grass';
  }

  terrainNormal(): THREE.Vector3 {
    const e = 1.5;
    const hL = this.gen.height(this.position.x - e, this.position.z);
    const hR = this.gen.height(this.position.x + e, this.position.z);
    const hD = this.gen.height(this.position.x, this.position.z - e);
    const hU = this.gen.height(this.position.x, this.position.z + e);
    return new THREE.Vector3(hL - hR, 2 * e, hD - hU).normalize();
  }

  forwardDir(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  /** Position the game camera for the active mode. */
  updateCamera(dt: number, camera?: THREE.PerspectiveCamera): void {
    if (!camera) return;
    const bob = this.grounded ? Math.sin(this.bobPhase) * 0.045 : 0;

    if (this.cameraMode === 'first') {
      camera.position.copy(this.position);
      camera.position.y += this.eyeHeight + bob;
      const look = this.forwardDir();
      camera.lookAt(camera.position.clone().add(look));
      return;
    }

    // Third person: orbit behind the player, terrain-aware boom.
    const look = this.forwardDir();
    const desired = this.position.clone().add(new THREE.Vector3(0, 1.85 + bob, 0)).addScaledVector(look, -this.thirdDistance);
    // Prevent the boom from going underground.
    const terrainAtCam = this.gen.height(desired.x, desired.z) + 0.65;
    if (desired.y < terrainAtCam) desired.y = terrainAtCam;
    // Also prevent clipping through a hill between player and camera.
    const mid = this.position.clone().lerp(desired, 0.55);
    const midH = this.gen.height(mid.x, mid.z) + 0.9;
    if (mid.y < midH) {
      desired.y += (midH - mid.y) * 0.85;
    }
    camera.position.lerp(desired, clamp(dt * 10, 0, 1));
    const target = this.position.clone().add(new THREE.Vector3(0, 1.62, 0)).addScaledVector(look, 1.4);
    camera.lookAt(target);
  }

  serialize(): PlayerState {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      stamina: this.stamina,
      hunger: this.hunger,
      thirst: this.thirst,
      warmth: this.warmth,
      cameraMode: this.cameraMode,
      thirdDistance: this.thirdDistance,
    };
  }

  restore(s: PlayerState): void {
    this.position.set(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.health;
    this.stamina = s.stamina;
    this.hunger = s.hunger;
    this.thirst = s.thirst;
    this.warmth = s.warmth;
    this.cameraMode = s.cameraMode;
    this.thirdDistance = s.thirdDistance;
  }
}
