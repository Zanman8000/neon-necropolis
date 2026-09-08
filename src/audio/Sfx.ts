// Fully synthesized sound effects via the Web Audio API. No audio files are needed; every sound
// is built from oscillators and filtered noise, positioned in stereo relative to the player.

export interface GunSound {
  len: number;
  low: number;
  bright: number;
  vol: number;
}

export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private ambienceStarted = false;
  listener = { x: 0, z: 0, yaw: 0 };
  volume = 0.8;

  init(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // ------------------------------------------------------------------ routing helpers

  private spatial(x?: number, z?: number): { gain: number; pan: number } {
    if (x === undefined || z === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = Math.min(1, 1 / (1 + (d * d) / 40));
    if (d < 0.01) return { gain, pan: 0 };
    const yaw = this.listener.yaw;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / d) * 0.8));
    return { gain, pan };
  }

  private out(vol: number, x?: number, z?: number, bus: GainNode = this.sfx): GainNode | null {
    if (!this.ctx) return null;
    const sp = this.spatial(x, z);
    if (sp.gain * vol < 0.004) return null;
    const g = this.ctx.createGain();
    g.gain.value = sp.gain * vol;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = sp.pan;
    g.connect(pan).connect(bus);
    return g;
  }

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = 2;
    return src;
  }

  private burst(
    dest: AudioNode,
    len: number,
    filterType: BiquadFilterType,
    f0: number,
    f1: number,
    q = 0.8,
    vol = 1,
    attack = 0.002,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noiseSource();
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len + 0.05);
  }

  private tone(
    dest: AudioNode,
    type: OscillatorType,
    f0: number,
    f1: number,
    len: number,
    vol: number,
    attack = 0.005,
    detune = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + len + 0.05);
  }

  // ------------------------------------------------------------------ weapons

  gunshot(s: GunSound, x?: number, z?: number): void {
    const dest = this.out(s.vol, x, z);
    if (!dest) return;
    this.burst(dest, s.len, 'lowpass', s.bright, 180, 0.7, 1);
    this.burst(dest, s.len * 0.5, 'bandpass', s.bright * 1.6, s.bright * 0.5, 1.5, 0.5);
    this.tone(dest, 'sine', s.low * 2.2, s.low * 0.45, Math.max(0.09, s.len * 0.8), 0.9);
    if (s.len > 0.25) this.tone(dest, 'triangle', s.low * 1.2, s.low * 0.3, s.len * 1.3, 0.5);
  }

  dryFire(): void {
    const dest = this.out(0.35);
    if (!dest) return;
    this.burst(dest, 0.04, 'bandpass', 2600, 1800, 3, 1);
  }

  reloadStart(): void {
    const dest = this.out(0.3);
    if (!dest) return;
    this.burst(dest, 0.05, 'bandpass', 1800, 900, 4, 1);
    this.tone(dest, 'square', 420, 300, 0.05, 0.15);
  }

  reloadEnd(): void {
    const dest = this.out(0.35);
    if (!dest) return;
    this.burst(dest, 0.06, 'bandpass', 2400, 1200, 4, 1);
    this.tone(dest, 'square', 620, 480, 0.06, 0.15);
  }

  weaponSwap(): void {
    const dest = this.out(0.25);
    if (!dest) return;
    this.burst(dest, 0.08, 'bandpass', 1500, 700, 3, 1);
  }

  hitMarker(kill: boolean): void {
    const dest = this.out(kill ? 0.3 : 0.2);
    if (!dest) return;
    this.tone(dest, 'triangle', kill ? 980 : 1500, kill ? 600 : 1100, kill ? 0.09 : 0.045, 1);
  }

  // ------------------------------------------------------------------ economy / ui

  purchase(): void {
    const dest = this.out(0.3);
    if (!dest) return;
    this.tone(dest, 'sine', 660, 660, 0.1, 0.8);
    setTimeout(() => {
      const d2 = this.out(0.3);
      if (d2) this.tone(d2, 'sine', 990, 990, 0.16, 0.8);
    }, 95);
  }

  denied(): void {
    const dest = this.out(0.25);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 120, 90, 0.22, 0.6);
  }

  pointsTick(): void {
    const dest = this.out(0.08);
    if (!dest) return;
    this.tone(dest, 'sine', 1800, 1800, 0.03, 1);
  }

  roundStart(): void {
    const dest = this.out(0.5);
    if (!dest) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (const det of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      osc.detune.value = det;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 6;
      filt.frequency.setValueAtTime(120, t);
      filt.frequency.exponentialRampToValueAtTime(1400, t + 1.6);
      filt.frequency.exponentialRampToValueAtTime(90, t + 3.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.3);
      osc.connect(filt).connect(g).connect(dest);
      osc.start(t);
      osc.stop(t + 3.4);
    }
    setTimeout(() => {
      const d2 = this.out(0.35);
      if (!d2) return;
      this.tone(d2, 'sine', 880, 870, 1.6, 0.5, 0.01);
      this.tone(d2, 'sine', 1320, 1310, 1.2, 0.25, 0.01);
    }, 400);
  }

  roundEnd(): void {
    const dest = this.out(0.35);
    if (!dest) return;
    this.tone(dest, 'sine', 660, 440, 1.2, 0.6, 0.02);
    this.tone(dest, 'triangle', 330, 220, 1.5, 0.3, 0.02);
  }

  // ------------------------------------------------------------------ player

  playerHurt(): void {
    const dest = this.out(0.6);
    if (!dest) return;
    this.burst(dest, 0.28, 'lowpass', 900, 120, 0.7, 1);
    this.tone(dest, 'sine', 110, 40, 0.3, 0.9);
  }

  playerDown(): void {
    const dest = this.out(0.7);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 220, 30, 2.5, 0.5, 0.05);
    this.burst(dest, 1.2, 'lowpass', 800, 60, 0.7, 0.6);
  }

  footstep(): void {
    const dest = this.out(0.13);
    if (!dest) return;
    this.burst(dest, 0.07, 'lowpass', 700 + Math.random() * 300, 200, 0.6, 1);
  }

  repair(): void {
    const dest = this.out(0.3);
    if (!dest) return;
    this.burst(dest, 0.05, 'bandpass', 2200, 1500, 4, 1);
    this.tone(dest, 'sine', 330, 520, 0.12, 0.5);
  }

  doorOpen(x: number, z: number): void {
    const dest = this.out(0.55, x, z);
    if (!dest) return;
    this.burst(dest, 0.9, 'lowpass', 2600, 250, 0.8, 0.8, 0.05);
    setTimeout(() => {
      const d2 = this.out(0.5, x, z);
      if (d2) this.tone(d2, 'sine', 90, 35, 0.35, 1);
    }, 850);
  }

  // ------------------------------------------------------------------ zombies

  zombieGroan(x: number, z: number, pitch = 1): void {
    const dest = this.out(0.5, x, z);
    if (!dest) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const len = 0.7 + Math.random() * 0.8;
    const base = (70 + Math.random() * 45) * pitch;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5 + Math.random() * 3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 3;
    filt.frequency.setValueAtTime(220, t);
    filt.frequency.exponentialRampToValueAtTime(700 + Math.random() * 300, t + len * 0.5);
    filt.frequency.exponentialRampToValueAtTime(260, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.12);
    g.gain.setValueAtTime(0.8, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    for (const det of [0, 12]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.linearRampToValueAtTime(base * 0.82, t + len);
      osc.detune.value = det;
      lfoGain.connect(osc.frequency);
      osc.connect(filt);
      osc.start(t);
      osc.stop(t + len + 0.05);
    }
    filt.connect(g).connect(dest);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
  }

  zombieAttack(x: number, z: number): void {
    const dest = this.out(0.6, x, z);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 160, 70, 0.35, 0.7, 0.01);
    this.burst(dest, 0.25, 'bandpass', 900, 300, 2, 0.8, 0.01);
  }

  zombieHit(x: number, z: number): void {
    const dest = this.out(0.35, x, z);
    if (!dest) return;
    this.burst(dest, 0.12, 'lowpass', 1400, 300, 0.8, 1);
  }

  zombieDie(x: number, z: number): void {
    const dest = this.out(0.55, x, z);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 120, 35, 0.9, 0.5, 0.02, 10);
    this.burst(dest, 0.35, 'lowpass', 1200, 150, 0.8, 0.9, 0.01);
  }

  tearPlank(x: number, z: number): void {
    const dest = this.out(0.5, x, z);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 210, 80, 0.4, 0.5, 0.02);
    this.burst(dest, 0.18, 'bandpass', 1600, 400, 2.5, 0.8, 0.005);
  }

  zombieRise(x: number, z: number): void {
    const dest = this.out(0.4, x, z);
    if (!dest) return;
    this.burst(dest, 1.2, 'lowpass', 600, 120, 0.8, 0.8, 0.1);
  }

  // ------------------------------------------------------------------ melee, machines, power-ups

  meleeSwing(): void {
    const dest = this.out(0.35);
    if (!dest) return;
    this.burst(dest, 0.22, 'bandpass', 600, 2200, 1.2, 0.8, 0.03);
  }

  meleeHit(kill: boolean): void {
    const dest = this.out(kill ? 0.6 : 0.45);
    if (!dest) return;
    this.burst(dest, 0.16, 'lowpass', 1800, 300, 0.8, 1);
    this.tone(dest, 'sine', 180, 60, 0.18, 0.8);
  }

  perkDrink(): void {
    const dest = this.out(0.45);
    if (!dest) return;
    this.burst(dest, 0.35, 'bandpass', 500, 1400, 2, 0.6, 0.05);
    setTimeout(() => {
      const d2 = this.out(0.4);
      if (!d2) return;
      this.tone(d2, 'sine', 523, 523, 0.14, 0.7);
      setTimeout(() => {
        const d3 = this.out(0.4);
        if (d3) this.tone(d3, 'sine', 784, 784, 0.25, 0.7);
      }, 130);
    }, 350);
  }

  powerOn(x: number, z: number): void {
    const dest = this.out(0.8, x, z);
    if (!dest) return;
    this.tone(dest, 'square', 60, 30, 0.5, 0.6, 0.01);
    this.burst(dest, 0.5, 'lowpass', 1200, 100, 0.8, 0.8, 0.01);
    setTimeout(() => {
      const d2 = this.out(0.5);
      if (!d2) return;
      this.tone(d2, 'sawtooth', 40, 110, 2.2, 0.35, 0.3);
      this.tone(d2, 'sine', 110, 220, 2.0, 0.3, 0.3);
    }, 300);
  }

  crateOpen(x: number, z: number): void {
    const dest = this.out(0.5, x, z);
    if (!dest) return;
    this.burst(dest, 0.4, 'lowpass', 900, 200, 0.8, 0.8, 0.02);
    this.tone(dest, 'triangle', 220, 440, 0.6, 0.4, 0.05);
  }

  crateTick(x: number, z: number, pitch: number): void {
    const dest = this.out(0.25, x, z);
    if (!dest) return;
    this.tone(dest, 'square', 440 * pitch, 440 * pitch, 0.05, 0.5);
  }

  crateOffer(x: number, z: number): void {
    const dest = this.out(0.5, x, z);
    if (!dest) return;
    this.tone(dest, 'sine', 660, 660, 0.15, 0.7);
    setTimeout(() => {
      const d2 = this.out(0.5, x, z);
      if (d2) this.tone(d2, 'sine', 880, 880, 0.15, 0.7);
    }, 140);
    setTimeout(() => {
      const d3 = this.out(0.5, x, z);
      if (d3) this.tone(d3, 'sine', 1320, 1320, 0.4, 0.7);
    }, 280);
  }

  crateMove(x: number, z: number): void {
    const dest = this.out(0.55, x, z);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 300, 90, 1.2, 0.5, 0.02);
    this.tone(dest, 'square', 150, 45, 1.2, 0.3, 0.02);
  }

  upgradeStart(x: number, z: number): void {
    const dest = this.out(0.55, x, z);
    if (!dest) return;
    this.tone(dest, 'sawtooth', 55, 220, 3.2, 0.4, 0.2);
    this.burst(dest, 3.2, 'bandpass', 300, 3000, 2, 0.35, 0.3);
  }

  upgradeReady(x: number, z: number): void {
    const dest = this.out(0.6, x, z);
    if (!dest) return;
    this.tone(dest, 'sine', 440, 440, 0.2, 0.7);
    setTimeout(() => {
      const d2 = this.out(0.6, x, z);
      if (d2) this.tone(d2, 'sine', 660, 660, 0.2, 0.7);
    }, 180);
    setTimeout(() => {
      const d3 = this.out(0.6, x, z);
      if (!d3) return;
      this.tone(d3, 'sine', 880, 880, 0.6, 0.7);
      this.tone(d3, 'sine', 1320, 1320, 0.6, 0.4);
    }, 360);
  }

  powerupPickup(kind: string): void {
    const dest = this.out(0.6);
    if (!dest) return;
    if (kind === 'nuke') {
      this.burst(dest, 1.4, 'lowpass', 1500, 40, 0.8, 1, 0.005);
      this.tone(dest, 'sine', 90, 25, 1.4, 1, 0.005);
      return;
    }
    if (kind === 'instakill') {
      this.tone(dest, 'sawtooth', 220, 110, 0.9, 0.5, 0.01, 8);
      this.tone(dest, 'sawtooth', 330, 165, 0.9, 0.4, 0.01, -8);
      return;
    }
    const notes = kind === 'maxammo' ? [523, 659, 784, 1047] : kind === 'doublepoints' ? [659, 784, 988, 1319] : [392, 523, 659];
    notes.forEach((f, i) => {
      setTimeout(() => {
        const d = this.out(0.45);
        if (d) this.tone(d, 'sine', f, f, 0.22, 0.8);
      }, i * 90);
    });
  }

  powerupExpire(): void {
    const dest = this.out(0.35);
    if (!dest) return;
    this.tone(dest, 'sine', 660, 330, 0.5, 0.6, 0.02);
  }

  revive(): void {
    const dest = this.out(0.6);
    if (!dest) return;
    this.tone(dest, 'sine', 220, 880, 1.2, 0.6, 0.1);
    this.burst(dest, 0.6, 'highpass', 800, 3000, 1, 0.3, 0.2);
  }

  // ------------------------------------------------------------------ ambience

  startAmbience(): void {
    if (!this.ctx || this.ambienceStarted) return;
    this.ambienceStarted = true;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // low city drone
    for (const [f, det, vol] of [
      [48, 0, 0.05],
      [48, 9, 0.04],
      [96, -5, 0.02],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = f > 60 ? 'sawtooth' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = det;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 180;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 3);
      osc.connect(filt).connect(g).connect(this.amb);
      osc.start(t);
    }
    // rain
    const rain = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.03, t + 4);
    rain.connect(hp).connect(lp).connect(rg).connect(this.amb);
    rain.start(t);
    // wind swell
    const wind = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 1.2;
    const wg = ctx.createGain();
    wg.gain.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.015;
    lfo.connect(lg).connect(wg.gain);
    wind.connect(bp).connect(wg).connect(this.amb);
    wind.start(t);
    lfo.start(t);
  }
}
