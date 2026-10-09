/**
 * Water rendering: wind-driven waves, fresnel sky reflection, sun glints,
 * depth-based absorption, shore foam and flow streaks. Foam and absorption
 * come from per-vertex depth/flow fed by the hydrology simulation, so the
 * look follows the actual water state (droughts, floods, dug channels).
 */

import * as THREE from 'three';

export interface WaterHandles {
  material: THREE.ShaderMaterial;
}

const WATER_VERT = /* glsl */ `
  attribute float aDepth;
  attribute float aFlow;
  varying float vDepth;
  varying float vFlow;
  varying vec3 vWorldPos;
  varying vec3 vViewPos;
  uniform float uTime;
  uniform float uWaveHeight;
  uniform vec2 uWind;

  void main() {
    vDepth = aDepth;
    vFlow = aFlow;
    vec3 p = position;
    // Gentle waves scaled down in shallow water to avoid bank clipping.
    float shallow = smoothstep(0.0, 1.2, aDepth);
    float w1 = sin(p.x * 0.35 + uTime * 1.1 + p.z * 0.22) * 0.5;
    float w2 = sin(p.x * 0.12 - uTime * 0.7 + p.z * 0.41) * 0.5;
    float w3 = sin(dot(p.xz, uWind) * 0.28 + uTime * 1.6) * 0.35;
    p.y += (w1 + w2 + w3) * uWaveHeight * shallow;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    vec4 mv = viewMatrix * world;
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const WATER_FRAG = /* glsl */ `
  varying float vDepth;
  varying float vFlow;
  varying vec3 vWorldPos;
  varying vec3 vViewPos;

  uniform float uTime;
  uniform sampler2D uNormalMap;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uWaveHeight;
  uniform vec2 uWind;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
      mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x),
      f.y
    );
  }

  void main() {
    vec2 xz = vWorldPos.xz;
    float t = uTime;

    // Two scrolling normal samples (drift with wind + a cross swell)
    vec2 drift1 = xz * 0.055 + uWind * t * 0.035;
    vec2 drift2 = xz * 0.11 - uWind.yx * t * 0.05 + vec2(t * 0.012, -t * 0.009);
    vec3 n1 = texture2D(uNormalMap, drift1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalMap, drift2).rgb * 2.0 - 1.0;
    vec3 nBlend = normalize(vec3((n1.xy + n2.xy * 0.8) * uWaveHeight, 1.0));

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(viewDir, nBlend), 0.0), 5.0);
    fresnel = clamp(0.04 + fresnel * 0.96, 0.0, 1.0);

    // Sky reflection approximation
    vec3 reflectDir = reflect(-viewDir, nBlend);
    vec3 skyRefl = mix(uHorizonColor, uSkyColor, clamp(reflectDir.y * 1.6, 0.0, 1.0));

    // Sun glints
    vec3 halfDir = normalize(uSunDir + viewDir);
    float spec = pow(max(dot(nBlend, halfDir), 0.0), 220.0) * 2.4;
    float glint = pow(max(dot(nBlend, halfDir), 0.0), 36.0) * 0.25;

    // Depth-based absorption
    float depthFactor = 1.0 - exp(-max(vDepth, 0.0) * 0.55);
    vec3 body = mix(uShallowColor, uDeepColor, depthFactor);

    // Flow streaks in moving water
    float streak = noise2(vec2(xz.x * 0.18 + t * vFlow * 0.5, xz.z * 0.18)) * vFlow * 0.18;

    // Shore foam: thin band where depth is small, animated
    float foamBand = 1.0 - smoothstep(0.02, 0.85, vDepth);
    float foamNoise = noise2(xz * 0.6 + vec2(t * 0.25, -t * 0.18)) * 0.6 + noise2(xz * 1.7 - t * 0.1) * 0.4;
    float foam = smoothstep(0.42, 0.72, foamNoise * 0.65 + foamBand * 0.55) * foamBand;

    vec3 color = mix(body, skyRefl, fresnel * 0.85);
    color += uSunColor * (spec + glint);
    color += uFoamColor * foam * 0.85;
    color += vec3(streak);

    // Manual exponential fog to match atmospheric perspective
    float dist = length(vViewPos);
    float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 1.0));

    float alpha = clamp(0.78 + depthFactor * 0.2 + fresnel * 0.18 + foam * 0.2, 0.0, 0.97);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createWater(normalMap: THREE.Texture): WaterHandles {
  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uWaveHeight: { value: 0.35 },
      uWind: { value: new THREE.Vector2(1, 0.35).normalize() },
      uNormalMap: { value: normalMap },
      uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyColor: { value: new THREE.Color(0.35, 0.55, 0.85) },
      uHorizonColor: { value: new THREE.Color(0.72, 0.82, 0.9) },
      uDeepColor: { value: new THREE.Color(0.05, 0.18, 0.32) },
      uShallowColor: { value: new THREE.Color(0.16, 0.42, 0.48) },
      uFoamColor: { value: new THREE.Color(0.92, 0.95, 0.97) },
      uFogColor: { value: new THREE.Color(0.72, 0.8, 0.88) },
      uFogDensity: { value: 0.00045 },
    },
    transparent: true,
    depthWrite: false,
  });
  return { material };
}

export interface WaterVisualState {
  time: number;
  waveHeight: number;
  wind: THREE.Vector2;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  horizonColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  deepColor: THREE.Color;
  shallowColor: THREE.Color;
}

export function updateWater(material: THREE.ShaderMaterial, s: WaterVisualState): void {
  const u = material.uniforms;
  u.uTime.value = s.time;
  u.uWaveHeight.value = s.waveHeight;
  (u.uWind.value as THREE.Vector2).copy(s.wind);
  (u.uSunDir.value as THREE.Vector3).copy(s.sunDirection);
  (u.uSunColor.value as THREE.Color).copy(s.sunColor);
  (u.uSkyColor.value as THREE.Color).copy(s.skyColor);
  (u.uHorizonColor.value as THREE.Color).copy(s.horizonColor);
  (u.uFogColor.value as THREE.Color).copy(s.fogColor);
  u.uFogDensity.value = s.fogDensity;
  (u.uDeepColor.value as THREE.Color).copy(s.deepColor);
  (u.uShallowColor.value as THREE.Color).copy(s.shallowColor);
}
