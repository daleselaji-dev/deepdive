/**
 * 全程序化音频引擎（WebAudio，零采样资产）。
 * drone / 水声 / 呼吸循环 / 心跳 / 金属敲击 / 叩击 / 耳鸣 / 惊吓 stinger /
 * 气瓶泄漏 / 无线电杂音 / 红房间 pad / 洞穴卷积混响（脉冲响应亦为程序生成）。
 */
import { clampNum } from './util';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private lowpass!: BiquadFilterNode;
  private reverbSend!: GainNode;

  private droneGain!: GainNode;
  private eerieGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private padNodes: AudioNode[] = [];
  private tapeGain: GainNode | null = null;

  private tension = 0;
  private tensionTarget = 0;
  private heartScale = 1;
  private heartExtra = 0;
  private nextBreathAt = 0;
  private nextBeatAt = 0;
  private nextHissBlipAt = 0;
  private breathEnabled = false;

  /** 呼气时回调（用于生成气泡视觉）。 */
  onExhale: ((strength: number) => void) | null = null;

  get ready() { return this.ctx !== null; }
  get now() { return this.ctx?.currentTime ?? 0; }

  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }

  /** 必须在用户手势中调用。 */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 19000;
    this.bus = ctx.createGain();

    this.bus.connect(this.lowpass);
    this.lowpass.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // 程序化洞穴混响：指数衰减噪声脉冲响应
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.5;
    this.reverbSend.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(this.bus);

    this.buildDrone();
    this.buildWater();
    this.nextBreathAt = ctx.currentTime + 1.5;
    this.nextBeatAt = ctx.currentTime + 0.5;
  }

  // ---------- 常驻声层 ----------

  private buildDrone() {
    const ctx = this.ctx!;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.bus);

    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 36;
    const g1 = ctx.createGain();
    g1.gain.value = 0.5;
    o1.connect(g1); g1.connect(this.droneGain);

    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = 54.3;
    const g2 = ctx.createGain();
    g2.gain.value = 0.34;
    o2.connect(g2); g2.connect(this.droneGain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 9;
    lfo.connect(lfoAmp); lfoAmp.connect(o2.detune);

    const noise = this.noiseSource('brown', 6);
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 210;
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    noise.connect(nf); nf.connect(ng); ng.connect(this.droneGain);

    o1.start(); o2.start(); lfo.start(); noise.start();
  }

  private buildWater() {
    const ctx = this.ctx!;
    const noise = this.noiseSource('white', 4);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.016;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmp = ctx.createGain();
    lfoAmp.gain.value = 0.008;
    lfo.connect(lfoAmp); lfoAmp.connect(g.gain);
    noise.connect(bp); bp.connect(g); g.connect(this.bus);
    noise.start(); lfo.start();
  }

  // ---------- 参数控制 ----------

  setDrone(level: number, t = 1.2) {
    if (!this.ctx) return;
    this.droneGain.gain.setTargetAtTime(clampNum(level, 0, 1) * 0.4, this.now, t);
  }

  setTension(x: number) { this.tensionTarget = clampNum(x, 0, 1); }

  /** 心跳速率倍数（缺氧时减慢）与额外音量。 */
  setHeart(scale: number, extraVol = 0) {
    this.heartScale = scale;
    this.heartExtra = extraVol;
  }

  setBreathing(on: boolean) { this.breathEnabled = on; }

  /** 0=清晰, 1=完全闷化（缺氧）。 */
  setMuffle(x: number) {
    if (!this.ctx) return;
    const f = 19000 * Math.pow(280 / 19000, clampNum(x, 0, 1));
    this.lowpass.frequency.setTargetAtTime(f, this.now, 0.35);
  }

  update(_dt: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tension += (this.tensionTarget - this.tension) * 0.02;

    if (this.breathEnabled && t >= this.nextBreathAt) {
      const period = 4.6 - 2.7 * this.tension;
      this.scheduleBreath(t, period);
      this.nextBreathAt = t + period;
    }
    if (this.tension > 0.06 || this.heartExtra > 0) {
      if (t >= this.nextBeatAt) {
        const interval = (1.15 - 0.7 * this.tension) / Math.max(0.25, this.heartScale);
        const vol = Math.pow(this.tension, 1.25) * 0.5 + this.heartExtra;
        this.thump(t, Math.min(0.75, vol));
        this.nextBeatAt = t + interval;
      }
    } else {
      this.nextBeatAt = t + 0.25;
    }
    if (this.hissGain && t >= this.nextHissBlipAt) {
      this.bubbleBlip(t, 0.06 + Math.random() * 0.05);
      this.nextHissBlipAt = t + 0.05 + Math.random() * 0.11;
    }
  }

  // ---------- 事件音效 ----------

  /** 远处金属敲击（洞穴混响）。 */
  clank(volume = 0.5, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const f = 170 + Math.random() * 90;
    const partials = [1, 2.76, 5.4, 8.93, 11.34];
    for (let i = 0; i < partials.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * partials[i];
      const g = ctx.createGain();
      const amp = (volume * 0.22) / (i + 1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5 + Math.random() * 0.5);
      o.connect(g);
      g.connect(this.reverbSend);
      const dry = ctx.createGain();
      dry.gain.value = 0.25;
      g.connect(dry); dry.connect(this.bus);
      o.start(t0); o.stop(t0 + 1.4);
    }
  }

  /** 沉闷的叩击 ×n（惊吓铺垫）。 */
  knock(n = 2, volume = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * 0.62;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(96, t0);
      o.frequency.exponentialRampToValueAtTime(52, t0 + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g); g.connect(this.reverbSend);
      const dry = ctx.createGain();
      dry.gain.value = 0.5;
      g.connect(dry); dry.connect(this.bus);
      o.start(t0); o.stop(t0 + 0.5);
    }
  }

  /** 高频耳鸣（异象）。 */
  eerie(on: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.eerieGain) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.012, this.now, 2.5);
      for (const f of [1172, 1179.3]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(g);
        o.start();
      }
      g.connect(this.bus);
      this.eerieGain = g;
    } else if (!on && this.eerieGain) {
      this.eerieGain.gain.setTargetAtTime(0, this.now, 1.2);
      const g = this.eerieGain;
      this.eerieGain = null;
      setTimeout(() => g.disconnect(), 5000);
    }
  }

  /** 惊吓 stinger：失谐锯齿簇下滑 + 噪声爆发 + 次低频下坠。 */
  stinger() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const shaper = ctx.createWaveShaper();
    shaper.curve = this.tanhCurve(3.2);
    const sg = ctx.createGain();
    sg.gain.value = 0.5;
    shaper.connect(sg);
    sg.connect(this.bus);
    const sw = ctx.createGain();
    sw.gain.value = 0.6;
    sg.connect(sw); sw.connect(this.reverbSend);

    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 320 + Math.random() * 830;
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.38, t0 + 1.4);
      o.detune.value = (Math.random() - 0.5) * 40;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      o.connect(g); g.connect(shaper);
      o.start(t0); o.stop(t0 + 1.7);
    }
    // 噪声爆发
    const nb = this.noiseSource('white', 1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    nb.connect(hp); hp.connect(ng); ng.connect(this.bus);
    nb.start(t0); nb.stop(t0 + 0.5);
    // 次低频下坠
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, t0);
    sub.frequency.exponentialRampToValueAtTime(27, t0 + 1.2);
    const sg2 = ctx.createGain();
    sg2.gain.setValueAtTime(0.0001, t0);
    sg2.gain.exponentialRampToValueAtTime(0.6, t0 + 0.02);
    sg2.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    sub.connect(sg2); sg2.connect(this.bus);
    sub.start(t0); sub.stop(t0 + 1.8);
  }

  /** 气瓶泄漏嘶声（含持续气泡）。 */
  setHiss(on: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.hissGain) {
      const noise = this.noiseSource('white', 4);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3400;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.085, this.now, 0.4);
      noise.connect(bp); bp.connect(g); g.connect(this.bus);
      noise.start();
      this.hissGain = g;
      this.nextHissBlipAt = ctx.currentTime;
    } else if (!on && this.hissGain) {
      this.hissGain.gain.setTargetAtTime(0, this.now, 0.8);
      const g = this.hissGain;
      this.hissGain = null;
      setTimeout(() => g.disconnect(), 4000);
    }
  }

  /** 无线电杂音。 */
  radioCrackle(dur = 1.6) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const n = Math.floor(dur / 0.07);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.4) continue;
      const t = t0 + i * 0.07 + Math.random() * 0.03;
      const src = this.noiseSource('white', 0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400 + Math.random() * 2000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.12, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp); hp.connect(g); g.connect(this.bus);
      src.start(t); src.stop(t + 0.06);
    }
  }

  /** 深海生物现身前的声浪 swell。 */
  swell(dur = 4) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const noise = this.noiseSource('white', dur + 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(240, t0);
    bp.frequency.exponentialRampToValueAtTime(2100, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.4);
    noise.connect(bp); bp.connect(g); g.connect(this.reverbSend);
    noise.start(t0); noise.stop(t0 + dur + 0.5);
  }

  /** 红房间 pad（小调和弦 + 颤音 + 磁带漂移）。 */
  padOn() {
    if (!this.ctx || this.padNodes.length) return;
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.setTargetAtTime(0.16, this.now, 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1350;
    master.connect(lp); lp.connect(this.bus);
    const trem = ctx.createGain();
    trem.gain.value = 1;
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 0.9;
    const tremAmp = ctx.createGain();
    tremAmp.gain.value = 0.3;
    tremLfo.connect(tremAmp); tremAmp.connect(trem.gain);
    trem.connect(master);
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.13;
    const driftAmp = ctx.createGain();
    driftAmp.gain.value = 7;
    drift.connect(driftAmp);
    const freqs = [73.42, 110.0, 146.83, 220.0, 293.66];
    const amps = [0.32, 0.26, 0.22, 0.13, 0.07];
    for (let i = 0; i < freqs.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freqs[i];
      driftAmp.connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = amps[i];
      o.connect(g); g.connect(trem);
      o.start();
      this.padNodes.push(o);
    }
    tremLfo.start(); drift.start();
    this.padNodes.push(master, trem, tremLfo, drift, lp);
    // master 存在第一个位置便于淡出
    this.padNodes.unshift(master);
  }

  padOff() {
    if (!this.ctx || !this.padNodes.length) return;
    const master = this.padNodes[0] as GainNode;
    master.gain.setTargetAtTime(0, this.now, 1.5);
    const nodes = this.padNodes;
    this.padNodes = [];
    setTimeout(() => nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } }), 6000);
  }

  /** 磁带底噪（介绍卡）。 */
  setTape(on: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.tapeGain) {
      const noise = this.noiseSource('brown', 4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.05, this.now, 1.5);
      noise.connect(lp); lp.connect(g); g.connect(this.bus);
      noise.start();
      this.tapeGain = g;
    } else if (!on && this.tapeGain) {
      this.tapeGain.gain.setTargetAtTime(0, this.now, 0.8);
      const g = this.tapeGain;
      this.tapeGain = null;
      setTimeout(() => g.disconnect(), 4000);
    }
  }

  uiClick() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(330, t0 + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    o.connect(g); g.connect(this.bus);
    o.start(t0); o.stop(t0 + 0.12);
  }

  /** 手电开关/闪烁的电流咔嗒。 */
  tick(volume = 0.08) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = this.noiseSource('white', 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    src.connect(hp); hp.connect(g); g.connect(this.bus);
    src.start(t0); src.stop(t0 + 0.035);
  }

  // ---------- 内部 ----------

  private scheduleBreath(t0: number, period: number) {
    const ctx = this.ctx!;
    // 吸气：带通噪声下扫
    const inh = this.noiseSource('white', 1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(760, t0);
    bp.frequency.exponentialRampToValueAtTime(270, t0 + 0.95);
    const g = ctx.createGain();
    const vol = 0.028 + this.tension * 0.05;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    inh.connect(bp); bp.connect(g); g.connect(this.bus);
    inh.start(t0); inh.stop(t0 + 1.1);

    // 呼气：气泡簇
    const tEx = t0 + period * 0.45;
    const nBub = 5 + Math.floor(Math.random() * 8);
    for (let i = 0; i < nBub; i++) {
      this.bubbleBlip(tEx + Math.random() * 0.7, 0.02 + Math.random() * 0.035);
    }
    const strength = this.tension;
    const delayMs = Math.max(0, (tEx - ctx.currentTime) * 1000);
    setTimeout(() => this.onExhale?.(strength), delayMs);
  }

  private bubbleBlip(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f = 380 + Math.random() * 560;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055 + Math.random() * 0.05);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + 0.13);
  }

  private thump(t0: number, vol: number) {
    if (vol < 0.005) return;
    const ctx = this.ctx!;
    const beat = (t: number, v: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(58, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(this.bus);
      o.start(t); o.stop(t + 0.3);
    };
    beat(t0, vol);
    beat(t0 + 0.17, vol * 0.55);
  }

  private noiseSource(type: 'white' | 'brown', seconds: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (type === 'white') {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } else {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = seconds > 0.5;
    return src;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      // 稀疏早期反射增强"洞穴"感
      for (let r = 0; r < 8; r++) {
        const at = Math.floor((0.02 + Math.random() * 0.12) * ctx.sampleRate);
        if (at < len) data[at] += (Math.random() * 2 - 1) * 0.5;
      }
    }
    return buf;
  }

  private tanhCurve(k: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x);
    }
    return curve;
  }
}
