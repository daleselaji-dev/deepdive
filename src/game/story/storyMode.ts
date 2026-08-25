/**
 * 故事模式《蓝井》：
 * 六自由度洞潜控制、氧气、线绳导航、脚本化叙事节拍、
 * 铺垫后的惊吓序列、缺氧收束（深海生物）、红房间尾声。
 */
import * as THREE from 'three';
import type { GameContext, GameMode } from '../modes';
import { CaveSystem, GALLERY_T0, GALLERY_T1, type Interactable } from './cave';
import { FishSchool, PolypField } from './fauna';
import { Creature } from './creature';
import { RedRoom } from './redroom';
import {
  BEATS, CREATURE_LINES, REDROOM_DIALOGUE, REDROOM_FINAL, CREDITS_LINES,
  type ScriptCtx,
} from './script';
import { Silt, BubblePool } from '../../render/particles';
import { makeLightCone, makeGlowSprite, tickCone } from '../../render/volumetric';
import { clamp, damp, lerp } from '../../core/noise';

type Phase = 'explore' | 'scare' | 'hypoxia' | 'whiteout' | 'redroom' | 'done';

const MAX_O2 = 3100;
const SCARE_O2 = 1400;
const LOOK_SENS = 0.0021;

export class StoryMode implements GameMode {
  readonly id = 'story';
  scene: THREE.Scene;

  private ctx!: GameContext;
  private cave!: CaveSystem;
  private creature!: Creature;
  private redroom: RedRoom | null = null;
  private silt!: Silt;
  private bubbles!: BubblePool;
  private fishMain!: FishSchool;
  private fishEntry!: FishSchool;
  private polyps!: PolypField;
  private rippleCooldown = 0;
  private o2Bonus = 0;

  private phase: Phase = 'explore';
  private idle = true;
  private time = 0;
  private seqT = 0;
  private seqStep = 0;

  // 玩家
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = Math.PI; private pitch = 0; private roll = 0;
  private sampleIdx = 8;
  private progressT = 0;
  private bobPhase = 0;
  private shake = 0;
  private o2 = MAX_O2;
  private exertion = 0;
  private speedFactor = 1;

  // 灯
  private lampOn = true;
  private lampLocked = false;
  private lampForcedOff = false;
  private lampDim = 1;
  private flickerLeft = 0;
  private lampEffective = 1;
  private battery = 1;
  private battWarned = 0;
  private spotBase = 50;
  private fillBase = 2.5;
  private spot!: THREE.SpotLight;
  private fill!: THREE.PointLight;
  private cone: THREE.Mesh | null = null;
  private lampRig!: THREE.Group;

  // 环境
  private ambientLight!: THREE.AmbientLight;
  private fogTargetDensity = 0.035;
  private fogTargetColor = new THREE.Color(0x0b3540);
  private ambientTarget = 0.4;
  private ambientCur = 0.4;

  // 叙事
  private beatIdx = 0;
  private guideSprite: THREE.Sprite | null = null;
  private guideLightPt: THREE.PointLight | null = null;
  private guideAlive = false;
  private hissOn = false;
  private hissBubbleT = 0;
  private aweSpawned = false;
  private creatureLineIdx = 0;
  private creatureLineT = 0;
  private whiteout = 0;
  private blackHold = 0;
  private dlgIdx = 0;
  private finalT = -1;
  private endFired = new Set<number>();

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor() {
    this.scene = new THREE.Scene();
  }

  init(ctx: GameContext) {
    this.ctx = ctx;
    const q = ctx.quality;

    this.scene.fog = new THREE.FogExp2(0x0b3540, 0.035);
    this.scene.background = (this.scene.fog as THREE.FogExp2).color;

    this.cave = new CaveSystem(q);
    this.scene.add(this.cave.group);

    this.ambientLight = new THREE.AmbientLight(0x2b4a52, 0.4);
    this.scene.add(this.ambientLight);

    // 手电装备（跟随相机）
    this.lampRig = new THREE.Group();
    this.spot = new THREE.SpotLight(0xfff0d6, this.spotBase, 38, 0.5, 0.68, 1.4);
    this.spot.position.set(0.22, -0.16, 0);
    this.spot.target.position.set(0, 0, -12);
    this.lampRig.add(this.spot, this.spot.target);
    this.fill = new THREE.PointLight(0xa8c8d2, 2.4, 8, 1.7);
    this.lampRig.add(this.fill);
    if (q.volumetric) {
      this.cone = makeLightCone({ length: 13, radius: 3.4, color: 0xcfe6dd, intensity: 0.085 });
      this.cone.position.set(0.22, -0.16, -0.1);
      this.lampRig.add(this.cone);
    }
    this.scene.add(this.lampRig);

    this.silt = new Silt(2600);
    this.silt.points.geometry.setDrawRange(0, q.siltCount);
    this.scene.add(this.silt.points);
    this.bubbles = new BubblePool(180);
    this.scene.add(this.bubbles.points);

    this.creature = new Creature();
    this.scene.add(this.creature.group);

    // 奇观 1：钟厅天光下的鱼群漩涡 + 入口小鱼群
    const orbit = this.cave.shaftFloor.clone();
    orbit.y += 2.6;
    this.fishMain = new FishSchool(orbit, q.fishCount, 2.8, 4.2);
    this.scene.add(this.fishMain.mesh);
    const entryC = this.cave.sampleAtT(0.055).pos.clone();
    entryC.y += 0.8;
    this.fishEntry = new FishSchool(entryC, Math.max(8, Math.floor(q.fishCount * 0.35)), 1.7, 2);
    this.scene.add(this.fishEntry.mesh);

    // 奇观 2：发光廊道水螅体点阵（成簇分布）
    const polypPos: THREE.Vector3[] = [];
    const clusters = 20;
    for (let c = 0; c < clusters; c++) {
      const ct = GALLERY_T0 + (GALLERY_T1 - GALLERY_T0) * ((c + Math.random() * 0.8) / clusters);
      const ca = Math.random() * Math.PI * 2;
      const per = Math.floor(q.polypCount / clusters);
      for (let i = 0; i < per; i++) {
        const t = ct + (Math.random() - 0.5) * 0.012;
        const a = ca + (Math.random() - 0.5) * 1.6;
        polypPos.push(this.cave.wallPoint(t, a, 0.93 + Math.random() * 0.05));
      }
    }
    this.polyps = new PolypField(polypPos);
    this.scene.add(this.polyps.points);

    // 假指引灯
    this.guideSprite = makeGlowSprite(0xd8e8b8, 2.6, 0);
    const gp = this.cave.sampleAtT(0.765).pos;
    this.guideSprite.position.copy(gp);
    this.guideLightPt = new THREE.PointLight(0xc8e0a0, 0, 16, 1.6);
    this.guideLightPt.position.copy(gp);
    this.scene.add(this.guideSprite, this.guideLightPt);

    ctx.audio.onExhale = (strength) => {
      if (this.idle || this.phase === 'redroom' || this.phase === 'done') return;
      const origin = this.tmpV.copy(this.pos);
      origin.y -= 0.15;
      this.bubbles.burst(origin, 5 + Math.floor(strength * 8), 0.3);
    };

    this.resetPlayer();
  }

  resetPlayer() {
    this.pos.copy(this.cave.spawnPos);
    this.vel.set(0, 0, 0);
    // 入水第一眼：仰望水面与下泻光柱（首屏奇观），转身向下即是黑暗的隧道
    this.yaw = Math.PI;
    this.pitch = 1.28;
    this.sampleIdx = 8;
    this.o2 = MAX_O2;
    this.battery = 1;
    this.battWarned = 0;
    this.o2Bonus = 0;
  }

  // ---------- 调试钩子（?debug=1 时由 game.ts 暴露到 window.__dd） ----------

  debugTeleport(t: number) {
    const s = this.cave.sampleAtT(t);
    this.pos.copy(s.pos);
    this.sampleIdx = Math.round(t * (this.cave.samples.length - 1));
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-s.tangent.x, -s.tangent.z);
    this.pitch = clamp(Math.asin(clamp(s.tangent.y, -1, 1)), -1.4, 1.4);
    this.updateProgress();
    this.applyCamera();
  }

  debugFace() {
    this.creature.poseScare(this.ctx.camera);
    this.ctx.post.uniforms.uFlash.value = 0.22;
    this.lampOn = true;
    this.lampForcedOff = false;
    this.lampDim = 1;
  }

  debugAwe() {
    const ahead = this.cave.sampleAtT(Math.min(0.985, this.progressT + 0.05));
    const p = ahead.pos.clone().addScaledVector(ahead.down, -ahead.radius * 0.15);
    this.creature.poseAwe(p, this.pos);
    this.fogTargetDensity = 0.045;
    this.fogTargetColor.set(0x04222e);
    this.ambientTarget = 0.1;
  }

  debugRedRoom() {
    this.enterRedRoom();
    this.ctx.post.uniforms.uFade.value = 0;
    this.ctx.hud.setGaugesVisible(false);
  }

  debugScare() { this.beginScare(); }

  debugPulse() {
    this.polyps.triggerPulse(this.pos, this.time, true);
  }

  debugLamp(on: boolean) {
    this.lampOn = on;
  }

  /** 运行时可热切换的画质项（粒子数 / 体积光 / 后处理由 PostFX 处理）。 */
  applyQuality(q: import('../../core/quality').QualitySettings) {
    this.silt.points.geometry.setDrawRange(0, q.siltCount);
    if (this.cone) this.cone.visible = q.volumetric;
  }

  /** 菜单闲置镜头。 */
  setIdle(v: boolean) {
    this.idle = v;
    if (v) {
      this.ambientTarget = 0.5;
    }
  }

  beginPlay() {
    this.idle = false;
    this.phase = 'explore';
    this.ctx.hud.setNoteTotal(this.cave.interactables.length);
    this.ctx.hud.resetNotes();
    this.ctx.audio.setBreathing(true);
    this.ctx.audio.setDrone(0.25);
  }

  get currentScene(): THREE.Scene {
    return this.phase === 'redroom' || this.phase === 'done'
      ? this.redroom!.scene : this.scene;
  }

  get finished() { return this.phase === 'done'; }

  // ---------- 脚本上下文 ----------

  private scriptCtx: ScriptCtx = {
    sub: (t, d = 5, s) => this.ctx.hud.subtitle(t, d, s === 'creature' ? 'creature' : s === 'mono' ? 'mono' : ''),
    obj: (t) => this.ctx.hud.objective(t),
    fog: (d, c) => { this.fogTargetDensity = d; this.fogTargetColor.set(c); },
    drone: (x) => this.ctx.audio.setDrone(x),
    tension: (x) => this.ctx.audio.setTension(x),
    ambient: (x) => { this.ambientTarget = x; },
    clank: (v = 0.5, d = 0) => this.ctx.audio.clank(v, d),
    radio: () => this.ctx.audio.radioCrackle(2),
    eerie: (on) => this.ctx.audio.eerie(on),
    flicker: (dur) => { this.flickerLeft = dur; },
    guideLight: (on) => { this.guideAlive = on; },
    beginScare: () => this.beginScare(),
    swell: (dur = 4) => this.ctx.audio.swell(dur),
  };

  // ---------- 主更新 ----------

  update(dt: number) {
    this.time += this.idle ? dt * 0.35 : dt;
    const t = this.time;

    this.cave.update(t, this.lampEffective);
    this.creature.update(dt, t);
    this.bubbles.update(dt, t);
    if (this.cone) tickCone(this.cone, t);
    if (this.phase !== 'redroom' && this.phase !== 'done') {
      const pp = this.idle ? this.ctx.camera.position : this.pos;
      this.fishMain.update(dt, t, pp);
      this.fishEntry.update(dt, t, pp);
      this.polyps.update(t, this.lampEffective);
    }

    if (this.idle) { this.updateIdleCam(dt, t); this.updateEnv(dt, t); return; }

    switch (this.phase) {
      case 'explore':
        this.updateSwim(dt, 1);
        this.updateProgress();
        this.updateBeats();
        this.updateInteraction();
        this.updateGuideLight(dt, t);
        this.updateO2Explore(dt);
        this.updateGalleryRipple(dt);
        break;
      case 'scare':
        this.updateSwim(dt, 0);
        this.updateScare(dt);
        break;
      case 'hypoxia':
        this.updateSwim(dt, this.speedFactor);
        this.updateProgress();
        this.updateHypoxia(dt);
        break;
      case 'whiteout':
        this.updateWhiteout(dt);
        break;
      case 'redroom':
        this.updateRedRoom(dt, t);
        return;
      case 'done':
        this.redroom?.update(dt, t);
        return;
    }

    this.updateLamp(dt, t);
    this.updateEnv(dt, t);
    this.updateHud();

    if (this.hissOn) {
      this.hissBubbleT -= dt;
      if (this.hissBubbleT <= 0) {
        this.hissBubbleT = 0.07;
        this.tmpV.copy(this.pos);
        this.tmpV.y -= 0.1;
        this.bubbles.burst(this.tmpV, 3, 0.5);
      }
    }
  }

  // ---------- 相机与移动 ----------

  private applyCamera() {
    const cam = this.ctx.camera;
    cam.position.copy(this.pos);
    // 呼吸浮沉 + 头部摆动
    cam.position.y += Math.sin(this.time * 0.7) * 0.02 + Math.sin(this.bobPhase) * 0.015;
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.06;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.06;
    }
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    this.lampRig.position.copy(cam.position);
    this.lampRig.quaternion.copy(cam.quaternion);
  }

  private updateLook(dt: number) {
    const { dx, dy } = this.ctx.input.consumeLook();
    this.yaw -= dx * LOOK_SENS;
    this.pitch = clamp(this.pitch - dy * LOOK_SENS, -1.45, 1.45);
    this.roll = damp(this.roll, -this.ctx.input.moveX * 0.035 - dx * 0.0004, 6, dt);
  }

  private updateSwim(dt: number, control: number) {
    this.updateLook(dt);
    const input = this.ctx.input;
    const cam = this.ctx.camera;

    cam.getWorldDirection(this.fwd);
    const right = this.tmpV.set(-Math.sin(this.yaw - Math.PI / 2), 0, -Math.cos(this.yaw - Math.PI / 2));

    const accel = 6.2 * control;
    this.vel.addScaledVector(this.fwd, input.moveZ * accel * dt);
    this.vel.addScaledVector(right, input.moveX * accel * dt);
    this.vel.y += input.moveY * accel * 0.8 * dt;

    // 水阻
    this.vel.multiplyScalar(Math.exp(-2.1 * dt));
    const speed = this.vel.length();
    const maxSpeed = 2.3 * Math.max(0.3, control);
    if (speed > maxSpeed) this.vel.multiplyScalar(maxSpeed / speed);
    this.pos.addScaledVector(this.vel, dt);
    this.bobPhase += speed * dt * 1.7;
    this.exertion += speed * dt * 0.55;
    this.shake = Math.max(0, this.shake - dt * 1.4);

    // 洞壁约束
    const near = this.cave.nearest(this.pos, this.sampleIdx);
    this.sampleIdx = near.idx;
    const s = near.sample;
    const radial = this.tmpV2.copy(this.pos).sub(s.pos);
    let along = radial.dot(s.tangent);
    const perp = radial.addScaledVector(s.tangent, -along);
    const maxR = s.radius * 0.62;
    if (perp.lengthSq() > maxR * maxR) {
      perp.setLength(maxR);
      const n = this.fwd.copy(perp).normalize();
      const vOut = this.vel.dot(n);
      if (vOut > 0) this.vel.addScaledVector(n, -vOut);
    }
    // 两端封死
    const lastIdx = this.cave.samples.length - 1;
    if (near.idx <= 2) along = Math.min(along, 0.2);
    if (near.idx >= lastIdx - 2) along = Math.min(along, 0);
    this.pos.copy(s.pos).addScaledVector(s.tangent, along).add(perp);

    this.applyCamera();
  }

  private updateProgress() {
    this.progressT = this.sampleIdx / (this.cave.samples.length - 1);
  }

  private updateBeats() {
    while (this.beatIdx < BEATS.length && BEATS[this.beatIdx].t <= this.progressT) {
      BEATS[this.beatIdx].run(this.scriptCtx);
      this.beatIdx++;
    }
  }

  private updateIdleCam(dt: number, t: number) {
    const cam = this.ctx.camera;
    const base = this.cave.spawnPos;
    cam.position.set(
      base.x + Math.sin(t * 0.1) * 0.8,
      base.y + 0.4 + Math.sin(t * 0.13) * 0.5,
      base.z + 2.5
    );
    cam.quaternion.setFromEuler(new THREE.Euler(-0.12 + Math.sin(t * 0.09) * 0.05, Math.PI + Math.sin(t * 0.07) * 0.2, 0, 'YXZ'));
    this.lampRig.position.copy(cam.position);
    this.lampRig.quaternion.copy(cam.quaternion);
    this.lampEffective = 0;
    this.spot.intensity = 0;
    this.fill.intensity = 1.2;
    if (this.cone) tickCone(this.cone, t, 0);
    cam.getWorldDirection(this.fwd);
    this.silt.update(t, cam.position, this.fwd, 0, 0.3);
    void dt;
  }

  // ---------- 灯光 / 环境 ----------

  private updateLamp(dt: number, t: number) {
    if (!this.lampLocked && this.ctx.input.consumePressed('KeyF')) {
      this.lampOn = !this.lampOn;
      this.ctx.audio.tick(0.12);
    }
    // 灯电量博弈：探索阶段开灯耗电（黑暗廊道里"省电"是有意义的选择）
    if (this.phase === 'explore' && this.lampOn && !this.lampForcedOff) {
      this.battery = Math.max(0, this.battery - dt / 560);
      if (this.battery < 0.35 && this.battWarned < 1) {
        this.battWarned = 1;
        this.flickerLeft = 1.1;
        this.ctx.hud.subtitle('手电在抱怨了。电量剩三分之一——黑暗开始有了利息。', 6);
      } else if (this.battery < 0.12 && this.battWarned < 2) {
        this.battWarned = 2;
        this.flickerLeft = 1.6;
        this.ctx.hud.subtitle('灯芯发红。剩下的黑，比剩下的电多。', 6);
      }
    }
    const battDim = this.battery <= 0 ? 0.26 : this.battery < 0.12 ? 0.26 + (this.battery / 0.12) * 0.74 : 1;
    let f = this.lampOn && !this.lampForcedOff ? 1 : 0;
    if (this.flickerLeft > 0 && f > 0) {
      this.flickerLeft -= dt;
      const g = Math.sin(t * 47.3) * Math.sin(t * 13.7) + Math.sin(t * 71.1) * 0.5;
      f = g > -0.35 ? 1 : 0.12;
      if (Math.random() < dt * 6) this.ctx.audio.tick(0.05);
    }
    f *= this.lampDim * battDim;
    this.lampEffective = damp(this.lampEffective, f, 18, dt);
    this.spot.intensity = this.spotBase * this.lampEffective;
    this.fill.intensity = this.fillBase * Math.max(this.lampEffective, 0.12);
    if (this.cone) tickCone(this.cone, t, 0.085 * this.lampEffective);
    this.creature.setLamp(this.lampEffective);
  }

  private updateEnv(dt: number, t: number) {
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = damp(fog.density, this.fogTargetDensity, 1.2, dt);
    fog.color.lerp(this.fogTargetColor, Math.min(1, dt * 1.2));
    this.ambientCur = damp(this.ambientCur, this.ambientTarget, 1.5, dt);
    this.ambientLight.intensity = this.ambientCur;

    const cam = this.ctx.camera;
    cam.getWorldDirection(this.fwd);
    this.silt.update(t, cam.position, this.fwd, this.lampEffective, this.ambientCur * 0.22);
    this.ctx.audio.update(dt);
  }

  private updateHud() {
    const hud = this.ctx.hud;
    hud.setO2(this.o2, MAX_O2);
    hud.setBattery(this.battery);
    hud.setDepth(-this.pos.y);
  }

  private updateO2Explore(dt: number) {
    const base = Math.min(MAX_O2, MAX_O2 - this.progressT * 2100 - this.exertion + this.o2Bonus);
    this.o2 = Math.max(SCARE_O2 + 30, damp(this.o2, base, 0.8, dt));
  }

  /** 发光廊道：贴近洞壁激起光的涟漪（暗适应下尤其醒目）。 */
  private updateGalleryRipple(dt: number) {
    this.rippleCooldown -= dt;
    if (this.rippleCooldown > 0) return;
    if (this.progressT < GALLERY_T0 || this.progressT > GALLERY_T1) return;
    const s = this.cave.samples[this.sampleIdx];
    const radial = this.tmpV.copy(this.pos).sub(s.pos);
    radial.addScaledVector(s.tangent, -radial.dot(s.tangent));
    const rd = radial.length();
    if (rd > s.radius * 0.44 && this.vel.lengthSq() > 0.04) {
      const origin = this.tmpV2.copy(s.pos).addScaledVector(radial.normalize(), s.radius * 0.95);
      this.polyps.triggerPulse(origin, this.time, false);
      this.ctx.audio.tick(0.09);
      this.rippleCooldown = 2.6;
    }
  }

  // ---------- 交互 ----------

  private updateInteraction() {
    const cam = this.ctx.camera;
    cam.getWorldDirection(this.fwd);
    let found: Interactable | null = null;
    for (const it of this.cave.interactables) {
      if (it.used) continue;
      const d = it.pos.distanceTo(this.pos);
      if (d > it.radius + 0.6) continue;
      this.tmpV.copy(it.pos).sub(this.pos).normalize();
      if (this.tmpV.dot(this.fwd) < 0.45) continue;
      found = it;
      break;
    }
    const hud = this.ctx.hud;
    if (found) {
      hud.prompt(this.ctx.input.touch ? `· ${found.prompt} ·` : `E · ${found.prompt}`);
      this.ctx.input.setInteractVisible(true);
      if (this.ctx.input.consumePressed('KeyE')) {
        found.used = true;
        this.ctx.audio.uiClick();
        for (const line of found.lines) {
          hud.subtitle(line, Math.max(3.4, line.length * 0.14));
        }
        if (found.id === 'cutline') this.ctx.audio.setTension(0.55);
        hud.addNote(found.note[0], found.note[1]);
        // 玩法效果
        if (found.effect === 'o2') {
          this.o2Bonus += 450;
          this.tmpV.copy(found.pos);
          this.bubbles.burst(this.tmpV, 30, 0.7);
          this.ctx.audio.tick(0.2);
        } else if (found.effect === 'polypWave') {
          this.polyps.triggerPulse(found.pos, this.time, true);
          this.ctx.audio.swell(3.5);
        }
        hud.prompt(null);
        this.ctx.input.setInteractVisible(false);
      }
    } else {
      hud.prompt(null);
      this.ctx.input.setInteractVisible(false);
    }
  }

  private updateGuideLight(dt: number, t: number) {
    if (!this.guideSprite || !this.guideLightPt) return;
    if (!this.guideAlive) {
      (this.guideSprite.material as THREE.SpriteMaterial).opacity =
        damp((this.guideSprite.material as THREE.SpriteMaterial).opacity, 0, 5, dt);
      this.guideLightPt.intensity = damp(this.guideLightPt.intensity, 0, 5, dt);
      return;
    }
    const pulse = 0.6 + 0.35 * Math.sin(t * 2.2) * Math.sin(t * 0.9);
    (this.guideSprite.material as THREE.SpriteMaterial).opacity = pulse;
    this.guideLightPt.intensity = 34 * pulse;
    const d = this.guideSprite.position.distanceTo(this.pos);
    if (d < 6.5) {
      this.guideAlive = false;
      this.ctx.audio.tick(0.2);
      this.ctx.audio.setTension(0.75);
      this.ctx.hud.subtitle('灯灭了。', 4);
      this.ctx.hud.objective(null);
    }
  }

  // ---------- 惊吓序列 ----------

  private beginScare() {
    if (this.phase !== 'explore') return;
    this.phase = 'scare';
    this.seqT = 0;
    this.seqStep = 0;
    this.o2 = SCARE_O2;
    this.ctx.hud.prompt(null);
    this.ctx.input.setInteractVisible(false);
  }

  private updateScare(dt: number) {
    this.seqT += dt;
    const step = (n: number, at: number, fn: () => void) => {
      if (this.seqStep === n && this.seqT >= at) { fn(); this.seqStep++; }
    };
    step(0, 0, () => {
      this.flickerLeft = 2.2;
      this.lampLocked = true;
      this.ctx.audio.setTension(0.9);
      this.ctx.hud.subtitle('手电——别这样。别现在这样。', 4);
    });
    step(1, 2.3, () => {
      this.lampForcedOff = true;
      this.ctx.audio.setDrone(0.12);
      this.ctx.audio.setHeart(1, 0.3);
      this.ctx.hud.objective(null);
    });
    step(2, 5.6, () => this.ctx.audio.knock(2, 0.55));
    step(3, 7.6, () => {
      this.lampForcedOff = false;
      this.creature.poseScare(this.ctx.camera);
      this.ctx.audio.stinger();
      this.ctx.post.uniforms.uFlash.value = 0.75;
      this.shake = 1.4;
    });
    step(4, 8.55, () => {
      this.lampForcedOff = true;
      this.creature.hide();
    });
    step(5, 10.2, () => {
      this.lampForcedOff = false;
      this.lampDim = 0.5;
      this.lampLocked = false;
      this.ctx.audio.setHiss(true);
      this.hissOn = true;
      this.ctx.audio.setTension(1);
      this.ctx.hud.subtitle('气瓶在漏。阀座裂了。剩下的每一口气都有编号。', 6);
      this.ctx.hud.objective('向上。向前。快。');
      this.phase = 'hypoxia';
      this.seqT = 0;
    });
    // 闪光衰减
    const u = this.ctx.post.uniforms;
    u.uFlash.value = Math.max(0, (u.uFlash.value as number) - dt * 1.6);
  }

  // ---------- 缺氧 → 白光 ----------

  private updateHypoxia(dt: number) {
    this.seqT += dt;
    this.o2 = Math.max(0, this.o2 - dt * 21);
    const k = 1 - this.o2 / SCARE_O2; // 0..1 缺氧程度

    this.speedFactor = lerp(1, 0.42, k);
    this.ctx.audio.setMuffle(k * 0.95);
    this.ctx.audio.setHeart(lerp(1, 0.42, k), 0.35);
    this.ctx.post.uniforms.uClose.value = Math.pow(k, 1.4) * 0.88;
    const u = this.ctx.post.uniforms;
    u.uFlash.value = Math.max(0, (u.uFlash.value as number) - dt * 1.6);

    if (this.seqT > 4 && this.creatureLineIdx === 0) {
      this.ctx.hud.subtitle(CREATURE_LINES[0], 6, 'mono');
      this.creatureLineIdx = 1;
      this.creatureLineT = this.seqT;
    }
    if (!this.aweSpawned && this.o2 < 950) {
      this.aweSpawned = true;
      this.ctx.audio.swell(4.5);
      this.ctx.audio.eerie(false);
      window.setTimeout(() => {
        if (this.phase !== 'hypoxia') return;
        const ahead = this.cave.sampleAtT(Math.min(0.985, this.progressT + 0.05));
        const p = ahead.pos.clone().addScaledVector(ahead.down, -ahead.radius * 0.15);
        this.creature.poseAwe(p, this.pos);
        this.ctx.audio.padOn();
        this.ctx.audio.setHiss(false);
        this.hissOn = false;
        this.fogTargetDensity = 0.045;
        this.fogTargetColor.set(0x04222e);
        this.ambientTarget = 0.1;
      }, 4500);
    }
    if (this.aweSpawned && this.creatureLineIdx >= 1 && this.creatureLineIdx < CREATURE_LINES.length
      && this.seqT - this.creatureLineT > 7) {
      this.ctx.hud.subtitle(CREATURE_LINES[this.creatureLineIdx], 6.5, 'creature');
      this.creatureLineIdx++;
      this.creatureLineT = this.seqT;
    }
    // 生物缓慢漂近（3/4 侧身，躯干灯列可见）
    if (this.aweSpawned && this.creature.group.visible) {
      this.tmpV.copy(this.pos).sub(this.creature.group.position);
      const d = this.tmpV.length();
      if (d > 9.5) this.creature.group.position.addScaledVector(this.tmpV.normalize(), dt * 0.55);
      this.creature.aimAt(this.pos);
    }

    if (this.o2 <= 60) {
      this.phase = 'whiteout';
      this.seqT = 0;
      this.ctx.hud.objective(null);
      this.ctx.hud.clearSubtitles();
    }
  }

  private updateWhiteout(dt: number) {
    this.seqT += dt;
    this.updateLook(dt);
    this.applyCamera();
    const u = this.ctx.post.uniforms;
    if (this.blackHold === 0) {
      this.whiteout = Math.min(1, this.whiteout + dt / 4.5);
      u.uWhite.value = this.whiteout;
      u.uClose.value = Math.min(0.97, (u.uClose.value as number) + dt * 0.08);
      this.ctx.audio.setMuffle(1);
      if (this.whiteout >= 1) {
        this.blackHold = 0.001;
        u.uWhite.value = 0;
        u.uFade.value = 1;
        u.uClose.value = 0;
        this.ctx.audio.setDrone(0);
        this.ctx.audio.setBreathing(false);
        this.ctx.audio.setTension(0);
        this.ctx.audio.setHeart(0.4, 0.12);
        this.ctx.hud.setGaugesVisible(false);
      }
    } else {
      this.blackHold += dt;
      if (this.blackHold > 3.5) this.enterRedRoom();
    }
  }

  // ---------- 红房间 ----------

  private enterRedRoom() {
    this.phase = 'redroom';
    this.redroom = new RedRoom(this.ctx.quality.dropletCount);
    this.pos.set(0, 1.7, 7.5);
    this.vel.set(0, 0, 0);
    this.yaw = 0; // 面向 -z 的身影
    this.pitch = 0;
    this.roll = 0;
    const cam = this.ctx.camera;
    cam.position.copy(this.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const audio = this.ctx.audio;
    audio.setMuffle(0);
    audio.setHeart(0.5, 0.06);
    audio.padOn();
    this.ctx.hud.subtitle('……', 2);
    const u = this.ctx.post.uniforms;
    u.uGradeDepth.value = 0.08;
    u.uDistort.value = 0;
    window.setTimeout(() => { u.uFade.value = 0.999; }, 100);
  }

  private updateRedRoom(dt: number, t: number) {
    const u = this.ctx.post.uniforms;
    if (this.finalT < 0) u.uFade.value = Math.max(0, (u.uFade.value as number) - dt / 3.5);

    this.updateLook(dt);
    // 步行：forward=(-sin yaw, 0, -cos yaw)，right=(cos yaw, 0, -sin yaw)
    const input = this.ctx.input;
    const speed = 1.5;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.pos.x += (-sy * input.moveZ + cy * input.moveX) * speed * dt;
    this.pos.z += (-cy * input.moveZ - sy * input.moveX) * speed * dt;
    this.pos.y = 1.7;
    // 场地限制 + 不能穿过身影
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 11.5) { this.pos.x *= 11.5 / r; this.pos.z *= 11.5 / r; }
    const fp = this.redroom!.figurePos;
    const dx = this.pos.x - fp.x, dz = this.pos.z - fp.z;
    const fd = Math.hypot(dx, dz);
    if (fd < 1.5 && fd > 0.0001) {
      this.pos.x = fp.x + (dx / fd) * 1.5;
      this.pos.z = fp.z + (dz / fd) * 1.5;
    }
    const cam = this.ctx.camera;
    cam.position.copy(this.pos);
    cam.position.y += Math.sin(this.bobPhase) * 0.02;
    this.bobPhase += Math.hypot(input.moveX, input.moveZ) * dt * 6;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    this.redroom!.update(dt, t);
    this.ctx.audio.update(dt);

    // 距离驱动对白
    const dist = fd;
    if (this.dlgIdx < REDROOM_DIALOGUE.length && dist < REDROOM_DIALOGUE[this.dlgIdx][0]) {
      const [, who, text] = REDROOM_DIALOGUE[this.dlgIdx];
      this.ctx.hud.subtitle(text, 6, who === 'figure' ? 'creature' : '');
      if (this.dlgIdx === 2) this.redroom!.turnTo(1);
      // 「你带来了水」→ 逆浮水珠（奇观 4）
      if (this.dlgIdx === 3) this.redroom!.startDroplets();
      this.dlgIdx++;
      if (this.dlgIdx >= REDROOM_DIALOGUE.length) this.finalT = 0;
    }
    if (this.finalT >= 0) {
      this.finalT += dt;
      const fire = (n: number, at: number, fn: () => void) => {
        if (this.finalT >= at && !this.endFired.has(n)) { this.endFired.add(n); fn(); }
      };
      fire(0, 5, () => this.redroom!.dimLights(0.3));
      fire(1, 6.5, () => this.ctx.hud.subtitle(REDROOM_FINAL[0], 5));
      fire(2, 10.5, () => this.ctx.hud.subtitle(REDROOM_FINAL[1], 5));
      fire(3, 14.5, () => { this.ctx.hud.fade(1, 4); this.ctx.audio.padOff(); });
      fire(4, 19, () => {
        this.phase = 'done';
        this.ctx.hud.setVisible(false);
        this.ctx.input.exitPointerLock();
        this.ctx.hud.showCredits(CREDITS_LINES, () => this.ctx.onStoryEnd());
      });
    }
  }

  dispose() {
    this.ctx.audio.setBreathing(false);
    this.ctx.audio.setHiss(false);
    this.ctx.audio.eerie(false);
    this.ctx.audio.padOff();
    this.ctx.audio.setMuffle(0);
    this.ctx.audio.setTension(0);
    this.ctx.audio.setHeart(1, 0);
    this.ctx.audio.setDrone(0);
    this.scene.clear();
    this.redroom?.scene.clear();
  }
}
