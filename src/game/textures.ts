import * as THREE from 'three';

/** Canvas 程序化纹理合成 —— 零外部资产（docs/ART_DIRECTION.md §4） */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const rand2 = (x: number, y: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = rand2(xi, yi), b = rand2(xi + 1, yi), c = rand2(xi, yi + 1), d = rand2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 分形值噪声网格（供多贴图共用） */
function fbmGrid(w: number, h: number, octaves = 5, baseFreq = 5): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, amp = 0.55, freq = baseFreq / w;
      for (let o = 0; o < octaves; o++) {
        n += valueNoise(x * freq, y * freq) * amp;
        amp *= 0.5;
        freq *= 2.1;
      }
      out[y * w + x] = n;
    }
  }
  return out;
}

export interface RockMaps {
  map: THREE.Texture;
  bumpMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** 岩壁三贴图：反照率（层理+裂隙）+ 凹凸 + 粗糙度 */
export function rockMaps(size = 512): RockMaps {
  const macro = fbmGrid(size, size, 5, 5);
  const micro = fbmGrid(size, size, 4, 22);

  // ---- 反照率 ----
  const [ca, ctxA] = canvas(size, size);
  const img = ctxA.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = macro[i] * 0.8 + micro[i] * 0.2;
    const val = Math.max(0, Math.min(255, 96 + (n - 0.5) * 150));
    img.data[i * 4] = val * 0.72;
    img.data[i * 4 + 1] = val * 0.86;
    img.data[i * 4 + 2] = val * 0.82;
    img.data[i * 4 + 3] = 255;
  }
  ctxA.putImageData(img, 0, 0);
  // 沉积条带（石灰岩层理）
  ctxA.globalAlpha = 0.14;
  for (let i = 0; i < 22; i++) {
    const y = rand2(i, 7) * size;
    ctxA.fillStyle = i % 2 ? '#0c1a1c' : '#3d4a46';
    ctxA.fillRect(0, y, size, 1.5 + rand2(i, 11) * 5);
  }
  // 裂隙
  ctxA.globalAlpha = 0.32;
  ctxA.strokeStyle = '#050b0c';
  for (let i = 0; i < 30; i++) {
    ctxA.lineWidth = 0.6 + rand2(i, 3) * 1.6;
    ctxA.beginPath();
    let x = rand2(i, 5) * size, y = rand2(i, 9) * size;
    ctxA.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (rand2(i, s * 2) - 0.5) * 90;
      y += rand2(i, s * 2 + 1) * 55;
      ctxA.lineTo(x, y);
    }
    ctxA.stroke();
  }
  ctxA.globalAlpha = 1;
  const map = new THREE.CanvasTexture(ca);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  // ---- 凹凸（高频微噪 + 宏观起伏）----
  const [cb, ctxB] = canvas(size, size);
  const imgB = ctxB.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, (macro[i] * 0.45 + micro[i] * 0.55) * 255));
    imgB.data[i * 4] = imgB.data[i * 4 + 1] = imgB.data[i * 4 + 2] = v;
    imgB.data[i * 4 + 3] = 255;
  }
  ctxB.putImageData(imgB, 0, 0);
  const bumpMap = new THREE.CanvasTexture(cb);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;

  // ---- 粗糙度（湿岩局部反光）----
  const [cr, ctxR] = canvas(size, size);
  const imgR = ctxR.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(150, Math.min(255, 255 - macro[i] * 90));
    imgR.data[i * 4] = imgR.data[i * 4 + 1] = imgR.data[i * 4 + 2] = v;
    imgR.data[i * 4 + 3] = 255;
  }
  ctxR.putImageData(imgR, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(cr);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;

  return { map, bumpMap, roughnessMap };
}

/** 焦散动画帧：正弦干涉网（cheap caustic），循环 n 帧 */
export function causticFrames(n: number, size: number): THREE.CanvasTexture[] {
  const frames: THREE.CanvasTexture[] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const [c, ctx] = canvas(size, size);
    const img = ctx.createImageData(size, size);
    const f = (Math.PI * 2) / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x * f * 3, v = y * f * 3;
        const a = Math.sin(u * 1.7 + t) + Math.sin(v * 1.3 - t * 1.0) + Math.sin((u + v) * 1.1 + t * 0.7);
        const b = Math.sin(u * 2.3 - t * 1.3) + Math.sin(v * 2.9 + t * 0.8);
        let br = Math.pow(Math.abs(Math.sin(a * 1.2 + b * 0.7)), 6.0);
        br = Math.min(1, br * 1.5);
        const i = (y * size + x) * 4;
        img.data[i] = br * 190;
        img.data[i + 1] = br * 235;
        img.data[i + 2] = br * 225;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    frames.push(tex);
  }
  return frames;
}

/** 老木纹（沉船）：暗褐基底 + 年轮条纹 + 腐蚀噪斑 */
export function woodTexture(size = 256): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = '#231a12';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * size + (rand2(i, 1) - 0.5) * 6;
    ctx.strokeStyle = `rgba(${52 + rand2(i, 2) * 30}, ${38 + rand2(i, 3) * 22}, ${24 + rand2(i, 4) * 14}, ${0.35 + rand2(i, 5) * 0.4})`;
    ctx.lineWidth = 1 + rand2(i, 6) * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (rand2(i, x) - 0.5) * 2);
    }
    ctx.stroke();
  }
  // 腐蚀噪斑
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(10, 14, 12, ${0.1 + rand2(i, 8) * 0.25})`;
    const r = 1 + rand2(i, 9) * 5;
    ctx.beginPath();
    ctx.arc(rand2(i, 10) * size, rand2(i, 11) * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 玛雅式雕纹石板：暗石基底 + 几何刻痕行 */
export function glyphTexture(size = 256): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  const g = fbmGrid(size, size, 4, 6);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 58 + g[i] * 44;
    img.data[i * 4] = v * 0.95;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v * 0.9;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 刻痕行：抽象几何图形（虚构纹样，非真实文字）
  const cell = size / 6;
  ctx.strokeStyle = 'rgba(18, 22, 20, 0.85)';
  ctx.lineWidth = Math.max(1.6, size / 150);
  for (let ry = 0; ry < 6; ry++) {
    for (let rx = 0; rx < 6; rx++) {
      const cx = rx * cell + cell / 2, cy = ry * cell + cell / 2;
      const s = cell * 0.32;
      const kind = Math.floor(rand2(rx * 7 + 1, ry * 13 + 2) * 4);
      ctx.beginPath();
      if (kind === 0) {
        ctx.arc(cx, cy, s, 0, Math.PI * 2);
        ctx.moveTo(cx - s * 0.5, cy);
        ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
      } else if (kind === 1) {
        ctx.rect(cx - s, cy - s, s * 2, s * 2);
        ctx.moveTo(cx - s, cy - s);
        ctx.lineTo(cx + s, cy + s);
      } else if (kind === 2) {
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s, cy + s);
        ctx.lineTo(cx - s, cy + s);
        ctx.closePath();
        ctx.moveTo(cx, cy + s * 0.2);
        ctx.arc(cx, cy + s * 0.2, s * 0.3, 0, Math.PI * 2);
      } else {
        for (let w = 0; w < 3; w++) {
          ctx.moveTo(cx - s, cy - s + w * s);
          ctx.lineTo(cx + s, cy - s + w * s);
        }
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx, cy + s);
      }
      ctx.stroke();
    }
  }
  // 风化磨损
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(${90 + rand2(i, 1) * 30}, ${96 + rand2(i, 2) * 30}, ${88 + rand2(i, 3) * 28}, 0.12)`;
    ctx.fillRect(rand2(i, 4) * size, rand2(i, 5) * size, 1 + rand2(i, 6) * 3, 1 + rand2(i, 7) * 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 软圆粒子 sprite（marine snow / 气泡 / 浮游） */
export function particleSprite(): THREE.Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(220,235,230,0.9)');
  g.addColorStop(0.35, 'rgba(190,215,205,0.35)');
  g.addColorStop(1, 'rgba(180,210,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 气泡 sprite：环形高光（区别于雪粒） */
export function bubbleSprite(): THREE.Texture {
  const [c, ctx] = canvas(64, 64);
  ctx.strokeStyle = 'rgba(210,240,240,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 22, 0, Math.PI * 2);
  ctx.stroke();
  const g = ctx.createRadialGradient(24, 22, 0, 24, 22, 10);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 光柱面片纹理（god ray 补充层） */
export function shaftTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, 'rgba(190,230,235,0.5)');
  g.addColorStop(0.55, 'rgba(140,200,205,0.13)');
  g.addColorStop(1, 'rgba(120,180,190,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 512);
  const side = ctx.createLinearGradient(0, 0, 128, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 128, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 天空渐变（黎明：青黑 → 暖金地平线） */
export function skyTexture(): THREE.Texture {
  const [c, ctx] = canvas(16, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#0a1a26');
  g.addColorStop(0.42, '#16324a');
  g.addColorStop(0.66, '#3c5a66');
  g.addColorStop(0.82, '#b87a3a');
  g.addColorStop(0.93, '#e8b25c');
  g.addColorStop(1, '#f2cf8a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 太阳光斑 sprite */
export function sunSprite(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.18, 'rgba(255,226,160,0.9)');
  g.addColorStop(0.5, 'rgba(240,190,110,0.25)');
  g.addColorStop(1, 'rgba(230,170,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 胶片颗粒噪点（注入 #grain 背景） */
export function grainDataURL(): string {
  const [c, ctx] = canvas(180, 180);
  const img = ctx.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
