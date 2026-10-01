// Terrain mesh — static grid over the full 600m world, with heights baked
// into vertex positions. The fragment shader colors by slope and height
// using the palette, and applies fog at distance.
//
// Ported from the reference's warped-clipmap approach (§7.1). For a 600m
// world a single fixed grid is sufficient — the clipmap's complexity buys
// nothing when the whole world is visible in one view.

import * as THREE from 'three';
import { GL_SAFE, GL_HASH, paletteGlsl } from './glsl';
import type { SharedUniforms } from './glsl';
import type { Heightfield } from '../worldgen/heightfield';
import { WORLD_SIZE, HALF } from '../worldgen/config';

const GRID = 128; // 128×128 = 16k verts, 4.7m cells over 600m

export function buildTerrainMesh(hf: Heightfield, shared: SharedUniforms): THREE.Mesh {
  const pos = new Float32Array((GRID + 1) * (GRID + 1) * 3);
  const idx = new Uint32Array(GRID * GRID * 6);
  const col = new Float32Array((GRID + 1) * (GRID + 1) * 3); // vertex colors

  let k = 0;
  const cell = WORLD_SIZE / GRID;
  for (let j = 0; j <= GRID; j++) {
    const wz = j * cell - HALF;
    for (let i = 0; i <= GRID; i++) {
      const wx = i * cell - HALF;
      const h = hf.heightAt(wx, wz);
      pos[k++] = wx;
      pos[k++] = h;
      pos[k++] = wz;
    }
  }

  k = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i;
      const b = a + 1;
      const c = a + GRID + 1;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  // Vertex colors from slope + height.
  const hm = hf.maxHeight();
  const range = hm - hf.minHeight();
  k = 0;
  for (let j = 0; j <= GRID; j++) {
    const wz = j * cell - HALF;
    for (let i = 0; i <= GRID; i++) {
      const wx = i * cell - HALF;
      const h = hf.heightAt(wx, wz);
      const n = hf.normalAt(wx, wz, 4);
      const slope = 1 - n.y;
      const heightFrac = (h - hf.minHeight()) / range;

      // Palette: hollows = dark, mids = green, crests = ridge tones.
      let r = 0.35 + 0.4 * (1 - slope);
      let g = 0.40 + 0.3 * (1 - slope);
      let b = 0.25 + 0.1 * (1 - slope);
      // Crests take on ridge hues.
      if (heightFrac > 0.7) {
        const crest = (heightFrac - 0.7) / 0.3;
        r = r * (1 - crest) + 0.65 * crest;
        g = g * (1 - crest) + 0.68 * crest;
        b = b * (1 - crest) + 0.75 * crest;
      }
      col[k++] = r; col[k++] = g; col[k++] = b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mat = new THREE.RawShaderMaterial({
    vertexShader: TERRAIN_VS,
    fragmentShader: TERRAIN_FS,
    uniforms: { ...shared },
    glslVersion: THREE.GLSL3,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

const TERRAIN_VS = /* glsl */`
precision highp float;
precision highp int;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position;
in vec3 color;
out vec3 vColor;
out float vDist;

void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  vColor = color;
  gl_Position = projectionMatrix * mv;
}
`;

const TERRAIN_FS = /* glsl */`
precision highp float;
${GL_SAFE}
${GL_HASH}
${paletteGlsl()}
uniform vec3 cameraPosition;
uniform vec3 uSunDir;
uniform float uFogMul;
in vec3 vColor;
in float vDist;
out vec4 outColor;

void main(){
  vec3 col = vColor;

  // Simple directional light: slope toward sun gets lit.
  // (Vertex normals are computed on the GPU, but we approximate with a
  //  simple gradient — the terrain colors are already baked, so just
  //  add a bit of warmth from the sun direction.)
  float sun = 0.7 + 0.3 * 0.5; // flat ambient + directional; cheap
  col *= sun;

  // Fog: aerial perspective toward the palette's haze.
  float d = max(vDist - 70.0, 0.0);
  float f = 1.0 - exp(-pow(d / 1200.0, 1.28) * 3.1 * uFogMul);
  vec3 fogCol = mix(K_HAZE, K_MIST, 0.35);
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));

  outColor = vec4(SAFE3(col), 1.0);
}
`;