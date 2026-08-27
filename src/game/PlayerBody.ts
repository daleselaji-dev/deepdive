import * as THREE from 'three';

/**
 * M5-L3 玩家第一人称身体：
 * - 持手电的右臂（前臂+手掌+指扣）与手电筒体——光不再凭空出现；
 * - 左臂：腕上潜水电脑（微光屏，随深度/氧气变色）；
 * - 二级头呼吸气泡：周期性一小串上浮（与呼吸节奏同源的计时器）；
 * - 游动摆动低幅（晕眩红线：只做位置微摆，不加镜头滚转）。
 * 挂载在 Player.lightRig 下（朝向带惯性延迟——手臂跟手电一起「慢半拍」，正是手持感）。
 */
export class PlayerBody {
  readonly group = new THREE.Group();
  /** 呼吸气泡（世界空间粒子） */
  private bubbles: THREE.Points;
  private bPos: Float32Array;
  private bVel: Float32Array;
  private bLife: Float32Array;
  private readonly N_BUB = 26;
  private nextBreathAt = 2.2;
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private screenMat: THREE.MeshStandardMaterial;
  private visible_ = false;

  constructor(scene: THREE.Scene, lightRig: THREE.Object3D, sprite: THREE.Texture) {
    const suit = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.92 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x1e2429, roughness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb5842e, roughness: 0.6, emissive: 0x2a1e08 });
    const alu = new THREE.MeshStandardMaterial({ color: 0x4c5459, metalness: 0.7, roughness: 0.42 });

    // 两点连线肢段：胶囊沿 from→to 取向并等长——手臂必须是「连起来的链条」，
    // 手写欧拉角摆散件在俯视时会裂成漂浮碎块（M5-L3 踩坑）
    const limb = (from: THREE.Vector3, to: THREE.Vector3, rad: number, m: THREE.Material): THREE.Mesh => {
      const dir = to.clone().sub(from);
      const len = dir.length();
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(rad, Math.max(0.01, len - rad * 0.8), 4, 10), m);
      mesh.position.copy(from).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      return mesh;
    };

    // ---- 右臂：持手电（平视时筒头探进右下角，光有出处；俯视时整条前臂从画外伸进来） ----
    const r = this.armR;
    const elbowR = new THREE.Vector3(0.34, -0.4, -0.1); // 画外（肩肘留给想象）
    const wristR = new THREE.Vector3(0.17, -0.21, -0.33);
    r.add(limb(elbowR, wristR, 0.042, suit));
    // 袖口环：轴向沿前臂
    const cuffR = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.009, 6, 14), accent);
    cuffR.position.copy(elbowR).lerp(wristR, 0.72);
    cuffR.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), wristR.clone().sub(elbowR).normalize());
    r.add(cuffR);
    // 手电筒体（指向 -Z，与 Player.flashlight 同轴）；筒尾顶在腕前
    const torchC = wristR.clone().add(new THREE.Vector3(0, 0.024, -0.055));
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.16, 10), alu);
    torch.rotation.x = Math.PI / 2;
    torch.position.copy(torchC);
    const torchHead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.023, 0.05, 10), alu);
    torchHead.rotation.x = Math.PI / 2;
    torchHead.position.copy(torchC).add(new THREE.Vector3(0, 0, -0.09));
    // 手掌自下包住筒尾 + 四指握环（缠绕筒身的环——散棍手指在斜视角读作毛毛虫腿，M5-L3 踩坑）
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), glove);
    palm.scale.set(1.05, 0.8, 1.3);
    palm.position.copy(wristR).add(new THREE.Vector3(0, 0.01, -0.02));
    r.add(torch, torchHead, palm);
    for (let i = 0; i < 4; i++) {
      const grip = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0085, 6, 12), glove);
      grip.position.copy(torchC).add(new THREE.Vector3(0, -0.004, 0.02 - i * 0.021));
      r.add(grip);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.04, 3, 6), glove);
    thumb.position.copy(torchC).add(new THREE.Vector3(-0.026, -0.006, 0.01));
    thumb.rotation.x = Math.PI / 2 - 0.25;
    r.add(thumb);

    // ---- 左臂：腕上潜水电脑（微收在画面左下，俯视/看表时可读屏） ----
    const l = this.armL;
    const elbowL = new THREE.Vector3(-0.36, -0.44, -0.06);
    const wristL = new THREE.Vector3(-0.19, -0.25, -0.3);
    const foreDirL = wristL.clone().sub(elbowL).normalize();
    l.add(limb(elbowL, wristL, 0.042, suit));
    // 手：半握拳（掌心向内）
    const handL = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), glove);
    handL.scale.set(0.95, 0.8, 1.25);
    handL.position.copy(wristL).addScaledVector(foreDirL, 0.05);
    l.add(handL);
    // 潜水电脑：腕带环绕前臂 + 表体在腕背（朝眼一侧）+ 微光屏
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.011, 6, 14), suit);
    strap.position.copy(wristL).addScaledVector(foreDirL, -0.035);
    strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), foreDirL);
    // 腕背方向：从腕指向眼(原点)的分量中去掉前臂方向 → 屏面自然朝向视线
    const toEye = wristL.clone().negate().addScaledVector(foreDirL, -wristL.clone().negate().dot(foreDirL)).normalize();
    const dcC = wristL.clone().addScaledVector(foreDirL, -0.035).addScaledVector(toEye, 0.05);
    const dcBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 12), alu);
    dcBody.position.copy(dcC);
    dcBody.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toEye);
    this.screenMat = new THREE.MeshStandardMaterial({
      color: 0x0a1210, emissive: 0x3fae8e, emissiveIntensity: 1.6, roughness: 0.3,
    });
    const dcFace = new THREE.Mesh(new THREE.CircleGeometry(0.024, 12), this.screenMat);
    dcFace.position.copy(dcC).addScaledVector(toEye, 0.008);
    dcFace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toEye);
    l.add(strap, dcBody, dcFace);

    this.group.add(r, l);
    this.group.visible = false;
    lightRig.add(this.group);

    // ---- 呼吸气泡（世界空间；隐藏时不发射） ----
    this.bPos = new Float32Array(this.N_BUB * 3);
    this.bVel = new Float32Array(this.N_BUB * 3);
    this.bLife = new Float32Array(this.N_BUB); // <=0 表示空闲
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3));
    this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({
      map: sprite,
      size: 0.085,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }));
    this.bubbles.frustumCulled = false;
    scene.add(this.bubbles);
    for (let i = 0; i < this.N_BUB; i++) this.bPos[i * 3 + 1] = -999;
  }

  setVisible(v: boolean): void {
    this.visible_ = v;
    this.group.visible = v;
  }

  /** M5-L4 气泡帘穿越演出：视野四周一次性炸开一圈密集小泡（复用呼吸泡粒子池） */
  burst(camPos: THREE.Vector3, camQuat: THREE.Quaternion): void {
    const dir = new THREE.Vector3();
    let emitted = 0;
    for (let i = 0; i < this.N_BUB && emitted < 14; i++) {
      if (this.bLife[i] > 0) continue;
      emitted++;
      this.bLife[i] = 1 + Math.random() * 0.8;
      const a = Math.random() * Math.PI * 2;
      const rr = 0.35 + Math.random() * 0.5;
      dir.set(Math.cos(a) * rr, (Math.random() - 0.5) * 0.5, -0.4 - Math.random() * 0.6).applyQuaternion(camQuat);
      this.bPos[i * 3] = camPos.x + dir.x;
      this.bPos[i * 3 + 1] = camPos.y + dir.y;
      this.bPos[i * 3 + 2] = camPos.z + dir.z;
      this.bVel[i * 3] = (Math.random() - 0.5) * 0.5;
      this.bVel[i * 3 + 1] = 0.8 + Math.random() * 0.7;
      this.bVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    (this.bubbles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * @param exhaling 允许发射气泡（水下且非气穴/水面）
   * @param camPos 相机世界位置（气泡从头侧发射）
   * @param camQuat 相机朝向
   */
  update(
    dt: number, time: number, speed: number, sprint: boolean,
    exhaling: boolean, camPos: THREE.Vector3, camQuat: THREE.Quaternion,
    o2fraction: number,
  ): void {
    if (this.visible_) {
      // 游动摆动：手臂随速度微摆；冲刺时前臂内收（拉水姿态暗示）
      const sway = Math.sin(time * 1.6) * 0.006 + Math.min(0.02, speed * 0.004);
      this.armR.position.y = sway;
      this.armR.position.x = sprint ? -0.015 : 0;
      this.armL.position.y = Math.sin(time * 1.6 + 1.4) * 0.006;
      this.armL.position.x = sprint ? 0.015 : 0;
      // 潜水电脑屏色：氧气充足青绿 → 低氧橙红（余光可感知的状态灯）
      const warn = o2fraction < 0.3;
      this.screenMat.emissive.setHex(warn ? 0xc86a2a : 0x3fae8e);
      this.screenMat.emissiveIntensity = warn ? 1.9 + Math.sin(time * 6) * 0.7 : 1.6;
    }

    // ---- 气泡发射：约 3.8s 一次呼气（visible 且水下） ----
    if (this.visible_ && exhaling && time >= this.nextBreathAt) {
      this.nextBreathAt = time + 3.4 + Math.random() * 0.9;
      const side = new THREE.Vector3(0.16, 0.02, -0.05).applyQuaternion(camQuat);
      let emitted = 0;
      for (let i = 0; i < this.N_BUB && emitted < 7; i++) {
        if (this.bLife[i] > 0) continue;
        emitted++;
        this.bLife[i] = 1.9 + Math.random() * 0.9;
        this.bPos[i * 3] = camPos.x + side.x + (Math.random() - 0.5) * 0.08;
        this.bPos[i * 3 + 1] = camPos.y + side.y + (Math.random() - 0.5) * 0.05;
        this.bPos[i * 3 + 2] = camPos.z + side.z + (Math.random() - 0.5) * 0.08;
        this.bVel[i * 3] = (Math.random() - 0.5) * 0.14;
        this.bVel[i * 3 + 1] = 0.5 + Math.random() * 0.35;
        this.bVel[i * 3 + 2] = (Math.random() - 0.5) * 0.14;
      }
    }
    // 气泡上浮 + 摆动 + 消亡
    let any = false;
    for (let i = 0; i < this.N_BUB; i++) {
      if (this.bLife[i] <= 0) continue;
      any = true;
      this.bLife[i] -= dt;
      if (this.bLife[i] <= 0) {
        this.bPos[i * 3 + 1] = -999;
        continue;
      }
      this.bVel[i * 3 + 1] += 0.55 * dt; // 越浮越快（膨胀）
      this.bPos[i * 3] += (this.bVel[i * 3] + Math.sin(time * 5 + i * 2.1) * 0.05) * dt;
      this.bPos[i * 3 + 1] += this.bVel[i * 3 + 1] * dt;
      this.bPos[i * 3 + 2] += this.bVel[i * 3 + 2] * dt;
    }
    if (any || this.visible_) {
      (this.bubbles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
