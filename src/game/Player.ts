import * as THREE from 'three';
import type { Cave } from './Cave';
import type { InputManager } from './Input';

/** 第一人称游动：水体阻尼、多路径隧道软约束、手电惯性延迟与手持晃动 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly flashlight: THREE.SpotLight;
  readonly lightRig = new THREE.Object3D();
  readonly position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = 0; // 默认朝向 -Z（洞的深处）
  pitch = 0;
  /** 当前所在路径（0 主脉 / 1 祭坛支线 / 2 错绳支线） */
  pathId = 0;
  /** 当前路径上的样条进度 */
  curveT = 0.01;
  /** 最近一次在主脉上的进度（叙事触发用） */
  mainT = 0.01;
  /** 0..1，缺氧时降低操控性 */
  control = 1;
  /** 表层模式：贴水面游（回程破水后） */
  surfaceMode = false;
  swimPhase = 0;

  private lightTarget = new THREE.Object3D();
  private tmpDir = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(scene: THREE.Scene, aspect: number, isMobile: boolean) {
    this.camera = new THREE.PerspectiveCamera(isMobile ? 74 : 68, aspect, 0.08, 340);
    scene.add(this.camera);

    this.flashlight = new THREE.SpotLight(0xffd9a0, 0, 52, 0.48, 0.78, 1.05);
    this.flashlight.intensity = 0;
    this.lightRig.add(this.flashlight);
    this.lightRig.add(this.lightTarget);
    this.lightTarget.position.set(0, 0, -10);
    this.flashlight.target = this.lightTarget;
    scene.add(this.lightRig);
  }

  setStart(cave: Cave, t: number): void {
    this.pathId = 0;
    this.curveT = t;
    this.mainT = t;
    this.position.copy(cave.pointAt(t));
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(this.position);
    this.lightRig.position.copy(this.position);
  }

  lightOn(v: number): void {
    this.flashlight.intensity = v;
  }

  get depth(): number {
    return Math.max(0, -this.position.y);
  }

  update(dt: number, input: InputManager, cave: Cave, time: number): { speed: number } {
    // 视角
    const look = input.consumeLook();
    const sens = 0.0021 * Math.max(0.25, this.control);
    this.yaw -= look.dx * sens;
    this.pitch -= look.dy * sens;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));

    // 推进
    input.poll();
    this.euler.set(this.pitch, this.yaw, 0);
    this.tmpQuat.setFromEuler(this.euler);
    const forward = this.tmpDir.set(0, 0, -1).applyQuaternion(this.tmpQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.tmpQuat);

    const accel = (input.sprint ? 9.5 : 5.2) * this.control;
    const a = new THREE.Vector3()
      .addScaledVector(forward, input.moveZ * accel)
      .addScaledVector(right, input.moveX * accel * 0.75);
    if (this.surfaceMode) a.y = 0; // 表层：不下潜
    this.velocity.addScaledVector(a, dt);
    // 水体阻尼
    this.velocity.multiplyScalar(Math.exp(-1.9 * dt));
    // 微弱负浮力（配平不完美的真实感）；表层为浮力托举
    if (!this.surfaceMode) this.velocity.y -= 0.06 * dt;

    this.position.addScaledVector(this.velocity, dt);

    if (this.surfaceMode) {
      // 浮在水面：头在水上（眼位高于水面才能看见晨光世界，而不是水面背侧的暗镜面）
      this.position.y = 0.34 + Math.sin(time * 1.3) * 0.05 + Math.sin(time * 2.7) * 0.025;
      this.velocity.y = 0;
    }

    // 多路径隧道软约束
    const hit = cave.resolve(this.position, this.pathId, this.curveT);
    this.pathId = hit.pathId;
    this.curveT = hit.t;
    if (hit.pathId === 0) this.mainT = hit.t;
    const margin = 0.55 + hit.radius * 0.1;
    const maxR = hit.radius - margin;
    const radial = this.position.clone().sub(hit.center);
    const len = radial.length();
    if (len > maxR) {
      const n = radial.multiplyScalar(1 / len);
      this.position.copy(hit.center).addScaledVector(n, maxR);
      const vn = this.velocity.dot(n);
      if (vn > 0) this.velocity.addScaledVector(n, -vn * 1.25); // 缓冲反弹
    }

    // 相机：游动摆动 + 转头惯性滚转
    const speed = this.velocity.length();
    this.swimPhase += dt * (1.2 + speed * 0.55);
    const bobY = Math.sin(this.swimPhase * 1.7) * 0.02 * Math.min(1, speed);
    const roll = Math.sin(this.swimPhase * 0.8) * 0.008 + look.dx * -0.00012;
    this.camera.position.copy(this.position);
    this.camera.position.y += bobY + Math.sin(time * 0.7) * 0.012;
    this.euler.set(this.pitch, this.yaw, roll);
    this.camera.quaternion.setFromEuler(this.euler);

    // 手电惯性：位置紧随、朝向延迟 + 手持晃动
    this.lightRig.position.lerp(this.camera.position, Math.min(1, 18 * dt));
    const lag = Math.min(1, 6.5 * dt);
    this.lightRig.quaternion.slerp(this.camera.quaternion, lag);
    this.flashlight.position.set(0.14, -0.12, 0.05);
    this.lightTarget.position.set(
      Math.sin(time * 1.1) * 0.24 + Math.sin(time * 2.7) * 0.07,
      Math.cos(time * 0.9) * 0.2,
      -10,
    );

    return { speed };
  }
}
