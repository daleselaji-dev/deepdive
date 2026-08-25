import * as THREE from 'three';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import type { Models, MeshAsset } from './Models';
import { particleSprite, bubbleSprite } from './textures';

/**
 * 可交互洞穴生态（docs/GAME_DESIGN.md §5）：
 * - 银汉鱼群：天光井光柱绕游，玩家靠近惊散。真实拓扑鱼模型实例（Models.ts）。
 * - 巡游大鱼：光之厅/沉船厅独游的大个体，怕光缓慢避让。
 * - 盲眼洞鱼：贴壁游弋，被手电长照会缓慢趋光（细思恐）。
 * - 浮游发光体：快速游过时脉冲蓝光尾迹。
 * - 深渊水母群：缓慢升降，靠近时收缩闪光并避让。
 * - 换气泡帘：大厅裂隙持续上涌的气泡柱。
 */

interface Fish {
  ang: number;
  radius: number;
  y: number;
  speed: number;
  bobPhase: number;
  scatter: THREE.Vector3;
  len: number;
}

interface Cruiser {
  pos: THREE.Vector3;
  home: THREE.Vector3;
  phase: number;
  len: number;
  wanderR: number;
  avoid: THREE.Vector3;
}

interface Jelly {
  group: THREE.Group;
  bell: THREE.Mesh;
  glow: THREE.Sprite;
  base: THREE.Vector3;
  phase: number;
  drift: THREE.Vector3;
  shrink: number;
}

export class Ecology {
  readonly group = new THREE.Group();

  private fishMesh: THREE.InstancedMesh | null = null;
  private fish: Fish[] = [];
  private fishCenter: THREE.Vector3;
  private fishSource: 'pending' | 'gltf' | 'procedural' = 'pending';

  private blindMesh: THREE.InstancedMesh | null = null;
  private blind: { pos: THREE.Vector3; home: THREE.Vector3; phase: number }[] = [];

  private cruiserMesh: THREE.InstancedMesh | null = null;
  private cruisers: Cruiser[] = [];

  private plankton: THREE.Points;
  private pkPos: Float32Array;
  private pkGlow: Float32Array;
  private pkCol: Float32Array;

  private jellies: Jelly[] = [];
  private vents: { pts: THREE.Points; pos: Float32Array; base: THREE.Vector3; h: number }[] = [];

  private dummy = new THREE.Object3D();

  constructor(q: QualityProfile, cave: Cave, scene: THREE.Scene, models: Models) {
    scene.add(this.group);
    this.fishCenter = new THREE.Vector3(cave.poolCenter.x, -6, cave.poolCenter.z);

    // ---------- 银汉鱼群（行为数据先建，网格待模型解码后挂载） ----------
    for (let i = 0; i < q.fish; i++) {
      this.fish.push({
        ang: Math.random() * Math.PI * 2,
        radius: 1.6 + Math.random() * 3.4,
        y: -2.5 - Math.random() * 7,
        speed: 0.35 + Math.random() * 0.4,
        bobPhase: Math.random() * Math.PI * 2,
        scatter: new THREE.Vector3(),
        len: 0.24 + Math.random() * 0.14,
      });
    }

    // ---------- 盲眼洞鱼 ----------
    const blindCount = Math.max(8, Math.floor(q.fish * 0.12));
    const zones: ['hall' | 'wreck', number][] = [['hall', 0.4], ['wreck', 0.5]];
    for (let i = 0; i < blindCount; i++) {
      const [zn, frac] = zones[i % zones.length];
      const zr = cave.zoneRange(zn);
      const t = zr.t0 + (zr.t1 - zr.t0) * (frac + (Math.random() - 0.5) * 0.3);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.55;
      const home = c.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * r,
        (Math.random() - 0.5) * r * 0.6,
        (Math.random() - 0.5) * r,
      ));
      this.blind.push({ pos: home.clone(), home, phase: Math.random() * 10 });
    }

    // ---------- 巡游大鱼（光之厅 / 沉船厅 / 深渊各 1-2 条独游个体） ----------
    const cruiserZones: ['hall' | 'wreck' | 'abyss', number][] = q.tier === 'mobile'
      ? [['hall', 0.5], ['wreck', 0.4]]
      : [['hall', 0.35], ['hall', 0.7], ['wreck', 0.4], ['abyss', 0.35]];
    for (const [zn, frac] of cruiserZones) {
      const zr = cave.zoneRange(zn);
      const t = zr.t0 + (zr.t1 - zr.t0) * frac;
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const home = c.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * r * 0.5,
        r * 0.1 + Math.random() * r * 0.25,
        (Math.random() - 0.5) * r * 0.5,
      ));
      this.cruisers.push({
        pos: home.clone(),
        home,
        phase: Math.random() * Math.PI * 2,
        len: 0.9 + Math.random() * 0.5,
        wanderR: Math.max(2.5, r * 0.42),
        avoid: new THREE.Vector3(),
      });
    }

    // 模型解码完成后挂载三种鱼网格（data URI 解码近乎即时；失败自动程序化中模）
    void models.fish.then((asset) => this.mountFishMeshes(q, asset));

    // ---------- 浮游发光体 ----------
    const n = q.plankton;
    this.pkPos = new Float32Array(n * 3);
    this.pkGlow = new Float32Array(n);
    this.pkCol = new Float32Array(n * 3);
    const haloT = cave.zoneRange('halo');
    const abyssT = cave.zoneRange('abyss');
    for (let i = 0; i < n; i++) {
      const t = haloT.t0 + Math.random() * (abyssT.t1 - haloT.t0);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.85;
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      this.pkPos[i * 3] = c.x + Math.cos(ang) * rr;
      this.pkPos[i * 3 + 1] = c.y + (Math.random() - 0.5) * r * 1.2;
      this.pkPos[i * 3 + 2] = c.z + Math.sin(ang) * rr;
      this.pkGlow[i] = 0;
    }
    const pkGeo = new THREE.BufferGeometry();
    pkGeo.setAttribute('position', new THREE.BufferAttribute(this.pkPos, 3));
    pkGeo.setAttribute('color', new THREE.BufferAttribute(this.pkCol, 3));
    const pkMat = new THREE.PointsMaterial({
      map: particleSprite(),
      size: 0.08,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.plankton = new THREE.Points(pkGeo, pkMat);
    this.group.add(this.plankton);

    // ---------- 深渊水母群 ----------
    const bellMat = new THREE.MeshStandardMaterial({
      color: 0x2a4a52,
      emissive: 0x3a7a8c,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    const glowTex = particleSprite();
    const { p: abyssC } = cave.frameAt(0, (abyssT.t0 + abyssT.t1) / 2);
    for (let i = 0; i < q.jellies; i++) {
      const g = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat.clone());
      g.add(bell);
      // 触手
      for (let k = 0; k < 5; k++) {
        const tent = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.016, 1.6 + Math.random(), 4),
          new THREE.MeshStandardMaterial({
            color: 0x2a4a52,
            emissive: 0x2a6a7c,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.4,
          }),
        );
        tent.position.set(Math.sin(k * 1.26) * 0.28, -0.9, Math.cos(k * 1.26) * 0.28);
        g.add(tent);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0x66c8d8,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(2.4);
      g.add(glow);
      const base = abyssC.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 22,
        (Math.random() - 0.3) * 12,
        (Math.random() - 0.5) * 22,
      ));
      // 出生点至少离大厅中轴 7m：装饰性生物不该出现在玩家行进路线上
      const dx = base.x - abyssC.x;
      const dz = base.z - abyssC.z;
      const dHoriz = Math.hypot(dx, dz);
      if (dHoriz < 7) {
        const push = dHoriz < 0.01 ? { x: 1, z: 0 } : { x: dx / dHoriz, z: dz / dHoriz };
        base.x = abyssC.x + push.x * (7 + Math.random() * 3);
        base.z = abyssC.z + push.z * (7 + Math.random() * 3);
      }
      g.position.copy(base);
      const s = 0.6 + Math.random() * 1.1;
      g.scale.setScalar(s);
      this.group.add(g);
      this.jellies.push({
        group: g, bell, glow, base,
        phase: Math.random() * Math.PI * 2,
        drift: new THREE.Vector3(),
        shrink: 0,
      });
    }

    // ---------- 气泡帘（光之厅 + 深渊井口） ----------
    const ventDefs: [THREE.Vector3, number][] = [
      [new THREE.Vector3(cave.crackPoint.x - 6, cave.crackPoint.y - 20, cave.crackPoint.z + 5), 14],
      [new THREE.Vector3(cave.pitCenter.x + 3.4, cave.pitCenter.y, cave.pitCenter.z - 2), 16],
    ];
    const bubTex = bubbleSprite();
    for (const [base, h] of ventDefs) {
      const count = q.tier === 'mobile' ? 40 : 90;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = base.x + (Math.random() - 0.5) * 0.7;
        pos[i * 3 + 1] = base.y + Math.random() * h;
        pos[i * 3 + 2] = base.z + (Math.random() - 0.5) * 0.7;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        map: bubTex,
        size: 0.06,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      this.group.add(pts);
      this.vents.push({ pts, pos, base, h });
    }
  }

  /** 模型解码完成 → 建三种鱼的 InstancedMesh（银汉鱼群 / 盲鱼 / 巡游大鱼） */
  private mountFishMeshes(q: QualityProfile, asset: MeshAsset): void {
    this.fishSource = asset.source;

    // 银汉鱼群：银蓝色调 + 微弱冷发光（黑水里可读）
    const schoolMat = asset.material.clone();
    schoolMat.metalness = Math.max(schoolMat.metalness, 0.35);
    schoolMat.roughness = Math.min(schoolMat.roughness, 0.5);
    schoolMat.emissive = new THREE.Color(0x101c1c);
    schoolMat.color.multiply(new THREE.Color(0xbcd4d8));
    this.fishMesh = new THREE.InstancedMesh(asset.geometry, schoolMat, q.fish);
    this.fishMesh.frustumCulled = false;
    // 个体色差：银青微变
    const tint = new THREE.Color();
    for (let i = 0; i < q.fish; i++) {
      tint.setHSL(0.5 + Math.sin(i * 3.7) * 0.03, 0.12, 0.62 + Math.sin(i * 7.1) * 0.1);
      this.fishMesh.setColorAt(i, tint);
    }
    this.group.add(this.fishMesh);

    // 盲眼洞鱼：无色素的苍白（洞穴特有种不需要贴图色）
    const blindMat = new THREE.MeshStandardMaterial({
      color: 0xd8cfc4,
      roughness: 0.55,
      emissive: 0x2a2620,
      side: asset.source === 'procedural' ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.blindMesh = new THREE.InstancedMesh(asset.geometry, blindMat, this.blind.length);
    this.blindMesh.frustumCulled = false;
    this.group.add(this.blindMesh);

    // 巡游大鱼：保留原贴图（近看细节），色调压暗融入深水
    const cruiserMat = asset.material.clone();
    cruiserMat.color.multiply(new THREE.Color(0x9ab4ac));
    cruiserMat.emissive = new THREE.Color(0x0a1210);
    this.cruiserMesh = new THREE.InstancedMesh(asset.geometry, cruiserMat, this.cruisers.length);
    this.cruiserMesh.frustumCulled = false;
    this.group.add(this.cruiserMesh);
  }

  /** 调试：鱼资产来源与规模（无头回归断言用） */
  fishInfo(): { source: string; school: number; blind: number; cruisers: number } {
    return {
      source: this.fishSource,
      school: this.fish.length,
      blind: this.blind.length,
      cruisers: this.cruisers.length,
    };
  }

  update(dt: number, time: number, playerPos: THREE.Vector3, playerSpeed: number): void {
    this.updateFish(dt, time, playerPos);
    this.updateBlind(dt, time, playerPos);
    this.updateCruisers(dt, time, playerPos);
    this.updatePlankton(dt, time, playerPos, playerSpeed);
    this.updateJellies(dt, time, playerPos);
    this.updateVents(dt);
  }

  private updateFish(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.fishMesh) return;
    const c = this.fishCenter;
    const prev = new THREE.Vector3();
    const next = new THREE.Vector3();
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.ang += f.speed * dt * (1 + f.scatter.length() * 0.7);
      const bob = Math.sin(time * 0.8 + f.bobPhase) * 0.4;
      prev.set(c.x + Math.cos(f.ang) * f.radius, f.y + bob, c.z + Math.sin(f.ang) * f.radius);
      // 惊散：4m 内被推离
      const d2 = prev.distanceToSquared(playerPos);
      if (d2 < 16) {
        const away = prev.clone().sub(playerPos).normalize().multiplyScalar((4 - Math.sqrt(d2)) * 2.2);
        f.scatter.add(away.multiplyScalar(dt * 4));
      }
      f.scatter.multiplyScalar(Math.exp(-1.4 * dt));
      prev.add(f.scatter);
      // 朝向 = 运动切线 + 惊散方向
      const ang2 = f.ang + 0.06;
      next.set(c.x + Math.cos(ang2) * f.radius, f.y + bob, c.z + Math.sin(ang2) * f.radius).add(f.scatter);
      this.dummy.position.copy(prev);
      this.dummy.lookAt(next);
      // 尾摆：绕 Y 的小幅摆动（速度越快摆越快）
      this.dummy.rotateY(Math.sin(time * (6 + f.speed * 5) + f.bobPhase * 3) * 0.14);
      this.dummy.scale.setScalar(f.len);
      this.dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  private updateBlind(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.blindMesh) return;
    for (let i = 0; i < this.blind.length; i++) {
      const b = this.blind[i];
      // 缓慢盘旋 + 被"光"（玩家）静静吸引
      const wander = new THREE.Vector3(
        Math.sin(time * 0.4 + b.phase) * 0.4,
        Math.sin(time * 0.3 + b.phase * 2) * 0.2,
        Math.cos(time * 0.35 + b.phase) * 0.4,
      );
      const target = b.home.clone().add(wander);
      const dp = playerPos.distanceTo(b.pos);
      if (dp < 7) target.lerp(playerPos, 0.35 * (1 - dp / 7)); // 它们不该看得见
      const dir = target.clone().sub(b.pos);
      b.pos.addScaledVector(dir, Math.min(1, dt * 0.5));
      this.dummy.position.copy(b.pos);
      this.dummy.lookAt(target.add(dir));
      this.dummy.rotateY(Math.sin(time * 4.5 + b.phase * 5) * 0.12);
      this.dummy.scale.setScalar(0.2);
      this.dummy.updateMatrix();
      this.blindMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.blindMesh.instanceMatrix.needsUpdate = true;
  }

  /** 巡游大鱼：家域内缓慢巡游，怕玩家手电——4.5m 内缓慢转向避离 */
  private updateCruisers(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.cruiserMesh) return;
    const target = new THREE.Vector3();
    for (let i = 0; i < this.cruisers.length; i++) {
      const cr = this.cruisers[i];
      cr.phase += dt * 0.16;
      target.set(
        cr.home.x + Math.cos(cr.phase) * cr.wanderR,
        cr.home.y + Math.sin(cr.phase * 1.7 + i) * cr.wanderR * 0.22,
        cr.home.z + Math.sin(cr.phase) * cr.wanderR * 0.8,
      );
      const dp = cr.pos.distanceTo(playerPos);
      if (dp < 4.5) {
        const away = cr.pos.clone().sub(playerPos).normalize();
        cr.avoid.addScaledVector(away, dt * (4.5 - dp) * 1.4);
      }
      cr.avoid.multiplyScalar(Math.exp(-0.8 * dt));
      target.add(cr.avoid);
      const dir = target.clone().sub(cr.pos);
      cr.pos.addScaledVector(dir, Math.min(1, dt * 0.32));
      this.dummy.position.copy(cr.pos);
      this.dummy.lookAt(target.add(dir));
      this.dummy.rotateY(Math.sin(time * 2.2 + i * 2.6) * 0.1);
      this.dummy.scale.setScalar(cr.len);
      this.dummy.updateMatrix();
      this.cruiserMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.cruiserMesh.instanceMatrix.needsUpdate = true;
  }

  private updatePlankton(dt: number, time: number, playerPos: THREE.Vector3, playerSpeed: number): void {
    const n = this.pkGlow.length;
    const excite = playerSpeed > 1.1;
    for (let i = 0; i < n; i++) {
      // 扰动激发
      if (excite) {
        const dx = this.pkPos[i * 3] - playerPos.x;
        const dy = this.pkPos[i * 3 + 1] - playerPos.y;
        const dz = this.pkPos[i * 3 + 2] - playerPos.z;
        if (dx * dx + dy * dy + dz * dz < 6.5) this.pkGlow[i] = 1;
      }
      this.pkGlow[i] *= Math.exp(-1.1 * dt);
      const twinkle = 0.05 + 0.04 * Math.sin(time * 1.7 + i * 2.3);
      const g = this.pkGlow[i];
      this.pkCol[i * 3] = twinkle * 0.4 + g * 0.25;
      this.pkCol[i * 3 + 1] = twinkle + g * 0.95;
      this.pkCol[i * 3 + 2] = twinkle + g * 1.0;
    }
    (this.plankton.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateJellies(dt: number, time: number, playerPos: THREE.Vector3): void {
    for (const j of this.jellies) {
      j.phase += dt * 0.9;
      const pulse = Math.sin(j.phase);
      j.bell.scale.set(1 + pulse * 0.08, 1 - pulse * 0.14, 1 + pulse * 0.08);
      // 靠近 → 收缩闪光 + 避让（近距离推力更强，避免怼到镜头前）
      const d = j.group.position.distanceTo(playerPos);
      if (d < 4.5) {
        j.shrink = Math.min(1, j.shrink + dt * 3);
        const away = j.group.position.clone().sub(playerPos).normalize();
        j.drift.addScaledVector(away, dt * (0.8 + (4.5 - d) * 1.6));
      } else {
        j.shrink = Math.max(0, j.shrink - dt * 0.5);
      }
      j.drift.multiplyScalar(Math.exp(-0.4 * dt));
      const mat = j.bell.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + pulse * 0.3 + j.shrink * 2.2;
      (j.glow.material as THREE.SpriteMaterial).opacity = 0.35 + pulse * 0.12 + j.shrink * 0.45;
      j.group.scale.setScalar(j.group.scale.x * (1 - j.shrink * 0.12 * dt * 3));
      // 缓慢升降漂移
      j.group.position.copy(j.base)
        .add(new THREE.Vector3(
          Math.sin(time * 0.11 + j.phase) * 1.6,
          Math.sin(time * 0.07 + j.phase * 1.7) * 2.6 + pulse * 0.12,
          Math.cos(time * 0.09 + j.phase) * 1.6,
        ))
        .add(j.drift);
    }
  }

  private updateVents(dt: number): void {
    for (const v of this.vents) {
      const n = v.pos.length / 3;
      for (let i = 0; i < n; i++) {
        v.pos[i * 3 + 1] += (0.55 + (i % 5) * 0.06) * dt;
        v.pos[i * 3] += Math.sin(v.pos[i * 3 + 1] * 2.1 + i) * 0.14 * dt;
        if (v.pos[i * 3 + 1] > v.base.y + v.h) {
          v.pos[i * 3] = v.base.x + (Math.random() - 0.5) * 0.7;
          v.pos[i * 3 + 1] = v.base.y;
          v.pos[i * 3 + 2] = v.base.z + (Math.random() - 0.5) * 0.7;
        }
      }
      (v.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
