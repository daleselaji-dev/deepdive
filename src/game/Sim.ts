import * as THREE from 'three';
import type { Cave, ZoneName } from './Cave';
import type { Player } from './Player';
import type { Buddy } from './Buddy';
import type { Hud } from './Hud';
import type { AudioEngine } from './AudioEngine';

/**
 * 洞潜安全模拟（docs/WORKFLOW.md §3.2 Loop4 / 尊重红线 §3.5）：
 * 五个**教学向、模式化**的事故类型重建——内容全部虚构，
 * 不使用真实遇难者姓名，不影射任何一起具体真实事故。
 * 事故类型分类参考公开洞潜安全教育文献：
 * 能见度丧失 / 导览线方向错误 / 气体管理失败 / 潜伴失散 / 减压停留失败。
 */

export interface SimSpec {
  id: number;
  code: string;
  title: string;
  goal: string;
  rule: string;
}

export const SIM_SPECS: SimSpec[] = [
  {
    id: 0, code: 'SIM-01', title: '白雾 · 能见度丧失',
    goal: '沉积物扬起后，贴住导览线撤离到集合点',
    rule: '停 · 贴线 · 慢——白雾里唯一的路是线',
  },
  {
    id: 1, code: 'SIM-02', title: '错箭头 · 导览线方向错误',
    goal: '发现箭头指向洞内后，做出正确的返航决策',
    rule: '线箭头永远指向最近出口；存疑即返航',
  },
  {
    id: 2, code: 'SIM-03', title: '三分线 · 气体管理',
    goal: '在气量降到 2/3 前主动转向，带余量出洞',
    rule: '1/3 去程，1/3 回程，1/3 留给意外',
  },
  {
    id: 3, code: 'SIM-04', title: '失散 · 潜伴分离',
    goal: '按失散协议：停住、灯光扫视、沿线寻回潜伴',
    rule: '先停住再找灯——乱动的人找不到人，也会被找不到',
  },
  {
    id: 4, code: 'SIM-05', title: '减压债 · 阶段停留',
    goal: '带着接近饱和的氮上升：完成两段停留再出水',
    rule: '气泡比你慢——超过它，氮就在血里开花',
  },
];

/** Game 提供给模拟导演的窄接口 */
export interface SimHooks {
  time(): number;
  o2(): number;
  setO2(v: number): void;
  n2(): number;
  setN2(v: number): void;
  /** 氧耗倍率（SIM-03 用压缩时间尺度） */
  setDrain(mult: number): void;
  silt(seconds: number): void;
  /** 结束模拟：弹出复盘面板 */
  end(pass: boolean, headline: string, body: string): void;
}

export class SimDirector {
  active = false;
  id = -1;
  /** 测试加速：仅放大模拟内部计时（停留/静止/离线），不影响物理 */
  debugScale = 1;

  private step = 0;
  private t0 = 0; // 模拟开始时刻
  private markT = 0; // 场景锚点（转向点/失散点等）
  private offLine = 0;
  private lostPoint = new THREE.Vector3();
  private sweepAccum = 0;
  private prevYaw = 0;
  private stillTimer = 0;
  private stop1 = 0;
  private stop2 = 0;
  private prevDepth = 0;
  private rate = 0;
  private warned = new Set<string>();
  private arrowMesh: THREE.Object3D | null = null;

  constructor(
    private cave: Cave,
    private player: Player,
    private buddy: Buddy,
    private hud: Hud,
    private audio: AudioEngine,
    private scene: THREE.Scene,
    private hooks: SimHooks,
  ) {}

  /** 该场景是否需要 HUD 导览线罗盘 */
  wantGuide(): boolean {
    if (this.id === 1 && this.step >= 1) return false; // 错箭头：决策必须自己做
    if (this.id === 2 && this.step >= 2) return false; // 三分线：转向后靠记忆回程
    if (this.id === 3 && this.step >= 2) return false; // 失散：靠灯找人，不靠罗盘
    return true;
  }

  private zt(zone: ZoneName, frac: number): number {
    const { t0, t1 } = this.cave.zoneRange(zone);
    return t0 + (t1 - t0) * frac;
  }

  private say(text: string, who = '', hold = 6): void {
    this.hud.subtitle(text, who, hold);
  }

  private once(key: string, run: () => void): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    run();
  }

  // ---------- 启动 ----------
  start(id: number): void {
    this.active = true;
    this.id = id;
    this.step = 0;
    this.t0 = this.hooks.time();
    this.offLine = 0;
    this.sweepAccum = 0;
    this.stillTimer = 0;
    this.stop1 = 0;
    this.stop2 = 0;
    this.rate = 0;
    this.warned.clear();
    this.hooks.setDrain(1);
    this.buddy.hide();

    const spec = SIM_SPECS[id];
    const brief = (body: string): void => {
      void this.hud.showSlate(
        `${spec.code} ${spec.title}\n\n${body}\n\n【守则】${spec.rule}\n\n本模拟为虚构教学场景，向洞潜安全教育社区致敬，不影射任何真实事件或人员。`,
        '安全模拟 · 任务简报',
      );
    };

    switch (id) {
      case 0: { // 白雾
        this.player.setStart(this.cave, this.zt('wreck', 0.15));
        this.hooks.setO2(85);
        this.hooks.setN2(20);
        this.buddy.spawn(this.player.position.clone().add(new THREE.Vector3(-1.2, 0.8, 1)));
        brief('你和特奥在沉船峡做穿越训练。粉质沉积层比预报的厚。\n如果起雾：立刻减速、贴住导览线、匀速撤离到船尾集合点。\n离线超过几秒，你就再也摸不回来了。');
        break;
      }
      case 1: { // 错箭头
        this.player.setStart(this.cave, this.zt('throat', 0.12));
        this.hooks.setO2(70);
        this.hooks.setN2(25);
        brief('独潜复线任务：检查一段前人留下的旧导览线。\n规程：线上的方向箭头**永远指向最近的出口**。\n如果现场与规程矛盾——相信规程，不相信现场。');
        break;
      }
      case 2: { // 三分线
        this.player.setStart(this.cave, this.zt('gallery', 0.08));
        this.hooks.setO2(100);
        this.hooks.setN2(10);
        this.hooks.setDrain(3.4); // 压缩时间尺度：把 6 分钟的气当 2 分钟用
        this.buddy.spawn(this.player.position.clone().add(new THREE.Vector3(-1.2, 0.8, 1)));
        brief('探线日：往深处走，能走多远走多远——\n但按三分法则：气量降到 2/3（66%）之前必须转向。\n下面永远有「再看一眼」的理由。三分线不讲理由。');
        break;
      }
      case 3: { // 失散
        this.player.setStart(this.cave, this.zt('hall', 0.25));
        this.hooks.setO2(80);
        this.hooks.setN2(25);
        this.buddy.spawn(this.player.position.clone().add(new THREE.Vector3(-1.2, 0.8, 1)));
        brief('你和特奥横穿光之厅。他在你左后方，灯光互相可见。\n若失散：**原地停住**，灯光缓慢扫视一整圈找他的灯——\n乱动的人找不到人，也会被找不到。');
        break;
      }
      case 4: { // 减压债
        this.player.setStart(this.cave, this.zt('chimney', 0.3));
        this.hooks.setO2(72);
        this.hooks.setN2(80);
        this.prevDepth = this.player.depth;
        brief('长潜回程，你的氮饱和已接近上限。\n上升途中完成两段停留：−9M 带 18 秒，−5M 带 26 秒。\n上升永远不要超过你呼出的气泡。');
        break;
      }
    }
  }

  // ---------- 主更新 ----------
  update(dt: number): void {
    if (!this.active) return;
    dt *= this.debugScale;
    switch (this.id) {
      case 0: this.simSilt(dt); break;
      case 1: this.simArrow(); break;
      case 2: this.simThirds(); break;
      case 3: this.simLost(dt); break;
      case 4: this.simDeco(dt); break;
    }
    // 通用安全网：气尽即失败
    if (this.active && this.hooks.o2() <= 0) {
      this.fail('气尽', '压力表停在 0。\n在洞里，气量不是资源，是倒计时。\n每一条守则，最终都是为了让这个数字永远大于零。');
    }
  }

  private pass(headline: string, body: string): void {
    if (!this.active) return;
    this.active = false;
    this.hooks.end(true, headline, body);
  }

  private fail(headline: string, body: string): void {
    if (!this.active) return;
    this.active = false;
    this.hooks.end(false, headline, body);
  }

  // ---------- SIM-01 白雾 ----------
  private simSilt(dt: number): void {
    const p = this.player;
    if (this.step === 0 && !this.hud.slateOpen) {
      this.step = 1;
      this.say('集合点在沉船尾。跟着线走，注意鳍——别踢起底。', '特奥 · 手势', 6.5);
      this.buddy.gesture('point', 3, this.cave.frameAt(0, p.mainT).tan);
    }
    if (this.step === 1 && p.mainT >= this.zt('wreck', 0.42)) {
      this.step = 2;
      this.hooks.silt(34);
      this.audio.duckBed(0.3, 3);
      this.buddy.gesture('attention', 3);
      this.say('底起来了——白雾在一秒内吞掉一切。\n停。摸到线。贴着它走。', '', 7);
    }
    if (this.step === 2) {
      // 离线检测：偏离主脉中心超过 62% 半径
      const { p: center } = this.cave.frameAt(0, p.mainT);
      const r = this.cave.radiusAt(p.mainT);
      const off = p.position.distanceTo(center) > r * 0.62;
      this.offLine = off ? this.offLine + dt : Math.max(0, this.offLine - dt * 1.6);
      if (off) {
        this.once('off1', () => this.say('你离线了。白雾里没有第二次机会——回到线上。', '', 4));
        if (this.offLine > 2.4) this.warned.delete('off1');
      }
      if (this.offLine > 6) {
        this.fail(
          '离线 · 迷失',
          '你在白雾里离开了导览线超过六秒。\n真实事故统计里，「找不回线」是能见度丧失后的头号死因。\n守则只有三个字：停、贴线、慢。',
        );
        return;
      }
      if (p.mainT >= this.zt('wreck', 0.88)) {
        this.pass(
          '集合点到达',
          '你在零能见度里贴住了线，匀速撤离。\n没有英雄动作，没有捷径——这正是教科书答案。\n记住这次手心贴着线的感觉。',
        );
      }
    }
    if (this.hooks.time() - this.t0 > 300) {
      this.fail('超时', '你在白雾里耗得太久。\n气量与冷静都是消耗品。撤离要匀速，但不能停滞。');
    }
  }

  // ---------- SIM-02 错箭头 ----------
  private simArrow(): void {
    const p = this.player;
    if (this.step === 0 && !this.hud.slateOpen) {
      this.step = 0.5;
      this.say('旧线状态不错。检查每一枚方向箭头。', '', 5.5);
    }
    if (this.step < 1 && p.mainT >= this.zt('throat', 0.45)) {
      this.step = 1;
      this.buildArrow();
      this.audio.radioBlip(0.4);
      this.say('这枚箭头指向洞的**深处**。\n规程说：箭头永远指向最近的出口。\n现场和规程，只能信一个。', '', 9);
    }
    if (this.step === 1) {
      if (p.mainT <= this.zt('throat', 0.1)) {
        this.pass(
          '存疑返航',
          '你没有跟着错误的箭头走。\n真实事故里，被反向箭头或断线带进死路的潜水员，最后都在离出口很近的地方耗尽气。\n「存疑即返航」——这五个字每年都在救人。',
        );
      } else if (p.mainT >= this.zt('throat', 0.92)) {
        this.fail(
          '跟随错误箭头',
          '你顺着箭头游进了更深的迷宫。\n放错（或被人反转）的箭头是洞潜史上反复出现的杀手。\n规程高于现场：箭头存疑，立即返航，报告复线。',
        );
      }
    }
    if (this.hooks.time() - this.t0 > 300) {
      this.fail('犹豫超时', '你停在原地太久。\n犹豫本身也是一个决策——而且是耗气的那种。\n存疑：返航。永远可以改天再来。');
    }
  }

  // ---------- SIM-03 三分线 ----------
  private simThirds(): void {
    const p = this.player;
    const o2 = this.hooks.o2();
    if (this.step === 0 && !this.hud.slateOpen) {
      this.step = 1;
      this.say('往深处走。表读 100。\n你的转向点：66。', '特奥 · 写字板', 6);
    }
    if (this.step === 1) {
      if (o2 <= 80) this.once('air80', () => {
        this.buddy.gesture('airCheck', 4);
        this.say('特奥敲表——报数。你比出 8 和 0。', '', 4.5);
      });
      if (o2 <= 66) {
        this.step = 2;
        this.markT = p.mainT;
        this.buddy.gesture('up', 3.4);
        this.audio.radioBlip(0.6);
        this.say('66。三分线到了。\n前面还有没看完的洞——它明天还在。转向。', '', 7);
      }
    }
    if (this.step === 2) {
      if (o2 < 55 && p.mainT > this.markT + 0.008) {
        this.fail(
          '越过三分线',
          '转向点过去很久，你还在向深处走。\n气体管理失败很少是「没气了」，几乎都是「转身太晚」。\n1/3 去程，1/3 回程，1/3 留给那个你以为不会发生的意外。',
        );
        return;
      }
      if (p.mainT <= this.zt('gallery', 0.05)) {
        if (o2 >= 20) {
          this.pass(
            '带余量出洞',
            `你在 66 转向，出洞时表读 ${Math.round(o2)}。\n那多出来的 1/3 你今天没用上——\n用上它的那天，你会记得今天。`,
          );
        } else {
          this.fail(
            '余量耗尽',
            `你出来了，但表读只剩 ${Math.round(o2)}。\n回程比去程更费气：逆流、疲劳、紧张。\n三分法则安的就是这个心——今天你把保险用掉了。`,
          );
        }
      }
    }
  }

  // ---------- SIM-04 失散 ----------
  private simLost(dt: number): void {
    const p = this.player;
    if (this.step === 0 && !this.hud.slateOpen) {
      this.step = 1;
      this.say('保持队形。你的灯扫到哪，他就知道你在哪。', '', 5.5);
    }
    if (this.step === 1 && p.mainT >= this.zt('hall', 0.48)) {
      this.step = 2;
      this.hooks.silt(11);
      this.buddy.hide();
      this.lostPoint.copy(p.position);
      this.stillTimer = 0;
      this.say('一阵白雾扫过——\n左后方的灯没了。特奥不见了。\n【协议第一步】原地停住。', '', 8);
    }
    if (this.step === 2) {
      // 第一步：停住 2.5 秒
      const speed = p.velocity.length();
      this.stillTimer = speed < 0.5 ? this.stillTimer + dt : 0;
      if (p.position.distanceTo(this.lostPoint) > 10) {
        this.fail(
          '乱找 · 双重失散',
          '你离开失散点去「找」他——现在你们两个都在动，\n两盏灯在黑暗里画着永不相交的圆。\n协议第一步永远是：停住。让至少一个人是定点。',
        );
        return;
      }
      if (this.stillTimer >= 2.5) {
        this.step = 3;
        this.prevYaw = p.yaw;
        this.sweepAccum = 0;
        this.say('【协议第二步】灯光缓慢扫视一整圈。\n找他的灯，不是找他的人——灯比人亮得多。', '', 7);
      }
    }
    if (this.step === 3) {
      let d = p.yaw - this.prevYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.prevYaw = p.yaw;
      if (p.velocity.length() < 0.8) this.sweepAccum += Math.abs(d);
      if (p.position.distanceTo(this.lostPoint) > 10) {
        this.fail('乱找 · 双重失散', '扫视要在原地完成。\n你一移动，你的灯在他眼里就成了另一颗流星。\n停住，是为了让他能找到你。');
        return;
      }
      if (this.sweepAccum > 5.8) {
        this.step = 4;
        // 特奥出现在线前方，灯光横扫回应
        const { p: c, N } = this.cave.frameAt(0, this.zt('hall', 0.6));
        this.buddy.spawn(c.clone().addScaledVector(N, 1.5), 'hold');
        this.buddy.gesture('attention', 6);
        this.say('十点钟方向——一道灯光在横扫。\n是他。沿线过去汇合。', '', 6.5);
      }
    }
    if (this.step === 4 && p.position.distanceTo(this.buddy.worldPos) < 3.4) {
      this.buddy.gesture('ok', 3);
      this.pass(
        '寻回潜伴',
        '停住 → 扫灯 → 沿线汇合。三步，一步没乱。\n失散协议的核心是把「两个移动目标」变成「一个定点加一个搜索者」。\n你们今天都回家。',
      );
    }
    if (this.hooks.time() - this.t0 > 300) {
      this.fail(
        '超时 · 单人出洞',
        '协议的最后一条你没能用上：搜索超时后，带着自己的 1/3 独立出洞，在洞口等他。\n两个人都耗在里面，救援队要找的就是两具装备。',
      );
    }
  }

  // ---------- SIM-05 减压债 ----------
  private simDeco(dt: number): void {
    const p = this.player;
    const depth = p.depth;
    // 上升速率
    const rawRate = dt > 0 ? (this.prevDepth - depth) / dt : 0;
    this.prevDepth = depth;
    this.rate += (rawRate - this.rate) * Math.min(1, dt * 3);

    if (this.step === 0 && !this.hud.slateOpen) {
      this.step = 1;
      this.say('潜水电脑：两段停留。−9M × 18 秒，−5M × 26 秒。\n慢慢来。水面不会跑。', '潜水电脑', 6.5);
    }
    if (this.step >= 1 && this.step < 4) {
      // 超速上升 → 氮惩罚
      if (this.rate > 2.3 && depth > 3) {
        this.once('fast', () => {
          this.say('上升太快——你追过了自己的气泡。\n血里的氮在变成香槟。慢下来。', '潜水电脑', 5);
          this.hooks.setN2(Math.min(100, this.hooks.n2() + 7));
          window.setTimeout(() => this.warned.delete('fast'), 6000);
        });
      }
      if (this.hooks.n2() >= 100) {
        this.fail(
          '减压病 · 血里的针',
          '氮饱和越过红线。关节、皮肤、神经——气泡在所有毛细血管里开花。\n减压停留不是仪式，是把香槟瓶的盖子慢慢拧开。\n你今天把它一口气拔了。',
        );
        return;
      }
    }
    if (this.step === 1) {
      const inW = depth >= 7.5 && depth <= 10.5;
      if (inW) this.stop1 += dt;
      if (depth < 16) this.hud.setDeco(18 - this.stop1, inW, '第一段停留 · HOLD −9M', '保持在 −7.5 ~ −10.5M');
      if (this.stop1 >= 18) {
        this.step = 2;
        this.hud.hideDeco();
        this.say('第一段完成。上到 −5M 做第二段。', '潜水电脑', 5);
      } else if (depth < 6.5) {
        this.fail(
          '跳过第一段停留',
          '你从 −9M 的窗口直接漂了上去。\n深停的意义是先把最激烈的一段压差消化掉——\n跳过它，后面的停留做得再久也追不回来。',
        );
        return;
      }
    }
    if (this.step === 2) {
      const inW = depth >= 3.5 && depth <= 7;
      if (inW) this.stop2 += dt;
      this.hud.setDeco(26 - this.stop2, inW, '第二段停留 · HOLD −5M', '保持在 −3.5 ~ −7M');
      if (this.stop2 >= 26) {
        this.step = 3;
        this.hud.hideDeco();
        this.say('减压完成。潜水电脑安静了。\n现在，慢慢出水。', '潜水电脑', 5.5);
      }
    }
    if (p.position.y > -0.2) {
      if (this.step >= 3) {
        this.pass(
          '干干净净地出水',
          `两段停留全部完成，氮饱和 ${Math.round(this.hooks.n2())}%，在安全线内。\n你比计划多花了四十四秒——\n和在减压舱里躺六小时相比，这是全世界最划算的四十四秒。`,
        );
      } else {
        this.fail(
          '跳过减压 · 出水',
          '你带着接近饱和的氮直接破水。\n晨光很好，但你的关节里已经有细小的针。\n上面没有任何东西，值得你跳过一次停留。',
        );
      }
    }
  }

  // ---------- 场景道具 ----------
  /** SIM-02：指向洞内的错误箭头（挂在导览线上的三角标） */
  private buildArrow(): void {
    const { p: c, tan, N } = this.cave.frameAt(0, this.zt('throat', 0.5));
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, emissive: 0x4a4636, roughness: 0.5 });
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 4), mat);
    head.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.16), mat);
    tail.position.z = -0.16;
    g.add(head, tail);
    g.position.copy(c).addScaledVector(N, 0.6);
    // 指向洞内（+tan 是深处方向——这正是错误所在）
    g.lookAt(g.position.clone().add(tan));
    const glow = new THREE.PointLight(0xe8e2c0, 2.2, 4, 1.8);
    g.add(glow);
    this.arrowMesh = g;
    this.scene.add(g);
  }

  /** 清理场景道具（复盘后重开时由页面刷新兜底） */
  dispose(): void {
    if (this.arrowMesh) this.scene.remove(this.arrowMesh);
    this.arrowMesh = null;
  }

  /** 调试快照（scripts/flow-test 无头断言用） */
  debugState(): object {
    return {
      id: this.id,
      active: this.active,
      step: this.step,
      offLine: +this.offLine.toFixed(2),
      sweep: +this.sweepAccum.toFixed(2),
      stop1: +this.stop1.toFixed(1),
      stop2: +this.stop2.toFixed(1),
    };
  }
}
