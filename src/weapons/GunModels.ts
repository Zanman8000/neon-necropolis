// Procedural gun meshes built from primitives. Forward is -Z, up is +Y, right is +X. Units are metres.
import * as THREE from 'three';
import type { GunModelKind } from './WeaponDefs';

export interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  /** Part that cycles on each shot (slide, bolt or pump). */
  cycler: THREE.Mesh | null;
  cyclerAxis: 'z';
  cyclerTravel: number;
  materials: THREE.Material[];
}

const gunmetal = () => new THREE.MeshStandardMaterial({ color: 0x5a6070, metalness: 0.85, roughness: 0.38, emissive: 0x1a1d24, emissiveIntensity: 0.5 });
const polymer = () => new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.2, roughness: 0.75, emissive: 0x14161b, emissiveIntensity: 0.5 });
const steel = () => new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.9, roughness: 0.3, emissive: 0x1a1d24, emissiveIntensity: 0.4 });
const accentMat = (color: number) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3) });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

function tube(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

export function buildGunModel(kind: GunModelKind, accent: number): GunModel {
  const group = new THREE.Group();
  const gm = gunmetal();
  const pm = polymer();
  const st = steel();
  const am = accentMat(accent);
  const materials: THREE.Material[] = [gm, pm, st, am];
  const muzzle = new THREE.Object3D();
  let cycler: THREE.Mesh | null = null;
  let cyclerTravel = 0.02;

  const add = (m: THREE.Object3D) => {
    group.add(m);
    return m;
  };

  if (kind === 'pistol') {
    cycler = add(box(0.032, 0.036, 0.19, gm, 0, 0.03, -0.07)) as THREE.Mesh;
    add(box(0.03, 0.03, 0.15, pm, 0, 0.0, -0.05));
    add(tube(0.007, 0.03, st, 0, 0.03, -0.175));
    add(box(0.03, 0.095, 0.04, pm, 0, -0.055, 0.015, -0.28));
    add(box(0.006, 0.028, 0.045, pm, 0, -0.024, -0.02));
    add(box(0.008, 0.01, 0.01, pm, 0, 0.053, 0.015));
    add(box(0.006, 0.01, 0.008, pm, 0, 0.053, -0.155));
    add(box(0.002, 0.004, 0.1, am, 0.0165, 0.036, -0.07));
    add(box(0.002, 0.004, 0.1, am, -0.0165, 0.036, -0.07));
    muzzle.position.set(0, 0.03, -0.19);
    cyclerTravel = 0.03;
  } else if (kind === 'smg') {
    add(box(0.05, 0.07, 0.34, gm, 0, 0.02, -0.12));
    add(tube(0.016, 0.16, st, 0, 0.035, -0.37));
    add(tube(0.02, 0.06, gm, 0, 0.035, -0.31));
    add(box(0.03, 0.16, 0.05, pm, 0, -0.09, -0.08, 0.12));
    add(box(0.035, 0.1, 0.045, pm, 0, -0.06, 0.05, -0.3));
    add(box(0.03, 0.04, 0.16, pm, 0, 0.02, 0.13));
    add(box(0.04, 0.09, 0.02, pm, 0, 0.0, 0.215));
    add(box(0.05, 0.015, 0.2, gm, 0, 0.062, -0.15));
    add(box(0.03, 0.03, 0.06, pm, 0, 0.085, -0.05));
    add(box(0.024, 0.02, 0.002, am, 0, 0.088, -0.019));
    cycler = add(box(0.012, 0.012, 0.04, st, 0.031, 0.03, -0.02)) as THREE.Mesh;
    add(box(0.002, 0.005, 0.22, am, 0.026, 0.0, -0.12));
    add(box(0.002, 0.005, 0.22, am, -0.026, 0.0, -0.12));
    muzzle.position.set(0, 0.035, -0.45);
    cyclerTravel = 0.03;
  } else if (kind === 'shotgun') {
    add(box(0.05, 0.075, 0.28, gm, 0, 0.02, -0.05));
    add(tube(0.014, 0.5, st, 0, 0.045, -0.44));
    add(tube(0.012, 0.42, gm, 0, 0.003, -0.4));
    cycler = add(box(0.05, 0.05, 0.12, pm, 0, 0.02, -0.34)) as THREE.Mesh;
    add(box(0.035, 0.06, 0.24, pm, 0, 0.0, 0.2));
    add(box(0.04, 0.09, 0.025, pm, 0, -0.01, 0.325));
    add(box(0.035, 0.09, 0.045, pm, 0, -0.06, 0.06, -0.3));
    add(box(0.01, 0.012, 0.012, st, 0, 0.065, -0.66));
    add(box(0.052, 0.01, 0.05, am, 0, 0.02, -0.16));
    muzzle.position.set(0, 0.045, -0.7);
    cyclerTravel = 0.07;
  } else {
    add(box(0.05, 0.08, 0.36, gm, 0, 0.02, -0.1));
    add(box(0.045, 0.06, 0.28, pm, 0, 0.03, -0.42));
    add(tube(0.011, 0.18, st, 0, 0.04, -0.64));
    add(tube(0.016, 0.05, gm, 0, 0.04, -0.71));
    add(box(0.03, 0.17, 0.06, pm, 0, -0.09, -0.12, 0.18));
    add(box(0.035, 0.1, 0.045, pm, 0, -0.06, 0.06, -0.3));
    add(box(0.035, 0.06, 0.2, pm, 0, 0.0, 0.2));
    add(box(0.045, 0.1, 0.025, pm, 0, -0.01, 0.31));
    add(box(0.035, 0.04, 0.1, pm, 0, 0.085, -0.08));
    add(box(0.028, 0.026, 0.002, am, 0, 0.088, -0.029));
    add(box(0.05, 0.012, 0.3, gm, 0, 0.066, -0.42));
    cycler = add(box(0.012, 0.012, 0.05, st, 0.031, 0.03, -0.03)) as THREE.Mesh;
    add(box(0.002, 0.006, 0.26, am, 0.0235, 0.03, -0.42));
    add(box(0.002, 0.006, 0.26, am, -0.0235, 0.03, -0.42));
    muzzle.position.set(0, 0.04, -0.74);
    cyclerTravel = 0.035;
  }

  group.add(muzzle);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return { group, muzzle, cycler, cyclerAxis: 'z', cyclerTravel, materials };
}
