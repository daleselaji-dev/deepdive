import type { Cave, CaveProp } from './Cave';
import type * as THREE from 'three';

/**
 * 叙事触发系统（docs/GAME_DESIGN.md §6「人为搞砸」）。
 * radio/env 按主脉进度触发（下潜与回程共用 mainT 递增）；slate/tank 按 3D 距离触发。
 *
 * 五条破坏线索（全程不点破凶手）：
 * ① 搅浑水 silt-out（沉船区，能见度骤降 22s）
 * ② 错绳：白线支线以死结收尾（S2），箭头指向洞内（throat env）
 * ③ 矛盾写字板：两块「第 1 天」（S1 vs S6）；气瓶数目对不上（S3）
 * ④ 可疑无线电：M 的口误（"比上次平稳多了"）、不该知道的沉船
 * ⑤ 空气瓶被人用空又摆回原位（塌方区 T3）
 */

export interface StoryContext {
  radio(text: string, hold?: number): void;
  env(text: string, hold?: number): void;
  slate(text: string): void;
  tank(prop: CaveProp): void;
  silenceBegins(): void;
  scare(): void;
  /** 搅浑水：能见度骤降 seconds 秒 */
  siltOut(seconds: number): void;
}

interface FlowNode {
  t: number;
  fired: boolean;
  run(ctx: StoryContext): void;
}

/** 写字板文本（含互相矛盾对：S1↔S6） */
const SLATES: { key: string; text: string }[] = [
  {
    key: 's1-day1',
    text: '第 1 天 —— 主线布设完成。\n洞比测绘图上深。水像玻璃。\n美极了。\n—— L.C.',
  },
  {
    key: 's2-fakeline',
    text: '这条白线不是我的线。我的线是蓝的。\n白线在这里打了死结。\n打结的人知道会有人跟着它。\n回头。现在。',
  },
  {
    key: 's3-tanks',
    text: '第 3 天 —— 备用瓶少了一支。我数了三遍。\nM 说是我记错了。\nM 是谁？\n我是一个人下来的。',
  },
  {
    key: 's4-bubbles',
    text: '别数气泡。\n数到第七个，它就到了。',
  },
  {
    key: 's5-fins',
    text: '淤泥起来的那次，我看见了鳍。\n不是鲨鱼。鳍是一整排的，像桨。\n它绕着我游了一圈。\n它在看我的灯。',
  },
  {
    key: 's6-day1b',
    text: '第 1 天？——塌方后捡到前面那块板。\n那不是我的字。\n我今天才是第 1 天。\n谁在替我写日志？',
  },
  {
    key: 's7-altar',
    text: '祭坛上的玉器被人重新摆过。\n照片里它们朝东，朝着日出。\n现在全部朝下。\n朝着井。',
  },
];

/** 气瓶元数据：empty 的那支是被人用空又摆回去的 */
const TANKS: { empty: boolean; text: string }[] = [
  { empty: false, text: '备用气瓶，压力表满格。标签上手写着缩写：E.V.\n——你没有在这里放过气瓶。' },
  { empty: false, text: '第二只备用瓶。它是崭新的。\n它在等你。' },
  {
    empty: true,
    text: '压力表：0。\n有人用完了它，又把它摆回原位。\n摆得整整齐齐，标签朝外。',
  },
  { empty: false, text: '荧光标旁的最后一瓶。\n有人希望你能回去。\n或者，希望「回去的人」是谁都行。' },
];

/** 可观察物件（非拾取）：靠近触发一次环境描述，物件保留在原地 */
const RELICS: { kind: CaveProp['kind']; text: string }[] = [
  {
    kind: 'ammonite',
    text: '岩壁里嵌着一枚菊石，比你的头还大。\n一亿年前这里是海底。现在它还是。',
  },
  {
    kind: 'handprints',
    text: '赭红色的负手印，一整面墙。\n一千年前有人潜到这里，只为把手按在黑暗上。\n他们没有手电。',
  },
  {
    kind: 'pot',
    text: '一只玛雅陶罐，半埋在钙化层里。\n给井底之物的供品。\n它是空的——或者说，被收下了。',
  },
  {
    kind: 'helictite',
    text: '石膏针晶，朝所有方向乱长——包括向下。\n洞穴学家管这叫「违反重力的花」。\n一根一万年长一厘米。别碰。',
  },
  {
    kind: 'crayfish',
    text: '几只无色素的盲螯虾伏在岩面上。\n它们是这里的顶级掠食者。\n指甲盖那么大。',
  },
  {
    kind: 'antiquecam',
    text: '一台木三脚架古董相机，镜头对着船头。\n半个世纪前，有人想在水下拍些什么。\n底片匣是空的——被人取走了。',
  },
  {
    kind: 'chest',
    text: '船长的物资箱，半埋在淤泥里。\n锁没有被撬——它是从里面打开的。\n箱底只有一盏没了油的灯。',
  },
];

export class Story {
  private nodes: FlowNode[] = [];
  private slateProps: { prop: CaveProp; text: string }[] = [];
  private tankProps: CaveProp[] = [];
  private relicProps: { prop: CaveProp; text: string; seen: boolean }[] = [];

  constructor(cave: Cave) {
    /** 区内比例 → 主脉 t */
    const zt = (zone: Parameters<Cave['zoneRange']>[0], frac: number): number => {
      const { t0, t1 } = cave.zoneRange(zone);
      return t0 + (t1 - t0) * frac;
    };
    const N = (t: number, run: (ctx: StoryContext) => void): FlowNode => ({ t, fired: false, run });

    this.nodes = [
      // ---------- 下潜 ----------
      N(zt('shaft', 0.3), (c) =>
        c.radio('通话检查。收到请敲两下面镜。……很好。\n水温 24 度，你有 40 分钟。\n找到她——或者找到答案。', 7),
      ),
      N(zt('shaft', 0.85), (c) => c.env('头顶的光柱在收窄。\n回头看了一眼——入口比记忆里远。', 5.5)),
      N(zt('gallery', 0.4), (c) =>
        c.radio('你的呼吸听起来不错，埃利亚斯。比上次平稳多了。\n（你从没和 M 潜过水。）', 6.5),
      ),
      N(zt('throat', 0.45), (c) => c.env('导览线的箭头指向洞的深处。\n箭头，永远应该指向出口。', 6)),
      N(zt('hall', 0.25), (c) => c.env('手电的光第一次够不到对面的墙。\n这里大得不像洞——像被谁挖空的教堂。', 6.5)),
      N(zt('halo', 0.45), (c) =>
        c.env('卤水层。一面悬在半空的镜子。\n镜子下面的世界是黄的，慢的，旧的。', 6.5),
      ),
      N(zt('wreck', 0.25), (c) =>
        c.radio('前面有条船。别碰货舱，那不是这次的任务。\n（你没告诉过 M 有沉船。）', 6.5),
      ),
      // ① 搅浑水：沉船尾段，白雾吞掉一切
      N(zt('wreck', 0.72), (c) => {
        c.siltOut(22);
        c.env('前方的水炸开成一团白雾。\n淤泥不会自己起来。\n刚刚，有什么东西扫过了船底。', 7);
      }),
      N(zt('collapse', 0.12), (c) =>
        c.env('主线在这里断了。\n断口平整——是刀切的，不是磨断的。', 6.5),
      ),
      N(zt('collapse', 0.42), (c) => c.scare()),
      N(zt('collapse', 0.8), (c) => {
        c.silenceBegins();
        c.env('无线电里只剩呼吸声。\n节奏和你的完全一致——只是慢半秒。', 7);
      }),
      N(zt('abyss', 0.18), (c) => c.env('水变暖了。\n洞潜守则里，井底不该是暖的。', 5.5)),
      N(zt('abyss', 0.38), (c) => c.radio('你已经到了。\n她一直都到了。', 6)),
      // ---------- 回程（mainT 继续递增） ----------
      N(zt('chimney', 0.35), (c) =>
        c.env('荧光标钉进岩缝的手法很专业。\n有人维护着它们。最近。', 6),
      ),
      N(zt('chimney', 0.85), (c) =>
        c.radio('快到了。上来之前，把写字板都留在水里。\n那是规矩。\n（谁的规矩？）', 7),
      ),
    ];

    // ---------- 写字板布点（越深越密，支线各藏一块） ----------
    const slateAt = (i: number, zone: Parameters<Cave['zoneRange']>[0] | null, frac: number, ang: number, pathId = 0): void => {
      const t = zone === null ? frac : zt(zone, frac);
      const prop = cave.addProp('slate', t, ang, pathId);
      this.slateProps.push({ prop, text: SLATES[i].text });
    };
    slateAt(0, 'gallery', 0.62, -0.6); // S1 第 1 天（L.C.）
    slateAt(1, null, 0.86, 0.9, 2); //    S2 错绳死结（支线 2 末端）
    slateAt(2, 'hall', 0.6, 2.4); //      S3 气瓶数目 & "M 是谁"
    slateAt(3, 'halo', 0.7, -2.2); //     S4 别数气泡
    slateAt(4, 'wreck', 0.86, 0.7); //    S5 一排的鳍（silt-out 之后）
    slateAt(5, 'collapse', 0.55, -1.1); //S6 另一块「第 1 天」
    slateAt(6, null, 0.8, -0.9, 1); //    S7 祭坛玉器（支线 1）

    // ---------- 备用气瓶（T3 是空的） ----------
    this.tankProps.push(
      cave.addProp('tank', zt('gallery', 0.85), -2.6),
      cave.addProp('tank', zt('hall', 0.78), 2.1),
      cave.addProp('tank', zt('collapse', 0.62), -1.2),
      cave.addProp('tank', zt('chimney', 0.3), 1.8),
    );

    // ---------- 可观察物件（探索奖励：每区一个秘密） ----------
    const relicAt = (i: number, zone: Parameters<Cave['zoneRange']>[0] | null, frac: number, ang: number, pathId = 0): void => {
      const t = zone === null ? frac : zt(zone, frac);
      const prop = cave.addProp(RELICS[i].kind, t, ang, pathId);
      this.relicProps.push({ prop, text: RELICS[i].text, seen: false });
    };
    relicAt(0, 'gallery', 0.3, 1.6); //    菊石（回廊壁）
    relicAt(1, 'hall', 0.4, -2.7); //      手印岩画（光之厅侧壁）
    relicAt(2, null, 0.55, 1.9, 1); //     陶罐（祭坛支线中段）
    relicAt(3, 'collapse', 0.3, 0.8); //   石膏针晶（塌方区）
    relicAt(4, 'abyss', 0.62, -1.9); //    盲螯虾（深渊大厅）
    relicAt(5, 'wreck', 0.55, -1.3); //    古董相机（沉船厅：底片匣之谜）
    relicAt(6, 'wreck', 0.34, 1.9); //     船长物资箱（从里面打开的锁）
  }

  get relicsSeen(): number {
    return this.relicProps.filter((r) => r.seen).length;
  }

  get relicTotal(): number {
    return this.relicProps.length;
  }

  get slatesFound(): number {
    return this.slateProps.filter((s) => s.prop.taken).length;
  }

  get slateTotal(): number {
    return this.slateProps.length;
  }

  tankIndex(prop: CaveProp): number {
    return this.tankProps.indexOf(prop);
  }

  static tankMeta(index: number): { empty: boolean; text: string } {
    return TANKS[Math.max(0, Math.min(TANKS.length - 1, index))];
  }

  update(playerT: number, playerPos: THREE.Vector3, ctx: StoryContext): void {
    for (const node of this.nodes) {
      if (!node.fired && playerT >= node.t) {
        node.fired = true;
        node.run(ctx);
      }
    }
    for (const s of this.slateProps) {
      if (!s.prop.taken && s.prop.mesh.position.distanceToSquared(playerPos) < 2.4 * 2.4) {
        s.prop.taken = true;
        s.prop.mesh.visible = false;
        ctx.slate(s.text);
      }
    }
    for (const t of this.tankProps) {
      if (!t.taken && t.mesh.position.distanceToSquared(playerPos) < 2.2 * 2.2) {
        t.taken = true;
        t.mesh.visible = false;
        ctx.tank(t);
      }
    }
    for (const r of this.relicProps) {
      if (!r.seen && r.prop.mesh.position.distanceToSquared(playerPos) < 3.4 * 3.4) {
        r.seen = true;
        ctx.env(r.text, 7);
      }
    }
  }
}
