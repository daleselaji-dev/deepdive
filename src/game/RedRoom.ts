import * as THREE from 'three';
import { zigzagTexture } from './textures';

/**
 * 结局 A ·「红厅」：红帷幕环形空间 + 黑白锯齿地纹（Twin Peaks 致意）
 * + 发光巨型竹节虫（《极乐迪斯科》式温柔的不可名状）。
 * 见 docs/GAME_DESIGN.md §3.1。
 */
export class RedRoom {
  readonly group = new THREE.Group();
  readonly anchor = new THREE.Vector3(0, 400, 0);
  private curtains: THREE.Mesh[] = [];
  private curtainBase: Float32Array[] = [];
  private phasmid = new THREE.Group();
  private phasmidLight: THREE.PointLight;
  private keyLights: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene) {
    this.group.position.copy(this.anchor);

    // 锯齿地面
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshStandardMaterial({ map: zigzagTexture(), color: 0xb5ad98, roughness: 0.72 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // 红帷幕：16 片 CPU 波动
    const curtainMat = new THREE.MeshStandardMaterial({
      color: 0x5a0b0b,
      roughness: 0.85,
      side: THREE.DoubleSide,
      emissive: 0x200404,
    });
    const R = 10;
    for (let i = 0; i < 16; i++) {
      const geo = new THREE.PlaneGeometry(4.4, 9.5, 10, 26);
      const mesh = new THREE.Mesh(geo, curtainMat);
      const ang = (i / 16) * Math.PI * 2;
      mesh.position.set(Math.cos(ang) * R, 4.7, Math.sin(ang) * R);
      mesh.lookAt(0, 4.7, 0);
      this.group.add(mesh);
      this.curtains.push(mesh);
      this.curtainBase.push(new Float32Array(geo.attributes.position.array));
    }

    // 顶部红色穹隆（封闭空间）
    const dome = new THREE.Mesh(
      new THREE.CircleGeometry(11, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a0606, roughness: 1 }),
    );
    dome.rotation.x = Math.PI / 2;
    dome.position.y = 9.4;
    this.group.add(dome);

    // 布光：暖白主光 ×2 + 红氛围（压暗，红为主）
    const key1 = new THREE.PointLight(0xffe2c0, 38, 30, 1.6);
    key1.position.set(3, 7.5, 3);
    const key2 = new THREE.PointLight(0xffd0a8, 20, 26, 1.7);
    key2.position.set(-4, 6, -2);
    const redAmb = new THREE.PointLight(0xc8341f, 34, 34, 1.5);
    redAmb.position.set(0, 2.4, 0);
    this.keyLights.push(key1, key2, redAmb);
    this.group.add(key1, key2, redAmb);

    // 竹节虫
    this.buildPhasmid();
    this.phasmid.position.set(0, 2.5, -1.2);
    this.group.add(this.phasmid);
    this.phasmidLight = new THREE.PointLight(0xcfe8d0, 26, 18, 1.7);
    this.phasmidLight.position.set(0, 3.8, -1.2);
    this.group.add(this.phasmidLight);

    this.group.visible = false;
    scene.add(this.group);
  }

  private buildPhasmid(): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb8ccb4,
      emissive: 0x39543c,
      roughness: 0.42,
    });
    // 体节链：细长弓形
    const bodyCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -2.4),
      new THREE.Vector3(0, 0.7, -1.1),
      new THREE.Vector3(0, 1.0, 0.4),
      new THREE.Vector3(0, 0.65, 1.8),
      new THREE.Vector3(0, 1.15, 3.0),
    ]);
    const body = new THREE.Mesh(new THREE.TubeGeometry(bodyCurve, 40, 0.14, 8), mat);
    this.phasmid.add(body);
    // 头与触须
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), mat);
    head.position.set(0, 1.2, 3.05);
    head.scale.set(0.8, 0.8, 1.4);
    this.phasmid.add(head);
    for (const s of [-1, 1]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.7, 5), mat);
      ant.position.set(s * 0.16, 1.85, 3.5);
      ant.rotation.set(0.7, 0, s * 0.35);
      this.phasmid.add(ant);
    }
    // 六足：折线细腿
    const legSeg = new THREE.CylinderGeometry(0.03, 0.022, 1.9, 5);
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const hip = new THREE.Group();
        hip.position.set(s * 0.1, 0.55, -1.4 + i * 1.7);
        const upper = new THREE.Mesh(legSeg, mat);
        upper.position.set(s * 0.75, 0.25, 0);
        upper.rotation.z = s * 1.15;
        const lower = new THREE.Mesh(legSeg, mat);
        lower.position.set(s * 1.65, -0.85, 0);
        lower.rotation.z = s * 0.32;
        hip.add(upper, lower);
        this.phasmid.add(hip);
      }
    }
    this.phasmid.scale.setScalar(1.55);
  }

  show(): void {
    this.group.visible = true;
  }

  /** 玩家在红厅中的初始视点 */
  get entryPos(): THREE.Vector3 {
    return this.anchor.clone().add(new THREE.Vector3(0, 1.7, 8.6));
  }

  update(_dt: number, time: number): void {
    if (!this.group.visible) return;
    // 帷幕波动
    for (let i = 0; i < this.curtains.length; i++) {
      const geo = this.curtains[i].geometry as THREE.PlaneGeometry;
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const base = this.curtainBase[i];
      for (let v = 0; v < posAttr.count; v++) {
        const x = base[v * 3];
        const y = base[v * 3 + 1];
        const wave =
          Math.sin(x * 2.6 + time * 0.7 + i * 1.3) * 0.16 + Math.sin(y * 1.2 + time * 0.4 + i) * 0.1;
        posAttr.setZ(v, wave * (0.4 + (4.75 - Math.min(4.75, Math.abs(y))) * 0.12));
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
    }
    // 竹节虫：缓慢呼吸式起伏与偏摆
    this.phasmid.position.y = 2.5 + Math.sin(time * 0.5) * 0.28;
    this.phasmid.rotation.y = Math.sin(time * 0.21) * 0.5;
    this.phasmid.rotation.z = Math.sin(time * 0.33) * 0.06;
    this.phasmidLight.intensity = 22 + Math.sin(time * 1.7) * 6 + Math.sin(time * 4.3) * 3;
    // 主光极缓慢脉动（房间在"呼吸"）
    this.keyLights[0].intensity = 36 + Math.sin(time * 0.23) * 7;
  }
}
