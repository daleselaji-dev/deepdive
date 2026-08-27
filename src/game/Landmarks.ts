import * as THREE from 'three';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import type { Models } from './Models';
import { glyphTexture, woodTexture } from './textures';
import { boulderGeometry, dripstoneGeometry, vnoise3 } from './geo';

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
  /** M4-L8 黑井呼吸幽光（膜+柱）：缓慢脉动的不祥光 */
  private pitBreath: THREE.MeshBasicMaterial[] = [];
  /** M4-L5 距离剔除簇：雾外的地标集合整组隐藏（省 drawcall 与 overdraw；无遮挡剔除的补偿） */
  private cullClusters: { obj: THREE.Object3D; center: THREE.Vector3; r2: number }[] = [];

  constructor(q: QualityProfile, cave: Cave, models: Models) {
    const rockMat = new THREE.MeshStandardMaterial({
      map: cave.rock.map,
      normalMap: cave.rock.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      color: 0x59655f,
      roughness: 0.95,
    });

    this.buildSpeleothems(q, cave, rockMat);
    this.buildLightTower(cave, rockMat);
    const halo = this.buildHalocline(q, cave, rockMat);
    this.haloPlaneY = halo.y;
    this.haloCenter.copy(halo.center);
    this.buildWreck(cave, models);
    this.altarLight = this.buildAltar(cave);
    this.buildCollapse(q, cave, rockMat);
    this.buildPit(cave, rockMat);
    this.buildGuidelines(cave);
    this.buildZoneFills(cave);
    this.buildBatChamber(cave);
    this.buildFakeLineSlit(cave);
    this.buildBypassMarks(cave);
  }

  // ---------- 支线 C 蝙蝠气室（水面气穴 + 粪堆锥 + 裂隙漏光；蝙蝠群动画在 Ecology） ----------
  private buildBatChamber(cave: Cave): void {
    const c = cave.batChamberTop;
    const wy = cave.batWaterY;
    const g = new THREE.Group();
    // 岩石穹顶：封住支线管末端的开口环（否则从气穴仰望会看穿到天空球，M4-L4 踩坑）。
    // 半球壳 + 径向噪声位移，rim 半径大于管端半径（3.3）保证与管壁交叠无缝隙。
    const domeGeo = new THREE.SphereGeometry(4.3, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const dp = domeGeo.attributes.position;
    const dv = new THREE.Vector3();
    for (let i = 0; i < dp.count; i++) {
      dv.fromBufferAttribute(dp, i);
      const len = dv.length();
      if (len > 1e-4) {
        const n = vnoise3(dv.x * 0.9 + 7.7, dv.y * 0.9, dv.z * 0.9);
        const k = 1 + (n - 0.5) * 0.22;
        dp.setXYZ(i, dv.x * k, dv.y * k * 0.62, dv.z * k);
      }
    }
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshStandardMaterial({
      map: cave.rock.map,
      normalMap: cave.rock.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      color: 0x4d5a54,
      roughness: 0.97,
      side: THREE.DoubleSide,
    }));
    dome.position.set(c.x, c.y - 0.7, c.z);
    g.add(dome);
    // 穹顶裂隙：一条窄缝发光板（漏光的视觉来源），配合下方的窄冷光
    const slit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 1.7),
      new THREE.MeshBasicMaterial({ color: 0xd8f2e4, fog: false, side: THREE.DoubleSide }),
    );
    slit.position.set(c.x + 0.9, c.y + 1.55, c.z - 0.6);
    slit.rotation.set(Math.PI / 2, 0, 0.7);
    g.add(slit);
    // 气穴水面：半透明冷青盘——从下往上看是一面发亮的「假出口」
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 40),
      new THREE.MeshStandardMaterial({
        color: 0x8fb4a8, transparent: true, opacity: 0.4, roughness: 0.12, metalness: 0.4,
        emissive: 0x2a4a44, emissiveIntensity: 0.55, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(c.x, wy, c.z);
    g.add(disc);
    // 洞顶裂隙漏光：一束窄冷光（真实气穴的光源之一），挂在穹顶裂缝正下方
    const crackLight = new THREE.PointLight(0xcfe8dc, 10, 10, 1.7);
    crackLight.position.set(c.x + 0.9, c.y + 1.2, c.z - 0.6);
    cave.zoneLights.push(crackLight);
    g.add(crackLight);
    // 粪堆锥（guano cone）：锥尖探出水面——蝙蝠粪是洞穴食物网的能量输入
    const guanoMat = new THREE.MeshStandardMaterial({ color: 0x453723, roughness: 1 });
    const guano: [number, number, number, number][] = [
      [0.7, 0.5, 1.5, 3.3],
      [-1.0, -0.7, 1.0, 8.9],
    ];
    for (const [dx, dz, s, seed] of guano) {
      const cone = new THREE.Mesh(dripstoneGeometry(seed, 12, 14), guanoMat);
      cone.scale.set(2.4 * s, 2.6 * s, 2.4 * s);
      cone.position.set(c.x + dx, wy - 2.6 * s + 1.0, c.z + dz);
      g.add(cone);
    }
    // （倒挂蝙蝠群已迁入 Ecology：受惊盘旋状态机 + 事件供 Game 触发音频字幕）
    // 气穴幽暗环境光（可读不敞亮）
    const fill = new THREE.PointLight(0x35443c, 5, 9, 1.8);
    fill.position.set(c.x, wy + 1.5, c.z);
    cave.zoneLights.push(fill);
    g.add(fill);
    this.group.add(g);
    this.registerCull(g, c, 55);
  }

  // ---------- 支线 B 末端「窥视缝」：缝隙后透出主线荧光——错误路线的代价 ----------
  private buildFakeLineSlit(cave: Cave): void {
    const { p: end, N } = cave.frameAt(2, 0.96);
    const r = cave.paths[2].radiusAt(0.96);
    const pos = end.clone().addScaledVector(N, r * 0.72);
    const sg = new THREE.Group();
    const slit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 1.3),
      new THREE.MeshBasicMaterial({ color: 0xbdf2ff, fog: false }),
    );
    slit.position.copy(pos);
    slit.lookAt(end);
    slit.rotation.z = 0.4;
    sg.add(slit);
    const glow = new THREE.PointLight(0x4a9aaa, 3.5, 5, 1.9);
    glow.position.copy(pos).addScaledVector(N, -0.4);
    cave.zoneLights.push(glow);
    sg.add(glow);
    this.group.add(sg);
    this.registerCull(sg, pos, 50);
  }

  // ---------- 支线 D 旁道：cookie 标记 + 洞口岩石环（遮裁剪锯齿）+ 口灯 ----------
  private buildBypassMarks(cave: Cave): void {
    const bg = new THREE.Group();
    const cookieMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d0, emissive: 0x4a4433, roughness: 0.5,
    });
    for (const ft of [0.18, 0.5, 0.82]) {
      const { p: center, N, B } = cave.frameAt(4, ft);
      const r = cave.paths[4].radiusAt(ft) * 0.78;
      const cookie = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12), cookieMat);
      cookie.position.copy(center).addScaledVector(N, Math.cos(-0.7) * r).addScaledVector(B, Math.sin(-0.7) * r);
      cookie.lookAt(center);
      cookie.rotation.z = Math.PI / 2;
      bg.add(cookie);
    }
    // 洞口岩石环：崩落岩块箍住两端开孔的裁剪锯齿（与 pit 井缘同做法）
    const rimMat = new THREE.MeshStandardMaterial({
      map: cave.rock.map, normalMap: cave.rock.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0), color: 0x4e5a54, roughness: 0.96,
    });
    const rimGeos = [boulderGeometry(11.3), boulderGeometry(17.9)];
    // 支线 C 洞口环（回廊）与旁道两端环（塌方↔深渊）相距甚远，分属不同剔除簇
    const cg = new THREE.Group();
    for (const [pid, ft] of [[4, 0.045], [4, 0.955], [3, 0.05]] as const) {
      const grp = pid === 3 ? cg : bg;
      const { p: c, N, B, tan } = cave.frameAt(pid, ft);
      const rr = cave.paths[pid].radiusAt(ft) * 1.08;
      for (let k = 0; k < 9; k++) {
        const ang = (k / 9) * Math.PI * 2 + pid + ft * 7;
        const s = 0.55 + Math.abs(Math.sin(k * 5.7 + pid)) * 0.75;
        const rock = new THREE.Mesh(rimGeos[k % 2], rimMat);
        rock.scale.set(s, s * (0.7 + Math.abs(Math.cos(k * 3.1)) * 0.5), s);
        rock.position.copy(c)
          .addScaledVector(N, Math.cos(ang) * rr)
          .addScaledVector(B, Math.sin(ang) * rr)
          .addScaledVector(tan, Math.sin(k * 9.3) * 0.5);
        rock.rotation.set(k * 1.7, k * 2.9, k * 0.9);
        grp.add(rock);
      }
      // 口灯：一盏冷暗标记光——「这里有路」的远距可读性
      const mouthGlow = new THREE.PointLight(0x3a6a5e, 6, 10, 1.8);
      mouthGlow.position.copy(c).addScaledVector(tan, pid === 3 ? 1.5 : (ft < 0.5 ? 1.5 : -1.5));
      cave.zoneLights.push(mouthGlow);
      grp.add(mouthGlow);
    }
    this.group.add(bg, cg);
    const { p: bypassMid } = cave.frameAt(4, 0.5);
    this.registerCull(bg, bypassMid, 70);
    const { p: stubCMouth } = cave.frameAt(3, 0.05);
    this.registerCull(cg, stubCMouth, 60);
  }

  // ---------- Z2 石笋回廊 ----------
  private buildSpeleothems(q: QualityProfile, cave: Cave, mat: THREE.MeshStandardMaterial): void {
    const { t0, t1 } = cave.zoneRange('gallery');
    const count = Math.floor(q.rocks * 0.55);
    // 3 款滴水石变体（裙边褶皱/蚀沟/轴弯各异）轮换实例化，替代 7 段圆锥「铅笔尖」
    const variants = [dripstoneGeometry(1.3), dripstoneGeometry(6.8), dripstoneGeometry(12.4)];
    const per = Math.ceil(count / variants.length);
    const total = per * variants.length;
    const meshes = variants.map((g) => new THREE.InstancedMesh(g, mat, per));
    const m = new THREE.Matrix4();
    const qDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const qUp = new THREE.Quaternion();
    let idx = 0;
    const place = (mm: THREE.Matrix4): void => {
      if (idx >= total) return;
      meshes[idx % variants.length].setMatrixAt(Math.floor(idx / variants.length), mm);
      idx++;
    };
    while (idx < total) {
      const t = t0 + Math.random() * (t1 - t0) * 1.35; // 溢出到咽喉口
      const { p: center } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const isColumn = Math.random() < 0.1;
      const fromCeil = isColumn ? true : Math.random() < 0.6;
      const posv = center.clone();
      // 避开泳道中轴：水平偏移下限（粗柱贴脸挡视线、也挡玩家路线）
      const minOff = r * (isColumn ? 0.5 : 0.34);
      const offAng = Math.random() * Math.PI * 2;
      const offR = minOff + Math.random() * (r * 0.75 - minOff);
      posv.x += Math.cos(offAng) * offR;
      posv.z += Math.sin(offAng) * offR;
      const s = 0.5 + Math.random() * 1.1;
      if (isColumn) {
        // 石柱 = 石笋 + 石钟乳在腰部相接（真实成柱方式，占两个实例槽）
        posv.y = center.y - r * 0.95;
        m.compose(posv, qUp, new THREE.Vector3(s * 0.9, r * 1.06, s * 0.9));
        place(m);
        const posc = posv.clone();
        posc.y = center.y + r * 0.95;
        m.compose(posc, qDown, new THREE.Vector3(s * 0.82, r * 1.06, s * 0.82));
        place(m);
      } else if (fromCeil) {
        posv.y = center.y + r * (0.88 + Math.random() * 0.15);
        m.compose(posv, qDown, new THREE.Vector3(s * 0.8, 2.6 * s * (1.1 + Math.random() * 0.9), s * 0.8));
        place(m);
      } else {
        posv.y = center.y - r * (0.85 + Math.random() * 0.18);
        m.compose(posv, qUp, new THREE.Vector3(s, 2.6 * s * (0.9 + Math.random() * 0.7), s));
        place(m);
      }
    }
    for (const mesh of meshes) this.group.add(mesh);

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
    // 主塔：一体式巨型石笋（流石裙边+蚀沟高细分），替代 5 段圆锥堆叠的「蛋糕塔」
    const spire = new THREE.Mesh(dripstoneGeometry(3.3, 24, 32), mat);
    spire.scale.set(9.5, 11.2, 9.5);
    spire.position.set(crack.x, floorY, crack.z);
    tower.add(spire);
    // 塔肩：两根伴生石笋打破单锥剪影
    const shoulders: [number, number, number, number, number][] = [
      [1.9, 0.8, 3.4, 5.2, 7.7],
      [-1.6, -1.2, 2.6, 3.8, 15.1],
    ];
    for (const [dx, dz, sxz, sy, seed] of shoulders) {
      const side = new THREE.Mesh(dripstoneGeometry(seed, 16, 22), mat);
      side.scale.set(sxz, sy, sxz);
      side.position.set(crack.x + dx, floorY, crack.z + dz);
      tower.add(side);
    }
    // 塔尖被光束击中的亮斑
    const tipGlow = new THREE.PointLight(0xbfe8da, 85, 26, 1.6);
    tipGlow.position.set(crack.x, floorY + 11.8, crack.z);
    cave.zoneLights.push(tipGlow);
    tower.add(tipGlow);
    // 裂隙下照聚光：把主塔从黑剪影里雕出来（塔身受光面=画面锚点，M4-L7）
    const beamSpot = new THREE.SpotLight(0xbfe8da, 430, 36, 0.46, 0.85, 1.3);
    beamSpot.position.set(crack.x + 0.5, crack.y - 1.5, crack.z + 0.4);
    beamSpot.target.position.set(crack.x, floorY + 5, crack.z);
    tower.add(beamSpot, beamSpot.target);
    // 周围一圈小石笋（构图）
    const smallGeos = [dripstoneGeometry(21.7, 12, 16), dripstoneGeometry(33.9, 12, 16)];
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const s = 0.5 + Math.abs(Math.sin(k * 7.3)) * 0.9;
      const small = new THREE.Mesh(smallGeos[k % 2], mat);
      small.scale.set(1.43 * s, 2.2 * s, 1.43 * s);
      small.rotation.y = k * 2.4;
      small.position.set(
        crack.x + Math.cos(ang) * (4 + Math.sin(k * 3.1) * 1.5),
        floorY,
        crack.z + Math.sin(ang) * (4 + Math.cos(k * 5.7) * 1.5),
      );
      tower.add(small);
    }
    this.group.add(tower);
    this.registerCull(tower, crack, 80);
  }

  // ---------- Z5 卤水镜面（硫化氢云层 + 枯枝） ----------
  private buildHalocline(
    q: QualityProfile, cave: Cave, rockMat: THREE.MeshStandardMaterial,
  ): { y: number; center: THREE.Vector3 } {
    const { t0, t1 } = cave.zoneRange('halo');
    const tMid = (t0 + t1) / 2;
    const { p: center } = cave.frameAt(0, tMid);
    const y = center.y - cave.radiusAt(tMid) * 0.42;
    const hg = new THREE.Group(); // 卤水层地标簇（云面/枯枝/菌席）：距离剔除整组启停

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
      hg.add(plane);
    }

    // 枯树枝（Angelita 式）：从洞底穿出云面。
    // 硫菌白霜（M4-L4）：H2S 界面以下的化能细菌把枯枝裹上一层灰白菌壳——
    // 真实 anchialine 洞穴（如 Cenote Angelita）的标志性景象，云下白、云上深褐。
    // 枝色不用纯黑（黑棍读作几何废件）；干加节弯折、分叉真正长在干上（M4-L7 去棱角）
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x2e2519, roughness: 0.9 });
    const frostMat = new THREE.MeshStandardMaterial({
      color: 0xd6dcd2, roughness: 0.9, emissive: 0x10140f, emissiveIntensity: 0.6,
    });
    for (let i = 0; i < q.branches; i++) {
      const t = t0 + Math.random() * (t1 - t0);
      const { p: c2 } = cave.frameAt(0, t);
      const floorY = c2.y - cave.radiusAt(t) * 0.88;
      const bx = c2.x + (Math.random() - 0.5) * cave.radiusAt(t) * 1.2;
      const bz = c2.z + (Math.random() - 0.5) * cave.radiusAt(t) * 1.2;
      const h = y - floorY + 1 + Math.random() * 3.5;
      // 树干在云面处分成两段：下段带白霜、上段深褐（挂在同一根组下保证同轴）
      const hBelow = Math.min(h - 0.4, Math.max(0.4, y - floorY - 0.25));
      const hAbove = h - hBelow;
      const midR = 0.16 + (0.05 - 0.16) * (hBelow / h);
      const tg = new THREE.Group();
      tg.position.set(bx, floorY, bz);
      tg.rotation.set((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(midR, 0.16, hBelow, 7), frostMat);
      lower.position.y = hBelow / 2;
      tg.add(lower);
      // 上段挂在关节组下，带一个随机折角——枯树的「肘」
      const joint = new THREE.Group();
      joint.position.y = hBelow;
      joint.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, midR, hAbove, 7), branchMat);
      upper.position.y = hAbove / 2;
      joint.add(upper);
      tg.add(joint);
      hg.add(tg);
      // 分叉：几何平移出基端枢轴后长在干的对应高度上（原实现随机悬在干旁像漂浮的棍）
      const n = 2 + Math.floor(Math.random() * 2);
      for (let b = 0; b < n; b++) {
        const bl = 0.7 + Math.random() * 1.6;
        const hFrac = 0.45 + Math.random() * 0.5;
        const geo = new THREE.CylinderGeometry(0.018, 0.05, bl, 5);
        geo.translate(0, bl / 2, 0);
        const fork = new THREE.Mesh(geo, floorY + h * hFrac < y ? frostMat : branchMat);
        fork.position.set(0, h * hFrac, 0);
        fork.rotation.set(
          (0.5 + Math.random() * 0.6) * (Math.random() < 0.5 ? 1 : -1),
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 0.4,
        );
        tg.add(fork);
      }
    }

    // 硫菌席毯：云面下岩底的灰白菌毯斑块（复用云纹理做柔和边缘）
    const matTex = this.cloudTexture();
    for (let i = 0; i < 6; i++) {
      const t = t0 + (0.12 + 0.76 * (i / 5)) * (t1 - t0);
      const { p: c3 } = cave.frameAt(0, t);
      const fy = c3.y - cave.radiusAt(t) * 0.86;
      const mat = new THREE.MeshBasicMaterial({
        map: matTex, color: 0xcfe0d2, transparent: true, opacity: 0.4,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9 + Math.random() * 1.2, 20), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(
        c3.x + (Math.random() - 0.5) * 3,
        fy + 0.08,
        c3.z + (Math.random() - 0.5) * 3,
      );
      disc.renderOrder = 1;
      hg.add(disc);
    }

    // 云层之上的幽白补光
    const haloFill = new THREE.PointLight(0xc8d8cc, 14, 26, 1.6);
    haloFill.position.set(center.x, y + 4, center.z);
    cave.zoneLights.push(haloFill);
    hg.add(haloFill);
    this.group.add(hg);
    this.registerCull(hg, new THREE.Vector3(center.x, y, center.z), 80);
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
  private buildWreck(cave: Cave, models: Models): void {
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
    // 残存船壳板：两片弧面（骨架之外要有「体量」，纯肋骨读作乱线团——M4-L7 读形）
    const shellL = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.35, 4.6, 14, 1, true, Math.PI * 0.62, Math.PI * 0.55),
      wood,
    );
    shellL.rotation.set(Math.PI / 2, 0, 0); // 圆筒轴转到船长方向（z）
    shellL.position.set(-0.15, 0.5, -1.4);
    wreck.add(shellL);
    const shellR = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.3, 3.2, 12, 1, true, Math.PI * 1.32, Math.PI * 0.48),
      wood,
    );
    shellR.rotation.set(Math.PI / 2, 0, 0);
    shellR.position.set(0.1, 0.42, 1.9);
    wreck.add(shellR);
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
    // 船头的老黄铜提灯——还亮着（谁点的？）（Khronos Lantern，CC0；失败保留程序化版本）
    const lantern = new THREE.Group();
    void models.prop('lantern').then((m) => {
      if (!m) {
        const cage = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.11, 0.2, 6, 1, true),
          new THREE.MeshStandardMaterial({ color: 0x6a5428, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }),
        );
        lantern.add(cage);
        return;
      }
      m.scale.setScalar(0.62);
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && mat.color) {
            mat.color.multiply(new THREE.Color(0x9aa89a)); // 铜绿锈色偏
            mat.emissive = new THREE.Color(0x224a30);
            mat.emissiveIntensity = 0.4;
          }
        }
      });
      lantern.add(m);
    });
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a4030, emissive: 0x6ee8a0, emissiveIntensity: 2.4 }),
    );
    flame.position.y = 0.34;
    lantern.add(flame);
    lantern.position.set(0.4, 0.6, -3.9);
    const lanternLight = new THREE.PointLight(0x66d89a, 22, 16, 1.8);
    lanternLight.position.y = 0.34;
    lantern.add(lanternLight);
    cave.zoneLights.push(lanternLight);
    wreck.add(lantern);

    // 碎场：散落的木桶与鱼骨（Kenney Pirate Kit，CC0）——半世纪补给船的货物
    const scatter: [ 'barrel' | 'fishbones', number, number, number, number, number ][] = [
      // [名称, x, z, 缩放, 旋转y, 倾倒]
      ['barrel', -2.4, 2.6, 0.72, 1.2, 1.45],
      ['barrel', 3.1, -1.8, 0.68, 2.8, 0],
      ['barrel', 1.6, 4.4, 0.75, 0.4, 1.5],
      ['fishbones', -1.2, -2.5, 0.55, 2.2, 0],
      ['fishbones', 2.4, 1.3, 0.42, 4.4, 0],
    ];
    for (const [name, sx, sz, ss, ry, rz] of scatter) {
      void models.prop(name).then((m) => {
        if (!m) return;
        m.scale.setScalar(ss);
        m.position.set(sx, rz > 0 ? 0.18 : 0.02, sz);
        m.rotation.set(0, ry, rz);
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat && mat.color) {
              mat.color.multiply(new THREE.Color(name === 'fishbones' ? 0xb8c2b4 : 0x4e6058));
              mat.roughness = Math.min(1, (mat.roughness ?? 0.8) + 0.15);
            }
          }
        });
        wreck.add(m);
      });
    }
    this.group.add(wreck);
    this.registerCull(wreck, this.wreckPos, 75);

    // 沉船厅幽绿死水补光（主光压向船体，让龙骨肋骨的剪影可读）
    const fill = new THREE.PointLight(0x3a5c48, 120, 52, 1.4);
    fill.position.set(center.x + 1, center.y + 1.5, center.z + 1);
    cave.zoneLights.push(fill);
    this.group.add(fill);
    // 船体上方的窄冷光——"墓志"式顶光
    const top = new THREE.PointLight(0x6a9a8a, 55, 20, 1.7);
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
    this.registerCull(altar, this.altarPos, 60);
    return light;
  }

  // ---------- Z7 塌方巨石 ----------
  private buildCollapse(q: QualityProfile, cave: Cave, mat: THREE.MeshStandardMaterial): void {
    const { t0, t1 } = cave.zoneRange('collapse');
    const count = Math.floor(q.rocks * 0.22);
    // 有机巨石变体（平滑法线）替代 20 面体「骰子堆」；窄缝内贴脸可见 → detail 3
    const variants = [boulderGeometry(2.9, 3), boulderGeometry(6.3, 3)];
    const per = Math.ceil(count / variants.length);
    const meshes = variants.map((g) => new THREE.InstancedMesh(g, mat, per));
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    // 确定性伪随机（M5-L1）：巡检可复现；巨石按 N/B 框架贴壁布置，
    // 保证游泳走廊净空（此前世界坐标随机散布会把巨石怼在轴上——玩家无巨石碰撞，直接穿石）
    const rnd = (k: number): number => {
      const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < per * variants.length; i++) {
      const t = t0 + rnd(i * 3.1) * (t1 - t0);
      const { p: center, N, B } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const ang = rnd(i * 7.7) * Math.PI * 2;
      // 贴壁分布：62%~117% 半径（塌方读作「从壁上崩下来堆在四周」）
      const d = r * (0.62 + rnd(i * 5.3) * 0.55);
      // 底部沉降偏置：更多石头堆在洞底
      const sink = -r * 0.22 * rnd(i * 9.1);
      const posv = center.clone()
        .addScaledVector(N, Math.cos(ang) * d)
        .addScaledVector(B, Math.sin(ang) * d);
      posv.y += sink;
      // 走廊净空：靠近轴的石头按距离缩小（净空半径 42% r）
      let s = 0.5 + rnd(i * 11.3) * 1.4;
      s = Math.min(s, Math.max(0.3, (d - r * 0.42) * 0.9));
      quat.setFromEuler(new THREE.Euler(rnd(i * 2.3) * 3, rnd(i * 4.9) * 3, rnd(i * 6.1) * 3));
      m.compose(posv, quat, new THREE.Vector3(s, s * (0.7 + rnd(i * 8.3) * 0.6), s));
      meshes[i % variants.length].setMatrixAt(Math.floor(i / variants.length), m);
    }
    for (const mesh of meshes) this.group.add(mesh);
  }

  // ---------- Z8 深渊井（大厅地面的黑洞） ----------
  private buildPit(cave: Cave, rockMat: THREE.MeshStandardMaterial): void {
    const pc = cave.pitCenter;
    const pg = new THREE.Group(); // 井口地标簇：距离剔除整组启停
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
    pg.add(wall);
    // 井底纯黑
    const abyssDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    abyssDisc.rotation.x = -Math.PI / 2;
    abyssDisc.position.set(pc.x, pc.y - 32.5, pc.z);
    pg.add(abyssDisc);
    // 井口崩落岩块环：厚重的碎石唇缘，遮住地面开洞的裁切锯齿
    const rimGeo = boulderGeometry(5.5, 3);
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
    pg.add(rim);
    // 少量岩齿尖刺穿插其间（滴水石几何：蚀沟+裙边，不再是 5 段锥）
    const toothGeos = [dripstoneGeometry(8.1, 12, 16), dripstoneGeometry(19.5, 12, 16)];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.3;
      const s = 0.6 + Math.abs(Math.sin(i * 5.3)) * 1.0;
      const tooth = new THREE.Mesh(toothGeos[i % 2], rockMat);
      tooth.scale.set(1.8 * s, 2.2 * s, 1.8 * s);
      tooth.position.set(pc.x + Math.cos(ang) * 5.6, pc.y - 0.5, pc.z + Math.sin(ang) * 5.6);
      tooth.rotation.set((Math.random() - 0.5) * 0.5, i * 1.9, (Math.random() - 0.5) * 0.5);
      pg.add(tooth);
    }
    // 深渊冷蓝补光（让大厅轮廓可读，压抑但不致盲黑）
    const { t0, t1 } = cave.zoneRange('abyss');
    const { p: hallC } = cave.frameAt(0, (t0 + t1) / 2);
    const fill = new THREE.PointLight(0x24485a, 130, 100, 1.3);
    fill.position.set(hallC.x, hallC.y + 8, hallC.z);
    cave.zoneLights.push(fill);
    this.group.add(fill);
    // 井口幽蓝上照光（深井在"发光"的错觉——它不该发光）
    const pitGlow = new THREE.PointLight(0x16404e, 48, 34, 1.5);
    pitGlow.position.set(pc.x, pc.y - 3, pc.z);
    cave.zoneLights.push(pitGlow);
    pg.add(pitGlow);
    // 呼吸的幽光（M4-L8）：井口发光膜 + 井筒内加色光柱——黑井从「一块黑」变成
    // 「往下看能看见光、却看不见底」的不祥奇观（fog:false 让它在深渊雾里也远远可见）
    const breathDisc = new THREE.MeshBasicMaterial({
      color: 0x1e5866, transparent: true, opacity: 0.16, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const membrane = new THREE.Mesh(new THREE.CircleGeometry(4.6, 28), breathDisc);
    membrane.rotation.x = -Math.PI / 2;
    membrane.position.set(pc.x, pc.y - 1.2, pc.z);
    pg.add(membrane);
    this.pitBreath.push(breathDisc);
    const breathCol = new THREE.MeshBasicMaterial({
      color: 0x17444f, transparent: true, opacity: 0.1, fog: false,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const column = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 16, 20, 1, true), breathCol);
    column.position.set(pc.x, pc.y - 8.5, pc.z);
    pg.add(column);
    this.pitBreath.push(breathCol);
    // 井筒内两级下沉光点：越深越暗——「有底」的错觉被故意留在半路
    for (const [dy, inten] of [[-8, 26], [-15, 12]] as [number, number][]) {
      const deep = new THREE.PointLight(0x123a46, inten, 20, 1.6);
      deep.position.set(pc.x, pc.y + dy, pc.z);
      cave.zoneLights.push(deep);
      pg.add(deep);
    }
    this.group.add(pg);
    this.registerCull(pg, pc, 85);
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

  private registerCull(obj: THREE.Object3D, center: THREE.Vector3, radius: number): void {
    this.cullClusters.push({ obj, center: center.clone(), r2: radius * radius });
  }

  /** 每帧：按玩家距离启停地标簇（半径取雾能见度上限的宽裕值，玩家察觉不到切换） */
  cullByDistance(p: THREE.Vector3): void {
    for (const c of this.cullClusters) {
      c.obj.visible = p.distanceToSquared(c.center) < c.r2;
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
    // 黑井幽光呼吸（周期 ~9s：慢到刚好让人怀疑是不是自己眼花）
    if (this.pitBreath.length) {
      const b = 0.5 + Math.sin(time * 0.7) * 0.5;
      this.pitBreath[0].opacity = 0.1 + b * 0.12;
      this.pitBreath[1].opacity = 0.06 + b * 0.08;
    }
  }
}
