/* 碑帖集字生成器 · 前端
   三种字的状态：
     1. 原帖字   —— 拓本单字图（黑底白字拓片已在构建期翻墨为透明底墨字）
     2. 借来的字 —— 不是原帖的字（临本 / 他碑 / 拼合），朱砂虚线框 + 角标，悬停可看来源
     3. 缺字     —— 库里没有，如实留空，绝不用系统字体渲染一个假字冒充

   多版本选择（2026-10-21 加，同日晚按白星意见改交互）：
     同一个字在碑里往往出现很多次、写法各不相同（「之」有 22 版、「塔」15 版）。

     自动避复：同一句里某个字第 n 次出现，默认就用第 n 种写法——
     书法忌讳一幅里同字长得一模一样，这个由系统自动绕开。

     有多版本的字，格子右下角会挂一个角标，三种状态：
       黄点     —— 还没挑（用的是自动避复给的版本）
       黄点带晕 —— 挑过了但没拍板（点版本后按了「再想想」）
       绿点     —— 拍板了（按了「选好了」），记在本机，下次打开还是它

     点角标 → 下方展开该字全部写法 → 点一个，主区域立刻换（面板不关，能连着试）
       → 【选好了】确认并收起，角标变绿
       → 【再想想】收起但留着改动，角标还是黄——方便先整体看一遍再回来定

   布局：
     条幅 —— 单列竖排
     对联 —— 输入时用空格分隔上下联，如「上善若水 道法自然」，右列为上联

   数据安全：本页所有数据来自 data.js（由 tools/build_manifest.py 生成），
   字形图以 base64 按版本嵌入，因此：
     - 双击本文件即可运行，不需要起服务器，不需要联网
     - 导出 PNG 不受 file:// 画布跨域限制 */

var state = { book: 'dbt', layout: '条幅' };
var HKEY = 'glyph_history_v1';
var PKEY = 'glyph_pick_v1';    // 挑了哪个版本：{ "dbt:之#0": "05_G73" }
var OKKEY = 'glyph_pick_ok_v1'; // 哪些字已经拍板：{ "dbt:之#0": 1 }
var MAX_HISTORY = 50;

var REC = {};          // gid -> 字形记录（建一次，避免每次遍历上千条）
var picksCache = null; // 挑中的版本
var okCache = null;    // 已拍板的字
var curPick = null;    // 版本选择区当前正在挑的字：{ ch, idx }
var usage = {};        // gid -> [{ ch, idx, order }]，本句里每个版本被用在了哪几个位置

function el(id) {
  return document.getElementById(id);
}

/* ---------- 字形查找 ---------- */

// 简体 → 碑上的繁体/异体（画→畫、载→載…），没有映射就原样返回
function mapChar(ch) {
  var vs = (window.DATA.variants || {})[ch];
  return vs ? vs[0] : ch;
}

function buildRecIndex() {
  REC = {};
  (window.DATA.glyphs || []).forEach(function (g) {
    if (g.id) REC[g.id] = g;
  });
}

/* ---------- 多版本选择 ---------- */

function loadPicks() {
  if (picksCache) return picksCache;
  picksCache = {};
  var s = getStore();
  if (s) {
    try { picksCache = JSON.parse(s.getItem(PKEY)) || {}; } catch (e) { picksCache = {}; }
  }
  return picksCache;
}

function savePicks() {
  var s = getStore();
  if (!s) return;
  try { s.setItem(PKEY, JSON.stringify(picksCache)); } catch (e) { /* 存不下不影响使用 */ }
}

function loadOk() {
  if (okCache) return okCache;
  okCache = {};
  var s = getStore();
  if (s) {
    try { okCache = JSON.parse(s.getItem(OKKEY)) || {}; } catch (e) { okCache = {}; }
  }
  return okCache;
}

function saveOk() {
  var s = getStore();
  if (!s) return;
  try { s.setItem(OKKEY, JSON.stringify(okCache)); } catch (e) {}
}

// 记忆的键 = 碑 + 字 + 本句第几次出现
// 带序号是为了能逐字避复：同一句里第 1 个「之」和第 2 个「之」可以各选一版
function pickKey(ch, idx) {
  return state.book + ':' + mapChar(ch) + '#' + (idx || 0);
}

// 某个字在当前碑里的全部版本（已核对的排在前面）
// 只认当前碑：别的碑有这个字也不许拿来用，否则就变成拿多宝塔碑的字冒充颜勤礼碑了
function versionsOf(ch) {
  var ids = (window.DATA.by_char || {})[mapChar(ch)] || [];
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var g = REC[ids[i]];
    if (g && g.book === state.book) out.push(ids[i]);
  }
  return out;
}

// 综合出「本句第 idx 次出现的这个字」最终用哪个版本
//   rec      当前用的记录（缺字时为 null）
//   gid      当前用的版本 id
//   versions 全部版本
//   picked   是否手动挑过（没挑过就是自动避复给的）
//   ok       是否拍板了（决定角标是绿是黄）
function resolveGlyph(ch, idx) {
  var versions = versionsOf(ch);
  if (!versions.length) {
    return { rec: null, gid: null, versions: [], picked: false, ok: false };
  }
  var key = pickKey(ch, idx);
  var picked = loadPicks()[key];
  var gid;
  if (picked && versions.indexOf(picked) >= 0) {
    gid = picked;                       // 尊重手动挑的
  } else {
    // 自动避复：本句第 n 次出现就用第 n 种写法。
    // 只有一种写法时取模仍是它自己，不受影响。
    gid = versions[(idx || 0) % versions.length];
    picked = null;
  }
  return {
    rec: REC[gid] || null,
    gid: gid,
    versions: versions,
    picked: !!picked,
    ok: !!loadOk()[key]
  };
}

function imgOfGid(gid) {
  return gid ? (window.DATA.glyph_img[gid] || null) : null;
}

function setPick(ch, idx, gid) {
  var p = loadPicks();
  var key = pickKey(ch, idx);
  if (gid) p[key] = gid; else delete p[key];
  savePicks();
  // 换了版本就先摘掉"已拍板"——拍板是对当前这一版拍的
  var ok = loadOk();
  if (ok[key]) { delete ok[key]; saveOk(); }
}

// 【选好了】：把当前这一版定为拍板，角标变绿
function confirmPick(ch, idx) {
  var key = pickKey(ch, idx);
  loadOk()[key] = 1;
  saveOk();
}

// 【恢复默认】：丢掉手动选择，回到自动避复给的那一版
function clearPick(ch, idx) {
  var key = pickKey(ch, idx);
  delete loadPicks()[key];
  savePicks();
  delete loadOk()[key];
  saveOk();
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

function makeGlyphBox(ch, idx) {
  var r = resolveGlyph(ch, idx);
  var rec = r.rec;
  var box = document.createElement('div');
  box.className = 'glyph';
  var shown = mapChar(ch);

  if (!rec || !imgOfGid(r.gid)) {
    // 缺字：留空 + 标记，绝不渲染假字
    box.classList.add('missing');
    box.textContent = '缺';
    var mini = document.createElement('span');
    mini.className = 'mini';
    mini.textContent = ch;
    box.appendChild(mini);
    box.dataset.tip =
      '「' + ch + '」库里没有这个字的写法。\n' +
      '按红线约定：留空，绝不用系统字体造一个假字冒充原帖。\n' +
      '可以另借他碑补字，或换一句话。';
    return box;
  }

  box.dataset.gid = r.gid;   // render 拿它统计"这个写法本句用了几次"

  var img = document.createElement('img');
  img.src = imgOfGid(r.gid);
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

  // 多版本角标：黄=没挑（自动避复给的），黄带晕=挑了没拍板，绿=拍板了
  if (r.versions.length > 1) {
    var vdot = document.createElement('span');
    vdot.className = 'vdot' + (r.ok ? ' picked' : (r.picked ? ' tentative' : ''));
    vdot.textContent = r.versions.length;
    vdot.dataset.ch = ch;
    vdot.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleVersions(ch, idx);
    });
    box.appendChild(vdot);

    info += '\n—\n这个字在碑里有 ' + r.versions.length + ' 种写法，' +
      '当前是第 ' + (r.versions.indexOf(r.gid) + 1) + ' 种';
    if (r.ok) {
      info += '（已拍板，点角标可改）';
    } else if (r.picked) {
      info += '（你挑的，还没拍板，点角标可继续挑）';
    } else {
      info += '（本句第 ' + ((idx || 0) + 1) + ' 次出现，自动避复取的第 ' +
        (r.versions.indexOf(r.gid) + 1) + ' 种；点右下角黄点可自己指定）';
    }
  }

  box.dataset.tip = info;
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
  var multi = 0;
  var seen = {};   // 整句范围内数每个字出现到第几次（对联跨两列一起数）
  var order = 0;   // 整句第几个字（给人看的序号，从 1 开始）
  usage = {};      // 重算：本句里每个版本分别被用在了哪

  cols.forEach(function (part) {
    var col = document.createElement('div');
    col.className = 'col';
    for (var i = 0; i < part.length; i++) {
      var ch = part[i];
      var k = mapChar(ch);
      var idx = seen[k] || 0;
      seen[k] = idx + 1;
      order++;

      var box = makeGlyphBox(ch, idx);
      if (box.classList.contains('missing')) missing.push(ch);
      if (box.classList.contains('borrowed')) borrowed++;
      if (box.querySelector('.vdot')) multi++;

      if (box.dataset.gid) {
        (usage[box.dataset.gid] = usage[box.dataset.gid] || []).push({
          ch: ch, idx: idx, order: order
        });
      }
      col.appendChild(box);
    }
    strip.appendChild(col);
  });

  // 同字同形检查：usage 已经统计完，凡是本句出现两次以上的写法都标出来。
  // 自动避复一般不会撞，但手动挑的时候可能挑成一样——收起面板后也得看得见。
  var dupCount = 0;
  Array.prototype.forEach.call(strip.querySelectorAll('.glyph'), function (box) {
    var gid = box.dataset.gid;
    if (!gid || !usage[gid] || usage[gid].length < 2) return;
    dupCount++;
    box.classList.add('dup');
    if (box.dataset.tip) {
      box.dataset.tip += '\n—\n注意：本句第 ' +
        usage[gid].map(function (u) { return u.order; }).join('、') +
        ' 个字用了同一个写法——同字同形，书法上要避复。';
    }
  });

  var book = window.DATA.books[state.book] || {};
  el('intro').textContent =
    (book.name || state.book) + '　' + (book.author || '') + '　' + (book.year || '') + '　' +
    (book.age || '') + '　|　' + (book.desc || '') +
    (state.layout === '对联' ? '　|　对联：上下联用空格分隔' : '');

  el('srcInfo').textContent = '底本：' + (book.name || state.book);

  var s = el('stateInfo');
  var tail = (dupCount ? '　' + dupCount + ' 处同字同形' : '') +
    (multi ? '　' + multi + ' 字有多种写法（点黄点可换）' : '');
  if (missing.length > 0) {
    s.textContent = '缺 ' + missing.length + ' 字（' + missing.join('') + '）' +
      (borrowed ? '　借 ' + borrowed + ' 字' : '') + tail;
    s.className = 'state warn';
  } else if (dupCount > 0) {
    s.textContent = (borrowed ? '借用 ' + borrowed + ' 字（已标注）' : '全部来自原帖') + tail;
    s.className = 'state warn';
  } else if (borrowed > 0) {
    s.textContent = '借用 ' + borrowed + ' 字（已标注）' + tail;
    s.className = 'state ok';
  } else {
    s.textContent = '全部来自原帖' + tail;
    s.className = 'state ok';
  }
}

/* ---------- 版本选择区 ---------- */

function renderVersions(ch, idx) {
  var r = resolveGlyph(ch, idx);
  if (r.versions.length < 2) return;

  var shown = mapChar(ch);
  el('vTitle').textContent =
    '「' + shown + '」（本句第 ' + ((idx || 0) + 1) + ' 个）在碑里有 ' +
    r.versions.length + ' 种写法，当前用第 ' + (r.versions.indexOf(r.gid) + 1) + ' 种';

  var grid = el('vGrid');
  grid.innerHTML = '';

  r.versions.forEach(function (gid, i) {
    var g = REC[gid];
    var item = document.createElement('div');
    item.className = 'vitem' + (gid === r.gid ? ' on' : '');
    item.dataset.gid = gid;

    var im = document.createElement('img');
    im.src = imgOfGid(gid);
    im.alt = shown + ' 写法' + (i + 1);
    im.draggable = false;
    item.appendChild(im);

    var cap = document.createElement('span');
    cap.className = 'vcap';
    cap.textContent = '#' + (i + 1);
    item.appendChild(cap);

    var src = document.createElement('span');
    src.className = 'vsrc';
    src.textContent = g && g.src_page ? g.src_page.replace('碑文', '') : '出处待补';
    item.appendChild(src);

    // 避复提示：除了当前这个字，本句还有几处用了同一个写法
    var others = (usage[gid] || []).filter(function (u) {
      return !(u.idx === (idx || 0) && u.ch === ch);
    });
    var used = document.createElement('span');
    used.className = 'vused' + (others.length ? ' dup' : '');
    used.textContent = others.length ? '另有 ' + others.length + ' 处已用' : '未使用';
    if (others.length) {
      used.dataset.tip =
        '这个写法在本句第 ' + others.map(function (u) { return u.order; }).join('、') +
        ' 个字处已经用过了。\n再选它就会出现同字同形——书法上忌讳这个，叫「避复」。';
    }
    item.appendChild(used);

    item.addEventListener('click', function () {
      // 立刻换上去让人看见效果，但面板不关——可以连着试好几个
      setPick(ch, idx, gid);
      render();                 // 先重算主区域和 usage
      renderVersions(ch, idx);  // 再重画面板，这样"已用几处"才是最新的
    });

    grid.appendChild(item);
  });
}

function openVersions(ch, idx) {
  curPick = { ch: ch, idx: idx || 0 };
  renderVersions(ch, idx);
  el('versions').classList.add('open');
  el('versions').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeVersions() {
  curPick = null;
  el('versions').classList.remove('open');
}

function toggleVersions(ch, idx) {
  if (curPick && curPick.ch === ch && curPick.idx === (idx || 0) &&
      el('versions').classList.contains('open')) {
    closeVersions();
  } else {
    openVersions(ch, idx);
  }
}

// 【选好了】：把当前这一版定为拍板，收起，角标变绿
function confirmAndClose() {
  if (!curPick) return closeVersions();
  confirmPick(curPick.ch, curPick.idx);
  closeVersions();
  render();
}

// 【再想想】：改动已经存下了，这里只关面板；角标保持黄色，方便回头再定
function laterAndClose() {
  closeVersions();
  render();
}

/* ---------- 悬停说明 ----------
   凡是带 data-tip 的元素都有悬浮说明：字格用它显示出处，按钮用它解释自己是干嘛的。
   全站一套，所以给按钮加提示就是加一个属性的事。 */

function bindTooltip() {
  var tip = el('tip');

  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) return;
    var r = t.getBoundingClientRect();
    tip.textContent = t.dataset.tip;
    tip.style.left = Math.max(8, Math.min(r.right + 12, window.innerWidth - 300)) + 'px';
    tip.style.top = (window.scrollY + r.bottom + 8) + 'px';
    tip.classList.add('show');
  });

  document.addEventListener('mouseout', function (e) {
    if (e.target.closest && e.target.closest('[data-tip]')) tip.classList.remove('show');
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

  // 先按整句数一遍每个字出现到第几次（和屏幕上完全一致，含自动避复），
  // 再把用到的版本图都加载好（按 gid 去重，尊重多版本选择）
  var seen = {};
  var grid = cols.map(function (part) {
    return part.split('').map(function (ch) {
      var k = mapChar(ch);
      var idx = seen[k] || 0;
      seen[k] = idx + 1;
      return { ch: ch, idx: idx };
    });
  });

  var need = [];
  grid.forEach(function (cells) {
    cells.forEach(function (cell) {
      var gid = resolveGlyph(cell.ch, cell.idx).gid;
      if (gid && need.indexOf(gid) < 0) need.push(gid);
    });
  });

  Promise.all(need.map(function (gid) {
    var src = imgOfGid(gid);
    return (src ? loadImage(src) : Promise.resolve(null)).then(function (im) {
      return [gid, im];
    });
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
        var cell = grid[ci][j];
        var ch = cell.ch;
        var cy = PAD + j * (SIZE + GAP);
        var r = resolveGlyph(ch, cell.idx);
        var rec = r.rec;
        var im = r.gid ? imgs[r.gid] : null;

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
      closeVersions();
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
  buildRecIndex();

  el('input').addEventListener('input', function () {
    closeVersions();   // 改了内容，版本区里的字可能已经不在句里了
    render();
  });

  el('btnBook').addEventListener('click', function () {
    state.book = state.book === 'dbt' ? 'yql' : 'dbt';
    this.textContent = (window.DATA.books[state.book] || {}).name || state.book;
    closeVersions();   // 换碑后版本列表全变了
    render();
  });

  el('btnLayout').addEventListener('click', function () {
    state.layout = state.layout === '条幅' ? '对联' : '条幅';
    this.textContent = state.layout;
    closeVersions();
    render();
  });

  el('btnExport').addEventListener('click', exportPNG);

  el('btnHistory').addEventListener('click', function () { toggleHistory(); });

  el('historyClose').addEventListener('click', function () { toggleHistory(false); });

  el('historyMask').addEventListener('click', function () { toggleHistory(false); });

  el('vConfirm').addEventListener('click', confirmAndClose);

  el('vLater').addEventListener('click', laterAndClose);

  el('vDefault').addEventListener('click', function () {
    if (!curPick) return;
    clearPick(curPick.ch, curPick.idx);   // 丢掉手动选择，回到自动避复给的那一版
    renderVersions(curPick.ch, curPick.idx);
    render();
  });

  bindTooltip();
  render();
}

init();
