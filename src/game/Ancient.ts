import * as THREE from 'three';
import type { Cave } from './Cave';
import { particleSprite } from './textures';

/**
 * 远古生物 ·「奇虾」（Anomalocaris，docs/GAME_DESIGN.md §3.1）：
 * 程序化分节躯干 + 双列波动侧鳍（后掠相位波）+ 前附肢 + 柄眼 + 尾扇。
 * 体长 ~13m（不该有的尺寸）。唯一一次目击脚本：
 * 从深渊井升起 → 横越大厅 → 柄眼扫过玩家 → 沉回黑暗。
 */
export class Ancient {
  readonly group = new THREE.Group();
  /** 演出进行中 */
  playing = false;
  /** 演出完成 */
  done = false;

  private path!: THREE.CatmullRomCurve3;
  private elapsed = 0;
  private readonly DURATION = 38;
  private flapsL: THREE.Object3D[] = [];
  private flapsR: THREE.Object3D[] = [];
  private eyes: THREE.Mesh[] = [];
  private eyeMat: THREE.MeshStandardMaterial;
  private eyeGlows: THREE.Sprite[] = [];
  private photoMat: THREE.PointsMaterial;
  private rim: THREE.PointLight;
  private under: THREE.PointLight;
  private prevTan = new THREE.Vector3(0, 0, 1);

  constructor(cave: Cave, scene: THREE.Scene) {
    const body = new THREE.MeshStandardMaterial({
      color: 0x6a3428,
      roughness: 0.55,
      metalness: 0.08,
      emissive: 0x1e0d08,
    });
    const belly = new THREE.MeshStandardMaterial({
      color: 0x8a6a52,
      roughness: 0.6,
      emissive: 0x1c160e,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a1c,
      emissive: 0x86c86a,
      emissiveIntensity: 0.7,
      roughness: 0.25,
    });

    // ---------- 分节躯干（前进方向 +Z） ----------
    const segN = 12;
    for (let i = 0; i < segN; i++) {
      const k = i / (segN - 1);
      const r = 0.45 + Math.sin(Math.min(1, k * 1.35) * Math.PI) * 0.72; // 前 1/3 最宽
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), i % 2 ? body : belly);
      seg.scale.set(1.5, 0.62, 1.05);
      seg.position.set(0, Math.sin(k * 2.2) * 0.12, 4.6 - i * 1.05);
      this.group.add(seg);
    }

    // ---------- 头部 + 柄眼 + 前附肢 ----------
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.78, 12, 9), body);
    head.scale.set(1.35, 0.6, 1.3);
    head.position.set(0, 0.08, 5.3);
    this.group.add(head);
    for (const s of [-1, 1]) {
      // 柄眼
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.72, 6), body);
      stalk.position.set(s * 0.62, 0.55, 5.45);
      stalk.rotation.z = -s * 0.5;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), this.eyeMat);
      eye.position.set(s * 0.92, 0.86, 5.5);
      this.eyes.push(eye);
      const eg = new THREE.Sprite(new THREE.SpriteMaterial({
        map: particleSprite(),
        color: 0x9fe87a,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      eg.scale.setScalar(1.1);
      eg.position.copy(eye.position);
      this.eyeGlows.push(eg);
      this.group.add(stalk, eye, eg);
      // 前附肢：向下前方蜷曲的分节链
      let px = s * 0.42, py = -0.32, pz = 6.0;
      let ang = -0.5;
      for (let k = 0; k < 7; k++) {
        const len = 0.62 - k * 0.055;
        const claw = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - k * 0.016, 0.11 - k * 0.013, len, 6), body);
        claw.position.set(px, py + Math.sin(ang) * len * 0.5, pz + Math.cos(ang) * len * 0.5);
        claw.rotation.x = Math.PI / 2 - ang;
        // 每节小刺
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 4), body);
        spike.position.set(px, py + Math.sin(ang) * len * 0.5 - 0.16, pz + Math.cos(ang) * len * 0.5);
        spike.rotation.x = Math.PI;
        this.group.add(claw, spike);
        py += Math.sin(ang) * len;
        pz += Math.cos(ang) * len;
        ang -= 0.34; // 向下蜷
      }
    }

    // ---------- 双列波动侧鳍 ----------
    const flapGeo = new THREE.CircleGeometry(1, 5, -Math.PI / 2, Math.PI);
    flapGeo.scale(1.35, 0.62, 1);
    const flapMat = new THREE.MeshStandardMaterial({
      color: 0x7a4634,
      roughness: 0.6,
      emissive: 0x120806,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < 11; i++) {
      const k = i / 10;
      const w = 0.7 + Math.sin(Math.min(1, k * 1.3) * Math.PI) * 0.85;
      for (const s of [-1, 1]) {
        const pivot = new THREE.Object3D();
        pivot.position.set(s * (0.55 + w * 0.12), -0.1, 4.0 - i * 1.02);
        const flap = new THREE.Mesh(flapGeo, flapMat);
        flap.scale.setScalar(w);
        flap.rotation.set(-Math.PI / 2, 0, s > 0 ? 0 : Math.PI);
        flap.position.x = s * w * 0.55;
        pivot.add(flap);
        this.group.add(pivot);
        if (s < 0) this.flapsL.push(pivot);
        else this.flapsR.push(pivot);
      }
    }

    // ---------- 尾扇 ----------
    for (let k = 0; k < 3; k++) {
      for (const s of [-1, 1]) {
        const blade = new THREE.Mesh(flapGeo, flapMat);
        blade.scale.setScalar(0.9 - k * 0.18);
        blade.position.set(s * (0.25 + k * 0.24), 0.15 + k * 0.16, -7.2 - k * 0.35);
        blade.rotation.set(-Math.PI / 2 + 0.5 + k * 0.22, 0, s > 0 ? 0.4 : Math.PI - 0.4);
        this.group.add(blade);
      }
    }

    // 侧线发光点（虚构的深渊生物荧光——让 13m 轮廓在黑水里可读）
    const phRows = 13;
    const phPos = new Float32Array(phRows * 2 * 3);
    for (let i = 0; i < phRows; i++) {
      const kk = i / (phRows - 1);
      const w = 0.7 + Math.sin(Math.min(1, kk * 1.3) * Math.PI) * 0.85;
      for (let j = 0; j < 2; j++) {
        const s = j === 0 ? -1 : 1;
        const idx = (i * 2 + j) * 3;
        phPos[idx] = s * (0.5 + w * 0.5);
        phPos[idx + 1] = -0.02;
        phPos[idx + 2] = 4.4 - i * 0.95;
      }
    }
    const phGeo = new THREE.BufferGeometry();
    phGeo.setAttribute('position', new THREE.BufferAttribute(phPos, 3));
    this.photoMat = new THREE.PointsMaterial({
      map: particleSprite(),
      color: 0x8fe0e8,
      size: 0.58,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.group.add(new THREE.Points(phGeo, this.photoMat));

    // 冷色轮廓光：让它在黑水里"被看见但看不清"
    this.rim = new THREE.PointLight(0x3a6a78, 150, 60, 1.4);
    this.rim.position.set(0, 3.5, 0);
    this.group.add(this.rim);
    // 腹下冷青反光：横越大厅段离开井口辉光后，剪影仍能从下方被"生物光"托出（M4-L8）
    this.under = new THREE.PointLight(0x2f7a86, 90, 48, 1.5);
    this.under.position.set(0, -2.8, 1.5);
    this.group.add(this.under);

    // ---------- 巡游路径（井中升起 → 横越 → 回沉） ----------
    const pc = cave.pitCenter;
    const ab = cave.zoneRange('abyss');
    const { p: hallC } = cave.frameAt(0, (ab.t0 + ab.t1) / 2);
    this.path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(pc.x, pc.y - 22, pc.z),
      new THREE.Vector3(pc.x + 1, pc.y - 7, pc.z + 1),
      new THREE.Vector3(pc.x - 2, hallC.y - 3, pc.z + 5),
      new THREE.Vector3(hallC.x - 11, hallC.y + 2, hallC.z + 9),
      new THREE.Vector3(hallC.x - 14, hallC.y + 4.5, hallC.z - 5),
      new THREE.Vector3(hallC.x - 4, hallC.y + 6, hallC.z - 13),
      new THREE.Vector3(hallC.x + 7, hallC.y + 3, hallC.z - 10),
      new THREE.Vector3(pc.x + 2, pc.y + 1, pc.z - 3),
      new THREE.Vector3(pc.x, pc.y - 12, pc.z),
      new THREE.Vector3(pc.x, pc.y - 26, pc.z),
    ]);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** 启动目击演出 */
  play(): void {
    if (this.playing || this.done) return;
    this.playing = true;
    this.elapsed = 0;
    this.group.visible = true;
  }

  /** 调试：跳到演出进度 k（0..1） */
  skipTo(k: number): void {
    if (!this.playing) this.play();
    this.elapsed = Math.max(0, Math.min(1, k)) * this.DURATION;
  }

  /**
   * @returns 0..1 演出进度（未播放返回 -1）
   */
  update(dt: number, time: number, playerPos: THREE.Vector3): number {
    if (!this.playing) return this.done ? 1 : -1;
    this.elapsed += dt;
    const k = Math.min(1, this.elapsed / this.DURATION);
    // smoothstep 缓动：升起与回沉慢，横越稍快（处处连续）
    const ease = k * k * (3 - 2 * k);
    const t = Math.max(0.001, Math.min(0.999, ease));

    const pos = this.path.getPointAt(t);
    const tan = this.path.getTangentAt(t);
    this.group.position.copy(pos);
    // 朝向 + 转弯侧倾
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
    const bank = THREE.MathUtils.clamp(this.prevTan.clone().cross(tan).y * -18, -0.5, 0.5);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank);
    this.group.quaternion.slerp(q.multiply(roll), Math.min(1, dt * 3));
    this.prevTan.lerp(tan, Math.min(1, dt * 3)).normalize();

    // 侧鳍后掠波（metachronal wave）
    const phase = time * 3.1;
    for (let i = 0; i < this.flapsL.length; i++) {
      const w = Math.sin(phase - i * 0.62) * 0.5 - 0.12;
      this.flapsL[i].rotation.z = -w;
      this.flapsR[i].rotation.z = w;
    }
    // 躯干轻微起伏
    this.group.position.y += Math.sin(time * 0.9) * 0.25;

    // 柄眼：横越中段扫向玩家（被看的一眼）
    const gaze = k > 0.42 && k < 0.56;
    this.eyeMat.emissiveIntensity = gaze ? 2.6 + Math.sin(time * 7) * 0.6 : 0.7;
    for (const eg of this.eyeGlows) {
      (eg.material as THREE.SpriteMaterial).opacity = gaze ? 0.75 + Math.sin(time * 7) * 0.2 : 0.28;
    }
    if (gaze) {
      for (const eye of this.eyes) {
        const world = eye.getWorldPosition(new THREE.Vector3());
        const dir = playerPos.clone().sub(world).normalize();
        eye.lookAt(world.add(dir));
      }
    }
    // 侧线荧光沿身体缓慢呼吸；对视窗口随身灯提亮——"被看的一眼"必须可读，
    // 但保持「看得见看不清」的克制（M4-L8：全亮读作展示模型，半亮才是怪物）
    this.photoMat.opacity = 0.55 + Math.sin(time * 2.2) * 0.2 + (gaze ? 0.3 : 0);
    this.rim.intensity = (gaze ? 150 : 105) + Math.sin(time * 1.3) * 26;
    this.under.intensity = (gaze ? 95 : 70) + Math.sin(time * 1.7) * 18;

    if (k >= 1) {
      this.playing = false;
      this.done = true;
      this.group.visible = false;
    }
    return k;
  }
}
