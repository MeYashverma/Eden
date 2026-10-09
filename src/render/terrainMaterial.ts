/**
 * Layered PBR terrain material.
 *
 * Builds on MeshStandardMaterial (full lighting/shadows/fog pipeline) and
 * injects a splat blend of six procedural layers chosen by slope, altitude,
 * moisture, biome tint and player paint. Two texture scales cross-fade by
 * noise to hide repetition; a detail normal map adds close-up surface relief.
 */

import * as THREE from 'three';
import type { TerrainTextures } from './textures';

export interface TerrainMaterialUniforms {
  uSeaLevel: { value: number };
  uSnowLine: { value: number };
  uWetness: { value: number };
  uTime: { value: number };
  uSeasonTint: { value: THREE.Color };
  uDryness: { value: number };
}

export function createTerrainMaterial(tex: TerrainTextures): THREE.MeshStandardMaterial {
  const uniforms: TerrainMaterialUniforms = {
    uSeaLevel: { value: 0 },
    uSnowLine: { value: 150 },
    uWetness: { value: 0 },
    uTime: { value: 0 },
    uSeasonTint: { value: new THREE.Color(1, 1, 1) },
    uDryness: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
    vertexColors: true,
    dithering: true,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      ...uniforms,
      uGrass: { value: tex.grass },
      uDirt: { value: tex.dirt },
      uRock: { value: tex.rock },
      uSand: { value: tex.sand },
      uSnow: { value: tex.snow },
      uGravel: { value: tex.gravel },
      uDetailNormal: { value: tex.detailNormal },
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        attribute float aSlope;
        attribute float aHeight;
        attribute float aMoisture;
        attribute float aPaint;
        attribute float aPaintW;
        varying float vSlope;
        varying float vHeight;
        varying float vMoisture;
        varying float vPaint;
        varying float vPaintW;
        varying vec3 vWorldXZ;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vSlope = aSlope;
        vHeight = aHeight;
        vMoisture = aMoisture;
        vPaint = aPaint;
        vPaintW = aPaintW;
        vWorldXZ = (modelMatrix * vec4(position, 1.0)).xyz;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D uGrass;
        uniform sampler2D uDirt;
        uniform sampler2D uRock;
        uniform sampler2D uSand;
        uniform sampler2D uSnow;
        uniform sampler2D uGravel;
        uniform sampler2D uDetailNormal;
        uniform float uSeaLevel;
        uniform float uSnowLine;
        uniform float uWetness;
        uniform float uTime;
        uniform vec3 uSeasonTint;
        uniform float uDryness;
        varying float vSlope;
        varying float vHeight;
        varying float vMoisture;
        varying float vPaint;
        varying float vPaintW;
        varying vec3 vWorldXZ;

        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        vec4 sampleLayer(sampler2D t, vec2 xz, float scale) {
          // Two scales cross-faded by noise hide obvious tiling.
          vec2 uvA = xz * scale;
          vec2 uvB = xz * scale * 0.37 + 17.3;
          float m = hash21(floor(xz * scale * 0.5));
          vec4 a = texture2D(t, uvA);
          vec4 b = texture2D(t, uvB);
          return mix(a, b, smoothstep(0.35, 0.65, m));
        }
        `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        {
          vec2 xz = vWorldXZ.xz;
          float slope = clamp(vSlope, 0.0, 1.0);
          float altitude = vHeight;

          // Layer weights from environment.
          float wRock = smoothstep(0.42, 0.72, slope);
          float wGravel = smoothstep(0.22, 0.5, slope) * (1.0 - wRock);
          float wSand = (1.0 - smoothstep(uSeaLevel + 0.4, uSeaLevel + 3.2, altitude)) * (1.0 - wRock);
          float snowMask = smoothstep(uSnowLine - 18.0, uSnowLine + 22.0, altitude + vMoisture * 6.0);
          float wSnow = snowMask * (1.0 - wRock * 0.55);
          float wDirt = clamp(0.28 + uDryness * 0.45 - vMoisture * 0.35 + smoothstep(0.3, 0.6, slope) * 0.35, 0.0, 1.0);
          float wGrass = clamp(0.95 - wRock - wSand - wSnow * 0.8 - wDirt * 0.55, 0.0, 1.0);

          vec3 col =
            sampleLayer(uGrass, xz, 0.045).rgb * wGrass +
            sampleLayer(uDirt, xz, 0.05).rgb * wDirt +
            sampleLayer(uRock, xz, 0.035).rgb * wRock +
            sampleLayer(uSand, xz, 0.07).rgb * wSand +
            sampleLayer(uSnow, xz, 0.05).rgb * wSnow +
            sampleLayer(uGravel, xz, 0.06).rgb * wGravel;
          float wsum = wGrass + wDirt + wRock + wSand + wSnow + wGravel + 1e-4;
          col /= wsum;

          // Player material paint override (build/terrain tools).
          if (vPaintW > 0.01) {
            vec3 painted =
              vPaint < 0.5 ? sampleLayer(uGrass, xz, 0.045).rgb :
              vPaint < 1.5 ? sampleLayer(uDirt, xz, 0.05).rgb :
              vPaint < 2.5 ? sampleLayer(uRock, xz, 0.035).rgb :
              vPaint < 3.5 ? sampleLayer(uSand, xz, 0.07).rgb :
              vPaint < 4.5 ? sampleLayer(uSnow, xz, 0.05).rgb :
                            sampleLayer(uGravel, xz, 0.06).rgb;
            col = mix(col, painted, clamp(vPaintW, 0.0, 1.0));
          }

          // Wetness darkens shorelines and storm-soaked ground.
          col *= 1.0 - uWetness * 0.22 * (1.0 - slope * 0.4);

          diffuseColor.rgb *= col;
        }
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        {
          float slope = clamp(vSlope, 0.0, 1.0);
          // Wet ground is glossier; snow is soft-matte; rock is rough.
          float snowMask = smoothstep(uSnowLine - 18.0, uSnowLine + 22.0, vHeight);
          roughnessFactor = mix(0.92, 0.98, snowMask);
          roughnessFactor = mix(roughnessFactor, 0.72, uWetness * 0.5);
          roughnessFactor = mix(roughnessFactor, 0.85, smoothstep(0.45, 0.8, slope));
          roughnessFactor = clamp(roughnessFactor, 0.35, 1.0);
        }
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        {
          vec2 xz = vWorldXZ.xz;
          vec3 n1 = texture2D(uDetailNormal, xz * 0.09).rgb * 2.0 - 1.0;
          vec3 n2 = texture2D(uDetailNormal, xz * 0.028 + 3.7).rgb * 2.0 - 1.0;
          vec3 detail = normalize(vec3(n1.xy * 0.55 + n2.xy * 0.45, 1.0));
          normal = normalize(normal + vec3(detail.x, 0.0, detail.y) * 0.55);
        }
        `,
      );

    // Keep a handle so the game can animate uniforms.
    (mat as unknown as { userData: Record<string, unknown> }).userData.uniforms = uniforms;
  };

  (mat as unknown as { userData: Record<string, unknown> }).userData.uniforms = uniforms;
  return mat;
}

export function updateTerrainUniforms(mat: THREE.MeshStandardMaterial, opts: {
  snowLine?: number;
  wetness?: number;
  time?: number;
  seasonTint?: THREE.Color;
  dryness?: number;
}): void {
  const u = (mat as unknown as { userData: { uniforms?: TerrainMaterialUniforms } }).userData.uniforms;
  if (!u) return;
  if (opts.snowLine !== undefined) u.uSnowLine.value = opts.snowLine;
  if (opts.wetness !== undefined) u.uWetness.value = opts.wetness;
  if (opts.time !== undefined) u.uTime.value = opts.time;
  if (opts.dryness !== undefined) u.uDryness.value = opts.dryness;
  if (opts.seasonTint) u.uSeasonTint.value.copy(opts.seasonTint);
}
