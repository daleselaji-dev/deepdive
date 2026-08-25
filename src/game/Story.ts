import type { Cave, CaveProp } from './Cave';
import type * as THREE from 'three';

/**
 * 叙事触发系统。文本与节奏对应 docs/GAME_DESIGN.md §2.3。
 * radio/env 按样条进度触发；slate/tank 按 3D 距离触发。
 */

export interface StoryContext {
  radio(text: string, hold?: number): void;
  env(text: string, hold?: number): void;
  slate(text: string): void;
  tank(prop: CaveProp): void;
  silenceBegins(): void;
  scare(): void;
}

interface FlowNode {
  t: number;
  fired: boolean;
  run(ctx: StoryContext): void;
}

const SLATE_TEXTS: Record<number, string> = {
  1: '第 1 天 —— 主线布设完成。\n洞比测绘图上深。水像玻璃。\n美极了。\n—— L.C.',
  2: '这条白线不是我的。\n我的线是蓝的。\n箭头全部指向里面。\n谁会把箭头指向里面？',
  3: '灯在学我。\n我关灯，它也关。\n我数到三再开——\n它已经开了。',
  4: '别数气泡。\n数到第七个，它就到了。',
  5: '别相信光。它在学我们。\n\n—— 这一行的字迹，你认得。\n是你的。',
};

export class Story {
  private nodes: FlowNode[] = [];
  private slateProps: { prop: CaveProp; text: string }[] = [];
  private tankProps: CaveProp[] = [];

  constructor(cave: Cave) {
    // v2 闭环地图：去程占 t 0..abyssMid，旧触发点按比例重映射（Loop E 将全面重写）
    const ab = cave.zoneRange('abyss');
    const scale = ((ab.t0 + ab.t1) / 2) / 0.95;
    const N = (t0: number, run: (ctx: StoryContext) => void): FlowNode => ({ t: t0 * scale, fired: false, run });
    this.nodes = [
      N(0.028, (c) =>
        c.radio('通话检查。收到请敲两下面镜。……很好。\n水温 24 度，你有 40 分钟。\n找到她——或者找到答案。', 7),
      ),
      N(0.065, (c) => c.env('头顶的光柱在收窄。\n回头看了一眼——入口比记忆里远。', 5.5)),
      N(0.18, (c) => c.radio('你的呼吸听起来不错，埃利亚斯。比上次平稳多了。\n（你从没和 M 潜过水。）', 6.5)),
      N(0.34, (c) => c.env('导览线的箭头指向洞的深处。\n箭头，永远应该指向出口。', 6)),
      N(0.56, (c) => {
        c.silenceBegins();
        c.env('无线电里只剩呼吸声。\n节奏和你的完全一致——只是慢半秒。', 7);
      }),
      N(0.632, (c) => c.scare()),
      N(0.88, (c) => c.env('水变暖了。\n洞潜守则里，井底不该是暖的。', 5.5)),
      N(0.925, (c) => c.radio('你已经到了。\n她一直都到了。', 6)),
    ];

    // 写字板（靠近触发全屏）
    const slateDefs: [number, number, number][] = [
      // [t, angle, textId]
      [0.1, -0.6, 1],
      [0.26, 2.4, 2],
      [0.5, -2.2, 3],
      [0.7, 0.7, 4],
      [0.84, -1.1, 5],
    ];
    for (const [t, ang, id] of slateDefs) {
      const prop = cave.addProp('slate', t * scale, ang);
      this.slateProps.push({ prop, text: SLATE_TEXTS[id] });
    }

    // 备用气瓶
    this.tankProps.push(
      cave.addProp('tank', 0.3 * scale, -2.6),
      cave.addProp('tank', 0.58 * scale, 2.1),
      cave.addProp('tank', 0.8 * scale, -1.2),
      cave.addProp('tank', 0.93 * scale, 1.8),
    );
  }

  get slatesFound(): number {
    return this.slateProps.filter((s) => s.prop.taken).length;
  }

  /** 拾取时的叙事文案 */
  static tankText(index: number): string {
    return index === 0
      ? '备用气瓶。标签上手写着缩写：E.V.\n——你没有在这里放过气瓶。'
      : '第二只备用瓶，压力表满格。\n它是崭新的。它在等你。';
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
  }

  tankIndex(prop: CaveProp): number {
    return this.tankProps.indexOf(prop);
  }
}
