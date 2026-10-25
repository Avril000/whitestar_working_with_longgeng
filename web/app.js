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

/* state = 已经应用、主区域正在显示的那一套设置。
   draft  = 面板里正在调的那一套。改设置先落在 draft 上，主区域不动，
           左侧预览窗格实时显示 draft 的效果；点【应用改动】才落到 state。
           这样主区域天然就是"改动前"，预览窗格是"改动后"，两边一比就清楚。 */
var state = {
  book: 'dbt', layout: '条幅', ink: 'ink', credit: true, seal: true,
  // 成册界行（册页上分割字列的细线，也叫乌丝栏）。和条幅/对联是正交的——
  // 它是叠在排版之上的一层，不是第三种排版模式。
  ruled: false, ruleDir: '竖', ruleColor: 'red', ruleWidth: '细',
  frame: '文武'   // 外框：关 / 单边（细） / 文武（一粗一细，刻本册页最常见的版框）
};
var draft = null;

var SEAL_KEY = 'glyph_seal_v1';   // 用户自己上传的印章（dataURL），存本机，不联网
var sealImage = null;             // null = 用程序画的那枚「集字」朱砂印

/* 三种字色：墨色 / 朱砂 / 原图（拓片观感）。
   墨色和朱砂共用同一张字形图，只是把图当遮罩、换个填充色；
   原图是整幅反色。所以三种样式的存储开销都是 0，不必各存一份图。
   具体怎么上色见 style.css 的 .ink-red / .ink-rub 和 app.js 的 applyInkToPage。 */

/* 调整面板的目录。ready=false 的几项是我们排好队、还没开工的功能——
   目录里照样列出来（灰着），点开能看到说明，免得白星以为忘了。
   做一项就把它的 ready 改成 true，目录自动变亮。 */
var SECTIONS = [
  { key: 'style', name: '样式', ready: true },
  { key: 'album', name: '成册', ready: true, todo: '成册界行：给整幅加线框——颜色、方向（横竖）、粗细，以及框离首尾字留多远。做成开关，条幅和对联都能叠。' },
  { key: 'space', name: '间距', ready: false, todo: '行间距、字间距、页边距。每项给三档预设（紧 / 中 / 疏），再留一个微调滑杆。' },
  { key: 'mask', name: '遮罩', ready: false, todo: '单字遮罩：田字格 / 米字格 / 九宫格，勾上就在每个字格上叠一层辅助线，方便对着临。' },
  { key: 'brush', name: '朱笔', ready: false, todo: '朱笔单字：可以按字挑出某几个字染成朱砂，用来标重点。' }
];
var curSection = 'style';

var HKEY = 'glyph_history_v1';
/* ⚠️ 2026-10-25 改：版本选择只在**当前这句话**里记得，不再写 localStorage。
   以前的键是「碑:字#第几次出现」，跟整句内容无关——
   于是换了句子，上次挑的写法还跟着过来。白星举的例子：
   【道可道非常道】给第 1 个「道」挑了写法 6，重生成【道法不同】时
   第 1 个「道」还是写法 6，可这已经是另一句话了，没有道理沿用。
   同一句话之内（改样式、开面板、挑写法）照旧记得；换了句子就回到自动避复。
   这两个键只留着用来清理旧数据，不再读写。 */
var PKEY = 'glyph_pick_v1';
var OKKEY = 'glyph_pick_ok_v1';
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

// 只在内存里记：关掉网页就回到自动避复，换句子也回到自动避复（见上面的说明）
function loadPicks() {
  if (!picksCache) picksCache = {};
  return picksCache;
}

function savePicks() { /* 不再落盘 */ }

function loadOk() {
  if (!okCache) okCache = {};
  return okCache;
}

function saveOk() { /* 不再落盘 */ }

// 换了一句话：之前为上一句挑的写法全部作废，回到自动避复
function resetPicks() {
  picksCache = {};
  okCache = {};
  curPick = null;
}

// 记忆的键 = 碑 + 字 + 本句第几次出现
// 带序号是为了能逐字避复：同一句里第 1 个「之」和第 2 个「之」可以各选一版
function pickKey(ch, idx, book) {
  return (book || state.book) + ':' + mapChar(ch) + '#' + (idx || 0);
}

// 某个字在指定碑里的全部版本（已核对的排在前面）
// 只认这一块碑：别的碑有这个字也不许拿来用，否则就变成拿多宝塔碑的字冒充颜勤礼碑了
function versionsOf(ch, book) {
  var ids = (window.DATA.by_char || {})[mapChar(ch)] || [];
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var g = REC[ids[i]];
    if (g && g.book === (book || state.book)) out.push(ids[i]);
  }
  return out;
}

// 综合出「本句第 idx 次出现的这个字」最终用哪个版本
//   rec      当前用的记录（缺字时为 null）
//   gid      当前用的版本 id
//   versions 全部版本
//   picked   是否手动挑过（没挑过就是自动避复给的）
//   ok       是否拍板了（决定角标是绿是黄）
function resolveGlyph(ch, idx, book) {
  var versions = versionsOf(ch, book);
  if (!versions.length) {
    return { rec: null, gid: null, versions: [], picked: false, ok: false };
  }
  var key = pickKey(ch, idx, book);
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
function buildColumns(text, layout) {
  if (layout === '对联') {
    var parts = text.split(/\s+/).filter(function (s) { return s.length > 0; });
    if (parts.length >= 2) return parts;
  }
  return [text.replace(/\s+/g, '')];
}

/* ---------- 渲染 ---------- */

/* 造一个字格。cfg 决定用哪套设置（主区域用 state，预览用 draft），
   opts.interactive=false 时是预览：不挂多版本角标，因为预览只看排版效果，
   点角标选字仍然要在主区域做。 */
function makeGlyphBox(ch, idx, cfg, opts) {
  cfg = cfg || state;
  opts = opts || {};
  var r = resolveGlyph(ch, idx, cfg.book);
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

  var src = imgOfGid(r.gid);
  var img = document.createElement('img');
  img.src = src;
  img.alt = shown;
  img.draggable = false;
  box.appendChild(img);
  // 把字形图交给 CSS 当遮罩用（颜色由 --ink 给，见 style.css 的 .glyph::before）
  if (src) box.style.setProperty('--gimg', 'url("' + src + '")');

  if (shown !== ch) {
    var tag = document.createElement('span');
    tag.className = 'variant';
    tag.textContent = ch;
    box.appendChild(tag);
  }

  var info =
    '「' + shown + '」' + (shown !== ch ? '（输入：' + ch + '）\n' : '\n') +
    (window.DATA.books[cfg.book] || {}).name + ' · ' + (rec.src_page || '出处待补') + '\n' +
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
  if (r.versions.length > 1 && opts.interactive) {
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

/* 每个字列相对这张纸的盒子。版框和竖界都靠它定位——
   不拿 strip 自己的盒子：strip 是块级 flex，宽度会撑满整张纸，
   那样框就贴到纸边上了，等于又回到"框住整张纸"。 */
function colBoxes(paper, strip) {
  var out = [];
  Array.prototype.forEach.call(strip.querySelectorAll('.col'), function (col) {
    var x = 0, y = 0, n = col, guard = 0;
    while (n && n !== paper && guard++ < 20) {
      x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent;
    }
    out.push({ x: x, y: y, w: col.offsetWidth, h: col.offsetHeight });
  });
  return out;
}

/* 装饰层：版框 + 竖界，都是"按字列位置算出来的线"，所以放一起画。
   ⚠️ 可以重复调用——每次先把上一轮画的擦掉，所以调用方可以在
   布局稳定之后再补画一次（见 renderFooter 里的说明）。 */
function drawDecor(paper, strip, cfg) {
  Array.prototype.forEach.call(
    paper.querySelectorAll('.pframe, .rule-v'), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  var boxes = colBoxes(paper, strip);
  if (!boxes.length) return;   // 一个字都没有：不画

  // 竖界：每列左右各一条。以前是画在 .col 的 border 上，
  // 那样原碑模式整纸反色时会把它一起反成蓝色——改成独立元素才能单独抵消。
  if (cfg.ruled && cfg.ruleDir === '竖') {
    var lw = cfg.ruleWidth === '细' ? 1 : (cfg.ruleWidth === '粗' ? 3 : 2);
    boxes.forEach(function (b) {
      [b.x, b.x + b.w - lw].forEach(function (lx) {
        var v = document.createElement('i');
        v.className = 'rule-v';
        v.style.left = lx + 'px';
        v.style.top = b.y + 'px';
        v.style.width = lw + 'px';
        v.style.height = b.h + 'px';
        paper.appendChild(v);
      });
    });
  }

  // 版框：只框字区，落款和印章在框外下方（册页文武边栏的规矩）。
  // ⚠️ 别改回"框住整张纸"——那样落款排下来会掉到框线外面，看着像被框挤住了。
  if (cfg.frame === '关') return;
  var L = null, T = null, R = null, B = null;
  boxes.forEach(function (b) {
    L = (L === null) ? b.x : Math.min(L, b.x);
    T = (T === null) ? b.y : Math.min(T, b.y);
    R = (R === null) ? (b.x + b.w) : Math.max(R, b.x + b.w);
    B = (B === null) ? (b.y + b.h) : Math.max(B, b.y + b.h);
  });

  function mk(out, cls) {
    var f = document.createElement('div');
    f.className = 'pframe ' + cls;
    f.style.left = (L - out) + 'px';
    f.style.top = (T - out) + 'px';
    f.style.width = (R - L + out * 2) + 'px';
    f.style.height = (B - T + out * 2) + 'px';
    paper.appendChild(f);
  }
  if (cfg.frame === '文武') mk(14, 'thick');   // 粗线在外
  mk(8, 'thin');                               // 细线在内：单边只画它
}

/* 落款设完之后必须补画一次装饰层。
   原因：落款是纸的内容，字一多纸就变宽，居中的字列会跟着挪位置；
   而 renderInto 里画框发生在落款更新**之前**，量到的是旧位置
   ——表现就是刚打开网页时框偏左、右框线压在字脚上，
   点一下"应用改动"（此时落款已是最终值）框就正了（白星 2026-10-25 报的）。 */
function redrawDecor(strip, cfg) {
  var paper = strip.closest ? (strip.closest('.paper') || strip) : strip;
  drawDecor(paper, strip, cfg);
}

/* 把一句话渲染到指定的 strip 里。主区域和左侧预览窗格共用这一份代码——
   只有"用哪套设置"不同，所以看到的和导出的必然一致。
   返回统计结果，交给调用方去写各自的状态行。 */
function renderInto(strip, cfg, opts) {
  var raw = el('input').value;
  var text = raw.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
  var cols = buildColumns(text, cfg.layout);
  strip.innerHTML = '';
  strip.classList.toggle('duilian', cols.length > 1);

  // 成册界行 + 外框：开关 / 方向 / 颜色 / 粗细，全用 class 和两个 CSS 变量表达。
  // 变量挂在**纸**上（strip 和框的伪元素都能继承到），主区域和预览各渲染各的，
  // 所以不会互相污染（和字色、和 ink 同一个道理）。
  var paper = strip.closest ? (strip.closest('.paper') || strip) : strip;
  strip.classList.toggle('ruled', !!cfg.ruled);
  strip.classList.toggle('ruled-h', cfg.ruleDir === '横');
  paper.classList.toggle('framed', cfg.frame !== '关');
  paper.classList.toggle('framed-double', cfg.frame === '文武');
  // 颜色和导出 PNG 里用的是同一组值（含透明度），屏幕上看到的才和拿到的完全一致
  paper.style.setProperty('--rule', cfg.ruleColor === 'ink' ?
    'rgba(58, 54, 48, 0.55)' : 'rgba(158, 61, 50, 0.55)');
  paper.style.setProperty('--rule-w',
    cfg.ruleWidth === '细' ? '1px' : (cfg.ruleWidth === '粗' ? '3px' : '2px'));

  var borrowed = 0;
  var missing = [];
  var multi = 0;
  var seen = {};   // 整句范围内数每个字出现到第几次（对联跨两列一起数）
  var order = 0;   // 整句第几个字（给人看的序号，从 1 开始）
  var use = {};    // 本句里每个版本分别被用在了哪

  cols.forEach(function (part) {
    var col = document.createElement('div');
    col.className = 'col';
    for (var i = 0; i < part.length; i++) {
      var ch = part[i];
      var k = mapChar(ch);
      var idx = seen[k] || 0;
      seen[k] = idx + 1;
      order++;

      var box = makeGlyphBox(ch, idx, cfg, opts);
      if (box.classList.contains('missing')) missing.push(ch);
      if (box.classList.contains('borrowed')) borrowed++;
      if (box.querySelector('.vdot')) multi++;

      if (box.dataset.gid) {
        (use[box.dataset.gid] = use[box.dataset.gid] || []).push({
          ch: ch, idx: idx, order: order
        });
      }
      col.appendChild(box);
    }
    strip.appendChild(col);
  });

  // 横界：一整条线**贯穿**所有列（珍宝馆的界行就是贯穿的，不是一段一段的）。
  // 线撑满 strip 的宽度，位置按行号算，所以对联几列都照样贯穿。
  if (cfg.ruled && cfg.ruleDir === '横') {
    var maxRows = 0;
    cols.forEach(function (p) { if (p.length > maxRows) maxRows = p.length; });
    for (var r = 0; r < maxRows; r++) {
      var ln = document.createElement('i');
      ln.className = 'rule-h';
      ln.style.setProperty('--i', r);
      strip.appendChild(ln);
    }
  }

  // 同字同形检查：凡是本句出现两次以上的写法都标出来。
  // 自动避复一般不会撞，但手动挑的时候可能挑成一样——收起面板后也得看得见。
  var dupCount = 0;
  Array.prototype.forEach.call(strip.querySelectorAll('.glyph'), function (box) {
    var gid = box.dataset.gid;
    if (!gid || !use[gid] || use[gid].length < 2) return;
    dupCount++;
    box.classList.add('dup');
    if (box.dataset.tip) {
      box.dataset.tip += '\n—\n注意：本句第 ' +
        use[gid].map(function (u) { return u.order; }).join('、') +
        ' 个字用了同一个写法——同字同形，书法上要避复。';
    }
  });

  // ⚠️ 装饰层必须等字格全插完、浏览器排好版之后再画。
  // 以前这行放在函数开头（刚 innerHTML='' 清空完），量到的宽高是 0，
  // 框就缩成一团贴在纸顶上（白星 2026-10-25 报的）。
  // 这里画的是"当前"位置；落款更新后纸宽会变，所以外面还要再补画一次。
  drawDecor(paper, strip, cfg);

  return {
    text: text, borrowed: borrowed, missing: missing,
    multi: multi, dup: dupCount, usage: use
  };
}

// 状态栏那句话：缺字 / 借用 / 同字同形，主区域和预览共用一套说法
function stateLine(r) {
  var tail = (r.dup ? '　' + r.dup + ' 处同字同形' : '') +
    (r.multi ? '　' + r.multi + ' 字有多种写法（点黄点可换）' : '');
  if (r.missing.length > 0) {
    return {
      text: '缺 ' + r.missing.length + ' 字（' + r.missing.join('') + '）' +
        (r.borrowed ? '　借 ' + r.borrowed + ' 字' : '') + tail,
      cls: 'state warn'
    };
  }
  if (r.dup > 0) {
    return {
      text: (r.borrowed ? '借用 ' + r.borrowed + ' 字（已标注）' : '全部来自原帖') + tail,
      cls: 'state warn'
    };
  }
  if (r.borrowed > 0) {
    return { text: '借用 ' + r.borrowed + ' 字（已标注）' + tail, cls: 'state ok' };
  }
  return { text: '全部来自原帖' + tail, cls: 'state ok' };
}

/* 落款分成两行：**集字内容单独占一行**。
   以前"碑名 作者 集字 XXX 共 N 字"挤在一行，一折行集字内容就上下错位；
   而且 canvas 的 fillText 根本不会自动换行，长对联会直接画到纸外面去。 */
function creditLines(text, book) {
  var flat = text.replace(/\s+/g, '');
  return [
    (book.name || '') + '　' + (book.author || '') + '　集字',
    flat + '　共 ' + flat.length + ' 字'
  ];
}

// canvas 不会自动换行，长落款得自己折。返回实际画了几行。
function drawWrapped(ctx, text, x, y, maxW, lh) {
  var line = '';
  var n = 0;
  for (var i = 0; i < text.length; i++) {
    var t = line + text.charAt(i);
    if (line && ctx.measureText(t).width > maxW) {
      ctx.fillText(line, x, y + n * lh);
      n++;
      line = text.charAt(i);
    } else {
      line = t;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + n * lh);
    n++;
  }
  return n;
}

// 主区域 = 已经应用的（改动前）
function render() {
  var r = renderInto(el('strip'), state, { interactive: true });
  usage = r.usage;   // 版本面板靠它算"这个写法本句用了几次"

  // 碑本的作者、年代、馆藏、简介都搬进右侧面板了，这里只留一行底本名
  var book = window.DATA.books[state.book] || {};
  el('srcInfo').textContent = '底本：' + (book.name || state.book);

  var s = el('stateInfo');
  var line = stateLine(r);
  s.textContent = line.text;
  s.className = line.cls;

  var cr = el('credit');
  cr.textContent = state.credit ? creditLines(r.text, book).join('\n') : '';
  cr.style.display = state.credit ? '' : 'none';
  el('seal').style.display = state.seal ? '' : 'none';
  redrawDecor(el('strip'), state);   // 落款改完纸宽会变，框要按新位置重画
}

// 放大后的"改动前"那一栏：内容就是主区域正在显示的 state
function renderBefore() {
  var r = renderInto(el('beforeStrip'), state, { interactive: false });
  var book = window.DATA.books[state.book] || {};
  var cr = el('beforeCredit');
  cr.textContent = state.credit ? creditLines(r.text, book).join('\n') : '';
  cr.style.display = state.credit ? '' : 'none';
  applyInkTo(el('beforePaper'), state.ink);
  redrawDecor(el('beforeStrip'), state);
}

// 预览窗格 = 面板里正在调的（改动后）
function renderPreview() {
  if (!draft) return;
  renderBefore();
  var r = renderInto(el('previewStrip'), draft, { interactive: false });
  var book = window.DATA.books[draft.book] || {};

  var cr = el('previewCredit');
  cr.textContent = draft.credit ? creditLines(r.text, book).join('\n') : '';
  cr.style.display = draft.credit ? '' : 'none';
  el('previewSeal').style.display = draft.seal ? '' : 'none';

  var s = el('previewState');
  var line = stateLine(r);
  s.textContent = line.text;
  s.className = line.cls;

  // 字色在预览里也要看得出来——但用的是 draft，而且只上在这张纸上，不碰 body
  applyInkTo(el('previewPaper'), draft.ink);
  redrawDecor(el('previewStrip'), draft);
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

    var src = imgOfGid(gid);
    var im = document.createElement('img');
    im.src = src;
    im.alt = shown + ' 写法' + (i + 1);
    im.draggable = false;
    item.appendChild(im);
    // 缩略图也交给遮罩上色（见 style.css 的 .vitem::before），
    // 挑写法时看到的颜色才和主区域一致
    if (src) item.style.setProperty('--gimg', 'url("' + src + '")');

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

// 朱砂印章：优先用自己上传的那枚；没有就画内置的「集字」白文印
function drawSeal(ctx, x, y, s) {
  if (sealImgEl && sealImgEl.complete) {
    ctx.drawImage(sealImgEl, x, y, s, s);
    return;
  }
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

/* 把字形图染成指定颜色（透明底 + 单色墨 → 换色，不改 alpha）
   做法：先画上去，再用 source-in 只给"有像素的地方"填充颜色。
   和屏幕上 CSS 遮罩的效果一致，导出的图才不会和看到的不一样。 */
function tintImage(im, color) {
  var c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  var t = c.getContext('2d');
  t.drawImage(im, 0, 0);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, c.width, c.height);
  return c;
}

function exportPNG() {
  // 面板里还有没应用的改动？导出前先应用，免得"看到的和拿到的不一样"
  if (isDirty()) applyDraft();

  var text = el('input').value.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!text) return;
  var cols = buildColumns(text, state.layout);

  var SIZE = 160;   // 每格边长
  var GAP = 18;     // 格间距
  var PAD = 64;     // 纸边距
  // 落款区。以前只有 78，落款正好卡在框线上（被"挤压"）；
  // 现在框只框字区、落款在框外下方，这里要留够"往下退 + 两行字 + 印章"的空间。
  var FOOT = 170;
  var LH = 19;      // 落款行高

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

        // 朱砂：同一张字形图，换成朱砂色再画（屏幕上也是这么做的）
        if (state.ink === 'red') {
          ctx.drawImage(tintImage(im, '#B23A30'), x, cy, SIZE, SIZE);
        } else {
          ctx.drawImage(im, x, cy, SIZE, SIZE);
        }

        // 借字的朱砂虚线框统一在 paintDecor 里画（标记不能被反色，见那里）
        if (rec && rec.nature !== '原碑拓本') {
          credits.push('「' + ch + '」借自' + rec.nature + '，' + rec.holder);
        }
      }
    });

    // ⚠️ 界行、版框、借字框、印章这些**标记**统一在 paintDecor / paintSeal 里画，
    // 而且排在反色之后（见函数上面的说明）——它们是朱砂，被反色会变成青蓝。

    /* 界行 / 借字框 / 版框 / 印章 —— 这些都是**标记**，不是字形。
       ⚠️ 它们统一排到反色**之后**再画（调用处见下）：
       原碑模式这里是整幅反色，朱砂被反过去就是青蓝。
       屏幕上早改成"纸铺黑 + 字给白"不反整张纸了，导出还在反，
       所以只能靠"反完补画"把本色补回来。 */
    function paintDecor() {
      var ruleColor = state.ruleColor === 'ink' ?
        'rgba(58, 54, 48, 0.55)' : 'rgba(158, 61, 50, 0.55)';
      var ruleW = state.ruleWidth === '细' ? 1 : (state.ruleWidth === '粗' ? 3 : 2);

      // 竖界：每列左右各一条，从首字顶到末字底
      if (state.ruled && state.ruleDir !== '横') {
        ctx.save();
        ctx.strokeStyle = ruleColor;
        ctx.lineWidth = ruleW;
        cols.forEach(function (part, ci) {
          var x = W - PAD - SIZE - ci * (SIZE + GAP * 2);
          var yTop = PAD - GAP / 2;
          var yBot = PAD + (part.length - 1) * (SIZE + GAP) + SIZE + GAP / 2;
          ctx.beginPath();
          ctx.moveTo(x - 8, yTop);
          ctx.lineTo(x - 8, yBot);
          ctx.moveTo(x + SIZE + 8, yTop);
          ctx.lineTo(x + SIZE + 8, yBot);
          ctx.stroke();
        });
        ctx.restore();
      }

      // 横界：一整条线贯穿所有列（和屏幕上一样，不是一段一段的）
      if (state.ruled && state.ruleDir === '横') {
        ctx.save();
        ctx.strokeStyle = ruleColor;
        ctx.lineWidth = ruleW;
        var xL = W - PAD - SIZE - (cols.length - 1) * (SIZE + GAP * 2) - 8;
        var xR = W - PAD + 8;
        for (var hi = 0; hi < maxLen; hi++) {
          var hy = PAD + hi * (SIZE + GAP) + SIZE + GAP / 2;
          ctx.beginPath();
          ctx.moveTo(xL, hy);
          ctx.lineTo(xR, hy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 借来的字：朱砂虚线框标出来（屏幕上也是这个规矩）
      ctx.save();
      ctx.strokeStyle = '#9E3D32';
      ctx.setLineDash([7, 5]);
      cols.forEach(function (part, ci) {
        var x = W - PAD - SIZE - ci * (SIZE + GAP * 2);
        for (var j = 0; j < part.length; j++) {
          var cell = grid[ci][j];
          var rec = resolveGlyph(cell.ch, cell.idx).rec;
          if (rec && rec.nature !== '原碑拓本') {
            var cy = PAD + j * (SIZE + GAP);
            ctx.strokeRect(x + 4, cy + 4, SIZE - 8, SIZE - 8);
          }
        }
      });
      ctx.setLineDash([]);
      ctx.restore();

      // 版框：**只框字区**，落款和印章在框外下方。
      // 文武 = 一粗一细双边：外面粗、里面细，刻本册页最常见的版框。
      if (state.frame !== '关') {
        ctx.save();
        ctx.strokeStyle = ruleColor;
        var bTop = PAD;
        var bBot = PAD + (maxLen - 1) * (SIZE + GAP) + SIZE;
        var bL = W - PAD - SIZE - (cols.length - 1) * (SIZE + GAP * 2);
        var bR = W - PAD;
        function strokeBox(out, w) {
          ctx.lineWidth = w;
          ctx.strokeRect(bL - out, bTop - out,
            (bR - bL) + out * 2, (bBot - bTop) + out * 2);
        }
        if (state.frame === '文武') strokeBox(14, 3);   // 粗线在外
        strokeBox(8, 1);                                 // 细线在内：单边只画它
        ctx.restore();
      }
    }

    function paintSeal() {
      // 印章盖在落款下方偏右（也可以在面板里关掉）。
      // 它跟着落款一起在框外——版框框的是正文，钤印本来就该落在框外的纸面上。
      if (state.seal) {
        var sy = Math.min(H - 60, ly + used * LH + 12);
        drawSeal(ctx, W - PAD - 40, sy, 40);
      }
    }

    // 落款区：在版框之外的下方，所以不受框挤压，想往下退多少都行。
    // 两行起步（集字内容单独占一行），每行自己折行，长对联也不会画到纸外。
    var book = window.DATA.books[state.book] || {};
    var ly = H - FOOT + 41;          // 第一行基线：离字区底 92px（比原来退了一截）
    var used = 0;
    if (state.credit) {
      ctx.font = '13px "Songti SC", SimSun, serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var maxW = W - PAD * 2;        // 印章在落款下方，不占宽度
      ctx.fillStyle = '#6B6659';
      var lines = creditLines(text, book);
      for (var li = 0; li < lines.length; li++) {
        used += drawWrapped(ctx, lines[li], PAD, ly + used * LH, maxW, LH);
      }
      ctx.fillStyle = '#8A8474';
      if (credits.length === 0) {
        used += drawWrapped(ctx, '全部字形来自原帖', PAD, ly + used * LH, maxW, LH);
      } else {
        for (var k = 0; k < credits.length && k < 2; k++) {
          used += drawWrapped(ctx, credits[k], PAD, ly + used * LH, maxW, LH);
        }
        if (credits.length > 2) {
          used += drawWrapped(ctx, '…另有 ' + (credits.length - 2) + ' 条借用说明',
            PAD, ly + used * LH, maxW, LH);
        }
      }
    }

    // 原图（拓片观感）：碑帖拓片本来就是黑底白字，整幅翻转就是这个观感
    if (state.ink === 'rub') {
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 标记（界行 / 借字框 / 版框 / 印章）排在反色之后补画，保住朱砂本色
    paintDecor();
    paintSeal();

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
      // 只恢复"这块碑当时有字"的记录，免得点开一条历史就满屏缺字
      if ((window.DATA.books || {})[item.book] && booksWithGlyphs()[item.book]) {
        state.book = item.book;
      }
      state.layout = item.layout || '条幅';
      syncPanel();
      closeVersions();
      resetPicks();   // 从历史里换了一句话，等于换句子
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

/* ---------- 集字调整面板（抽屉） ----------
   从右边滑出来；目录竖排在抽屉右侧，点一项，窗格就朝左边展开。
   碑本、排版、字色三样原来挂在输入框下面，现在都收在这里。 */

// 只有真的录进了字的碑才让选。books.json 里登记了、但卡片还没收回来的，
// 灰着摆出来并注明"待入库"——不假装能用，也不藏着不让人知道有这一块碑。
function booksWithGlyphs() {
  var has = {};
  (window.DATA.glyphs || []).forEach(function (g) { if (g.book) has[g.book] = 1; });
  return has;
}

/* 碑本：上面一排按钮选，下面一个格子显示**当前选中的那一块**的详情。
   两块碑各摆一张大卡太占地方，而详情其实只需要看一块——所以拆开。 */
function renderBookSeg() {
  var box = el('bookSeg');
  if (!box) return;
  var books = window.DATA.books || {};
  var has = booksWithGlyphs();
  var cfg = draft || state;
  box.innerHTML = '';

  Object.keys(books).forEach(function (key) {
    var b = books[key];
    var ready = !!has[key];
    var btn = document.createElement('button');
    btn.className = 'segbtn' + (cfg.book === key ? ' on' : '') + (ready ? '' : ' off');
    btn.dataset.book = key;
    btn.textContent = ready ? (b.name || key) : (b.name || key) + '（待入库）';

    if (ready) {
      btn.dataset.tip = '用这块碑集字。\n目前库里有 ' + countGlyphs(key) + ' 个字形。';
      btn.addEventListener('click', function () { chooseBook(key); });
    } else {
      btn.dataset.tip = '这块碑的卡片还在核对，一个字都还没入库。\n' +
        '按红线约定：没入库就如实留空，绝不拿别碑的字顶上。\n' +
        '卡片收回来、跑一遍收卡片管线，这个按钮会自己亮起来——不用改程序。';
    }
    box.appendChild(btn);
  });
}

// 详情格：作者 / 年代 / 年龄 / 馆藏 / 简介 / 原帖链接 / 入库字数，只显示选中的那块
function renderBookInfo() {
  var box = el('bookInfo');
  if (!box) return;
  var cfg = draft || state;
  var b = (window.DATA.books || {})[cfg.book] || {};
  var ready = !!booksWithGlyphs()[cfg.book];
  box.innerHTML = '';

  function row(label, val) {
    if (!val) return;
    var r = document.createElement('div');
    r.className = 'ir';
    var k = document.createElement('span');
    k.className = 'ik';
    k.textContent = label;
    var v = document.createElement('span');
    v.className = 'iv';
    v.textContent = val;
    r.appendChild(k);
    r.appendChild(v);
    box.appendChild(r);
  }

  row('作者', b.author);
  row('年代', [b.year, b.age].filter(Boolean).join('　'));
  row('馆藏', b.holder);
  row('字数', ready ? (countGlyphs(cfg.book) + ' 个字形已入库') : '0（待入库）');
  if (b.desc) {
    var d = document.createElement('div');
    d.className = 'idesc';
    d.textContent = b.desc;
    box.appendChild(d);
  }
  if (b.url) {
    var a = document.createElement('a');
    a.className = 'bksrc';
    a.href = b.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '在中华珍宝馆看原帖 ↗';
    box.appendChild(a);
  }
}

function countGlyphs(book) {
  var n = 0;
  (window.DATA.glyphs || []).forEach(function (g) { if (g.book === book) n++; });
  return n;
}

// 换碑只改 draft——主区域保持"改动前"，左侧预览立刻显示新碑的效果
function chooseBook(key) {
  if (!draft || draft.book === key) return;
  draft.book = key;
  syncPanel();
  renderPreview();
}

function renderMenu() {
  var menu = el('dmenu');
  if (!menu) return;
  menu.innerHTML = '';
  SECTIONS.forEach(function (s, i) {
    var btn = document.createElement('button');
    btn.className = 'dmi' + (curSection === s.key ? ' on' : '') + (s.ready ? '' : ' todo');
    btn.textContent = s.name;
    if (!s.ready) {
      btn.dataset.tip = s.todo + '\n—\n排在这一轮的第 ' + (i + 1) + ' 项，样式定下来就轮到它。';
    }
    btn.addEventListener('click', function () { openSection(s.key); });
    menu.appendChild(btn);
  });
}

// 还没开工的那几项，窗格是临时生成的；做好了就把 ready 改 true，
// 并在 index.html 里写死自己的窗格（data-key 对上即可）。
function ensurePane(key) {
  var panes = el('dpanes');
  var pane = panes.querySelector('.dpane[data-key="' + key + '"]');
  if (pane) return pane;
  var s = null;
  SECTIONS.forEach(function (x) { if (x.key === key) s = x; });
  pane = document.createElement('section');
  pane.className = 'dpane';
  pane.dataset.key = key;
  var p = document.createElement('p');
  p.className = 'dnote';
  p.textContent = (s && s.todo ? s.todo : '') + '\n（这一项还没开工。）';
  pane.appendChild(p);
  panes.appendChild(pane);
  return pane;
}

function openSection(key) {
  curSection = key;
  renderMenu();
  var panes = el('dpanes');
  Array.prototype.forEach.call(panes.querySelectorAll('.dpane'), function (p) {
    p.classList.toggle('on', p.dataset.key === key);
  });
  ensurePane(key).classList.add('on');
}

/* ---------- 草稿 / 预览 / 应用 ----------
   面板里的改动先落进 draft。主区域不动（它就是"改动前"），
   左侧预览窗格实时显示 draft 的效果（"改动后"）。
   满意了点【应用改动】，draft 才变成 state。 */

function cloneCfg(c) {
  return {
    book: c.book, layout: c.layout, ink: c.ink,
    credit: !!c.credit, seal: !!c.seal,
    ruled: !!c.ruled, ruleDir: c.ruleDir || '竖',
    ruleColor: c.ruleColor || 'red', ruleWidth: c.ruleWidth || '细',
    frame: c.frame || '文武'
  };
}

function cfgEqual(a, b) {
  return a.book === b.book && a.layout === b.layout && a.ink === b.ink &&
    !!a.credit === !!b.credit && !!a.seal === !!b.seal &&
    !!a.ruled === !!b.ruled && a.ruleDir === b.ruleDir &&
    a.ruleColor === b.ruleColor && a.ruleWidth === b.ruleWidth &&
    a.frame === b.frame;
}

function isDirty() {
  return !!draft && !cfgEqual(draft, state);
}

function applyDraft() {
  if (!draft) return;
  var wasBook = state.book;
  state = cloneCfg(draft);
  if (state.book !== wasBook) closeVersions();   // 换碑后版本列表全变了
  applyInkToPage(state.ink);
  render();
  markDirty();
}

function cancelDraft() {
  if (!draft) return;
  draft = cloneCfg(state);
  syncPanel();
  renderPreview();
  markDirty();
}

// 抽屉底部那句话 + 【集字调整】按钮上的红点：让人知道"还有改动没应用"
function markDirty() {
  var dirty = isDirty();
  var note = el('dfnote');
  if (note) {
    note.textContent = dirty ? '有改动还没应用（左边是改后的效果）' : '改动都已应用';
    note.classList.toggle('on', dirty);
  }
  var btn = el('btnApply');
  if (btn) btn.classList.toggle('attn', dirty);
  var adj = el('btnAdjust');
  if (adj) adj.classList.toggle('dirty', dirty);
}

function togglePreview(open) {
  document.body.classList.toggle('previewing', open);
  el('preview').classList.toggle('open', open);
}

function toggleDrawer(open) {
  var d = el('drawer');
  var willOpen = (typeof open === 'boolean') ? open : !d.classList.contains('open');
  d.classList.toggle('open', willOpen);
  el('drawerMask').classList.toggle('open', willOpen);
  togglePreview(willOpen);
  if (willOpen) {
    if (!draft) draft = cloneCfg(state);   // 关了再开，上次的改动还在
    openSection(curSection);
    syncPanel();
    renderPreview();
    markDirty();
  }
}

// 面板上所有"当前值"的高亮，统一按 draft 刷一遍——改了设置调它就行
function syncPanel() {
  var cfg = draft || state;
  renderBookSeg();
  renderBookInfo();
  Array.prototype.forEach.call(el('segLayout').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.layout);
  });
  Array.prototype.forEach.call(el('segInk').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.ink);
  });
  Array.prototype.forEach.call(el('segTail').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', cfg[b.dataset.v] !== false);
  });

  // 界行：开关是二选一（开/关），方向 / 颜色 / 粗细是点哪个用哪个
  Array.prototype.forEach.call(el('segRuled').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', (b.dataset.v === 'on') === !!cfg.ruled);
  });
  Array.prototype.forEach.call(el('segRuleDir').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.ruleDir);
  });
  Array.prototype.forEach.call(el('segRuleColor').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.ruleColor);
  });
  Array.prototype.forEach.call(el('segRuleWidth').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.ruleWidth);
  });
  Array.prototype.forEach.call(el('segFrame').querySelectorAll('.segbtn'), function (b) {
    b.classList.toggle('on', b.dataset.v === cfg.frame);
  });
}

/* ---------- 印章 ----------
   默认那枚「集字」印是程序画的。用户也能换成自己的：
   选一张图 → 我把接近白的像素变透明 → 缩到 160px → 存进 localStorage。
   全程在本机，不联网、不上传。 */

var sealImgEl = null;   // 已加载好的印章 Image（导出时要现成可用）

function applySealToPage() {
  var seals = document.querySelectorAll('.seal');
  Array.prototype.forEach.call(seals, function (s) {
    if (sealImage) {
      s.style.backgroundImage = 'url("' + sealImage + '")';
      s.classList.add('custom');
    } else {
      s.style.backgroundImage = '';
      s.classList.remove('custom');
    }
  });
}

function setSealImage(dataURL) {
  sealImage = dataURL || null;
  sealImgEl = null;
  var s = getStore();
  if (s) {
    try {
      if (sealImage) s.setItem(SEAL_KEY, sealImage); else s.removeItem(SEAL_KEY);
    } catch (e) { /* 存不下就算了，本次会话内仍然有效 */ }
  }
  if (sealImage) {
    var im = new Image();
    im.onload = function () { sealImgEl = im; applySealToPage(); };
    im.src = sealImage;
  } else {
    applySealToPage();
  }
  // 换了印章，面板里那枚示意和页面上所有 .seal 都得跟着换
  el('sealPrevImg').style.backgroundImage = sealImage ? 'url("' + sealImage + '")' : '';
  el('sealPrevImg').classList.toggle('empty', !sealImage);
  el('sealPrevTxt').textContent = sealImage ? '你自己的印章' : '默认「集字」印';
}

function loadSeal() {
  var s = getStore();
  var saved = s ? s.getItem(SEAL_KEY) : null;
  setSealImage(saved || null);
}

// 去白底：RGB 三个通道都高于阈值的像素，直接变成透明。
// 扫描件/截图底色常常不是纯白，所以阈值做成可调的。
function stripWhite(im, threshold) {
  var c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  var t = c.getContext('2d');
  t.drawImage(im, 0, 0);
  var d = t.getImageData(0, 0, c.width, c.height);
  var p = d.data;
  for (var i = 0; i < p.length; i += 4) {
    if (p[i] >= threshold && p[i + 1] >= threshold && p[i + 2] >= threshold) p[i + 3] = 0;
  }
  t.putImageData(d, 0, 0);
  return c;
}

// 缩到不超过 160px（印章在导出图里只有 40px 见方，存大了纯浪费 localStorage）
function shrink(canvas, max) {
  var w = canvas.width, h = canvas.height;
  var k = Math.min(1, max / Math.max(w, h));
  if (k === 1) return canvas;
  var c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c;
}

function processSealFile(file) {
  if (!file) return;
  var fr = new FileReader();
  fr.onload = function () {
    var im = new Image();
    im.onload = function () {
      var thr = parseInt(el('sealThr').value, 10) || 235;
      try {
        setSealImage(shrink(stripWhite(im, thr), 160).toDataURL('image/png'));
      } catch (e) {
        alert('这张图处理不了：' + e.message);
      }
    };
    im.onerror = function () { alert('这张图读不出来，换一张 PNG / JPG 试试。'); };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* ---------- 初始化 ---------- */

/* 字色只作用在对应的那张"纸"上，绝不挂在 body 上——
   body 上的类和 --ink 会被预览窗格继承，导致主区域应用过的颜色渗进预览（2026-10-25 修）。
   主区域的纸照 state 上色，预览那张照 draft 上色（见 renderPreview）。 */
function applyInkTo(node, key) {
  node.classList.toggle('ink-red', key === 'red');
  node.classList.toggle('ink-rub', key === 'rub');
}

function applyInkToPage(key) {
  applyInkTo(el('mainPaper'), key);
  applyInkTo(el('versions'), key);   // 版本面板跟着一起换色，挑写法时看到的才一致
}

function init() {
  buildRecIndex();

  // 清掉旧版本的跨句子记忆（这两个键已经不再读写，留着只会让人困惑）
  try {
    var st = getStore();
    if (st) { st.removeItem(PKEY); st.removeItem(OKKEY); }
  } catch (e) { /* 清不掉不影响使用 */ }

  // 默认底本：books.json 里第一块"真的有字"的碑（颜勤礼碑入库后会自动被考虑）
  var has = booksWithGlyphs();
  var keys = Object.keys(window.DATA.books || {});
  for (var i = 0; i < keys.length; i++) {
    if (has[keys[i]]) { state.book = keys[i]; break; }
  }

  loadSeal();
  renderMenu();
  openSection(curSection);
  syncPanel();
  applyInkToPage(state.ink);

  el('input').addEventListener('input', function () {
    closeVersions();   // 改了内容，版本区里的字可能已经不在句里了
    resetPicks();      // 换了句子：上一句挑的写法不作数，回到自动避复
    render();
    renderPreview();   // 预览也跟着换内容
  });

  el('btnAdjust').addEventListener('click', function () { toggleDrawer(); });
  el('drawerClose').addEventListener('click', function () { toggleDrawer(false); });
  el('drawerMask').addEventListener('click', function () { toggleDrawer(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && el('drawer').classList.contains('open')) toggleDrawer(false);
  });

  // 下面三组按钮都是"点哪个用哪个"，不再循环切换。
  // 改的是 draft——主区域不动，左侧预览窗格立刻跟着变。
  el('segLayout').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.segbtn') : null;
    if (!b || !draft) return;
    draft.layout = b.dataset.v;
    syncPanel();
    renderPreview();
    markDirty();
  });

  el('segInk').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.segbtn') : null;
    if (!b || !draft) return;
    draft.ink = b.dataset.v;
    syncPanel();
    renderPreview();
    markDirty();
  });

  // 落款 / 印章是两个独立的开关（可开可关，不是二选一）
  el('segTail').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.segbtn') : null;
    if (!b || !draft) return;
    draft[b.dataset.v] = draft[b.dataset.v] === false;
    syncPanel();
    renderPreview();
    markDirty();
  });

  // 成册界行：四组都是点哪个用哪个（开关是"开 / 关"二选一）
  el('segRuled').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.segbtn') : null;
    if (!b || !draft) return;
    draft.ruled = (b.dataset.v === 'on');
    syncPanel();
    renderPreview();
    markDirty();
  });

  ['segRuleDir:ruleDir', 'segRuleColor:ruleColor', 'segRuleWidth:ruleWidth',
   'segFrame:frame'].forEach(function (pair) {
    var p = pair.split(':');
    el(p[0]).addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.segbtn') : null;
      if (!b || !draft) return;
      draft[p[1]] = b.dataset.v;
      syncPanel();
      renderPreview();
      markDirty();
    });
  });

  el('btnApply').addEventListener('click', applyDraft);
  el('btnCancel').addEventListener('click', cancelDraft);

  // 【放大】：长对联时把预览铺满设置窗口以外的整块屏幕
  el('btnZoom').addEventListener('click', function () {
    var on = document.body.classList.toggle('zoomed');
    el('pbody').classList.toggle('side', on);
    this.textContent = on ? '还原' : '放大';
    this.classList.toggle('on', on);
    renderBefore();   // 放大后左边要多出"改动前"那一栏
  });

  // 印章：换自己的 / 用回默认。全程本机处理，不联网、不上传
  el('btnSeal').addEventListener('click', function () { el('sealFile').click(); });
  el('sealFile').addEventListener('change', function () {
    processSealFile(this.files && this.files[0]);
    this.value = '';
  });
  el('btnSealReset').addEventListener('click', function () {
    setSealImage(null);
  });
  el('sealThr').addEventListener('change', function () {
    // 改了去白底强度：要是已经上传过，用新强度重做一遍得重新选图，这里只提示
    if (sealImage) {
      el('sealNote').textContent =
        '强度已改。想按新强度重做，再点一次「更换印章」选同一张图。';
    }
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
