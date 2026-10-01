// Third-person spring arm — follows the commander at a fixed offset, with
// terrain occlusion pushing the camera toward the pivot if the desired
// position would end up underground. Ported from the Phase 0 camera spike
// (docs/phase0-notes.md) and formalized into a module.

import * as THREE from 'three';
import type { Heightfield } from '../../worldgen/heightfield';

export interface SpringArmConfig {
  distance: number; // metres behind the pivot
  height: number;   // metres above eye height
  side: number;     // metres lateral offset (over-the-shoulder)
}

const DEFAULT_CONFIG: SpringArmConfig = {
  distance: 5.0,
  height: 1.15,
  side: 0.5,
};

export class SpringArm {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3();
  private config: SpringArmConfig;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 2000);

    // Initial position (will be overridden on first update).
    this.camera.position.set(0, this.config.height, this.config.distance);
    this.camera.lookAt(0, 0, 0);
  }

  update(pivotX: number, pivotY: number, pivotZ: number, pivotYaw: number, hf: Heightfield): void {
    this.target.set(pivotX, pivotY, pivotZ);

    // Desired camera position: behind and above the pivot, with a side offset
    // for the over-the-shoulder feel.
    const yaw = pivotYaw; // radians
    const backX = -Math.sin(yaw) * this.config.distance;
    const backZ = -Math.cos(yaw) * this.config.distance;
    const sideX = Math.cos(yaw) * this.config.side;
    const sideZ = -Math.sin(yaw) * this.config.side;

    const desired = new THREE.Vector3(
      pivotX + backX + sideX,
      pivotY + this.config.height,
      pivotZ + backZ + sideZ,
    );

    // Terrain occlusion: raymarch from desired to pivot, pulling the camera
    // toward the pivot if terrain would block.
    const occluded = this.raymarchOcclusion(desired, this.target, hf);
    this.camera.position.copy(occluded);

    // Look at a point slightly above the pivot (head height).
    const lookTarget = new THREE.Vector3(pivotX, pivotY + 1.6, pivotZ);
    this.camera.lookAt(lookTarget);
  }

  /** March along the desired→pivot line; if terrain rises above the ray,
      push the camera toward the pivot. */
  private raymarchOcclusion(
    desired: THREE.Vector3,
    pivot: THREE.Vector3,
    hf: Heightfield,
  ): THREE.Vector3 {
    const steps = 12;
    const dx = (pivot.x - desired.x) / steps;
    const dz = (pivot.z - desired.z) / steps;
    const dy = (pivot.y - desired.y) / steps;

    for (let i = 1; i <= steps; i++) {
      const x = desired.x + dx * i;
      const z = desired.z + dz * i;
      const h = hf.heightAt(x, z) + 0.3;
      const rayHeight = desired.y + dy * i;
      if (h > rayHeight) {
        return new THREE.Vector3(
          desired.x + dx * (i - 0.5),
          Math.max(rayHeight, h + 0.2),
          desired.z + dz * (i - 0.5),
        );
      }
    }
    return desired.clone();
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}