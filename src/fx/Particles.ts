// GPU point sprites for impact sparks and a muzzle-flash helper.
import * as THREE from 'three';
import { sparkTexture, flashTexture } from '../world/Textures';

const MAX = 900;

export class Sparks {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private cursor = 0;
  private alive = 0;

  constructor() {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX).fill(1);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: sparkTexture() } },
      vertexShader: `
        attribute float aLife; attribute vec3 aColor; attribute float aSize;
        varying float vLife; varying vec3 vColor;
        void main() {
          vLife = aLife; vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aLife > 0.0 ? clamp(aSize * 260.0 / max(0.1, -mv.z), 1.0, 40.0) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vLife; varying vec3 vColor;
        void main() {
          if (vLife <= 0.0) discard;
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * (0.6 + vLife * 1.6), t.a * vLife);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: THREE.Vector3, n: THREE.Vector3, count: number, color: THREE.Color, speed = 4, size = 0.06, lifeS = 0.5, gravity = true): void {
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.pos[k * 3] = p.x;
      this.pos[k * 3 + 1] = p.y;
      this.pos[k * 3 + 2] = p.z;
      const rx = (Math.random() - 0.5) * 2;
      const ry = (Math.random() - 0.5) * 2;
      const rz = (Math.random() - 0.5) * 2;
      const s = speed * (0.3 + Math.random());
      this.vel[k * 3] = (n.x * 1.2 + rx) * s;
      this.vel[k * 3 + 1] = (n.y * 1.2 + ry) * s + (gravity ? 1 : 0);
      this.vel[k * 3 + 2] = (n.z * 1.2 + rz) * s;
      const l = lifeS * (0.5 + Math.random());
      this.life[k] = 1;
      this.maxLife[k] = l;
      this.col[k * 3] = color.r;
      this.col[k * 3 + 1] = color.g;
      this.col[k * 3 + 2] = color.b;
      this.size[k] = size * (0.6 + Math.random() * 0.8);
      this.alive++;
    }
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt / this.maxLife[k];
      if (this.life[k] <= 0) {
        this.life[k] = 0;
        continue;
      }
      alive++;
      this.vel[k * 3 + 1] -= 9.8 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02) {
        this.pos[k * 3 + 1] = 0.02;
        this.vel[k * 3 + 1] *= -0.3;
        this.vel[k * 3] *= 0.6;
        this.vel[k * 3 + 2] *= 0.6;
      }
    }
    this.alive = alive;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Muzzle flash sprite plus a short-lived point light, attached to a gun muzzle. */
export class MuzzleFlash {
  readonly sprite: THREE.Sprite;
  readonly light: THREE.PointLight;
  private t = 0;

  constructor(color: number) {
    const mat = new THREE.SpriteMaterial({
      map: flashTexture(),
      color: new THREE.Color(color).lerp(new THREE.Color(0xfff2d0), 0.6).multiplyScalar(2),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
    this.light = new THREE.PointLight(0xffc27a, 0, 7, 2);
    this.light.visible = false;
  }

  attach(muzzle: THREE.Object3D): void {
    muzzle.add(this.sprite);
    muzzle.add(this.light);
    this.light.position.set(0, 0, -0.15);
  }

  fire(scale = 1): void {
    this.t = 0.055;
    this.sprite.visible = true;
    this.sprite.material.rotation = Math.random() * Math.PI * 2;
    const s = scale * (0.14 + Math.random() * 0.08);
    this.sprite.scale.set(s, s, s);
    this.light.visible = true;
    this.light.intensity = 24 * scale;
  }

  update(dt: number): void {
    if (this.t <= 0) return;
    this.t -= dt;
    this.light.intensity *= 0.6;
    if (this.t <= 0) {
      this.sprite.visible = false;
      this.light.visible = false;
      this.light.intensity = 0;
    }
  }
}
