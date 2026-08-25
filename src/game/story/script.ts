/** 叙事内容：介绍卡、进度触发节拍表、深海生物台词、红房间对白。 */

export const INTRO_CARDS: string[] = [
  '蓝井镇，雾季。\n委托人是个不肯摘手套的男人。',
  '他哥哥，埃利亚斯·凡恩——职业洞穴潜水员。\n三周前在天坑「蓝井」下潜，再没有上来。',
  '他寄给弟弟的最后一件东西，是一盘磁带。\n四十分钟的水声。\n第三十九分钟，有人在水里说话。',
  '我不会洞潜。\n我接了这个案子。',
];

/** 脚本上下文：storyMode 提供的可调用能力。 */
export interface ScriptCtx {
  sub(text: string, dur?: number, style?: 'mono' | 'creature'): void;
  obj(text: string | null): void;
  fog(density: number, color: number): void;
  drone(x: number): void;
  tension(x: number): void;
  ambient(x: number): void;
  clank(vol?: number, delay?: number): void;
  radio(): void;
  eerie(on: boolean): void;
  chime(): void;
  flicker(duration: number): void;
  guideLight(on: boolean): void;
  beginScare(): void;
}

export interface Beat {
  t: number;
  run(c: ScriptCtx): void;
}

/** 进度 t 驱动的节拍表（顺序触发，每个一次）。 */
export const BEATS: Beat[] = [
  {
    t: 0.005,
    run: (c) => {
      c.fog(0.035, 0x08222b);
      c.drone(0.25);
      c.ambient(0.4);
      c.obj('跟随主线绳下潜');
      c.sub('水比预想的冷。表读数：上午十点十七分。', 5);
    },
  },
  { t: 0.03, run: (c) => c.sub('（WASD / 左摇杆 游动，鼠标 / 右侧拖动 视角）', 6, 'mono') },
  { t: 0.055, run: (c) => c.sub('（Space 上浮，Shift 下潜；F 开关手电）', 6, 'mono') },
  {
    t: 0.1,
    run: (c) => {
      c.sub('入口的光在头顶收拢，像一只慢慢合上的眼睛。', 6);
    },
  },
  {
    t: 0.13,
    run: (c) => {
      c.fog(0.055, 0x04141c);
      c.drone(0.38);
      c.ambient(0.18);
      c.sub('通道在收窄。岩壁上有绳子——是主线绳。埃利亚斯布的线。', 6);
    },
  },
  { t: 0.18, run: (c) => c.clank(0.4, 1.2) },
  {
    t: 0.24,
    run: (c) => {
      c.sub('无线电只剩杂音。上面的世界正式失联。', 5);
      c.radio();
    },
  },
  {
    t: 0.3,
    run: (c) => {
      c.fog(0.038, 0x030f14);
      c.drone(0.45);
      c.ambient(0.12);
      c.sub('洞顶忽然远去——一座石头的教堂。他们管这种地方叫"钟厅"。', 7);
    },
  },
  {
    t: 0.34,
    run: (c) => {
      c.clank(0.5);
      c.clank(0.5, 0.9);
      c.clank(0.45, 1.8);
      c.sub('三下。有节奏的。潜水员用刀敲瓶是在喊：**我在这里**。', 7);
    },
  },
  {
    t: 0.37,
    run: (c) => {
      c.sub('石柱。一整座教堂的石柱，在黑暗里站了一万年。', 6);
    },
  },
  {
    t: 0.4,
    run: (c) => {
      c.sub('洞顶亮着一小片银色——空气。被石头困住了几百年的空气。', 7);
    },
  },
  { t: 0.42, run: (c) => c.tension(0.18) },
  {
    t: 0.46,
    run: (c) => {
      c.flicker(1.2);
      c.sub('手电抖了一下。这种灯，说明书上写着"军用级"。', 5);
      c.tension(0.26);
    },
  },
  {
    t: 0.5,
    run: (c) => {
      c.fog(0.08, 0x02090d);
      c.drone(0.55);
      c.tension(0.38);
      c.sub('窄缝。教科书说：吐气、贴壁、慢。教科书没说心跳怎么办。', 7);
    },
  },
  {
    t: 0.555,
    run: (c) => {
      c.obj('线绳断了——沿断口方向继续');
      c.tension(0.5);
    },
  },
  {
    t: 0.568,
    run: (c) => {
      c.fog(0.075, 0x02100f);
      c.chime();
      c.sub('墙在发光。有生命把整条隧道当成了它们的星空。', 7);
    },
  },
  {
    t: 0.6,
    run: (c) => {
      c.sub('没有线的水像没有语法的句子。我已经不确定哪边是回去。', 8);
    },
  },
  {
    t: 0.642,
    run: (c) => {
      c.fog(0.1, 0x010507);
      c.drone(0.4);
      c.ambient(0.03);
      c.eerie(true);
      c.tension(0.5);
      c.sub('光在身后退潮。黑暗重新合拢，比之前更暗。', 7);
    },
  },
  {
    t: 0.665,
    run: (c) => {
      c.guideLight(true);
      c.tension(0.6);
      c.sub('前面有光。稳定的、人造的光。……埃利亚斯？', 6);
      c.obj('靠近那盏灯');
    },
  },
  // t≈0.70 指引灯熄灭由 storyMode 距离逻辑处理
  {
    t: 0.75,
    run: (c) => {
      c.eerie(false);
      c.beginScare();
    },
  },
];

/** 深海生物的"话"（缺氧段，样式区别于独白）。 */
export const CREATURE_LINES: string[] = [
  '它没有用声音说话。水替它说。',
  '「你们把黑暗叫作深处。我们把它叫作家。」',
  '「那个布线的人向下游了很久。他不是迷路。他是想起了路。」',
  '「睡吧，小小的发光的东西。」',
];

/** 红房间对白：[触发距离(米), 说话者, 文本][]，距离逐级递减触发。 */
export const REDROOM_DIALOGUE: [number, 'figure' | 'mono', string][] = [
  [8.5, 'mono', '地板是干的。我的衣服也是。这里的红色有声音。'],
  [6.5, 'figure', '「你来晚了。或者太早。这里分不清。」'],
  [4.5, 'figure', '「我不是埃利亚斯。埃利亚斯也不是。」'],
  [3.2, 'figure', '「你带来了水。」'],
  [2.4, 'figure', '「失踪的人从来不在深处。深处在失踪的人里。」'],
];

export const REDROOM_FINAL: string[] = [
  '案卷上会写：委托终止，线索中断。',
  '结案报告：未提交。',
];

export const CREDITS_LINES: string[] = [
  'DEEP DIVE ·《蓝井》',
  '一次下潜，一宗悬案，一间红房间',
  '全部几何、纹理与声音均为程序生成',
  '感谢游玩',
];
