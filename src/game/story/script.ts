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
  flicker(duration: number): void;
  guideLight(on: boolean): void;
  beginScare(): void;
  /** 奇观弦乐涌起。 */
  swell(dur?: number): void;
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
    t: 0.365,
    run: (c) => {
      c.swell(5);
      c.sub('穹顶裂了一道缝。天光从五十米上方垂下来，像教堂里那种柱子。', 7);
    },
  },
  {
    t: 0.395,
    run: (c) => {
      c.sub('有活物——银色的一小群，绕着那道光转。像一枚慢慢旋转的钥匙。', 7);
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
    t: 0.567,
    run: (c) => {
      c.fog(0.095, 0x010507);
      c.drone(0.42);
      c.ambient(0.03);
      c.sub('没有线的水像没有语法的句子。我已经不确定哪边是回去。', 7);
    },
  },
  // ---- 生物发光廊道（奇观 2：恐惧与美妙的第一次交替）----
  {
    t: 0.585,
    run: (c) => {
      c.fog(0.07, 0x020a12);
      c.drone(0.3);
      c.tension(0.3);
      c.swell(5);
      c.sub('光。墙上有光——**活的光**。成千上万点，像沉在水底的星空。', 8);
      c.obj('穿过发光的廊道');
    },
  },
  { t: 0.612, run: (c) => c.sub('（关掉手电（F），它们会亮得更清楚——黑暗里省下的每一格电都算数）', 7, 'mono') },
  {
    t: 0.648,
    run: (c) => {
      c.sub('它们在我经过时亮起来，一圈一圈。像水替它们呼吸。', 7);
    },
  },
  {
    t: 0.69,
    run: (c) => {
      c.fog(0.105, 0x010507);
      c.drone(0.45);
      c.ambient(0.02);
      c.eerie(true);
      c.obj(null);
      c.sub('光到这里就断了。再往前，是纯粹的黑。', 6);
    },
  },
  {
    t: 0.72,
    run: (c) => {
      c.guideLight(true);
      c.tension(0.6);
      c.sub('前面有光。稳定的、人造的光。……埃利亚斯？', 6);
      c.obj('靠近那盏灯');
    },
  },
  // t≈0.77 指引灯熄灭由 storyMode 距离逻辑处理
  {
    t: 0.795,
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
