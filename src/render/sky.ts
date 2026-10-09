/**
 * Dynamic sky: analytic atmosphere, sun, moon, stars and a procedural cloud
 * layer. All driven by the shared time/weather state so dawn, storms and
 * nightfall transition smoothly. Rendered as a camera-locked dome.
 */

import * as THREE from 'three';

export interface SkyHandles {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // push to far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uDayFactor;      // 0 night … 1 day
  uniform float uTwilight;       // 0..1 warm horizon band
  uniform float uCloudCover;     // 0..1
  uniform float uStorm;          // 0..1
  uniform float uTime;
  uniform vec3 uFogColor;

  // ---- hash / noise ----------------------------------------------------
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise2(p);
      p = p * 2.02 + 11.7;
      a *= 0.5;
    }
    return v;
  }

  // ---- stars ------------------------------------------------------------
  float stars(vec3 dir) {
    vec3 p = dir * 220.0;
    vec3 cell = floor(p);
    float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float star = smoothstep(0.9975, 1.0, h);
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
    return star * twinkle;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float elev = dir.y;

    // Base gradient with twilight band
    float horizonT = pow(1.0 - max(elev, 0.0), 2.2);
    vec3 sky = mix(uZenith, uHorizon, horizonT);
    sky = mix(sky, uFogColor, 0.18 * horizonT);

    // Sun glow + disk
    float sunDot = max(dot(dir, uSunDir), 0.0);
    float glow = pow(sunDot, 18.0) * 0.35 + pow(sunDot, 4.0) * 0.12;
    float disk = smoothstep(0.9994, 0.9997, sunDot);
    vec3 sunContrib = uSunColor * (glow * uDayFactor * 1.6 + disk * 4.0 * uDayFactor);

    // Twilight warmth near horizon toward the sun's azimuth
    float sunHorizon = 1.0 - abs(uSunDir.y);
    float warm = uTwilight * pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0), 3.0);
    sky += vec3(0.85, 0.35, 0.12) * warm * sunHorizon * 0.35 * horizonT;

    // Moon
    float moonDot = max(dot(dir, uMoonDir), 0.0);
    float moonDisk = smoothstep(0.99955, 0.99985, moonDot);
    float moonGlow = pow(moonDot, 32.0) * 0.08;
    vec3 moonContrib = vec3(0.75, 0.8, 0.95) * (moonDisk * 1.4 + moonGlow) * (1.0 - uDayFactor);

    // Stars fade in at night, hidden by clouds and day
    float starAmt = stars(dir) * (1.0 - uDayFactor) * (1.0 - uCloudCover * 0.9) * smoothstep(-0.05, 0.25, elev);

    // Clouds — two scrolling fbm layers projected onto a slab above
    float cloudAmt = 0.0;
    if (elev > -0.02) {
      vec2 cp = dir.xz / (elev + 0.12);
      float t = uTime * 0.004;
      float c1 = fbm(cp * 1.35 + vec2(t * 2.2, t * 0.6));
      float c2 = fbm(cp * 3.1 - vec2(t * 1.4, t * 2.1) + 31.7);
      float density = c1 * 0.72 + c2 * 0.28;
      float threshold = 1.0 - uCloudCover * 0.95;
      cloudAmt = smoothstep(threshold, threshold + 0.22, density) * smoothstep(-0.02, 0.14, elev);
    }

    // Cloud shading: lit tops toward sun, dark bases; storm clouds darken
    float sunLit = 0.55 + 0.45 * pow(sunDot * 0.5 + 0.5, 2.0);
    vec3 cloudCol = mix(vec3(0.42, 0.44, 0.48), vec3(1.04, 1.0, 0.96), sunLit * mix(1.0, 0.35, uStorm));
    cloudCol = mix(cloudCol, vec3(0.32, 0.33, 0.38), uStorm * 0.75);
    cloudCol *= mix(1.0, 0.75, 1.0 - uDayFactor);

    vec3 color = sky + sunContrib + moonContrib + vec3(starAmt) * vec3(0.9, 0.95, 1.1);
    color = mix(color, cloudCol, cloudAmt * (0.85 + 0.15 * uStorm));

    // Distant horizon settles into fog colour
    color = mix(color, uFogColor, smoothstep(0.16, -0.03, elev) * 0.55);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createSky(): SkyHandles {
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3) },
      uMoonDir: { value: new THREE.Vector3(-0.5, 0.6, -0.3) },
      uZenith: { value: new THREE.Color(0.28, 0.48, 0.78) },
      uHorizon: { value: new THREE.Color(0.72, 0.82, 0.9) },
      uGround: { value: new THREE.Color(0.2, 0.22, 0.24) },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.88) },
      uDayFactor: { value: 1 },
      uTwilight: { value: 0 },
      uCloudCover: { value: 0.35 },
      uStorm: { value: 0 },
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(0.72, 0.8, 0.88) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return { mesh, material };
}

export interface SkyState {
  sunDirection: THREE.Vector3;
  moonDirection: THREE.Vector3;
  dayFactor: number;
  twilight: number;
  cloudCover: number;
  storm: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
}

export function updateSky(material: THREE.ShaderMaterial, state: SkyState, time: number): void {
  const u = material.uniforms;
  (u.uSunDir.value as THREE.Vector3).copy(state.sunDirection);
  (u.uMoonDir.value as THREE.Vector3).copy(state.moonDirection);
  (u.uZenith.value as THREE.Color).copy(state.zenith);
  (u.uHorizon.value as THREE.Color).copy(state.horizon);
  (u.uSunColor.value as THREE.Color).copy(state.sunColor);
  (u.uFogColor.value as THREE.Color).copy(state.fogColor);
  u.uDayFactor.value = state.dayFactor;
  u.uTwilight.value = state.twilight;
  u.uCloudCover.value = state.cloudCover;
  u.uStorm.value = state.storm;
  u.uTime.value = time;
}
