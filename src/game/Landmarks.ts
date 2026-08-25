import * as THREE from 'three';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import { glyphTexture, woodTexture } from './textures';

/**
 * 分区地标（docs/GAME_DESIGN.md §2.2）：
 * 石笋回廊、光之烛台、卤水镜面、沉船、玛雅祭坛、塌方巨石、深渊井、
 * 导览线系统（主线/断口/错绳假线/烟囱荧光标）。
 */
export class Landmarks {
  readonly group = new THREE.Group();
  /** 烟囱荧光标（回程阶段增亮） */
  readonly chimneyMarkers: THREE.Mesh[] = [];
  /** 卤水云层（Game 判定穿越） */
  readonly haloPlaneY: number;
  readonly haloCenter = new THREE.Vector3();
  readonly haloRadius = 15; // 不得泄漏进相邻的光之厅
  /** 祭坛供品（互动发光） */
  readonly altarPos = new THREE.Vector3();
  /** 沉船中心（取景/调试用） */
  readonly wreckPos = new THREE.Vector3();
  readonly altarLight: THREE.PointLight;
  private altarGems: THREE.Mesh[] = [];
  private haloMats: THREE.MeshBasicMaterial[] = [];
  private brokenLineEnd: THREE.Mesh | null = null;

  constructor(q: QualityProfile, cave: Cave) {
    const rockMat = new THREE.MeshStandardMaterial({
      map: cave.rock.map,
      bumpMap: cave.rock.bumpMap,
      bumpScale: 1.1,
      color: 0x59655f,
      roughness: 0.95,
    });

    this.buildSpeleothems(q, cave, rockMat);
    this.buildLightTower(cave, rockMat);
    const halo = this.buildHalocline(q, cave, rockMat);
    this.haloPlaneY = halo.y;
    this.haloCenter.copy(halo.center);
    this.buildWreck(cave);
    this.altarLight = this.buildAltar(cave);
    this.buildCollapse(q, cave, rockMat);
    this.buildPit(cave, rockMat);
    this.buildGuidelines(cave);
    this.buildZoneFills(cave);
  }

  // ---------- Z2 石笋回廊 ----------
  private buildSpeleothems(q: QualityProfile, cave: Cave, mat: THREE.MeshStandardMaterial): void {
    const { t0, t1 } = cave.zoneRange('gallery');
    const count = Math.floor(q.rocks * 0.55);
    const geo = new THREE.ConeGeometry(0.22, 2.6, 7);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const qDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const qUp = new THREE.Quaternion();
    let i = 0;
    while (i < count) {
      const t = t0 + Math.random() * (t1 - t0) * 1.35; // 溢出到咽喉口
      const { p: center } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const isColumn = Math.random() < 0.16;
      const fromCeil = isColumn ? true : Math.random() < 0.6;
      const posv = center.clone();
      posv.x += (Math.random() - 0.5) * r * 1.3;
      posv.z += (Math.random() - 0.5) * r * 1.3;
      const s = 0.5 + Math.random() * 1.1;
      if (isColumn) {
        // 石柱：顶天立地（拉长锥体近似）
        posv.y = center.y;
        m.compose(posv, qUp, new THREE.Vector3(s * 0.8, r * 0.86, s * 0.8));
      } else if (fromCeil) {
        posv.y = center.y + r * (0.85 + Math.random() * 0.2);
        m.compose(posv, qDown, new THREE.Vector3(s, s * (1.1 + Math.random() * 0.9), s));
      } else {
        posv.y = center.y - r * (0.8 + Math.random() * 0.2);
        m.compose(posv, qUp, new THREE.Vector3(s * 1.3, s * (0.9 + Math.random() * 0.7), s * 1.3));
      }
      mesh.setMatrixAt(i, m);
      i++;
    }
    this.group.add(mesh);

    // 回廊青冷补光 ×2（石笋剪影可读）
    for (const frac of [0.3, 0.75]) {
      const t = t0 + (t1 - t0) * frac;
      const { p: c2 } = cave.frameAt(0, t);
      const fill = new THREE.PointLight(0x2a4a52, 14, 26, 1.6);
      fill.position.set(c2.x, c2.y + cave.radiusAt(t) * 0.4, c2.z);
      cave.zoneLights.push(fill);
      this.group.add(fill);
    }
  }

  // ---------- Z4 光之烛台：裂隙光束击中的石笋塔 ----------
  private buildLightTower(cave: Cave, mat: THREE.MeshStandardMaterial): void {
    const crack = cave.crackPoint;
    const { t0, t1 } = cave.zoneRange('hall');
    const tMid = (t0 + t1) / 2;
    const { p: center } = cave.frameAt(0, tMid);
    const floorY = center.y - cave.radiusAt(tMid) * 0.9;
    const tower = new THREE.Group();
    let y = floorY;
    let rad = 2.6;
    for (let k = 0; k < 5; k++) {
      const h = 2.4 - k * 0.3;
      const seg = new THREE.Mesh(new THREE.ConeGeometry(rad, h * 2.4, 9), mat);
      seg.position.set(crack.x + Math.sin(k * 4.7) * 0.3, y + h * 0.8, crack.z + Math.cos(k * 3.1) * 0.3);
      tower.add(seg);
      y += h * 1.15;
      rad *= 0.62;
    }
    // 塔尖被光束击中的亮斑
    const tipGlow = new THREE.PointLight(0xbfe8da, 42, 18, 1.6);
    tipGlow.position.set(crack.x, y + 0.6, crack.z);
    cave.zoneLights.push(tipGlow);
    tower.add(tipGlow);
    // 周围一圈小石笋（构图）
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const s = 0.5 + Math.abs(Math.sin(k * 7.3)) * 0.9;
      const small = new THREE.Mesh(new THREE.ConeGeometry(0.4 * s, 2.2 * s, 7), mat);
      small.position.set(
        crack.x + Math.cos(ang) * (4 + Math.sin(k * 3.1) * 1.5),
        floorY + 1.1 * s,
        crack.z + Math.sin(ang) * (4 + Math.cos(k * 5.7) * 1.5),
      );
      tower.add(small);
    }
    this.group.add(tower);
  }

  // ---------- Z5 卤水镜面（硫化氢云层 + 枯枝） ----------
  private buildHalocline(
    q: QualityProfile, cave: Cave, rockMat: THREE.MeshStandardMaterial,
  ): { y: number; center: THREE.Vector3 } {
    const { t0, t1 } = cave.zoneRange('halo');
    const tMid = (t0 + t1) / 2;
    const { p: center } = cave.frameAt(0, tMid);
    const y = center.y - cave.radiusAt(tMid) * 0.42;

    // 双层软噪声云面（上亮下浊）
    const cloudTex = this.cloudTexture();
    for (const [dy, op, sc] of [
      [0, 0.42, 1],
      [-0.7, 0.3, 1.6],
      [0.5, 0.16, 2.3],
    ] as [number, number, number][]) {
      const mat = new THREE.MeshBasicMaterial({
        map: cloudTex,
        transparent: true,
        opacity: op,
        depthWrite: false,
        side: THREE.DoubleSide,
        color: 0xcfd8cc,
      });
      mat.map = cloudTex.clone();
      mat.map.repeat.set(sc, sc);
      mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
      this.haloMats.push(mat);
      const plane = new THREE.Mesh(new THREE.CircleGeometry(this.haloRadius, 36), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(center.x, y + dy, center.z);
      plane.renderOrder = 2;
      this.group.add(plane);
    }

    // 枯树枝（Angelita 式）：从洞底穿出云面
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x231d16, roughness: 0.95 });
    for (let i = 0; i < q.branches; i++) {
      const t = t0 + Math.random() * (t1 - t0);
      const { p: c2 } = cave.frameAt(0, t);
      const floorY = c2.y - cave.radiusAt(t) * 0.88;
      const bx = c2.x + (Math.random() - 0.5) * cave.radiusAt(t) * 1.2;
      const bz = c2.z + (Math.random() - 0.5) * cave.radiusAt(t) * 1.2;
      const h = y - floorY + 1 + Math.random() * 3.5;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, h, 5), branchMat);
      trunk.position.set(bx, floorY + h / 2, bz);
      trunk.rotation.set((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35);
      this.group.add(trunk);
      // 分叉
      const n = 1 + Math.floor(Math.random() * 3);
      for (let b = 0; b < n; b++) {
        const bl = 0.8 + Math.random() * 2;
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, bl, 4), branchMat);
        branch.position.set(
          bx + (Math.random() - 0.5) * 0.8,
          floorY + h * (0.55 + Math.random() * 0.4),
          bz + (Math.random() - 0.5) * 0.8,
        );
        branch.rotation.set((Math.random() - 0.5) * 1.6, Math.random() * 3, (Math.random() - 0.5) * 1.6);
        this.group.add(branch);
      }
    }

    // 云层之上的幽白补光
    const haloFill = new THREE.PointLight(0xc8d8cc, 14, 26, 1.6);
    haloFill.position.set(center.x, y + 4, center.z);
    cave.zoneLights.push(haloFill);
    this.group.add(haloFill);
    void rockMat;
    return { y, center };
  }

  private cloudTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 480; i++) {
      const x = Math.random() * 256, yy = Math.random() * 256;
      const r = 14 + Math.random() * 44;
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, r);
      const a = 0.028 + Math.random() * 0.05;
      g.addColorStop(0, `rgba(225,235,225,${a})`);
      g.addColorStop(1, 'rgba(225,235,225,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------- Z6 沉船（半个世纪前的木质补给船） ----------
  private buildWreck(cave: Cave): void {
    const { t0, t1 } = cave.zoneRange('wreck');
    const tMid = t0 + (t1 - t0) * 0.45;
    const { p: center, tan } = cave.frameAt(0, tMid);
    const floorY = center.y - cave.radiusAt(tMid) * 0.86;
    const wreck = new THREE.Group();
    wreck.position.set(center.x + 2, floorY, center.z + 1.5);
    wreck.rotation.y = Math.atan2(tan.x, tan.z) + 0.5;
    wreck.rotation.z = 0.14;
    this.wreckPos.set(center.x + 2, floorY + 0.8, center.z + 1.5);

    const wood = new THREE.MeshStandardMaterial({
      map: woodTexture(256),
      color: 0x8a7458,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    // 龙骨
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 9.5), wood);
    keel.position.y = 0.25;
    wreck.add(keel);
    // 肋骨拱列（半环）
    for (let i = 0; i < 9; i++) {
      const z = -4.2 + i * 1.05;
      const r = 1.6 - Math.abs(i - 4) * 0.16;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 6, 18, Math.PI), wood);
      rib.position.set(0, 0.35, z);
      rib.rotation.set(0, Math.PI / 2, 0);
      // 部分肋骨折断
      if (i === 2 || i === 6) rib.scale.set(1, 0.55 + Math.random() * 0.2, 1);
      wreck.add(rib);
    }
    // 倒下的桅杆
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8), wood);
    mast.position.set(1.8, 0.35, 1);
    mast.rotation.set(0.1, 0, Math.PI / 2 - 0.22);
    wreck.add(mast);
    // 散板
    for (let i = 0; i < 12; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.2 + Math.random() * 1.4), wood);
      plank.position.set((Math.random() - 0.5) * 6, 0.06, (Math.random() - 0.5) * 9);
      plank.rotation.y = Math.random() * Math.PI;
      wreck.add(plank);
    }
    // 陶罐（Lathe）
    const potPts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      potPts.push(new THREE.Vector2(0.12 + Math.sin(k * Math.PI) * 0.14, k * 0.42));
    }
    const potGeo = new THREE.LatheGeometry(potPts, 10);
    const potMat = new THREE.MeshStandardMaterial({ color: 0x6a5038, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const pot = new THREE.Mesh(potGeo, potMat);
      pot.position.set(-1.5 + Math.random() * 3, 0.03, -3 + Math.random() * 6);
      pot.rotation.set(i % 2 ? 1.2 : 0, Math.random() * 3, 0);
      pot.scale.setScalar(0.8 + Math.random() * 0.7);
      wreck.add(pot);
    }
    // 船头的老黄铜提灯——还亮着（谁点的？）
    const lantern = new THREE.Group();
    const cage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.2, 6, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6a5428, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }),
    );
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a4030, emissive: 0x6ee8a0, emissiveIntensity: 2.4 }),
    );
    lantern.add(cage, flame);
    lantern.position.set(0.4, 0.75, -3.9);
    const lanternLight = new THREE.PointLight(0x66d89a, 6, 9, 1.8);
    lantern.add(lanternLight);
    cave.zoneLights.push(lanternLight);
    wreck.add(lantern);
    this.group.add(wreck);

    // 沉船厅幽绿死水补光（主光压向船体，让龙骨肋骨的剪影可读）
    const fill = new THREE.PointLight(0x3a5c48, 120, 52, 1.4);
    fill.position.set(center.x + 1, center.y + 1.5, center.z + 1);
    cave.zoneLights.push(fill);
    this.group.add(fill);
    // 船体上方的窄冷光——"墓志"式顶光
    const top = new THREE.PointLight(0x6a9a8a, 30, 18, 1.7);
    top.position.set(this.wreckPos.x, this.wreckPos.y + 5, this.wreckPos.z);
    cave.zoneLights.push(top);
    this.group.add(top);
  }

  // ---------- 支线A 玛雅祭坛壁龛 ----------
  private buildAltar(cave: Cave): THREE.PointLight {
    const stub = cave.paths[1];
    const { p: center } = cave.frameAt(1, 0.82);
    const floorY = center.y - stub.radiusAt(0.82) * 0.8;
    this.altarPos.set(center.x, floorY + 1.2, center.z);

    const altar = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x7d8278, roughness: 0.9 });
    const carved = new THREE.MeshStandardMaterial({ map: glyphTexture(256), roughness: 0.85 });
    // 台基三层
    for (let k = 0; k < 3; k++) {
      const s = 2.4 - k * 0.55;
      const step = new THREE.Mesh(new THREE.BoxGeometry(s, 0.34, s), stone);
      step.position.set(center.x, floorY + 0.17 + k * 0.34, center.z);
      altar.add(step);
    }
    // 雕纹石碑
    const stela = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.22), carved);
    stela.position.set(center.x, floorY + 1.02 + 0.9, center.z - 0.4);
    stela.rotation.y = Math.PI * 0.02;
    altar.add(stela);
    // 玉石供品（互动发光体）
    const jade = new THREE.MeshStandardMaterial({
      color: 0x3f7a5c,
      emissive: 0x1e4c38,
      emissiveIntensity: 0.8,
      roughness: 0.3,
    });
    for (let k = 0; k < 5; k++) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 + Math.sin(k * 3.7) * 0.03, 0), jade.clone());
      gem.position.set(
        center.x - 0.5 + k * 0.24,
        floorY + 1.1,
        center.z + 0.25 + Math.sin(k * 2.1) * 0.12,
      );
      gem.rotation.set(k, k * 2, 0);
      this.altarGems.push(gem);
      altar.add(gem);
    }
    // 壁龛暖光（微弱、诡异地常亮着——谁点的？）
    const light = new THREE.PointLight(0xd8a860, 8, 14, 1.8);
    light.position.set(center.x, floorY + 2.2, center.z);
    cave.zoneLights.push(light);
    altar.add(light);
    this.group.add(altar);
    return light;
  }

  // ---------- Z7 塌方巨石 ----------
  private buildCollapse(q: QualityProfile, cave: Cave, mat: THREE.MeshStandardMaterial): void {
    const { t0, t1 } = cave.zoneRange('collapse');
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const count = Math.floor(q.rocks * 0.22);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const t = t0 + Math.random() * (t1 - t0);
      const { p: center } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const posv = center.clone();
      posv.x += (Math.random() - 0.5) * r * 1.4;
      posv.y += -r * 0.5 + Math.random() * r * 0.9;
      posv.z += (Math.random() - 0.5) * r * 1.4;
      const s = 0.5 + Math.random() * 1.4;
      quat.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      m.compose(posv, quat, new THREE.Vector3(s, s * (0.7 + Math.random() * 0.6), s));
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  // ---------- Z8 深渊井（大厅地面的黑洞） ----------
  private buildPit(cave: Cave, rockMat: THREE.MeshStandardMaterial): void {
    const pc = cave.pitCenter;
    // 井壁：向下延伸的暗筒
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(4.7, 5.4, 34, 20, 3, true),
      new THREE.MeshStandardMaterial({
        map: cave.rock.map,
        color: 0x2a3330,
        roughness: 1,
        side: THREE.BackSide,
      }),
    );
    wall.position.set(pc.x, pc.y - 16, pc.z);
    this.group.add(wall);
    // 井底纯黑
    const abyssDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    abyssDisc.rotation.x = -Math.PI / 2;
    abyssDisc.position.set(pc.x, pc.y - 32.5, pc.z);
    this.group.add(abyssDisc);
    // 井口崩落岩块环：厚重的碎石唇缘，遮住地面开洞的裁切锯齿
    const rimGeo = new THREE.DodecahedronGeometry(1, 0);
    const rim = new THREE.InstancedMesh(rimGeo, rockMat, 26);
    const m4 = new THREE.Matrix4();
    const qr = new THREE.Quaternion();
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + Math.sin(i * 7.3) * 0.1;
      const rr = 5.3 + Math.abs(Math.sin(i * 3.7)) * 1.3;
      const s = 0.9 + Math.abs(Math.sin(i * 5.1)) * 1.5;
      qr.setFromEuler(new THREE.Euler(Math.sin(i * 2.1) * 2, i * 1.7, Math.cos(i * 4.3) * 2));
      m4.compose(
        new THREE.Vector3(pc.x + Math.cos(ang) * rr, pc.y - 0.3 + Math.abs(Math.sin(i * 9.1)) * 0.5, pc.z + Math.sin(ang) * rr),
        qr,
        new THREE.Vector3(s, s * (0.55 + Math.abs(Math.cos(i * 3.3)) * 0.5), s),
      );
      rim.setMatrixAt(i, m4);
    }
    this.group.add(rim);
    // 少量岩齿尖刺穿插其间
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.3;
      const s = 0.6 + Math.abs(Math.sin(i * 5.3)) * 1.0;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 2.2 * s, 5), rockMat);
      tooth.position.set(pc.x + Math.cos(ang) * 5.6, pc.y + 0.5, pc.z + Math.sin(ang) * 5.6);
      tooth.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
      this.group.add(tooth);
    }
    // 深渊冷蓝补光（让大厅轮廓可读，压抑但不致盲黑）
    const { t0, t1 } = cave.zoneRange('abyss');
    const { p: hallC } = cave.frameAt(0, (t0 + t1) / 2);
    const fill = new THREE.PointLight(0x24485a, 90, 100, 1.3);
    fill.position.set(hallC.x, hallC.y + 8, hallC.z);
    cave.zoneLights.push(fill);
    this.group.add(fill);
    // 井口幽蓝上照光（深井在"发光"的错觉——它不该发光）
    const pitGlow = new THREE.PointLight(0x16404e, 22, 30, 1.5);
    pitGlow.position.set(pc.x, pc.y - 3, pc.z);
    cave.zoneLights.push(pitGlow);
    this.group.add(pitGlow);
  }

  // ---------- 导览线系统 ----------
  private buildGuidelines(cave: Cave): void {
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2c2,
      roughness: 0.7,
      emissive: 0x2a281f,
    });
    const arrowGeo = new THREE.ConeGeometry(0.06, 0.2, 4);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d4,
      emissive: 0x4a4030,
      roughness: 0.5,
    });

    // 主线：竖井底 → 深渊大厅（去程左脉），中途在塌方段断裂
    const galleryT0 = cave.zoneRange('gallery').t0;
    const abyssMid = (cave.zoneRange('abyss').t0 + cave.zoneRange('abyss').t1) / 2;
    const collapse = cave.zoneRange('collapse');
    const breakT0 = collapse.t0 + (collapse.t1 - collapse.t0) * 0.35;
    const breakT1 = collapse.t0 + (collapse.t1 - collapse.t0) * 0.62;

    const linePoint = (t: number): THREE.Vector3 => {
      const { p: center, N, B } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.8;
      const sag = Math.sin(t * 500) * 0.06;
      return center
        .clone()
        .addScaledVector(N, Math.cos(-0.9) * r)
        .addScaledVector(B, Math.sin(-0.9) * r + sag);
    };

    const seg1: THREE.Vector3[] = [];
    const seg2: THREE.Vector3[] = [];
    for (let i = 0; i <= 320; i++) {
      const t = galleryT0 * 0.4 + (i / 320) * (abyssMid - galleryT0 * 0.4);
      if (t < breakT0) seg1.push(linePoint(t));
      else if (t > breakT1) seg2.push(linePoint(t));
    }
    for (const pts of [seg1, seg2]) {
      if (pts.length < 4) continue;
      const c = new THREE.CatmullRomCurve3(pts);
      this.group.add(new THREE.Mesh(new THREE.TubeGeometry(c, Math.max(60, pts.length), 0.014, 5, false), lineMat));
    }
    // 断口垂落的线头（在水流里摆——Game 可动画化，这里静态下垂）
    if (seg1.length) {
      const end = seg1[seg1.length - 1];
      const dangle = new THREE.CatmullRomCurve3([
        end.clone(),
        end.clone().add(new THREE.Vector3(0.2, -0.7, 0.1)),
        end.clone().add(new THREE.Vector3(0.05, -1.5, 0.3)),
      ]);
      this.brokenLineEnd = new THREE.Mesh(new THREE.TubeGeometry(dangle, 16, 0.014, 5, false), lineMat);
      this.group.add(this.brokenLineEnd);
    }

    // 箭头：被人调转——全部指向洞的深处（叙事道具）
    for (let k = 0; k < 12; k++) {
      const t = galleryT0 + ((abyssMid - galleryT0) * (k + 0.5)) / 12;
      if (t > breakT0 && t < breakT1) continue;
      const p = linePoint(t);
      const dir = linePoint(Math.min(abyssMid, t + 0.004)).sub(p).normalize();
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.copy(p);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.group.add(arrow);
    }

    // 错绳假线：崭新白线从塌方断口接向支线B死胡同
    const fakeMat = new THREE.MeshStandardMaterial({
      color: 0xf2efe6,
      roughness: 0.35,
      emissive: 0x3a382e,
    });
    const stubB = cave.paths[2];
    const fakePts: THREE.Vector3[] = [];
    if (seg1.length) fakePts.push(seg1[seg1.length - 1].clone());
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 0.92;
      const { p: center, N, B } = cave.frameAt(2, t);
      const r = stubB.radiusAt(t) * 0.7;
      fakePts.push(
        center
          .clone()
          .addScaledVector(N, Math.cos(-1.1) * r)
          .addScaledVector(B, Math.sin(-1.1) * r),
      );
    }
    const fakeCurve = new THREE.CatmullRomCurve3(fakePts);
    this.group.add(new THREE.Mesh(new THREE.TubeGeometry(fakeCurve, 90, 0.013, 5, false), fakeMat));
    // 假线上的箭头（指向死胡同——致命的错误）
    for (let k = 0; k < 4; k++) {
      const tt = 0.15 + k * 0.22;
      const p = fakeCurve.getPointAt(tt);
      const dir = fakeCurve.getTangentAt(tt);
      const arrow = new THREE.Mesh(arrowGeo, fakeMat);
      arrow.position.copy(p);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.group.add(arrow);
    }

    // 回程烟囱：蓝绿荧光棒标记（目击后被"点亮"的路）
    const markMat = new THREE.MeshStandardMaterial({
      color: 0x9fe8d8,
      emissive: 0x1e6a5c,
      emissiveIntensity: 0.5,
      roughness: 0.4,
    });
    const chim = cave.zoneRange('chimney');
    for (let k = 0; k < 10; k++) {
      const t = chim.t0 + ((chim.t1 - chim.t0) * (k + 0.5)) / 10;
      const { p: center, N, B } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.78;
      const ang = -0.7 + Math.sin(k * 2.3) * 0.4;
      const stick = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.24, 3, 6), markMat.clone());
      stick.position.copy(center).addScaledVector(N, Math.cos(ang) * r).addScaledVector(B, Math.sin(ang) * r);
      stick.rotation.set(Math.random(), Math.random() * 3, Math.random());
      this.chimneyMarkers.push(stick);
      this.group.add(stick);
    }
  }

  /** 极暗分区补光：只保证地标剪影可读 */
  private buildZoneFills(cave: Cave): void {
    void cave;
  }

  /** 回程阶段点亮烟囱荧光标 */
  igniteChimney(): void {
    for (const m of this.chimneyMarkers) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 2.6;
    }
  }

  update(time: number): void {
    // 卤水云面缓慢流动
    for (let i = 0; i < this.haloMats.length; i++) {
      const map = this.haloMats[i].map!;
      map.offset.set(time * 0.004 * (i + 1), time * 0.0026 * (i + 1));
    }
    // 供品玉石呼吸发光
    for (let i = 0; i < this.altarGems.length; i++) {
      const mat = this.altarGems[i].material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.sin(time * 1.4 + i * 1.7) * 0.35;
    }
    // 断线头摆动
    if (this.brokenLineEnd) this.brokenLineEnd.rotation.y = Math.sin(time * 0.7) * 0.18;
  }
}
