const ROOMS = {
  study: { tail: 1.6, cutoff: 1700, tone: 400, color: 'brown' },
  salon: { tail: 1.9, cutoff: 1300, tone: 550, color: 'brown' },
  atelier: { tail: 1.4, cutoff: 4200, tone: 2000, color: 'pink' }
};
const random = (lo, hi) => lo + Math.random() * (hi - lo);
const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export class Sound {
  constructor() {
    this._ctx = null;
    this._room = 'study';
    this._muted = false;
    this._started = false;
    this._rings = [];
    this._clockPitch = false;
  }

  async unlock() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext || this.ready) return;
    try {
      if (!this._ctx) {
        this._ctx = new AudioContext();
        try { this._build(); } catch (error) {
          this._ctx.close().catch(() => {});
          this._ctx = null;
          throw error;
        }
      }
      const ctx = this._ctx;
      const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      const silent = ctx.createBufferSource();
      silent.buffer = this._silence;
      silent.connect(this._sfx);
      silent.onended = () => silent.disconnect();
      silent.start();
      await resumed;
      if (ctx.state !== 'running' || this._started) return;
      this._started = true;
      for (const room of Object.values(this._rooms)) room.loop.start();
      this.setRoom(this._room);
      this._schedule();
      this._timer = setInterval(() => this._schedule(), 100);
    } catch {
      // A denied resume can be retried on the next user gesture.
    }
  }

  // Tab hidden / shown: stop the room tone instead of humming in the background.
  suspend() { if (this._ctx?.state === 'running') this._ctx.suspend().catch(() => {}); }
  resume() { if (this._ctx && this._started && this._ctx.state === 'suspended') this._ctx.resume().catch(() => {}); }

  get ready() { return this._started && this._ctx?.state === 'running'; }
  get muted() { return this._muted; }

  setMuted(value) {
    this._muted = Boolean(value);
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    this._hold(this._master.gain, now);
    this._master.gain.linearRampToValueAtTime(this._muted ? 0 : 0.7, now + 0.12);
  }

  setRoom(name) {
    if (!Object.hasOwn(ROOMS, name)) return;
    const changed = name !== this._room;
    this._room = name;
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    for (const [key, room] of Object.entries(this._rooms)) {
      this._hold(room.gain.gain, now);
      room.gain.gain.linearRampToValueAtTime(key === name ? 1 : 0, now + 1.5);
    }
    if (changed || this._nextClock === undefined) {
      this._nextClock = now + 0.3;
      this._nextCrackle = now + random(0.5, 2.5);
      this._nextBird = now + random(4, 9);
    }
  }

  _hold(param, time) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(time);
    else {
      const value = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(value, time);
    }
  }

  _build() {
    const ctx = this._ctx;
    this._sfx = ctx.createGain();
    this._ambience = ctx.createGain();
    this._air = ctx.createBiquadFilter();
    this._air.type = 'lowpass';
    this._air.frequency.value = 18000;
    this._air.Q.value = 0.5;
    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0 : 0.7;
    this._limiter = ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -6;
    this._limiter.knee.value = 2;
    this._limiter.ratio.value = 20;
    this._limiter.attack.value = 0.001;
    this._limiter.release.value = 0.12;
    this._sfx.connect(this._master);
    this._ambience.connect(this._air).connect(this._master);
    this._master.connect(this._limiter).connect(ctx.destination);
    this._buffers = {};
    for (const color of ['white', 'pink', 'brown']) {
      this._buffers[color] = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    }
    const white = this._buffers.white.getChannelData(0);
    const pink = this._buffers.pink.getChannelData(0);
    const brown = this._buffers.brown.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, drift = 0;
    for (let i = 0; i < white.length; i++) {
      const n = random(-1, 1);
      white[i] = n;
      b0 = 0.99765 * b0 + n * 0.099046;
      b1 = 0.963 * b1 + n * 0.2965164;
      b2 = 0.57 * b2 + n * 1.0526913;
      pink[i] = (b0 + b1 + b2 + n * 0.1848) * 0.18;
      drift = (drift + n * 0.02) / 1.02;
      brown[i] = drift * 3.5;
    }
    for (const data of [pink, brown]) {
      // Smooth the loop seam without a periodic gap in the room tone.
      const seam = data[data.length - 1] - data[0];
      for (let i = 0; i < 512; i++) data[data.length - 512 + i] -= seam * i / 511;
    }
    this._silence = ctx.createBuffer(1, 1, ctx.sampleRate);
    this._saturation = Float32Array.from({ length: 1024 }, (_, i) =>
      Math.tanh(1.4 * (2 * i / 1023 - 1)) / Math.tanh(1.4));
    this._rooms = {};
    for (const [name, spec] of Object.entries(ROOMS)) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this._ambience);
      const loop = ctx.createBufferSource();
      loop.buffer = this._buffers[spec.color];
      loop.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.tone;
      filter.Q.value = 0.5;
      const level = ctx.createGain();
      level.gain.value = name === 'atelier' ? 0.045 : 0.06;
      loop.connect(filter).connect(level).connect(gain);
      const reverb = ctx.createConvolver();
      reverb.buffer = this._impulse(name, spec);
      const wet = ctx.createGain();
      wet.gain.value = 0.38;
      reverb.connect(wet).connect(this._sfx);
      this._rooms[name] = { gain, loop, reverb };
    }
  }

  _impulse(name, spec) {
    const ctx = this._ctx;
    const buffer = ctx.createBuffer(2, Math.ceil(spec.tail * ctx.sampleRate), ctx.sampleRate);
    const alpha = 1 - Math.exp(-2 * Math.PI * spec.cutoff / ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        low += alpha * (random(-1, 1) - low);
        const t = i / ctx.sampleRate;
        data[i] = low * Math.exp(-7 * t / spec.tail) * Math.min(1, t / 0.008);
      }
      if (name === 'atelier') {
        const start = Math.round((0.025 + channel * 0.001) * ctx.sampleRate);
        for (let j = 0; j < ctx.sampleRate * 0.004; j++) {
          data[start + j] += random(-0.6, 0.6) * Math.exp(-j / (ctx.sampleRate * 0.001));
        }
      }
    }
    return buffer;
  }

  _envelope(gain, time, duration, level, attack = 0.001) {
    gain.setValueAtTime(0, time);
    gain.linearRampToValueAtTime(Math.max(0.0001, level), time + attack);
    gain.exponentialRampToValueAtTime(0.0001, time + duration - 0.002);
    gain.linearRampToValueAtTime(0, time + duration);
  }

  _noise(time, duration, level, frequency, options = {}) {
    const ctx = this._ctx;
    const source = ctx.createBufferSource();
    source.buffer = this._buffers[options.color || 'white'];
    source.playbackRate.value = options.rate || 1;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type || 'bandpass';
    filter.Q.value = options.q || 0.7;
    filter.frequency.setValueAtTime(frequency, time);
    if (options.end) filter.frequency.exponentialRampToValueAtTime(options.end, time + duration);
    const gain = ctx.createGain();
    this._envelope(gain.gain, time, duration, level, options.attack);
    source.connect(filter).connect(gain).connect(options.dest || this._sfx);
    if (options.wet) gain.connect(options.wet);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(time, random(0, 2));
    source.stop(time + duration);
    return source;
  }

  _tone(time, duration, level, frequency, end = frequency, options = {}) {
    const ctx = this._ctx;
    const source = ctx.createOscillator();
    source.type = options.type || 'sine';
    source.frequency.setValueAtTime(frequency, time);
    source.frequency.exponentialRampToValueAtTime(end, time + duration);
    const gain = ctx.createGain();
    this._envelope(gain.gain, time, duration, level, options.attack);
    const nodes = [source, gain];
    if (options.saturate) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this._saturation;
      shaper.oversample = '2x';
      source.connect(shaper).connect(gain);
      nodes.push(shaper);
    } else source.connect(gain);
    if (options.fm) {
      const mod = ctx.createOscillator();
      const depth = ctx.createGain();
      mod.frequency.value = 32;
      depth.gain.value = 85;
      mod.connect(depth).connect(source.frequency);
      mod.start(time);
      mod.stop(time + duration);
      nodes.push(mod, depth);
    }
    gain.connect(options.dest || this._sfx);
    if (options.wet) gain.connect(options.wet);
    source.onended = () => nodes.forEach(node => node.disconnect());
    source.start(time);
    source.stop(time + duration);
    return { source, gain };
  }

  click(intensity = 1) {
    if (!this.ready || !(intensity = unit(intensity))) return;
    this._noise(this._ctx.currentTime, 0.024, intensity * random(0.13, 0.18),
      (1800 + intensity * 6200) * random(0.96, 1.04), { rate: random(0.88, 1.12), q: 1.4 });
  }

  cylinderOpen() {
    if (!this.ready) return;
    const t = this._ctx.currentTime;
    this._noise(t, 0.21, 0.16, 2300, { end: 800, attack: 0.012 });
    this._noise(t + 0.19, 0.06, 0.26, 3200, { q: 1.6 });
  }

  cylinderClose() {
    if (!this.ready) return;
    const t = this._ctx.currentTime;
    this._noise(t, 0.08, 0.42, 3400, { q: 1.3 });
    this._tone(t, 0.2, 0.24, 150, 65);
  }

  hammerCock() {
    if (!this.ready) return;
    const t = this._ctx.currentTime;
    this._noise(t, 0.035, 0.2, 3800, { q: 1.7 });
    this._noise(t + 0.09, 0.065, 0.34, 2700, { q: 1.9 });
  }

  dryFire() {
    if (this.ready) this._noise(this._ctx.currentTime, 0.032, 0.38, 4800, { q: 1.2 });
  }

  // A bass-free crack: a hard broadband transient, a short mid-range body, then the room's tail. No sub boom.
  shot({ ring = true, pitch = 1 } = {}) {
    if (!this.ready) return;
    const t = this._ctx.currentTime;
    const wet = this._rooms[this._room].reverb;
    this._noise(t, 0.005, 1.1, 12000 * pitch, { type: 'highpass', attack: 0.0002, wet });
    this._noise(t + 0.001, 0.045, 0.85, 2600 * pitch, { q: 0.8, end: 1400, attack: 0.0004, wet });
    this._noise(t + 0.004, 0.16, 0.4, 5200 * pitch, { type: 'lowpass', end: 900, wet });
    if (!ring) return;
    this._hold(this._ambience.gain, t);
    this._ambience.gain.linearRampToValueAtTime(0.025, t + 0.012);
    this._ambience.gain.setTargetAtTime(1, t + 0.16, 0.85);
    this._ambience.gain.setValueAtTime(1, t + 3);
    this._hold(this._air.frequency, t);
    this._air.frequency.linearRampToValueAtTime(300, t + 0.012);
    this._air.frequency.exponentialRampToValueAtTime(18000, t + 3);
    // Fade the previous ring so rapid shots cannot stack piercing tones.
    for (const ring of this._rings) {
      this._hold(ring.gain.gain, t);
      ring.gain.gain.linearRampToValueAtTime(0, t + 0.02);
      ring.source.stop(t + 0.02);
    }
    this._rings = [
      this._tone(t + 0.015, 2.8, 0.063, random(4150, 4250), 4180, { attack: 0.015 }),
      this._tone(t + 0.015, 2.6, 0.02, 6000, 5950, { attack: 0.02 })
    ];
  }

  paperHit(delay = 0) {
    if (!this.ready) return;
    const t = this._ctx.currentTime + (Number.isFinite(delay) ? Math.max(0, delay) : 0);
    this._noise(t, 0.04, 0.2, 2100, { type: 'highpass' });
    for (let i = 0; i < 3; i++) {
      this._noise(t + 0.025 + i * 0.05, 0.09, 0.075 / (i + 1), 1600,
        { color: 'pink', end: 650, attack: 0.009 });
    }
  }

  whoosh(strength = 1) {
    if (!this.ready || !(strength = unit(strength))) return;
    this._noise(this._ctx.currentTime, 0.3 + strength * 0.2, strength * 0.3,
      700 + strength * 2000, { end: 250, attack: 0.07, q: 0.6 });
  }

  catchGun() {
    if (!this.ready) return;
    const t = this._ctx.currentTime;
    this._noise(t, 0.12, 0.3, 700, { type: 'lowpass' });
    this._noise(t + 0.025, 0.035, 0.065, 3700, { q: 1.6 });
  }

  uiTick() {
    if (this.ready) this._tone(this._ctx.currentTime, 0.025, 0.045, 1150, 850);
  }

  _schedule() {
    if (!this.ready) return;
    const now = this._ctx.currentTime;
    const horizon = now + 0.15;
    const dest = this._rooms[this._room].gain;
    if (this._room === 'study') {
      if (this._nextClock < now) this._nextClock = now + 0.01;
      if (this._nextClock < horizon) {
        this._clockPitch = !this._clockPitch;
        const pitch = this._clockPitch ? 620 : 690;
        this._tone(this._nextClock, 0.055, 0.022, pitch, pitch * 0.75, { dest });
        this._noise(this._nextClock, 0.025, 0.016, 1100, { dest, type: 'lowpass' });
        this._nextClock += 1;
      }
    }
    if (this._room === 'atelier') {
      if (this._nextBird < now) this._nextBird = now + random(4, 9);
      if (this._nextBird < horizon) {
        this._tone(this._nextBird, 0.18, 0.012, random(2100, 2600), 3400,
          { dest, fm: true, attack: 0.015 });
        this._tone(this._nextBird + 0.21, 0.13, 0.008, 3100, 2400,
          { dest, fm: true, attack: 0.01 });
        this._nextBird += random(4, 9);
      }
    } else {
      if (this._nextCrackle < now) this._nextCrackle = now + random(0.2, 1);
      if (this._nextCrackle < horizon) {
        this._noise(this._nextCrackle, random(0.015, 0.045),
          this._room === 'study' ? 0.012 : 0.022, random(900, 3000), { dest });
        this._nextCrackle += random(0.7, 3.5);
      }
    }
  }
}
