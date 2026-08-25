import * as THREE from 'three';
import type { Cave } from './Cave';
import type { Player } from './Player';
import type { AudioEngine } from './AudioEngine';

/**
 * 唯一一次编排式惊吓（docs/GAME_DESIGN.md §4）：
 * 前置静默（由 Story t=0.56 触发）→ 手电频闪 → 频闪间隙中
 * 旧式潜水服身影横穿隧道（<1.2s，看不清是设计）→ sting →
 * 12 秒死寂余韵 → 环境床缓慢恢复。
 */
export class Scare {
  private figure: THREE.Group;
  private active = false;
  private elapsed = 0;
  private crossFrom = new THREE.Vector3();
  private crossTo = new THREE.Vector3();
  private flickerSchedule: { at: number; on: boolean }[] = [];
  private baseIntensity = 0;
  private done = false;

  constructor(scene: THREE.Scene) {
    this.figure = this.buildFigure();
    this.figure.visible = false;
    scene.add(this.figure);
  }

  /** 旧式潜水服身影：故意低细节的拉长人形剪影 */
  private buildFigure(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcfc8b8,
      roughness: 0.55,
      metalness: 0.25,
      emissive: 0x11100c,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c28, roughness: 0.8 });

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 12), mat);
    helmet.position.y = 0.95;
    const port = new THREE.Mesh(new THREE.CircleGeometry(0.085, 12), dark);
    port.position.set(0, 0.95, 0.21);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.15, 10), mat);
    body.position.y = 0.25;
    body.scale.set(1, 1.35, 0.8); // 拉长——比例微妙地不对
    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.95, 6);
    const armL = new THREE.Mesh(armGeo, mat);
    armL.position.set(-0.3, 0.35, 0);
    armL.rotation.z = 0.28;
    const armR = armL.clone();
    armR.position.x = 0.3;
    armR.rotation.z = -0.28;
    const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 1.1, 6);
    const legL = new THREE.Mesh(legGeo, mat);
    legL.position.set(-0.12, -0.85, 0);
    const legR = legL.clone();
    legR.position.x = 0.12;
    g.add(helmet, port, body, armL, armR, legL, legR);
    g.scale.setScalar(1.28);
    return g;
  }

  get hasFired(): boolean {
    return this.done;
  }

  trigger(cave: Cave, player: Player, audio: AudioEngine): void {
    if (this.active || this.done) return;
    this.active = true;
    this.elapsed = 0;
    this.baseIntensity = player.flashlight.intensity;

    // 身影在前方 ~7m 处横穿
    const tF = Math.min(0.98, player.curveT + 0.028);
    const center = cave.pointAt(tF);
    const tan = cave.curve.getTangentAt(tF);
    const side = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    const r = cave.radiusAt(tF) * 0.75;
    this.crossFrom.copy(center).addScaledVector(side, r);
    this.crossTo.copy(center).addScaledVector(side, -r);
    this.figure.position.copy(this.crossFrom);
    this.figure.lookAt(player.position);

    // 频闪脚本：70–140ms 随机间隔 ×6，目击帧插在第 3 与第 5 次之间
    let t = 0.15;
    this.flickerSchedule = [];
    for (let i = 0; i < 6; i++) {
      this.flickerSchedule.push({ at: t, on: false });
      t += 0.07 + Math.random() * 0.07;
      this.flickerSchedule.push({ at: t, on: true });
      t += 0.09 + Math.random() * 0.08;
    }

    audio.sting();
    audio.setTension(0.95);
  }

  /** @returns 惊吓是否仍在进行（Game 用于锁输入节奏） */
  update(dt: number, player: Player): boolean {
    if (!this.active) return false;
    this.elapsed += dt;

    // 执行频闪
    while (this.flickerSchedule.length && this.elapsed >= this.flickerSchedule[0].at) {
      const step = this.flickerSchedule.shift()!;
      player.flashlight.intensity = step.on ? this.baseIntensity : 0;
    }

    // 身影横穿：0.25s ~ 1.35s
    const cross = (this.elapsed - 0.25) / 1.1;
    if (cross >= 0 && cross <= 1) {
      this.figure.visible = true;
      this.figure.position.lerpVectors(this.crossFrom, this.crossTo, cross);
      this.figure.position.y += Math.sin(cross * Math.PI) * 0.4;
      this.figure.lookAt(player.position);
    } else if (cross > 1) {
      this.figure.visible = false;
    }

    if (this.elapsed > 1.8) {
      player.flashlight.intensity = this.baseIntensity;
      this.figure.visible = false;
      this.active = false;
      this.done = true;
    }
    return this.active;
  }
}
