import * as THREE from 'three';

/**
 * 潜伴 NPC「特奥」——支援潜水员（docs/GAME_DESIGN.md 双人洞潜协议）。
 * - 程序化潜水员模型：湿衣躯干 + 双瓶 + 面镜 + 黄鳍（水下辨识色）+ 手持潜灯。
 * - 行为：跟随（滞后弹簧 + 鳍踢摆动）/ 定点悬停 / 撤离；
 * - 手势：OK（灯画圈）/ 注意（灯横扫）/ 气检（敲表）/ 停（掌心向前）/ 向上（拇指）/ 指向。
 *   真实洞潜里手势与灯光信号是同一套语言的两半，这里同步演出。
 */

export type BuddyGesture = 'ok' | 'attention' | 'airCheck' | 'stop' | 'up' | 'point';
export type BuddyMode = 'hidden' | 'follow' | 'hold' | 'leave';

const ACCENT = 0xd8b545; // 鳍/条带的高可见黄

export class Buddy {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  mode: BuddyMode = 'hidden';

  private velocity = new THREE.Vector3();
  private holdPos = new THREE.Vector3();
  private leaveTarget = new THREE.Vector3();
  private finPhase = 0;

  // 骨架节点
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private lamp!: THREE.SpotLight;
  private lampTarget = new THREE.Object3D();
  private visor!: THREE.MeshStandardMaterial;

  // 手势状态
  private gestureKind: BuddyGesture | null = null;
  private gestureT = 0;
  private gestureDur = 0;
  private pointDir = new THREE.Vector3(0, 0, -1);

  // 复用临时量
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.buildModel();
    this.group.visible = false;
    scene.add(this.group);
  }

  // ---------- 模型 ----------
  private buildModel(): void {
    const suit = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.82 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: 0x3a2e08, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bfc4, metalness: 0.8, roughness: 0.32 });
    this.visor = new THREE.MeshStandardMaterial({
      color: 0x0c1214, emissive: 0x9fd8cf, emissiveIntensity: 0.35, roughness: 0.2, metalness: 0.4,
    });

    // 躯干（+Z 为前进方向）
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 6, 12), suit);
    torso.rotation.x = Math.PI / 2;
    // 胸前高可见条带
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.02, 6, 18), accent);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.1;

    // 头 + 面镜
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), suit);
    head.position.set(0, 0.05, 0.4);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.075, 0.05), this.visor);
    mask.position.set(0, 0.06, 0.5);

    // 双瓶（背上）
    for (const sx of [-0.085, 0.085]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.5, 12), steel);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(sx, 0.19, -0.02);
      const valve = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), steel);
      valve.position.set(sx, 0.19, 0.26);
      this.group.add(tank, valve);
    }
    // 呼吸管弧线
    const hoseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.085, 0.2, 0.24),
      new THREE.Vector3(0.16, 0.14, 0.36),
      new THREE.Vector3(0.05, 0.03, 0.48),
    ]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 10, 0.014, 6), suit);

    // 手臂（肩部可摆姿态；前臂固定微屈）
    const mkArm = (side: number): THREE.Group => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.2, 0.03, 0.26);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), suit);
      upper.position.y = -0.14;
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 4, 8), suit);
      fore.position.set(0, -0.3, 0.06);
      fore.rotation.x = -0.5;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
      hand.position.set(0, -0.38, 0.14);
      shoulder.add(upper, fore, hand);
      return shoulder;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    // 默认姿态：双臂收在体侧后方（洞潜标准 trim）
    this.armL.rotation.x = -1.25;
    this.armR.rotation.x = -1.25;

    // 腿 + 黄鳍（踢水动画）
    const mkLeg = (side: number): THREE.Group => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.085, 0, -0.24);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 4, 8), suit);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.z = -0.15;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), suit);
      shin.rotation.x = Math.PI / 2;
      shin.position.z = -0.4;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.34), accent);
      fin.position.set(0, -0.01, -0.68);
      hip.add(thigh, shin, fin);
      return hip;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    // 手持潜灯（右手）：灯体 + 聚光（比玩家手电冷一点，水里一眼能认出是谁的灯）
    const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, 0.11, 8), steel);
    lampBody.rotation.x = Math.PI / 2;
    lampBody.position.set(0.24, -0.14, 0.34);
    const lampFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.034, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfeee4, emissiveIntensity: 4 }),
    );
    lampFace.position.set(0.24, -0.14, 0.4);
    this.lamp = new THREE.SpotLight(0xcfeee4, 26, 30, 0.42, 0.7, 1.1);
    this.lamp.position.copy(lampBody.position);
    this.lampTarget.position.set(0.24, -0.14, 8);
    this.lamp.target = this.lampTarget;

    this.group.add(
      torso, band, head, mask, hose,
      this.armL, this.armR, this.legL, this.legR,
      lampBody, lampFace, this.lamp, this.lampTarget,
    );
  }

  // ---------- 行为 API ----------
  /** 出现在指定位置并开始跟随 */
  spawn(pos: THREE.Vector3, mode: BuddyMode = 'follow'): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.group.position.copy(pos);
    this.mode = mode;
    this.holdPos.copy(pos);
    this.group.visible = true;
  }

  hold(pos: THREE.Vector3): void {
    this.holdPos.copy(pos);
    this.mode = 'hold';
    this.group.visible = true;
  }

  /** 游向目标点后消失（撤离/先行） */
  leave(target: THREE.Vector3): void {
    this.leaveTarget.copy(target);
    this.mode = 'leave';
  }

  hide(): void {
    this.mode = 'hidden';
    this.group.visible = false;
  }

  /** 播放手势（同时驱动灯光信号） */
  gesture(kind: BuddyGesture, dur = 2.6, pointDir?: THREE.Vector3): void {
    this.gestureKind = kind;
    this.gestureT = 0;
    this.gestureDur = dur;
    if (pointDir) this.pointDir.copy(pointDir).normalize();
  }

  get gesturing(): boolean {
    return this.gestureKind !== null;
  }

  /** 世界坐标（判定玩家是否看向潜伴） */
  get worldPos(): THREE.Vector3 {
    return this.group.position;
  }

  // ---------- 主更新 ----------
  update(dt: number, time: number, playerPos: THREE.Vector3, playerYaw: number): void {
    if (this.mode === 'hidden') return;

    // ---- 目标点 ----
    let target: THREE.Vector3;
    if (this.mode === 'follow') {
      // 玩家左后上方的编队位（洞潜双人队形：灯光互相可见、不搅对方的水）
      const back = this.tmpV.set(Math.sin(playerYaw), 0, Math.cos(playerYaw));
      target = playerPos.clone()
        .addScaledVector(back, 1.7)
        .add(new THREE.Vector3(Math.cos(playerYaw) * -1.3, 0.55, Math.sin(playerYaw) * 1.3));
    } else if (this.mode === 'leave') {
      target = this.leaveTarget;
      if (this.position.distanceTo(target) < 1.2) {
        this.hide();
        return;
      }
    } else {
      target = this.holdPos;
    }

    // ---- 弹簧跟随（限速，游不出鱼雷感）----
    const to = target.clone().sub(this.position);
    const dist = to.length();
    const maxSpeed = this.mode === 'leave' ? 3.4 : Math.min(3.0, dist * 1.4);
    this.velocity.addScaledVector(to.normalize(), Math.min(6, dist * 2.2) * dt);
    this.velocity.multiplyScalar(Math.exp(-1.6 * dt));
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);
    this.position.addScaledVector(this.velocity, dt);
    // 悬停呼吸起伏
    this.group.position.copy(this.position);
    this.group.position.y += Math.sin(time * 0.9) * 0.05;

    // ---- 朝向：游动沿速度；慢速/手势时面向玩家 ----
    const speed = this.velocity.length();
    const facePlayer = this.gestureKind !== null || speed < 0.35;
    const lookAt = facePlayer
      ? playerPos
      : this.position.clone().addScaledVector(this.velocity, 2);
    this.tmpM.lookAt(lookAt, this.group.position, new THREE.Vector3(0, 1, 0));
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    this.group.quaternion.slerp(this.tmpQ, Math.min(1, dt * 2.6));

    // ---- 鳍踢 ----
    this.finPhase += dt * (1.4 + speed * 2.2);
    const kick = Math.sin(this.finPhase) * (0.14 + Math.min(0.3, speed * 0.12));
    this.legL.rotation.x = kick;
    this.legR.rotation.x = -kick;

    // ---- 手势演出 ----
    this.updateGesture(dt, time);
  }

  private updateGesture(dt: number, time: number): void {
    // 灯光默认：随身前方微摆
    if (this.gestureKind === null) {
      this.lampTarget.position.set(
        0.24 + Math.sin(time * 0.8) * 0.5,
        -0.14 + Math.cos(time * 0.7) * 0.4,
        8,
      );
      // 双臂缓慢回到 trim 姿态
      this.armR.rotation.x += (-1.25 - this.armR.rotation.x) * Math.min(1, dt * 3);
      this.armR.rotation.z += (0 - this.armR.rotation.z) * Math.min(1, dt * 3);
      this.armL.rotation.x += (-1.25 - this.armL.rotation.x) * Math.min(1, dt * 3);
      return;
    }

    this.gestureT += dt;
    const k = Math.min(1, this.gestureT * 3); // 进入姿态的缓动
    switch (this.gestureKind) {
      case 'ok': {
        // 右臂抬起，灯画圈（OK 灯语）
        this.armR.rotation.x = -1.25 + (1.0 + 1.25) * k;
        const a = this.gestureT * 4.2;
        this.lampTarget.position.set(0.24 + Math.cos(a) * 1.6, -0.14 + Math.sin(a) * 1.6, 7);
        break;
      }
      case 'attention': {
        // 灯快速横扫（注意/紧急）
        this.armR.rotation.x = -1.25 + (0.9 + 1.25) * k;
        this.lampTarget.position.set(Math.sin(this.gestureT * 9) * 3.2, -0.1, 7);
        break;
      }
      case 'airCheck': {
        // 左手拍压力表（胸前），右臂半举示意"报气量"
        this.armL.rotation.x = -1.25 + (0.4 + 1.25) * k;
        this.armL.rotation.z = 0.5 * k * (1 + Math.sin(this.gestureT * 6) * 0.15);
        this.armR.rotation.x = -1.25 + (0.4 + 1.25) * k;
        break;
      }
      case 'stop': {
        // 掌心向前：停
        this.armR.rotation.x = -1.25 + (1.5 + 1.25) * k;
        this.lampTarget.position.set(0.24, -0.14, 8);
        break;
      }
      case 'up': {
        // 拇指向上：上升/结束潜水（洞潜里这不是"好"，是命令）
        this.armR.rotation.x = -1.25 + (2.4 + 1.25) * k;
        this.lampTarget.position.set(0.24, 6, 3);
        break;
      }
      case 'point': {
        // 指向目标方向，灯照过去
        this.armR.rotation.x = -1.25 + (0.9 + 1.25) * k;
        const world = this.pointDir.clone().multiplyScalar(9);
        const local = this.group.worldToLocal(this.group.position.clone().add(world));
        this.lampTarget.position.copy(local);
        break;
      }
    }
    // 面镜在手势时更亮（他在看你）
    this.visor.emissiveIntensity = 0.35 + Math.min(1, this.gestureT * 2) * 0.5;
    if (this.gestureT >= this.gestureDur) {
      this.gestureKind = null;
      this.visor.emissiveIntensity = 0.35;
    }
  }
}
