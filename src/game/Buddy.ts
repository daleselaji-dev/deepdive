import * as THREE from 'three';

/**
 * 潜伴 NPC「特奥」——支援潜水员（docs/GAME_DESIGN.md 双人洞潜协议）。
 * M5-L3 全身重制（§3.14）：
 * - 真实人体比例（站高 ~1.78m，头身比 ~1:7.2）；
 * - 肘/膝双关节：手势由肩+肘两段驱动，踢鳍是髋+膝相位差的真扑动；
 * - 叶形导流鳍（Shape 放样曲面）替代 Box 板；
 * - 面镜内可见脸 + 头部注视玩家；二级头咬嘴 + 软管弧线 + 左肋压力表控制台；
 * - 潜灯挂在右手：灯语（画圈/横扫）物理地从手上发出。
 * 行为：跟随（滞后弹簧）/ 定点悬停 / 撤离；
 * 手势：OK / 注意 / 气检 / 停 / 向上 / 指向 / 慢 / 贴线——
 * 真实洞潜里手势与灯光信号是同一套语言的两半，这里同步演出。
 */

export type BuddyGesture = 'ok' | 'attention' | 'airCheck' | 'stop' | 'up' | 'point' | 'slow' | 'line';
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

  // 骨架节点（肩/肘、髋/膝双关节）
  private shoulderL!: THREE.Group;
  private shoulderR!: THREE.Group;
  private elbowL!: THREE.Group;
  private elbowR!: THREE.Group;
  private hipL!: THREE.Group;
  private hipR!: THREE.Group;
  private kneeL!: THREE.Group;
  private kneeR!: THREE.Group;
  private head!: THREE.Group;
  private lamp!: THREE.SpotLight;
  private lampTarget = new THREE.Object3D();
  private visor!: THREE.MeshStandardMaterial;

  // 默认姿态（洞潜 trim：双臂收在体侧后方，肘微屈）
  private static readonly TRIM_SHOULDER = -1.15;
  private static readonly TRIM_ELBOW = 0.5;

  // 手势状态
  private gestureKind: BuddyGesture | null = null;
  private gestureT = 0;
  private gestureDur = 0;
  private pointDir = new THREE.Vector3(0, 0, -1);

  // 复用临时量
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private headQ = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.buildModel();
    this.group.visible = false;
    scene.add(this.group);
  }

  // ---------- 模型 ----------
  private buildModel(): void {
    const suit = new THREE.MeshStandardMaterial({ color: 0x111619, roughness: 0.9 });
    const suit2 = new THREE.MeshStandardMaterial({ color: 0x1a2126, roughness: 0.88 }); // 双色湿衣拼块
    const glove = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: ACCENT, emissive: 0x3a2e08, roughness: 0.6 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bfc4, metalness: 0.8, roughness: 0.32 });
    this.visor = new THREE.MeshStandardMaterial({
      color: 0x0c1214, emissive: 0x9fd8cf, emissiveIntensity: 0.35,
      roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.72,
    });

    // ---- 躯干（+Z 为前进方向）：胸廓 + 骨盆两段，读出人形而非胶囊 ----
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.3, 6, 14), suit);
    chest.rotation.x = Math.PI / 2;
    chest.position.z = 0.08;
    chest.scale.set(1.12, 0.82, 1); // 扁胸廓
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.16, 6, 12), suit2);
    pelvis.rotation.x = Math.PI / 2;
    pelvis.position.z = -0.2;
    pelvis.scale.set(1.05, 0.8, 1);
    // 胸前高可见条带 + 肩背拼色
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.02, 6, 18), accent);
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.14;
    const yoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.168, 0.1, 4, 12), suit2);
    yoke.rotation.x = Math.PI / 2;
    yoke.position.set(0, 0.02, 0.24);
    yoke.scale.set(1.1, 0.8, 1);

    // ---- BCD 背飞气囊 + 背板 ----
    const wing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.06, 8, 16, Math.PI * 1.25), suit2);
    wing.position.set(0, 0.14, 0.02);
    wing.rotation.set(Math.PI / 2, 0, Math.PI * 0.875);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.34), rail);
    plate.position.set(0, 0.16, 0.05);

    // ---- 头（可注视玩家的独立关节） ----
    this.head = new THREE.Group();
    this.head.position.set(0, 0.05, 0.42);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), suit); // 湿衣头套
    skull.scale.set(0.92, 1, 1.05);
    // 面镜框 + 玻璃 + 镜后的脸（半透明玻璃里能看到人——不是空壳）
    const maskFrame = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.014, 8, 18), rail);
    maskFrame.position.set(0, 0.015, 0.095);
    maskFrame.scale.set(1.15, 0.82, 1);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.068, 16), this.visor);
    glass.position.set(0, 0.015, 0.098);
    glass.scale.set(1.12, 0.8, 1);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), skin);
    face.position.set(0, 0.012, 0.055);
    face.scale.set(1.05, 0.9, 0.7);
    // 二级头咬嘴 + 排气阀
    const reg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.045, 10), rail);
    reg.rotation.x = Math.PI / 2;
    reg.position.set(0, -0.055, 0.1);
    const regSide = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), rail);
    regSide.rotation.z = Math.PI / 2;
    regSide.position.set(0.035, -0.055, 0.085);
    this.head.add(skull, maskFrame, glass, face, reg, regSide);

    // ---- 双瓶 + 阀门 + 汇流排 ----
    for (const sx of [-0.085, 0.085]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 14), steel);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(sx, 0.24, -0.02);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), steel);
      dome.position.set(sx, 0.24, -0.27);
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.06, 8), rail);
      valve.position.set(sx, 0.24, 0.25);
      valve.rotation.x = Math.PI / 2;
      this.group.add(tank, dome, valve);
    }
    const manifold = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 8), steel);
    manifold.rotation.z = Math.PI / 2;
    manifold.position.set(0, 0.24, 0.27);

    // ---- 软管：右阀 → 咬嘴；左阀 → 左肋压力表控制台 ----
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.8 });
    const hose1 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.085, 0.24, 0.26),
      new THREE.Vector3(0.19, 0.16, 0.36),
      new THREE.Vector3(0.09, 0.01, 0.5),
      new THREE.Vector3(0.01, -0.005, 0.52),
    ]), 12, 0.013, 6), hoseMat);
    const hose2 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.085, 0.24, 0.26),
      new THREE.Vector3(-0.2, 0.1, 0.2),
      new THREE.Vector3(-0.19, -0.08, 0.02),
    ]), 10, 0.012, 6), hoseMat);
    // 压力表控制台（挂在左肋）
    const console_ = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.075, 12), rail);
    console_.position.set(-0.19, -0.1, 0.0);
    console_.rotation.x = Math.PI / 2;
    const consoleFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.028, 12),
      new THREE.MeshStandardMaterial({ color: 0xd9d2b8, emissive: 0x4a4430, roughness: 0.3 }),
    );
    consoleFace.position.set(-0.19, -0.1, 0.04);

    // ---- 手臂：肩(Group) → 上臂 → 肘(Group) → 前臂 + 手 ----
    const mkArm = (side: number): { shoulder: THREE.Group; elbow: THREE.Group } => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.21, 0.03, 0.26);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.18, 4, 10), suit);
      upper.position.y = -0.115;
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.23, 0);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.17, 4, 10), suit2);
      fore.position.y = -0.1;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 8), glove);
      hand.scale.set(0.85, 1.15, 0.6);
      hand.position.y = -0.215;
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      return { shoulder, elbow };
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    this.shoulderL = armL.shoulder;
    this.elbowL = armL.elbow;
    this.shoulderR = armR.shoulder;
    this.elbowR = armR.elbow;
    this.shoulderL.rotation.x = Buddy.TRIM_SHOULDER;
    this.shoulderR.rotation.x = Buddy.TRIM_SHOULDER;
    this.elbowL.rotation.x = Buddy.TRIM_ELBOW;
    this.elbowR.rotation.x = Buddy.TRIM_ELBOW;

    // ---- 腿：髋(Group) → 大腿 → 膝(Group) → 小腿 + 叶形鳍 ----
    const finBlade = (): THREE.Mesh => {
      // 叶形导流鳍：Shape 曲线放样（窄根 → 展宽 → 圆尖），微弯
      const sh = new THREE.Shape();
      sh.moveTo(-0.055, 0);
      sh.quadraticCurveTo(-0.115, -0.18, -0.085, -0.4);
      sh.quadraticCurveTo(0, -0.48, 0.085, -0.4);
      sh.quadraticCurveTo(0.115, -0.18, 0.055, 0);
      sh.lineTo(-0.055, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false });
      // 弯曲：越靠尖越向上翘（导流面）
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setZ(i, p.getZ(i) + y * y * 0.35);
      }
      geo.computeVertexNormals();
      const blade = new THREE.Mesh(geo, accent);
      blade.rotation.x = Math.PI / 2; // 平铺（-y 方向变 -z 尖端朝后）
      return blade;
    };
    const mkLeg = (side: number): { hip: THREE.Group; knee: THREE.Group } => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.09, 0, -0.28);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.22, 4, 10), suit);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.z = -0.13;
      const knee = new THREE.Group();
      knee.position.z = -0.27;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 10), suit2);
      shin.rotation.x = Math.PI / 2;
      shin.position.z = -0.12;
      // 脚蹼口袋 + 侧轨
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.1), rail);
      pocket.position.set(0, -0.005, -0.26);
      const blade = finBlade();
      blade.position.set(0, -0.005, -0.3);
      for (const bx of [-0.052, 0.052]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.36), rail);
        r.position.set(bx, -0.005, -0.44);
        knee.add(r);
      }
      knee.add(shin, pocket, blade);
      hip.add(thigh, knee);
      return { hip, knee };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);
    this.hipL = legL.hip;
    this.kneeL = legL.knee;
    this.hipR = legR.hip;
    this.kneeR = legR.knee;

    // ---- 手持潜灯（绑在右手：灯语物理地从手上发出） ----
    const lampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, 0.11, 10), steel);
    lampBody.rotation.x = Math.PI / 2;
    lampBody.position.set(0, -0.24, 0.06);
    const lampFace = new THREE.Mesh(
      new THREE.CircleGeometry(0.032, 10),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfeee4, emissiveIntensity: 4 }),
    );
    lampFace.position.set(0, -0.24, 0.12);
    this.elbowR.add(lampBody, lampFace);
    this.lamp = new THREE.SpotLight(0xcfeee4, 26, 30, 0.42, 0.7, 1.1);
    this.lamp.position.set(0, -0.24, 0.1);
    this.elbowR.add(this.lamp);
    this.lampTarget.position.set(0.24, -0.14, 8);
    this.group.add(this.lampTarget);
    this.lamp.target = this.lampTarget;

    this.group.add(
      chest, pelvis, band, yoke, wing, plate, this.head, manifold,
      hose1, hose2, console_, consoleFace,
      this.shoulderL, this.shoulderR, this.hipL, this.hipR,
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

    // ---- 头部注视：身体没转到位时，头先看向玩家（活人感） ----
    const localPlayer = this.group.worldToLocal(playerPos.clone().sub(new THREE.Vector3(0, 0.05, 0.42)));
    const headYaw = THREE.MathUtils.clamp(Math.atan2(localPlayer.x, localPlayer.z), -0.85, 0.85);
    const headPitch = THREE.MathUtils.clamp(Math.atan2(localPlayer.y, Math.hypot(localPlayer.x, localPlayer.z)) * 0.7, -0.5, 0.5);
    this.headQ.setFromEuler(new THREE.Euler(-headPitch * (facePlayer ? 1 : 0.3), headYaw * (facePlayer ? 1 : 0.35), 0, 'YXZ'));
    this.head.quaternion.slerp(this.headQ, Math.min(1, dt * 4));

    // ---- 踢鳍：髋+膝相位差扑动（真 flutter kick）；慢速时幅度收小 ----
    this.finPhase += dt * (1.4 + speed * 2.2);
    const amp = 0.1 + Math.min(0.26, speed * 0.11);
    const kickL = Math.sin(this.finPhase) * amp;
    const kickR = Math.sin(this.finPhase + Math.PI) * amp;
    this.hipL.rotation.x = kickL;
    this.hipR.rotation.x = kickR;
    // 膝关节滞后 0.9 相位：向下踢时腿伸直、回摆时膝屈——水下扑动的真实节奏
    this.kneeL.rotation.x = Math.max(0, Math.sin(this.finPhase - 0.9)) * amp * 1.6;
    this.kneeR.rotation.x = Math.max(0, Math.sin(this.finPhase + Math.PI - 0.9)) * amp * 1.6;

    // ---- 手势演出 ----
    this.updateGesture(dt, time);
  }

  private updateGesture(dt: number, time: number): void {
    const TS = Buddy.TRIM_SHOULDER;
    const TE = Buddy.TRIM_ELBOW;
    const back = (g: THREE.Group, target: number, k: number): void => {
      g.rotation.x += (target - g.rotation.x) * k;
    };
    // 灯光默认：随身前方微摆；四肢缓慢回 trim
    if (this.gestureKind === null) {
      this.lampTarget.position.set(
        0.24 + Math.sin(time * 0.8) * 0.5,
        -0.14 + Math.cos(time * 0.7) * 0.4,
        8,
      );
      const k = Math.min(1, dt * 3);
      back(this.shoulderR, TS, k);
      back(this.shoulderL, TS, k);
      back(this.elbowR, TE, k);
      back(this.elbowL, TE, k);
      this.shoulderR.rotation.z += (0 - this.shoulderR.rotation.z) * k;
      this.shoulderL.rotation.z += (0 - this.shoulderL.rotation.z) * k;
      return;
    }

    this.gestureT += dt;
    const k = Math.min(1, this.gestureT * 3); // 进入姿态的缓动
    const pose = (sh: number, el: number): void => {
      this.shoulderR.rotation.x = TS + (sh - TS) * k;
      this.elbowR.rotation.x = TE + (el - TE) * k;
    };
    switch (this.gestureKind) {
      case 'ok': {
        // 右臂抬起，灯画圈（OK 灯语）
        pose(1.0, 0.15);
        const a = this.gestureT * 4.2;
        this.lampTarget.position.set(0.24 + Math.cos(a) * 1.6, -0.14 + Math.sin(a) * 1.6, 7);
        break;
      }
      case 'attention': {
        // 灯快速横扫（注意/紧急）
        pose(0.9, 0.2);
        this.lampTarget.position.set(Math.sin(this.gestureT * 9) * 3.2, -0.1, 7);
        break;
      }
      case 'airCheck': {
        // 左手拍压力表（肘深屈把手带到胸前），右臂半举示意"报气量"
        this.shoulderL.rotation.x = TS + (0.1 - TS) * k;
        this.elbowL.rotation.x = TE + (1.9 - TE) * k * (1 + Math.sin(this.gestureT * 6) * 0.06);
        this.shoulderL.rotation.z = 0.35 * k;
        pose(0.4, 0.6);
        break;
      }
      case 'stop': {
        // 掌心向前：停（臂伸直，肘锁定）
        pose(1.5, 0.05);
        this.lampTarget.position.set(0.24, -0.14, 8);
        break;
      }
      case 'up': {
        // 拇指向上：上升/结束潜水（洞潜里这不是"好"，是命令）
        pose(2.4, 0.0);
        this.lampTarget.position.set(0.24, 6, 3);
        break;
      }
      case 'point': {
        // 指向目标方向，灯照过去
        pose(0.9, 0.15);
        const world = this.pointDir.clone().multiplyScalar(9);
        const local = this.group.worldToLocal(this.group.position.clone().add(world));
        this.lampTarget.position.copy(local);
        break;
      }
      case 'slow': {
        // 掌心向下缓拍：慢下来（呼吸、鳍法、心率都慢下来）
        const pat = Math.sin(this.gestureT * 2.6) * 0.18;
        pose(0.7 + pat, 0.5);
        this.shoulderR.rotation.z = -0.25 * k;
        this.lampTarget.position.set(0.24, -2.2 + pat * 2, 6);
        break;
      }
      case 'line': {
        // 指线：手指向下方的导览线，灯打在线上（「线是唯一的家」）
        pose(0.15, 0.25);
        this.shoulderR.rotation.z = -0.15 * k;
        this.lampTarget.position.set(0.3, -3.4, 4.5);
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
