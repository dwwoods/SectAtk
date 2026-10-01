// Post pipeline — simplified approach: bloom is optional, everything else
// (tone mapping, grain, vignette, dither) is in one composite shader with
// toggleable uniforms. This avoids the overhead of separate passes per
// effect while keeping the fps-plateau fix: the expensive effects
// (watercolour, chroma bleed) are omitted entirely, and the composite
// shader's per-effect uniforms can be set to zero to skip the ALU.

import * as THREE from 'three';
import type { IUniform } from 'three';
import { GL_FRAG_HEAD, GL_SAFE } from './glsl';

export interface PostFlags {
  bloom: boolean;
  grain: boolean;
  vignette: boolean;
  dither: boolean;
}

export class PostPipeline {
  private renderer: THREE.WebGLRenderer;
  private bloomRT: THREE.WebGLRenderTarget | null = null;
  private brightMat: THREE.RawShaderMaterial;
  private downMats: THREE.RawShaderMaterial[] = [];
  private upMats: THREE.RawShaderMaterial[] = [];
  private compositeMat: THREE.RawShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quadMesh: THREE.Mesh;

  flags: PostFlags = { bloom: true, grain: true, vignette: true, dither: true };

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.bloomRT = new THREE.WebGLRenderTarget(Math.max(4, width >> 1), Math.max(4, height >> 1), { type: THREE.UnsignedByteType });

    this.brightMat = blitMat(`
      uniform sampler2D uSrc; in vec2 vUv; out vec4 o;
      void main(){ vec3 c=texture(uSrc,vUv).rgb; float l=dot(c,vec3(0.2126,0.7152,0.0722)); o=vec4(c*smoothstep(0.55,0.85,l),1.0); }
    `, ['uSrc']);

    // Bloom downsample: 4 levels (one target is reused).
    this.downMats = [1, 2, 3, 4].map(() => blitMat(`
      uniform sampler2D uSrc; uniform vec2 uTexel; in vec2 vUv; out vec4 o;
      void main(){
        vec2 t=uTexel;
        vec3 a=texture(uSrc,vUv+t*vec2(-2,-2)).rgb, b=texture(uSrc,vUv+t*vec2(0,-2)).rgb, c=texture(uSrc,vUv+t*vec2(2,-2)).rgb;
        vec3 d=texture(uSrc,vUv+t*vec2(-2,0)).rgb,  e=texture(uSrc,vUv).rgb,               f=texture(uSrc,vUv+t*vec2(2,0)).rgb;
        vec3 g=texture(uSrc,vUv+t*vec2(-2,2)).rgb,  h=texture(uSrc,vUv+t*vec2(0,2)).rgb,   i=texture(uSrc,vUv+t*vec2(2,2)).rgb;
        o=vec4((a+b+d+e)*0.25+((a+b+c+d+e+f+g+h+i)-9.0*e)*-0.013,1.0);
      }
    `, ['uSrc', 'uTexel']));

    this.upMats = [1, 2, 3, 4].map(() => blitMat(`
      uniform sampler2D uSrc, uPrev; uniform vec2 uTexel; in vec2 vUv; out vec4 o;
      void main(){
        vec4 s=texture(uSrc,vUv); vec2 t=uTexel;
        vec3 n=texture(uPrev,vUv+t*vec2(-1,-1)).rgb+texture(uPrev,vUv+t*vec2(0,-1)).rgb+texture(uPrev,vUv+t*vec2(1,-1)).rgb
              +texture(uPrev,vUv+t*vec2(-1,0)).rgb+texture(uPrev,vUv+t*vec2(0,0)).rgb+texture(uPrev,vUv+t*vec2(1,0)).rgb
              +texture(uPrev,vUv+t*vec2(-1,1)).rgb+texture(uPrev,vUv+t*vec2(0,1)).rgb+texture(uPrev,vUv+t*vec2(1,1)).rgb;
        o=vec4(s.rgb+n/9.0+0.01,1.0);
      }
    `, ['uSrc', 'uPrev', 'uTexel']));

    this.compositeMat = blitMat(`
      uniform sampler2D uSrc, uBloom;
      uniform float uTime;
      uniform bool uBloomOn, uGrainOn, uVignetteOn, uDitherOn;
      ${GL_SAFE}
      in vec2 vUv; out vec4 o;
      vec3 tonemap(vec3 x){ x=max(x,vec3(0.0)); return clamp(x*(x*0.36+0.42)/(x*(x*0.34+0.66)+0.11),0.0,1.0); }
      void main(){
        vec3 c=texture(uSrc,vUv).rgb;
        // Bloom.
        if(uBloomOn){ vec3 b=texture(uBloom,vUv).rgb; c+=b*0.42; }
        // Vignette.
        if(uVignetteOn){ vec2 v=vUv-0.5; float vig=1.0-dot(v,v)*0.8; c*=mix(0.5,1.0,vig); }
        // Tonemap.
        c=tonemap(c);
        // Grain.
        if(uGrainOn){ float g=fract(sin(dot(gl_FragCoord.xy+uTime,vec2(12.9898,78.233)))*43758.5453); c+=g*0.015-0.008; }
        // Dither: hash-based white noise (no Bayer matrix needed for MVP).
        if(uDitherOn){ float d=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453); c+=d/512.0; }
        o=vec4(SAFE3(c),1.0);
      }
    `, ['uSrc', 'uBloom', 'uTime', 'uBloomOn', 'uGrainOn', 'uVignetteOn', 'uDitherOn']);

    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quadScene.add(this.quadMesh);
  }

  process(sceneRT: THREE.WebGLRenderTarget): void {
    const r = this.renderer;
    const flags = this.flags;
    // The uniform objects are created dynamically; cast for access.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cm = this.compositeMat.uniforms as any;

    if (flags.bloom && this.bloomRT) {
      // Extract bright areas.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.brightMat.uniforms as any).uSrc.value = sceneRT.texture;
      this.blit(this.brightMat, this.bloomRT);

      // Downsample.
      const src = this.bloomRT;
      for (let i = 0; i < this.downMats.length; i++) {
        const mt = this.downMats[i]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = mt.uniforms as any;
        u.uSrc.value = src.texture;
        u.uTexel.value.set(1 / src.width, 1 / src.height);
        this.blit(mt, src);
      }

      // Upsample (blend back into the same RT).
      for (let k = 0; k < this.upMats.length; k++) {
        const mt = this.upMats[k]!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = mt.uniforms as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prev = k === 0 ? this.bloomRT.texture : (this.upMats[k - 1]!.uniforms as any).uSrc.value;
        u.uSrc.value = prev;
        u.uPrev.value = src.texture;
        u.uTexel.value.set(1 / src.width, 1 / src.height);
        this.blit(mt, src);
      }

      cm.uBloom.value = this.bloomRT.texture;
    } else {
      cm.uBloom.value = sceneRT.texture;
    }

    cm.uSrc.value = sceneRT.texture;
    cm.uTime.value = performance.now() / 1000;
    cm.uBloomOn.value = flags.bloom;
    cm.uGrainOn.value = flags.grain;
    cm.uVignetteOn.value = flags.vignette;
    cm.uDitherOn.value = flags.dither;
    cm.uBloomOn.needsUpdate = true;
    cm.uGrainOn.needsUpdate = true;
    cm.uVignetteOn.needsUpdate = true;
    cm.uDitherOn.needsUpdate = true;

    this.quadMesh.material = this.compositeMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }

  resize(width: number, height: number): void {
    if (this.bloomRT) {
      this.bloomRT.setSize(Math.max(4, width >> 1), Math.max(4, height >> 1));
    }
  }

  private blit(mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quadMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}

function blitMat(fs: string, uniformNames: string[]): THREE.RawShaderMaterial {
  const u: Record<string, IUniform> = {};
  for (const n of uniformNames) {
    if (n === 'uTexel') u[n] = { value: new THREE.Vector2(0, 0) };
    else if (n === 'uTime') u[n] = { value: 0.0 };
    else if (n === 'uBloomOn' || n === 'uGrainOn' || n === 'uVignetteOn' || n === 'uDitherOn') u[n] = { value: false };
    else u[n] = { value: null };
  }
  return new THREE.RawShaderMaterial({
    vertexShader: `precision highp float;\nin vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: GL_FRAG_HEAD + fs,
    uniforms: u,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
}