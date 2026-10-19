/* 碑帖集字生成器 · 前端 MVP
   三种字的状态：
     1. 原帖字   —— 来自本碑的拓本，正常显示
     2. 借来的字 —— 不是原帖的字（临本 / 他碑 / 拼合），朱砂虚线框 + 角标，悬停可看来源
     3. 缺字     —— 库里没有，如实留空，绝不用系统字体渲染一个假字冒充

   数据安全：本页所有数据来自 data.js（由 tools/build_manifest.py 从 JSON 生成），
   不使用 fetch，因此双击本文件即可运行，不需要起服务器，也不需要联网。 */

var state = { book: 'dbt', layout: '条幅' };

function el(id) {
  return document.getElementById(id);
}

function findGlyph(ch) {
  var list = window.DATA.glyphs;
  for (var i = 0; i < list.length; i++) {
    if (list[i].char === ch && list[i].book === state.book) {
      return list[i];
    }
  }
  return null;
}

function render() {
  var text = el('input').value.replace(/\s/g, '');
  var strip = el('strip');
  strip.innerHTML = '';

  var borrowed = [];
  var missing = [];

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var rec = findGlyph(ch);
    var box = document.createElement('div');
    box.className = 'glyph';

    if (!rec) {
      // 缺字：留空 + 标记，绝不渲染假字
      box.classList.add('missing');
      box.textContent = '缺';
      missing.push(ch);
    } else {
      box.textContent = ch;
      if (rec.nature !== '原碑拓本') {
        // 借来的字：可见地区分
        box.classList.add('borrowed');
        var dot = document.createElement('span');
        dot.className = 'dot';
        box.appendChild(dot);
        box.dataset.info =
          '「' + ch + '」这个字，库里没有原帖的写法。\n' +
          '当前用的是：' + rec.nature + '（' + rec.edition + '）\n' +
          '来源：' + rec.holder + '\n' +
          '核对状态：' + rec.verified + (rec.by ? '　核对人：' + rec.by : '');
        borrowed.push(ch);
      }
    }
    strip.appendChild(box);
  }

  var book = window.DATA.books[state.book];
  el('intro').textContent =
    book.name + '　' + book.author + '　' + book.year + '　' + book.age + '　|　' + book.desc;

  el('srcInfo').textContent = '底本：' + book.name;

  var s = el('stateInfo');
  if (missing.length > 0) {
    s.textContent = '缺 ' + missing.length + ' 字' + (borrowed.length ? '　借 ' + borrowed.length + ' 字' : '');
    s.className = 'state warn';
  } else if (borrowed.length > 0) {
    s.textContent = '借用 ' + borrowed.length + ' 字（已标注）';
    s.className = 'state ok';
  } else {
    s.textContent = '全部来自原帖';
    s.className = 'state ok';
  }
}

function bindTooltip() {
  var tip = el('tip');
  var strip = el('strip');

  strip.addEventListener('mouseover', function (e) {
    var box = e.target.closest ? e.target.closest('.glyph') : null;
    if (box && box.dataset.info) {
      var r = box.getBoundingClientRect();
      tip.textContent = box.dataset.info;
      tip.style.left = (r.right + 12) + 'px';
      tip.style.top = (window.scrollY + r.top) + 'px';
      tip.classList.add('show');
    }
  });

  strip.addEventListener('mouseout', function () {
    tip.classList.remove('show');
  });
}

function exportPNG() {
  var text = el('input').value.replace(/\s/g, '');
  var size = 76;
  var pad = 36;
  var footH = 40;

  var w = 240;
  var h = text.length * size + pad * 2 + footH;

  var c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  var ctx = c.getContext('2d');

  ctx.fillStyle = '#FBF9F3';
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  var credits = [];

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var rec = findGlyph(ch);
    var y = pad + size * i + size / 2;

    if (!rec) {
      ctx.fillStyle = '#B4AEA0';
      ctx.font = '18px serif';
      ctx.fillText('缺', w / 2, y);
      credits.push('「' + ch + '」库中没有，留空未补');
    } else if (rec.nature !== '原碑拓本') {
      ctx.fillStyle = '#9E3D32';
      ctx.font = '48px serif';
      ctx.fillText(ch, w / 2, y);
      credits.push('「' + ch + '」借自' + rec.nature + '，' + rec.holder);
    } else {
      ctx.fillStyle = '#1A1A1A';
      ctx.font = '48px serif';
      ctx.fillText(ch, w / 2, y);
    }
  }

  // 出处清单统一列在底部（组会决议 A3）
  ctx.fillStyle = '#6B6659';
  ctx.font = '12px serif';
  ctx.textAlign = 'left';
  var ly = pad + text.length * size + 12;
  if (credits.length === 0) {
    ctx.fillText('全部字形来自原帖，无借用', 16, ly);
  } else {
    for (var k = 0; k < credits.length && k < 4; k++) {
      ctx.fillText(credits[k], 16, ly + k * 16);
    }
  }

  var a = document.createElement('a');
  a.download = '集字-' + text + '.png';
  a.href = c.toDataURL('image/png');
  a.click();
}

function init() {
  el('input').addEventListener('input', render);

  el('btnBook').addEventListener('click', function () {
    state.book = state.book === 'dbt' ? 'yql' : 'dbt';
    this.textContent = window.DATA.books[state.book].name;
    render();
  });

  el('btnLayout').addEventListener('click', function () {
    state.layout = state.layout === '条幅' ? '对联' : '条幅';
    this.textContent = state.layout;
    render();
  });

  el('btnExport').addEventListener('click', exportPNG);

  bindTooltip();
  render();
}

init();
