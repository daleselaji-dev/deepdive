import * as THREE from 'three';
import type { Cave } from './Cave';
import type { InputManager } from './Input';

/** 第一人称游动：水体阻尼、隧道软约束、手电惯性延迟与手持晃动 */
export class Player {
  readonly camera: THREE.PerspectiveCamera;
  readonly flashlight: THREE.SpotLight;
  readonly lightRig = new THREE.Object3D();
  readonly position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  yaw = Math.PI; // 面向 -Z（洞的深处）
  pitch = 0;
  curveT = 0.01;
  /** 0..1，缺氧时降低操控性 */
  control = 1;
  swimPhase = 0;

  private lightTarget = new THREE.Object3D();
  private tmpDir = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(scene: THREE.Scene, aspect: number, isMobile: boolean) {
    this.camera = new THREE.PerspectiveCamera(isMobile ? 74 : 68, aspect, 0.08, 320);
    scene.add(this.camera);

    this.flashlight = new THREE.SpotLight(0xffd9a0, 0, 44, 0.46, 0.62, 1.15);
    this.flashlight.intensity = 0;
    this.lightRig.add(this.flashlight);
    this.lightRig.add(this.lightTarget);
    this.lightTarget.position.set(0, 0, -10);
    this.flashlight.target = this.lightTarget;
    scene.add(this.lightRig);
  }

  setStart(cave: Cave, t: number): void {
    this.curveT = t;
    this.position.copy(cave.pointAt(t));
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(this.position);
    this.lightRig.position.copy(this.position);
  }

  lightOn(v: number): void {
    this.flashlight.intensity = v;
  }

  update(dt: number, input: InputManager, cave: Cave, time: number): { speed: number } {
    // 视角
    const look = input.consumeLook();
    const sens = 0.0021 * this.control;
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
    this.velocity.addScaledVector(a, dt);
    // 水体阻尼
    this.velocity.multiplyScalar(Math.exp(-1.9 * dt));
    // 微弱负浮力（配平不完美的真实感）
    this.velocity.y -= 0.06 * dt;

    this.position.addScaledVector(this.velocity, dt);

    // 隧道软约束
    this.curveT = cave.nearestT(this.position, this.curveT);
    const center = cave.pointAt(this.curveT);
    const radial = this.position.clone().sub(center);
    const maxR = cave.radiusAt(this.curveT) - 0.72;
    const len = radial.length();
    if (len > maxR) {
      const n = radial.multiplyScalar(1 / len);
      this.position.copy(center).addScaledVector(n, maxR);
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
