import * as THREE from 'three';

/** Canvas 程序化纹理合成 —— 原型期零外部资产（docs/ART_DIRECTION.md §4） */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** 值噪声（分形叠加），用于岩壁明暗 */
function fbmFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: number, spread: number): void {
  const img = ctx.createImageData(w, h);
  const rand = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rand(xi, yi), b = rand(xi + 1, yi), c2 = rand(xi, yi + 1), d = rand(xi + 1, yi + 1);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0, amp = 0.55, freq = 5 / w;
      for (let o = 0; o < 5; o++) {
        n += noise(x * freq, y * freq) * amp;
        amp *= 0.5;
        freq *= 2.1;
      }
      const val = Math.max(0, Math.min(255, base + (n - 0.5) * spread));
      const i = (y * w + x) * 4;
      img.data[i] = val * 0.72;
      img.data[i + 1] = val * 0.86;
      img.data[i + 2] = val * 0.82;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** 岩壁纹理：暗青灰基底 + 裂隙 + 沉积条带 */
export function rockTexture(size = 512): THREE.Texture {
  const [c, ctx] = canvas(size, size);
  fbmFill(ctx, size, size, 96, 150);
  // 沉积条带（石灰岩层理）
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 22; i++) {
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? '#0c1a1c' : '#3d4a46';
    ctx.fillRect(0, y, size, 1.5 + Math.random() * 5);
  }
  // 裂隙
  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = '#050b0c';
  for (let i = 0; i < 30; i++) {
    ctx.lineWidth = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 7; s++) {
      x += (Math.random() - 0.5) * 90;
      y += Math.random() * 55;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 软圆粒子 sprite（marine snow） */
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

/** 光柱面片纹理（入水段 god ray） */
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

/** 红厅锯齿地纹（Twin Peaks 致意） */
export function zigzagTexture(): THREE.Texture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#cfc8b8';
  const w = 64, h = 64;
  for (let row = 0; row < 256 / h; row++) {
    ctx.beginPath();
    const y0 = row * h;
    ctx.moveTo(0, y0 + h * 0.5);
    for (let x = 0; x <= 256; x += w) {
      ctx.lineTo(x + w / 2, y0);
      ctx.lineTo(x + w, y0 + h * 0.5);
    }
    ctx.lineTo(256, y0 + h);
    for (let x = 256; x >= 0; x -= w) {
      ctx.lineTo(x - w / 2, y0 + h * 0.5 + h * 0.5);
      ctx.lineTo(x - w, y0 + h);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
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
