// First-person controller: pointer-lock look, WASD with sprint / crouch / jump, grid collision, health.
import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Level } from '../world/Level';
import type { Sfx } from '../audio/Sfx';
import { moveWithCollision } from '../world/Grid';
import { PLAYER } from '../game/Rules';

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0;
  vy = 0;
  grounded = true;
  crouching = false;
  sprinting = false;
  moving = false;
  health: number = PLAYER.maxHealth;
  alive = true;
  sensitivity = 0.0022;
  invertY = false;
  baseFov = 75;
  bobPhase = 0;
  bobAmount = 0;
  private eye = PLAYER.eyeHeight;
  private sinceDamage = 999;
  private lastStepPhase = 0;
  onDamaged: ((amount: number) => void) | null = null;
  onDeath: (() => void) | null = null;

  constructor(
    private readonly level: Level,
    private readonly input: Input,
    private readonly sfx: Sfx,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
    this.reset();
  }

  reset(): void {
    this.pos.copy(this.level.spawnPoint());
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.vy = 0;
    this.grounded = true;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.sinceDamage = 999;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.eye = PLAYER.eyeHeight;
    this.syncCamera();
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  get forwardFlat(): THREE.Vector2 {
    return new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
  }

  get eyePosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.health -= amount;
    this.sinceDamage = 0;
    this.sfx.playerHurt();
    this.onDamaged?.(amount);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.sfx.playerDown();
      this.onDeath?.();
    }
  }

  update(dt: number, allowInput: boolean, ads: number): void {
    const input = this.input;
    if (allowInput && this.alive) {
      const sens = this.sensitivity * (1 - ads * 0.45);
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens * (this.invertY ? -1 : 1);
      // keyboard look fallback (arrow keys)
      const look = 1.8 * dt;
      if (input.isDown('ArrowLeft')) this.yaw += look;
      if (input.isDown('ArrowRight')) this.yaw -= look;
      if (input.isDown('ArrowUp')) this.pitch += look;
      if (input.isDown('ArrowDown')) this.pitch -= look;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    }

    let fwd = 0;
    let strafe = 0;
    let wantJump = false;
    let wantSprint = false;
    let wantCrouch = false;
    if (allowInput && this.alive) {
      fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
      wantJump = input.wasPressed('Space');
      wantSprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      wantCrouch = input.isDown('ControlLeft') || input.isDown('KeyC');
    }
    this.crouching = wantCrouch && this.grounded;
    this.sprinting = wantSprint && fwd > 0 && !this.crouching && ads < 0.2;
    const speed = this.crouching ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed * (1 - ads * 0.35);

    const f = this.forwardFlat;
    const rX = Math.cos(this.yaw);
    const rZ = -Math.sin(this.yaw);
    let dx = f.x * fwd + rX * strafe;
    let dz = f.y * fwd + rZ * strafe;
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
    }
    const accel = this.grounded ? 14 : 4;
    const k = Math.min(1, dt * accel);
    this.vel.x += (dx * speed - this.vel.x) * k;
    this.vel.z += (dz * speed - this.vel.z) * k;
    this.moving = len > 0;

    const p = { x: this.pos.x, z: this.pos.z };
    moveWithCollision(p, this.vel.x * dt, this.vel.z * dt, PLAYER.radius, this.level.isBlocked);
    this.pos.x = p.x;
    this.pos.z = p.z;

    if (wantJump && this.grounded) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= PLAYER.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.sfx.footstep();
      }
    }

    // regen
    this.sinceDamage += dt;
    if (this.alive && this.sinceDamage > PLAYER.regenDelay && this.health < PLAYER.maxHealth) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }

    // head bob + footsteps
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    const target = this.grounded && this.moving ? Math.min(1, horizSpeed / PLAYER.walkSpeed) : 0;
    this.bobAmount += (target - this.bobAmount) * Math.min(1, dt * 8);
    if (this.grounded && horizSpeed > 0.5) {
      this.bobPhase += dt * horizSpeed * 1.9;
      const stepIdx = Math.floor(this.bobPhase / Math.PI);
      if (stepIdx !== this.lastStepPhase) {
        this.lastStepPhase = stepIdx;
        this.sfx.footstep();
      }
    }
    const targetEye = this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    this.syncCamera();
  }

  private syncCamera(): void {
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.02 * this.bobAmount;
    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + this.eye + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.004 * this.bobAmount);
  }
}
