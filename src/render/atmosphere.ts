// Atmosphere — sky dome + sun + fog. Ported from the reference's skyDome
// shader (gradient wash, azimuthal asymmetry, Mie halo, sun disc), trimmed
// to the essentials for the 600m hillside. Clouds are deferred (the design
// doc's "horizon dissolving into haze" is fog, not cloud cover).

import * as THREE from 'three';
import { GL_SAFE, GL_HASH, paletteGlsl } from './glsl';
import type { SharedUniforms } from './glsl';

export class Atmosphere {
  readonly sunDir = new THREE.Vector3(-0.45, 0.3, -0.84).normalize();
  private sky: THREE.Mesh;

  constructor(scene: THREE.Scene, shared: SharedUniforms) {
    // Sky dome: a large sphere with BackSide material, forced to the far
    // plane (xyww trick from the reference).
    const geo = new THREE.SphereGeometry(2000, 24, 16);
    const mat = new THREE.RawShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: { ...shared },
      side: THREE.BackSide,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // Set the sun direction into shared uniforms.
    shared.uSunDir.value = { x: this.sunDir.x, y: this.sunDir.y, z: this.sunDir.z };
  }

  update(camera: THREE.Camera): void {
    // Sky follows the camera.
    this.sky.position.copy(camera.position);
  }
}

const SKY_VS = /* glsl */`
precision highp float;
precision highp int;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
out vec3 vDir;

void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = (projectionMatrix * mv).xyww; // force to the far plane
}
`;

const SKY_FS = /* glsl */`
precision highp float;
${GL_SAFE}
${GL_HASH}
${paletteGlsl()}
uniform vec3 uSunDir;
uniform float uTime;
in vec3 vDir;
out vec4 outColor;

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float yy = max(y, -0.18);

  // Four-stop vertical wash.
  vec3 col = mix(K_SKY_HOR, K_SKY_MID, smoothstep(-0.02, 0.13, yy));
  col = mix(col, K_SKY_UP,  smoothstep(0.10, 0.36, yy));
  col = mix(col, K_SKY_ZEN, smoothstep(0.32, 0.86, yy));

  // Azimuthal asymmetry: warm toward the sun, cool away.
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float horiz = pow(1.0 - clamp(yy, 0.0, 1.0), 3.4);
  col = mix(col, K_SKY_ANTI,    horiz * (1.0 - az) * 0.62);
  col = mix(col, K_SKY_HORSUN,  horiz * pow(az, 2.1) * 0.92);

  // Mie forward-scatter halo.
  float ang = dot(d, uSunDir);
  float halo = pow(max(ang, 0.0), 7.0);
  float wide = pow(max(ang, 0.0), 1.9);
  col = mix(col, K_SUN_GLOW, clamp(halo * 0.72 + wide * 0.16, 0.0, 0.9));

  // Sun disc.
  float sunMask = smoothstep(0.99977, 0.99992, ang);
  col = mix(col, K_SUN_DISC * 1.9, sunMask);

  // Ground-side wash below the horizon.
  col = mix(col, mix(K_HAZE, K_MIST, 0.35), smoothstep(0.0, -0.16, d.y));

  outColor = vec4(SAFE3(col), 0.0);
}
`;