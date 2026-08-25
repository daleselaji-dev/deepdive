/**
 * 全程序化音频（零音频文件）：环境低鸣、水噪床、呼吸气泡、心跳、
 * 无线电静噪、惊吓 sting、远古之声、破水面。节奏规则见 docs/GAME_DESIGN.md §4。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffleFilter!: BiquadFilterNode;
  private bedGain!: GainNode; // 环境床统一衰减（惊吓前静默用）
  private droneOscs: OscillatorNode[] = [];
  private noiseSrc: AudioBufferSourceNode | null = null;
  private breathTimer = 0;
  private heartTimer = 0;
  private tension = 0; // 0..1，驱动心跳
  private breathRate = 1;
  private started = false;

  get ready(): boolean {
    return this.started;
  }

  init(): void {
    if (this.started) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = 20000;
    this.muffleFilter.connect(this.master);
    this.master.connect(ctx.destination);

    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0;
    this.bedGain.connect(this.muffleFilter);

    this.buildDrone();
    this.buildWaterBed();
    // 环境床缓慢升起（首屏仪式感）
    this.bedGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
    this.started = true;
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private buildDrone(): void {
    const ctx = this.ctx!;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.14;
    droneGain.connect(this.bedGain);

    const freqs = [51, 51.7, 25.6];
    const types: OscillatorType[] = ['sine', 'sine', 'triangle'];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = types[i];
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.5 : 0.8;
      osc.connect(g);
      g.connect(droneGain);
      osc.start();
      this.droneOscs.push(osc);
    });

    // 慢 LFO 让低鸣"呼吸"
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);
    lfo.start();
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private buildWaterBed(): void {
    const ctx = this.ctx!;
    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = this.noiseBuffer(4);
    this.noiseSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    this.noiseSrc.connect(bp);
    bp.connect(g);
    g.connect(this.bedGain);
    this.noiseSrc.start();
  }

  /** 逐帧驱动：呼吸节奏、心跳、深度低通 */
  update(
    dt: number,
    state: { oxygen01: number; depth01: number; sprinting: boolean; muffle01?: number; above?: boolean },
  ): void {
    if (!this.started || !this.ctx) return;
    const { oxygen01, depth01, sprinting } = state;

    // 深度越深，高频越被水体吃掉；缺氧时叠加意识模糊低通；出水后完全打开
    const muffle = state.muffle01 ?? 0;
    const targetCut = state.above ? 20000 : Math.max(300, 16000 - depth01 * 9000 - muffle * 15000);
    this.muffleFilter.frequency.setTargetAtTime(targetCut, this.now(), 0.4);

    // 呼吸：氧少/冲刺 → 更急促
    this.breathRate = 1 + (1 - oxygen01) * 1.3 + (sprinting ? 0.8 : 0);
    this.breathTimer -= dt * this.breathRate;
    if (this.breathTimer <= 0) {
      this.breathTimer = 3.4;
      this.exhale();
    }

    // 心跳：tension 由 Game 设置（低氧/惊吓）
    if (this.tension > 0.02) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const interval = 1.15 - this.tension * 0.55;
        this.heartTimer = interval;
        this.heartbeat(0.1 + this.tension * 0.22);
      }
    }
  }

  setTension(v: number): void {
    this.tension = Math.max(0, Math.min(1, v));
  }

  /** 呼气气泡：3~6 个短促带通噪声泡 */
  private exhale(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = this.now() + i * (0.09 + Math.random() * 0.07);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(700 + Math.random() * 900, t);
      bp.frequency.exponentialRampToValueAtTime(1600 + Math.random() * 1400, t + 0.09);
      bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.bedGain);
      src.start(t);
      src.stop(t + 0.12);
    }
  }

  private heartbeat(vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const thump = (t: number, v: number) => {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(62, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.muffleFilter); // 心跳不走环境床——静默段也在
      osc.start(t);
      osc.stop(t + 0.25);
    };
    const t0 = this.now();
    thump(t0, vol);
    thump(t0 + 0.22, vol * 0.6);
  }

  /** 无线电静噪脉冲（叙事节点） */
  radioBlip(duration = 1.4): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(duration);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.035, t + 0.05);
    g.gain.setValueAtTime(0.035, t + duration - 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.muffleFilter);
    src.start(t);
    src.stop(t + duration);
  }

  /** 拾取备用气瓶：金属叩击 + 换气阀嘶声 */
  tankPickup(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.now();
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(430, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g);
    g.connect(this.muffleFilter);
    osc.start(t);
    osc.stop(t + 0.55);
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer(0.9);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.05, t + 0.1);
    hg.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    hiss.connect(hp);
    hp.connect(hg);
    hg.connect(this.muffleFilter);
    hiss.start(t + 0.1);
  }

  /** 环境床衰减（惊吓前的"静默下沉"） */
  duckBed(target: number, seconds: number): void {
    if (!this.ctx) return;
    this.bedGain.gain.cancelScheduledValues(this.now());
    this.bedGain.gain.setValueAtTime(this.bedGain.gain.value, this.now());
    this.bedGain.gain.linearRampToValueAtTime(target, this.now() + seconds);
  }

  /** 惊吓 sting：失谐锯齿簇 + 噪声爆 + 亚低频坠落 */
  sting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.now();
    [138, 141, 146.5, 277].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.9, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11 - i * 0.02, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4200, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 1.4);
      osc.connect(lp);
      lp.connect(g);
      g.connect(this.muffleFilter);
      osc.start(t);
      osc.stop(t + 1.5);
    });
    const burst = ctx.createBufferSource();
    burst.buffer = this.noiseBuffer(0.4);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.22, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    burst.connect(bg);
    bg.connect(this.muffleFilter);
    burst.start(t);
    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 1.2);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.3, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    sub.connect(sg);
    sg.connect(this.muffleFilter);
    sub.start(t);
    sub.stop(t + 1.4);
  }

  /**
   * 远古之声：亚低频鲸歌式呼唤（两声部缓慢滑音）+ 水体位移隆隆。
   * 在奇虾目击演出的关键节拍触发（docs/GAME_DESIGN.md §3.1）。
   */
  ancientCall(intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.now();
    // 两声部滑音：像从很远的地方传来的、不属于任何已知生物的呼唤
    const voices: [number, number, number][] = [
      [42, 30, 5.5],
      [63, 47, 4.6],
    ];
    for (const [f0, f1, dur] of voices) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * intensity, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      // 轻微颤音让声音"活"起来
      const vib = ctx.createOscillator();
      vib.frequency.value = 3.2;
      const vg = ctx.createGain();
      vg.gain.value = 1.6;
      vib.connect(vg);
      vg.connect(osc.frequency);
      osc.connect(g);
      g.connect(this.muffleFilter);
      osc.start(t);
      osc.stop(t + dur + 0.1);
      vib.start(t);
      vib.stop(t + dur + 0.1);
    }
    // 水体位移：低通噪声缓慢涌起再退去
    const rum = ctx.createBufferSource();
    rum.buffer = this.noiseBuffer(6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.18 * intensity, t + 2.2);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 6);
    rum.connect(lp);
    lp.connect(rg);
    rg.connect(this.muffleFilter);
    rum.start(t);
    rum.stop(t + 6.1);
  }

  /** 破水面：宽频水花 + 空气骤然打开 */
  breach(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = this.now();
    const splash = ctx.createBufferSource();
    splash.buffer = this.noiseBuffer(1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.25);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    splash.connect(bp);
    bp.connect(g);
    g.connect(this.master); // 不走水下低通
    splash.start(t);
    // 低频"离水"顿挫
    const sub = ctx.createOscillator();
    sub.frequency.setValueAtTime(90, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.2, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    sub.connect(sg);
    sg.connect(this.master);
    sub.start(t);
    sub.stop(t + 0.7);
  }

  /** 全体收束至无声（结局） */
  fadeOutAll(seconds: number): void {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.now());
    this.master.gain.setValueAtTime(this.master.gain.value, this.now());
    this.master.gain.linearRampToValueAtTime(0.0001, this.now() + seconds);
  }

  resumeMaster(): void {
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.now());
    this.master.gain.setValueAtTime(0.85, this.now());
    this.duckBed(1, 2);
  }
}
