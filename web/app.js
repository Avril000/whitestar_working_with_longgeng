/* 碑帖集字生成器 · 前端
   三种字的状态：
     1. 原帖字   —— 拓本单字图（黑底白字拓片已在构建期翻墨为透明底墨字）
     2. 借来的字 —— 不是原帖的字（临本 / 他碑 / 拼合），朱砂虚线框 + 角标，悬停可看来源
     3. 缺字     —— 库里没有，如实留空，绝不用系统字体渲染一个假字冒充

   布局：
     条幅 —— 单列竖排
     对联 —— 输入时用空格分隔上下联，如「上善若水 道法自然」，右列为上联

   数据安全：本页所有数据来自 data.js（由 tools/build_manifest.py 生成），
   字形图以 base64 按字嵌入，因此：
     - 双击本文件即可运行，不需要起服务器，不需要联网
     - 导出 PNG 不受 file:// 画布跨域限制 */

var state = { book: 'dbt', layout: '条幅' };
var HKEY = 'glyph_history_v1';
var MAX_HISTORY = 50;

function el(id) {
  return document.getElementById(id);
}

/* ---------- 字形查找 ---------- */

// 简体 → 碑上的繁体/异体（画→畫、载→載…），没有映射就原样返回
function mapChar(ch) {
  var vs = (window.DATA.variants || {})[ch];
  return vs ? vs[0] : ch;
}

function findGlyph(ch) {
  var target = mapChar(ch);
  var list = window.DATA.glyphs;
  var best = null;
  for (var i = 0; i < list.length; i++) {
    var g = list[i];
    if (g.char === target && g.book === state.book) {
      // 同字多条记录时，已核对的优先
      if (g.verified === '已核对') return g;
      if (!best) best = g;
    }
  }
  return best;
}

function imgOf(ch) {
  return window.DATA.glyph_img[mapChar(ch)] || window.DATA.glyph_img[ch] || null;
}

/* ---------- 布局 ---------- */

// 把输入按空格拆列：对联时右列（cols[0]）为上联；条幅单列。
// 空格只作对联分隔符，不当作字渲染。
function buildColumns(text) {
  if (state.layout === '对联') {
    var parts = text.split(/\s+/).filter(function (s) { return s.length > 0; });
    if (parts.length >= 2) return parts;
  }
  return [text.replace(/\s+/g, '')];
}

/* ---------- 渲染 ---------- */

function makeGlyphBox(ch) {
  var rec = findGlyph(ch);
  var box = document.createElement('div');
  box.className = 'glyph';
  var shown = mapChar(ch);

  if (!rec || !imgOf(ch)) {
    // 缺字：留空 + 标记，绝不渲染假字
    box.classList.add('missing');
    box.textContent = '缺';
    var mini = document.createElement('span');
    mini.className = 'mini';
    mini.textContent = ch;
    box.appendChild(mini);
    box.dataset.info =
      '「' + ch + '」库里没有这个字的写法。\n' +
      '按红线约定：留空，绝不用系统字体造一个假字冒充原帖。\n' +
      '可以另借他碑补字，或换一句话。';
    return box;
  }

  var img = document.createElement('img');
  img.src = imgOf(ch);
  img.alt = shown;
  img.draggable = false;
  box.appendChild(img);

  if (shown !== ch) {
    var tag = document.createElement('span');
    tag.className = 'variant';
    tag.textContent = ch;
    box.appendChild(tag);
  }

  var info =
    '「' + shown + '」' + (shown !== ch ? '（输入：' + ch + '）\n' : '\n') +
    window.DATA.books[state.book].name + ' · ' + (rec.src_page || '出处待补') + '\n' +
    (rec.holder ? rec.holder + '\n' : '') +
    '核对状态：' + (rec.verified || '未核对') + (rec.by ? '　核对人：' + rec.by : '');

  if (rec.nature !== '原碑拓本') {
    // 借来的字：可见地区分
    box.classList.add('borrowed');
    var dot = document.createElement('span');
    dot.className = 'dot';
    box.appendChild(dot);
    info =
      '「' + shown + '」这个字，库里没有原帖的写法。\n' +
      '当前用的是：' + rec.nature + '（' + rec.edition + '）\n' +
      '来源：' + rec.holder + '\n' +
      '核对状态：' + rec.verified + (rec.by ? '　核对人：' + rec.by : '');
  }
  box.dataset.info = info;
  return box;
}

function render() {
  var raw = el('input').value;
  var text = raw.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
  var cols = buildColumns(text);
  var strip = el('strip');
  strip.innerHTML = '';
  strip.classList.toggle('duilian', cols.length > 1);

  var borrowed = 0;
  var missing = [];

  cols.forEach(function (part) {
    var col = document.createElement('div');
    col.className = 'col';
    for (var i = 0; i < part.length; i++) {
      var box = makeGlyphBox(part[i]);
      if (box.classList.contains('missing')) missing.push(part[i]);
      if (box.classList.contains('borrowed')) borrowed++;
      col.appendChild(box);
    }
    strip.appendChild(col);
  });

  var book = window.DATA.books[state.book] || {};
  el('intro').textContent =
    (book.name || state.book) + '　' + (book.author || '') + '　' + (book.year || '') + '　' +
    (book.age || '') + '　|　' + (book.desc || '') +
    (state.layout === '对联' ? '　|　对联：上下联用空格分隔' : '');

  el('srcInfo').textContent = '底本：' + (book.name || state.book);

  var s = el('stateInfo');
  if (missing.length > 0) {
    s.textContent = '缺 ' + missing.length + ' 字（' + missing.join('') + '）' +
      (borrowed ? '　借 ' + borrowed + ' 字' : '');
    s.className = 'state warn';
  } else if (borrowed > 0) {
    s.textContent = '借用 ' + borrowed + ' 字（已标注）';
    s.className = 'state ok';
  } else {
    s.textContent = '全部来自原帖';
    s.className = 'state ok';
  }
}

/* ---------- 悬停出处 ---------- */

function bindTooltip() {
  var tip = el('tip');
  var strip = el('strip');

  strip.addEventListener('mouseover', function (e) {
    var box = e.target.closest ? e.target.closest('.glyph') : null;
    if (box && box.dataset.info) {
      var r = box.getBoundingClientRect();
      tip.textContent = box.dataset.info;
      tip.style.left = Math.min(r.right + 12, window.innerWidth - 300) + 'px';
      tip.style.top = (window.scrollY + r.top) + 'px';
      tip.classList.add('show');
    }
  });

  strip.addEventListener('mouseout', function () {
    tip.classList.remove('show');
  });
}

/* ---------- 导出 PNG ---------- */

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    var im = new Image();
    im.onload = function () { resolve(im); };
    im.onerror = function () { reject(new Error('图片加载失败')); };
    im.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 朱砂印章：集字（两字竖排白文）
function drawSeal(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = '#A84438';
  roundRectPath(ctx, x, y, s, s, Math.round(s * 0.09));
  ctx.fill();
  ctx.fillStyle = '#FBF9F3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = Math.round(s * 0.4) + 'px "Songti SC", SimSun, serif';
  ctx.fillText('集', x + s / 2, y + s * 0.3);
  ctx.fillText('字', x + s / 2, y + s * 0.72);
  ctx.restore();
}

function exportPNG() {
  var text = el('input').value.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!text) return;
  var cols = buildColumns(text);

  var SIZE = 160;   // 每格边长
  var GAP = 18;     // 格间距
  var PAD = 64;     // 纸边距
  var FOOT = 78;    // 落款区

  var maxLen = 0;
  cols.forEach(function (c) { if (c.length > maxLen) maxLen = c.length; });

  var W = PAD * 2 + cols.length * SIZE + (cols.length - 1) * GAP * 2;
  var H = PAD * 2 + maxLen * SIZE + (maxLen - 1) * GAP + FOOT;

  // 先把这一句里用到的字图都加载好
  var used = [];
  cols.forEach(function (part) {
    for (var i = 0; i < part.length; i++) {
      if (used.indexOf(part[i]) < 0) used.push(part[i]);
    }
  });

  var loads = {};
  used.forEach(function (ch) {
    var src = imgOf(ch);
    loads[ch] = src ? loadImage(src) : Promise.resolve(null);
  });

  Promise.all(Object.keys(loads).map(function (ch) {
    return loads[ch].then(function (im) { return [ch, im]; });
  })).then(function (pairs) {
    var imgs = {};
    pairs.forEach(function (p) { imgs[p[0]] = p[1]; });

    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var ctx = c.getContext('2d');

    // 宣纸底
    ctx.fillStyle = '#FBF9F3';
    ctx.fillRect(0, 0, W, H);

    // 每列：对联右为上联（cols[0] 画在最右）
    var credits = [];
    cols.forEach(function (part, ci) {
      var x = W - PAD - SIZE - ci * (SIZE + GAP * 2);
      // 界格（朱砂细线）
      ctx.strokeStyle = 'rgba(158, 61, 50, 0.16)';
      ctx.lineWidth = 1;
      for (var i = 0; i <= part.length; i++) {
        var y = PAD + i * (SIZE + GAP) - GAP / 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        ctx.lineTo(x + SIZE + 8, y);
        ctx.stroke();
      }

      for (var j = 0; j < part.length; j++) {
        var ch = part[j];
        var cy = PAD + j * (SIZE + GAP);
        var rec = findGlyph(ch);
        var im = imgs[ch];

        if (!im) {
          // 缺字：虚线空格
          ctx.save();
          ctx.strokeStyle = '#C9C3B5';
          ctx.setLineDash([6, 5]);
          ctx.strokeRect(x + 6, cy + 6, SIZE - 12, SIZE - 12);
          ctx.setLineDash([]);
          ctx.fillStyle = '#B4AEA0';
          ctx.font = '20px "Songti SC", SimSun, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('缺', x + SIZE / 2, cy + SIZE / 2 - 8);
          ctx.font = '14px "Songti SC", SimSun, serif';
          ctx.fillText(ch, x + SIZE / 2, cy + SIZE / 2 + 16);
          ctx.restore();
          credits.push('「' + ch + '」库中没有，留空未补');
          continue;
        }

        ctx.drawImage(im, x, cy, SIZE, SIZE);

        if (rec && rec.nature !== '原碑拓本') {
          ctx.save();
          ctx.strokeStyle = '#9E3D32';
          ctx.setLineDash([7, 5]);
          ctx.strokeRect(x + 4, cy + 4, SIZE - 8, SIZE - 8);
          ctx.setLineDash([]);
          ctx.restore();
          credits.push('「' + ch + '」借自' + rec.nature + '，' + rec.holder);
        }
      }
    });

    // 落款区
    ctx.fillStyle = '#6B6659';
    ctx.font = '13px "Songti SC", SimSun, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var book = window.DATA.books[state.book] || {};
    var ly = H - FOOT + 34;
    var line1 = (book.name || '') + '　' + (book.author || '') + '　集字 ' + text.replace(/\s+/g, '') + ' 共 ' + text.replace(/\s+/g, '').length + ' 字';
    ctx.fillText(line1, PAD, ly);
    if (credits.length === 0) {
      ctx.fillStyle = '#8A8474';
      ctx.fillText('全部字形来自原帖', PAD, ly + 20);
    } else {
      for (var k = 0; k < credits.length && k < 2; k++) {
        ctx.fillText(credits[k], PAD, ly + 20 + k * 18);
      }
      if (credits.length > 2) ctx.fillText('…另有 ' + (credits.length - 2) + ' 条借用说明', PAD, ly + 20 + 36);
    }

    // 印章盖在右下
    drawSeal(ctx, W - PAD - 8, H - PAD - 2, 40);

    // 下载
    var a = document.createElement('a');
    a.download = '集字-' + text.replace(/\s+/g, '') + '.png';
    a.href = c.toDataURL('image/png');
    a.click();

    // 自动留档
    saveHistory({ text: text, book: state.book, layout: state.layout, ts: Date.now() });
  }).catch(function (err) {
    console.error(err);
    alert('导出失败：' + err.message);
  });
}

/* ---------- 历史集字（localStorage 留档） ---------- */

// localStorage 在个别环境（file:// + 隐私模式）可能不可用，一律安全访问
function getStore() {
  try {
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

function loadHistory() {
  var s = getStore();
  if (!s) return [];
  try {
    return JSON.parse(s.getItem(HKEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveHistory(item) {
  var s = getStore();
  if (!s) return;
  var h = loadHistory().filter(function (x) {
    return !(x.text === item.text && x.book === item.book && x.layout === item.layout);
  });
  h.unshift(item);
  if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
  try {
    s.setItem(HKEY, JSON.stringify(h));
  } catch (e) { /* 存不下就算了，不影响导出 */ }
}

function renderHistory() {
  var h = loadHistory();
  var list = el('historyList');
  list.innerHTML = '';

  if (!h.length) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有留档。输入一句话，点「导出 PNG」就会自动存一份历史。';
    list.appendChild(empty);
    return;
  }

  h.forEach(function (item, idx) {
    var row = document.createElement('div');
    row.className = 'hrow';

    var t = document.createElement('div');
    t.className = 'htext';
    t.textContent = item.text;

    var m = document.createElement('div');
    m.className = 'hmeta';
    var bname = (window.DATA.books[item.book] || {}).name || item.book;
    m.textContent = bname + ' · ' + (item.layout || '条幅') + ' · ' + new Date(item.ts).toLocaleString();

    var del = document.createElement('button');
    del.className = 'hdel';
    del.textContent = '删除';

    row.appendChild(t);
    row.appendChild(m);
    row.appendChild(del);

    row.addEventListener('click', function (e) {
      if (e.target === del) return;
      el('input').value = item.text;
      state.book = item.book || 'dbt';
      state.layout = item.layout || '条幅';
      el('btnBook').textContent = (window.DATA.books[state.book] || {}).name || state.book;
      el('btnLayout').textContent = state.layout;
      render();
      toggleHistory(false);
    });

    del.addEventListener('click', function () {
      var s = getStore();
      if (!s) return;
      var arr = loadHistory();
      arr.splice(idx, 1);
      s.setItem(HKEY, JSON.stringify(arr));
      renderHistory();
    });

    list.appendChild(row);
  });
}

function toggleHistory(open) {
  var panel = el('historyPanel');
  var willOpen = (typeof open === 'boolean') ? open : !panel.classList.contains('open');
  if (willOpen) renderHistory();
  panel.classList.toggle('open', willOpen);
}

/* ---------- 初始化 ---------- */

function init() {
  el('input').addEventListener('input', render);

  el('btnBook').addEventListener('click', function () {
    state.book = state.book === 'dbt' ? 'yql' : 'dbt';
    this.textContent = (window.DATA.books[state.book] || {}).name || state.book;
    render();
  });

  el('btnLayout').addEventListener('click', function () {
    state.layout = state.layout === '条幅' ? '对联' : '条幅';
    this.textContent = state.layout;
    render();
  });

  el('btnExport').addEventListener('click', exportPNG);

  el('btnHistory').addEventListener('click', function () { toggleHistory(); });

  el('historyClose').addEventListener('click', function () { toggleHistory(false); });

  el('historyMask').addEventListener('click', function () { toggleHistory(false); });

  bindTooltip();
  render();
}

init();
