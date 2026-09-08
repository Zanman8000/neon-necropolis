// DOM heads-up display. Everything is plain HTML/CSS layered over the canvas.

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing HUD element #${id}`);
  return e as T;
}

export class Hud {
  private readonly root = el('hud');
  private readonly points = el('points');
  private readonly pops = el('points-pops');
  private readonly roundNum = el('round-num');
  private readonly zoneName = el('zone-name');
  private readonly weaponName = el('weapon-name');
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
  private damage = 0;
  private hitT = 0;
  private bannerT = 0;
  private noticeT = 0;
  private lastPoints = -1;

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

  setWeapon(name: string, slotIndex: number, slotCount: number, names: (string | null)[]): void {
    this.weaponName.textContent = name;
    this.slots.innerHTML = '';
    for (let i = 0; i < slotCount; i++) {
      const s = document.createElement('div');
      s.className = 'slot' + (i === slotIndex ? ' active' : '') + (names[i] ? '' : ' empty');
      s.textContent = names[i] ? String(i + 1) : '·';
      this.slots.appendChild(s);
    }
  }

  setAmmo(mag: number, reserve: number, reloading: boolean): void {
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = String(reserve);
    this.ammoMag.classList.toggle('low', mag === 0 || mag <= 4);
    this.reloadHint.classList.toggle('hidden', !(reloading || (mag === 0 && reserve > 0)));
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

  damageFlash(): void {
    this.damage = 1;
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
  }
}
