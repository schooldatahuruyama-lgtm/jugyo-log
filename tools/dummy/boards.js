// 端末の書体と canvas だけで描く、確認用の黒板。公開する関数は一つだけ。
(() => {
  'use strict';

  const fontFamily = "'UD デジタル 教科書体 NK-R', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif";
  const colors = { green: '#194a3b', white: '#f1f0df', yellow: '#f5dd83', pink: '#f2adbb', blue: '#a9dce9' };
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const textOf = (v) => (typeof v === 'string' ? v : '');

  function randomFor(title) {
    let seed = 2166136261;
    for (const char of title) seed = Math.imul(seed ^ char.codePointAt(0), 16777619) >>> 0;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function makeChalk(ctx, random) {
    function font(size) { ctx.font = `${size}px ${fontFamily}`; }
    function text(value, x, y, size = 28, color = colors.white) {
      if (!value) return;
      ctx.save();
      font(size);
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.fillText(value, x, y);
      const width = ctx.measureText(value).width;
      // 書いた字に細かい緑の点を重ね、少しだけかすれさせる。
      ctx.fillStyle = colors.green;
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < width * size / 90; i += 1) {
        const dot = 0.5 + random() * 1.1;
        ctx.fillRect(x + random() * width, y + random() * size, dot, dot);
      }
      ctx.restore();
    }
    function line(x1, y1, x2, y2, color = colors.white, dashed = false) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.setLineDash(dashed ? [8, 8] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
    function arrow(x1, y1, x2, y2, color = colors.white) {
      line(x1, y1, x2, y2, color);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      for (const offset of [-0.45, 0.45]) {
        line(x2, y2, x2 - 13 * Math.cos(angle + offset), y2 - 13 * Math.sin(angle + offset), color);
      }
    }
    function arc(x, y, radius, start, end, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius, start, end);
      ctx.stroke();
      ctx.restore();
    }
    function rect(x, y, width, height, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
    }
    function dot(x, y, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return { font, text, line, arrow, arc, rect, dot };
  }

  function clip(ctx, x, y, width, height) {
    ctx.beginPath();
    ctx.rect(x, y, Math.max(0, width), Math.max(0, height));
    ctx.clip();
  }

  function fitFont(ctx, chalk, lines, width, preferred) {
    let size = preferred;
    while (size > 22) {
      chalk.font(size);
      if (lines.every((line) => ctx.measureText(line).width <= width)) break;
      size -= 1;
    }
    chalk.font(size);
    return size;
  }

  function wrapLines(ctx, lines, width) {
    const result = [];
    for (const line of lines) {
      for (const paragraph of line.split(/\r?\n/)) {
        let part = '';
        for (const char of paragraph) {
          if (part && ctx.measureText(part + char).width > width) {
            result.push(part);
            part = '';
          }
          part += char;
        }
        result.push(part);
      }
    }
    return result;
  }

  function textBox(ctx, chalk, lines, x, y, width, height, preferred = 32, color = colors.white) {
    if (width <= 0 || height <= 0) return;
    ctx.save();
    clip(ctx, x, y, width, height);
    const size = fitFont(ctx, chalk, lines, width, preferred);
    const wrapped = wrapLines(ctx, lines, width);
    const step = size * 1.5;
    for (let i = 0; i < wrapped.length && i * step < height; i += 1) {
      chalk.text(wrapped[i], x, y + i * step, size, color);
    }
    ctx.restore();
  }

  // 図は 440 × 220 の中に描く。矢印は実際の光や力の向きを示す。
  const figures = {
    reflection(ctx, chalk) {
      chalk.line(24, 170, 416, 170, colors.blue);
      for (let x = 30; x < 410; x += 18) chalk.line(x, 172, x - 8, 184, colors.blue);
      chalk.line(220, 20, 220, 205, colors.white, true);
      chalk.arrow(65, 40, 220, 170, colors.yellow);
      chalk.arrow(220, 170, 375, 40, colors.pink);
      const angle = Math.atan2(-130, 155);
      chalk.arc(220, 170, 46, -Math.PI - angle, -Math.PI / 2, colors.yellow);
      chalk.arc(220, 170, 66, -Math.PI / 2, angle, colors.pink);
      chalk.text('入射光', 24, 10, 22, colors.yellow);
      chalk.text('反射光', 338, 10, 22, colors.pink);
      chalk.text('法線', 230, 28, 22);
      chalk.text('入射角', 108, 110, 22, colors.yellow);
      chalk.text('反射角', 258, 110, 22, colors.pink);
      chalk.text('鏡', 380, 190, 22, colors.blue);
    },
    refraction(ctx, chalk) {
      ctx.fillStyle = 'rgba(169, 220, 233, 0.09)';
      ctx.fillRect(12, 104, 416, 110);
      chalk.line(12, 104, 428, 104, colors.blue);
      chalk.line(220, 8, 220, 213, colors.white, true);
      chalk.arrow(80, 12, 220, 104, colors.yellow);
      chalk.arrow(220, 104, 270, 206, colors.pink);
      chalk.arc(220, 104, 42, Math.atan2(-92, -140), -Math.PI / 2, colors.yellow);
      chalk.arc(220, 104, 60, Math.atan2(102, 50), Math.PI / 2, colors.pink);
      chalk.text('空気', 342, 30, 22);
      chalk.text('水', 350, 135, 22, colors.blue);
      chalk.text('入射角', 116, 60, 22, colors.yellow);
      chalk.text('屈折角', 278, 171, 22, colors.pink);
      chalk.text('法線', 230, 10, 22);
    },
    lens(ctx, chalk) {
      chalk.line(12, 108, 428, 108, colors.white, true);
      ctx.save();
      ctx.strokeStyle = colors.blue;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(220, 108, 18, 86, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      for (const y of [52, 164]) {
        chalk.arrow(24, y, 214, y, colors.yellow);
        chalk.arrow(220, y, 380, 108 + (108 - y) / 3, colors.pink);
      }
      chalk.dot(100, 108, colors.pink);
      chalk.dot(340, 108, colors.pink);
      chalk.text('焦点', 72, 120, 22, colors.pink);
      chalk.text('焦点', 312, 120, 22, colors.pink);
      chalk.text('凸レンズ', 176, 0, 22, colors.blue);
      chalk.text('平行な光', 24, 76, 22, colors.yellow);
      chalk.line(220, 204, 340, 204, colors.white);
      chalk.line(220, 199, 220, 209);
      chalk.line(340, 199, 340, 209);
      chalk.text('焦点距離', 240, 175, 22);
    },
    wave(ctx, chalk) {
      chalk.text('振動のようす（同じ時間）', 44, 0, 22);
      for (const [center, cycles, color] of [[70, 2, colors.blue], [153, 4, colors.pink]]) {
        chalk.arrow(48, center, 422, center, colors.white);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let x = 52; x <= 396; x += 2) {
          const y = center - 26 * Math.sin((x - 52) / 344 * Math.PI * 2 * cycles);
          if (x === 52) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      chalk.arrow(95, 70, 95, 44, colors.yellow);
      chalk.text('振幅', 102, 37, 22, colors.yellow);
      chalk.text('振動数が多いほど高い音', 44, 194, 22, colors.pink);
      chalk.text('時間', 386, 94, 22);
      chalk.text('時間', 386, 174, 22);
    },
    'force-arrow'(ctx, chalk) {
      chalk.rect(40, 56, 156, 136, colors.blue);
      chalk.text('物体', 83, 79, 24, colors.blue);
      chalk.arrow(196, 132, 403, 132, colors.pink);
      chalk.dot(196, 132, colors.yellow);
      chalk.line(166, 180, 192, 140, colors.yellow);
      chalk.text('作用点', 117, 192, 22, colors.yellow);
      chalk.text('引く力', 270, 95, 24, colors.pink);
      chalk.text('長さ＝力の大きさ', 224, 159, 22);
      chalk.text('向き', 370, 55, 22, colors.pink);
      chalk.arrow(355, 81, 407, 81, colors.pink);
    },
    balance(ctx, chalk) {
      chalk.rect(166, 58, 108, 120, colors.blue);
      chalk.text('物体', 196, 76, 24, colors.blue);
      chalk.line(16, 132, 424, 132, colors.white, true);
      chalk.arrow(166, 132, 30, 132, colors.yellow);
      chalk.arrow(274, 132, 410, 132, colors.pink);
      chalk.dot(166, 132, colors.yellow);
      chalk.dot(274, 132, colors.pink);
      chalk.text('左へ引く力', 22, 35, 22, colors.yellow);
      chalk.text('右へ引く力', 286, 35, 22, colors.pink);
      chalk.text('同じ長さ・反対向き・一直線', 66, 194, 22);
    },
  };

  function background(ctx, random) {
    ctx.fillStyle = '#825432';
    ctx.fillRect(0, 0, 1600, 900);
    for (let i = 0; i < 80; i += 1) {
      ctx.fillStyle = i % 2 ? 'rgba(232, 182, 116, 0.15)' : 'rgba(58, 32, 16, 0.2)';
      ctx.fillRect(0, random() * 900, 1600, 1 + random() * 3);
    }
    ctx.fillStyle = '#102d24';
    ctx.fillRect(19, 17, 1562, 840);
    const gradient = ctx.createLinearGradient(0, 22, 1600, 850);
    gradient.addColorStop(0, '#204f40');
    gradient.addColorStop(0.5, colors.green);
    gradient.addColorStop(1, '#123e32');
    ctx.fillStyle = gradient;
    ctx.fillRect(25, 23, 1550, 828);
    ctx.save();
    clip(ctx, 25, 23, 1550, 828);
    for (let i = 0; i < 150; i += 1) {
      ctx.fillStyle = i % 2 ? 'rgba(218, 230, 203, 0.014)' : 'rgba(0, 18, 11, 0.018)';
      ctx.fillRect(random() * 1600, random() * 850, 80 + random() * 240, 5 + random() * 48);
    }
    for (let i = 0; i < 5000; i += 1) {
      ctx.fillStyle = 'rgba(229, 232, 207, 0.055)';
      ctx.fillRect(random() * 1600, random() * 850, 0.6 + random(), 0.6 + random());
    }
    ctx.restore();
    ctx.fillStyle = '#573a28';
    ctx.fillRect(12, 858, 1576, 29);
    ctx.fillStyle = '#bd9468';
    ctx.fillRect(12, 858, 1576, 7);
    [colors.white, colors.yellow, colors.pink, colors.blue].forEach((color, index) => {
      ctx.fillStyle = color;
      ctx.fillRect(1230 + index * 55, 852, 38, 7);
    });
  }

  function panel(ctx, chalk, label, value, y, color) {
    chalk.rect(56, y, 1488, 112, color);
    chalk.text(label, 78, y + 19, 28, color);
    textBox(ctx, chalk, [textOf(value)], 216, y + 18, 1304, 80, 32);
  }

  function drawBlock(ctx, chalk, block, index, count) {
    const column = 1488 / count;
    const gap = Math.min(24, column / 8);
    const x = 56 + index * column;
    const left = x + gap / 2 + 12;
    const width = Math.max(1, column - gap - 24);
    const value = isObj(block) ? block : {};
    const figure = typeof value.figure === 'string' && Object.hasOwn(figures, value.figure) ? figures[value.figure] : null;
    const lines = Array.isArray(value.lines) ? value.lines.filter((line) => typeof line === 'string') : [];
    ctx.save();
    if (index > 0) chalk.line(x, 278, x, 689, colors.blue, true);
    clip(ctx, x + gap / 2, 270, column - gap, 426);
    textBox(ctx, chalk, [textOf(value.heading)], left, 284, width, 54, 32, colors.yellow);
    textBox(ctx, chalk, lines, left, 348, width, figure ? 128 : 342, figure ? 30 : 32);
    if (figure) {
      const scale = Math.min(width / 440, 1);
      ctx.save();
      ctx.translate(left + (width - 440 * scale) / 2, 478 + (220 - 220 * scale) / 2);
      ctx.scale(scale, scale);
      clip(ctx, 0, 0, 440, 220);
      figure(ctx, chalk);
      ctx.restore();
    }
    ctx.restore();
  }

  // 1 回分の板書を描いて、JPEG の Blob を返す。座標は 1600 × 900 を基準に拡縮する。
  globalThis.drawDummyBoard = async function drawDummyBoard(board, { width = 1600, height = 900, quality = 0.85 } = {}) {
    if (!isObj(board)) throw new TypeError('board はオブジェクトにしてください。');
    for (const [name, value] of [['width', width], ['height', height]]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TypeError(`${name} は正の有限な数にしてください。`);
    }
    if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) {
      throw new TypeError('quality は 0 以上 1 以下の数にしてください。');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas の描画機能を使えません。');
    ctx.scale(canvas.width / 1600, canvas.height / 900);
    const title = textOf(board.title);
    const random = randomFor(title);
    const chalk = makeChalk(ctx, random);
    background(ctx, random);
    textBox(ctx, chalk, [title], 64, 42, 1472, 68, 48);
    chalk.line(64, 111, 1536, 111, colors.blue);
    panel(ctx, chalk, 'めあて', board.aim, 132, colors.yellow);
    const blocks = Array.isArray(board.blocks) ? board.blocks : [];
    blocks.forEach((block, index) => drawBlock(ctx, chalk, block, index, blocks.length));
    panel(ctx, chalk, 'まとめ', board.summary, 722, colors.pink);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob?.type === 'image/jpeg') resolve(blob);
        else reject(new Error('板書を JPEG に変換できませんでした。'));
      }, 'image/jpeg', quality);
    });
  };
})();
