// DOM heads-up display. Everything is plain HTML/CSS layered over the canvas.
import type { SlotView } from '../weapons/Weapons';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing HUD element #${id}`);
  return e as T;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

export interface PerkView {
  short: string;
  name: string;
  color: number;
}

export interface PowerupView {
  name: string;
  color: number;
  remaining: number;
  duration: number;
}

export class Hud {
  private readonly root = el('hud');
  private readonly points = el('points');
  private readonly pops = el('points-pops');
  private readonly roundNum = el('round-num');
  private readonly zoneName = el('zone-name');
  private readonly weaponName = el('weapon-name');
  private readonly ammoBlock = el('ammo');
  private readonly ammoMag = el('ammo-mag');
  private readonly ammoReserve = el('ammo-reserve');
  private readonly reloadHint = el('reload-hint');
  private readonly healthFill = el('health-fill');
  private readonly healthText = el('health-text');
  private readonly vignette = el('vignette');
  private readonly crosshair = el('crosshair');
  private readonly hitmarker = el('hitmarker');
  private readonly prompt = el('prompt');
  private readonly banner = el('banner');
  private readonly notice = el('notice');
  private readonly fps = el('fps');
  private readonly slots = el('slots');
  private readonly perks = el('perks');
  private readonly powerups = el('powerups');
  private readonly flashEl = el('flash');
  private damage = 0;
  private hitT = 0;
  private bannerT = 0;
  private noticeT = 0;
  private flashT = 0;
  private flashDur = 1;
  private lastPoints = -1;
  private lastSlots = '';
  private lastPerks = '';

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setPoints(n: number): void {
    if (n === this.lastPoints) return;
    this.lastPoints = n;
    this.points.textContent = n.toLocaleString('en-US');
  }

  popPoints(delta: number): void {
    const d = document.createElement('div');
    d.className = 'pop' + (delta < 0 ? ' neg' : '');
    d.textContent = (delta > 0 ? '+' : '') + delta;
    d.style.left = `${10 + Math.random() * 60}px`;
    this.pops.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  setRound(n: number): void {
    this.roundNum.textContent = String(n);
  }

  setZone(name: string): void {
    this.zoneName.textContent = name;
  }

  setWeapon(name: string, slots: SlotView[]): void {
    if (this.weaponName.textContent !== name) this.weaponName.textContent = name;
    const key = slots.map((s) => `${s.label}${s.kind}${s.active ? 1 : 0}${s.name ?? ''}`).join('|');
    if (key === this.lastSlots) return;
    this.lastSlots = key;
    this.slots.innerHTML = '';
    for (const s of slots) {
      const d = document.createElement('div');
      d.className = `slot ${s.kind}` + (s.active ? ' active' : '');
      d.textContent = s.kind === 'empty' ? '·' : s.label;
      d.title = s.name ?? '';
      this.slots.appendChild(d);
    }
  }

  setAmmo(mag: number, reserve: number, reloading: boolean, melee: boolean): void {
    this.ammoBlock.classList.toggle('hidden', melee);
    this.reloadHint.classList.toggle('hidden', melee || !(reloading || (mag === 0 && reserve > 0)));
    if (melee) return;
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle('low', mag === 0 || mag <= 4);
    this.reloadHint.textContent = reloading ? 'RELOADING' : 'PRESS R TO RELOAD';
  }

  setHealth(hp: number, max: number): void {
    const f = Math.max(0, Math.min(1, hp / max));
    this.healthFill.style.width = `${f * 100}%`;
    this.healthFill.classList.toggle('crit', f < 0.35);
    this.healthText.textContent = String(Math.ceil(hp));
    const dmg = 1 - f;
    this.damage = Math.max(this.damage * 0.94, dmg * 0.85);
  }

  setPerks(perks: PerkView[]): void {
    const key = perks.map((p) => p.short).join(',');
    if (key === this.lastPerks) return;
    this.lastPerks = key;
    this.perks.innerHTML = '';
    for (const p of perks) {
      const d = document.createElement('div');
      d.className = 'perk';
      d.textContent = p.short;
      d.title = p.name;
      d.style.borderColor = hex(p.color);
      d.style.color = hex(p.color);
      d.style.boxShadow = `0 0 8px ${hex(p.color)}66`;
      this.perks.appendChild(d);
    }
  }

  setPowerups(list: PowerupView[]): void {
    if (list.length === 0) {
      if (this.powerups.childElementCount > 0) this.powerups.innerHTML = '';
      return;
    }
    while (this.powerups.childElementCount < list.length) {
      const d = document.createElement('div');
      d.className = 'powerup';
      d.innerHTML = '<span class="pu-name"></span><div class="pu-bar"><div class="pu-fill"></div></div>';
      this.powerups.appendChild(d);
    }
    while (this.powerups.childElementCount > list.length) this.powerups.lastElementChild?.remove();
    list.forEach((p, i) => {
      const d = this.powerups.children[i] as HTMLElement;
      const name = d.querySelector('.pu-name') as HTMLElement;
      const fill = d.querySelector('.pu-fill') as HTMLElement;
      const label = `${p.name} ${Math.ceil(p.remaining)}`;
      if (name.textContent !== label) name.textContent = label;
      name.style.color = hex(p.color);
      fill.style.background = hex(p.color);
      fill.style.width = `${(p.remaining / p.duration) * 100}%`;
      d.classList.toggle('ending', p.remaining < 5);
    });
  }

  damageFlash(): void {
    this.damage = 1;
  }

  /** Full-screen colour flash (nuke, power-up pickup). */
  flash(color: number, seconds = 0.6, alpha = 0.8): void {
    this.flashEl.style.background = hex(color);
    this.flashEl.style.opacity = String(alpha);
    this.flashT = seconds;
    this.flashDur = seconds;
  }

  hitMarker(kill: boolean): void {
    this.hitT = 0.12;
    this.hitmarker.classList.add('show');
    this.hitmarker.classList.toggle('kill', kill);
  }

  setCrosshair(spreadPx: number, hidden: boolean): void {
    this.crosshair.style.setProperty('--spread', `${spreadPx.toFixed(1)}px`);
    this.crosshair.classList.toggle('hidden', hidden);
  }

  setPrompt(text: string | null, disabled = false): void {
    if (!text) {
      this.prompt.classList.add('hidden');
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.classList.toggle('disabled', disabled);
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
  }

  roundBanner(round: number, label = 'ROUND'): void {
    this.banner.innerHTML = `<span class="label">${label}</span><span class="num">${round}</span>`;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerT = 3.2;
  }

  showNotice(text: string, seconds = 2.5): void {
    this.notice.textContent = text;
    this.notice.classList.remove('hidden');
    this.noticeT = seconds;
  }

  setFps(fps: number, visible: boolean): void {
    this.fps.classList.toggle('hidden', !visible);
    if (visible) this.fps.textContent = `${fps.toFixed(0)} fps`;
  }

  update(dt: number): void {
    this.damage = Math.max(0, this.damage - dt * 1.4);
    this.vignette.style.opacity = String(Math.min(1, this.damage));
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitmarker.classList.remove('show');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.add('hidden');
    }
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.notice.classList.add('hidden');
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / this.flashDur);
      this.flashEl.style.opacity = String(k * k * 0.8);
      if (this.flashT <= 0) this.flashEl.style.opacity = '0';
    }
  }
}
