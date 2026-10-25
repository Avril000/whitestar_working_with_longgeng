/* 导出 PNG 的几何演算（纯计算，不需要浏览器）。
   自检（verify_web.js）跑在 jsdom 里，jsdom 不做布局、也没有 canvas，
   **导出的坐标对不对我没法用眼睛看**，所以把公式抄一份在这里算数验证：
   版框的四条边必须和字格实际占的区间完全重合，而且整框都要落在纸内。

   ⚠️ 公式是从 app.js 的 exportPNG 抄来的——改了那边，这边要同步。
   用法：node tools/check_export_geometry.js */
const SIZE = 160, K = SIZE / 76;

function geo(name, { heng, cols, gap = 8, rowGap = 34, pad = 34 }) {
  const GAPT = Math.round(gap * K), ROWG = Math.round(rowGap * K);
  const PADX = Math.round(pad * 1.3 * K), PADY = Math.round(pad * K);
  const FOOT = 170;
  const maxLen = Math.max.apply(null, cols.map(c => c.length));
  const nX = heng ? maxLen : cols.length;
  const nY = heng ? cols.length : maxLen;
  const gapX = heng ? GAPT : ROWG;
  const gapY = heng ? ROWG : GAPT;
  const W = PADX * 2 + nX * SIZE + (nX - 1) * gapX;
  const H = PADY * 2 + nY * SIZE + (nY - 1) * gapY + FOOT;

  const cellAt = (ix, iy) => ({
    x: W - PADX - SIZE - ix * (SIZE + gapX),
    y: PADY + iy * (SIZE + gapY)
  });
  const cellXY = (ci, j) => heng ? cellAt(j, ci) : cellAt(ci, j);

  let L = 1e9, T = 1e9, R = -1e9, B = -1e9;
  cols.forEach((p, ci) => {
    for (let j = 0; j < p.length; j++) {
      const q = cellXY(ci, j);
      L = Math.min(L, q.x); T = Math.min(T, q.y);
      R = Math.max(R, q.x + SIZE); B = Math.max(B, q.y + SIZE);
    }
  });
  const bTop = cellAt(0, 0).y, bBot = cellAt(0, nY - 1).y + SIZE;
  const bL = cellAt(nX - 1, 0).x, bR = cellAt(0, 0).x + SIZE;

  const ok = (L === bL && T === bTop && R === bR && B === bBot);
  const inPaper = bL - 29 >= 0 && bTop - 29 >= 0 && bR + 29 <= W && bBot + 29 <= H - FOOT;
  console.log(
    (ok ? '  OK ' : '  ✗✗ ') + name +
    '  纸 ' + W + '×' + H +
    '  字区 [' + L + ',' + T + ' → ' + R + ',' + B + ']' +
    '  框 [' + bL + ',' + bTop + ' → ' + bR + ',' + bBot + ']' +
    (ok ? '' : '  ← 框与字区对不上') +
    (inPaper ? '' : '  ← 框超出纸面')
  );
  return ok && inPaper;
}

const s = '上善若水'.split('');
let all = true;
all = geo('竖排 · 条幅（1 段 4 字）', { heng: false, cols: ['上善若水'] }) && all;
all = geo('竖排 · 对联（2 段各 4 字）', { heng: false, cols: ['上善若水', '道法自然'] }) && all;
all = geo('横排 · 条幅（1 段 4 字）', { heng: true, cols: ['上善若水'] }) && all;
all = geo('横排 · 对联（2 段各 4 字）', { heng: true, cols: ['上善若水', '道法自然'] }) && all;
all = geo('竖排 · 8 字长条幅', { heng: false, cols: ['上善若水道法自然'] }) && all;
all = geo('横排 · 8 字长条幅', { heng: true, cols: ['上善若水道法自然'] }) && all;
all = geo('竖排 · 疏朗档（16/52/50）', { heng: false, cols: ['上善若水', '道法自然'], gap: 16, rowGap: 52, pad: 50 }) && all;
all = geo('横排 · 紧凑档（3/20/20）', { heng: true, cols: ['上善若水', '道法自然'], gap: 3, rowGap: 20, pad: 20 }) && all;

console.log('\n' + (all ? '全部通过：框与字区一致，且都在纸内' : '有问题，见上'));
