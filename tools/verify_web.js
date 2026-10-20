/* 无头验证 web 前端：加载 index.html + data.js + app.js，跑关键交互
   （不需要真浏览器，img 不会真的渲染，但 DOM 逻辑全部能验证） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = 'D:/wockbuddy/工作空间/2026-10-15-19-35-52/whitestar_working_with_longgeng/web';
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const dataJs = fs.readFileSync(path.join(WEB, 'data.js'), 'utf8');
const appJs = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  url: 'file://' + WEB + '/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// jsdom 没有 localStorage 的 file:// 问题，但有 URL.createObjectURL 等，按需补
window.alert = (m) => errors.push('alert: ' + m);
window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect(){}, drawImage(){}, set fillStyle(v){}, get fillStyle(){return '';} });

// jsdom 把 file:// 视为 opaque origin，连 localStorage 属性都拒绝访问；
// 真浏览器（Chrome/Edge 双击打开）没这问题。注入假 storage 模拟可用环境。
const fakeStore = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
})();
Object.defineProperty(window, 'localStorage', { value: fakeStore, configurable: true });

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

try {
  window.eval(dataJs);
  window.eval(appJs);

  // 1. 默认渲染：8 个字全部有图
  const strip = document.getElementById('strip');
  let imgs = strip.querySelectorAll('img');
  check('默认句「上善若水 道法自然」渲染出 8 张字形图', imgs.length === 8);
  check('状态栏显示"全部来自原帖"', document.getElementById('stateInfo').textContent.includes('全部来自原帖'));
  check('简介栏显示碑帖名', document.getElementById('intro').textContent.includes('多宝塔碑'));

  // 2. 简体映射：输入简体"画"应映射到"畫"出图
  document.getElementById('input').value = '画';
  window.render();
  imgs = strip.querySelectorAll('img');
  check('简体「画」能映射到碑上的「畫」出图', imgs.length === 1);
  check('画面右上角/左下角有简体角标', strip.querySelector('.glyph .variant') !== null);

  // 3. 缺字：库里没有的字如实留空
  document.getElementById('input').value = '嗎';
  window.render();
  const missing = strip.querySelector('.glyph.missing');
  check('生僻字「嗎」正确标为缺字', missing !== null);
  check('缺字格绝不渲染 img（红线）', strip.querySelectorAll('img').length === 0);

  // 4. 对联布局：空格分两列，右列（DOM 第一列）是上联
  document.getElementById('input').value = '上善若水 道法自然';
  document.getElementById('btnLayout').click();
  const cols = strip.querySelectorAll('.col');
  check('对联模式分两列', cols.length === 2);
  check('DOM 第一列（屏显右侧）是上联"上善若水"', cols[0].querySelector('.glyph img') && cols[0].querySelectorAll('.glyph').length === 4);
  check('strip 有 duilian 类', strip.classList.contains('duilian'));
  document.getElementById('btnLayout').click(); // 切回条幅

  // 5. 悬停信息：每个有图的字都有出处 data-info
  document.getElementById('input').value = '大';
  window.render();
  const g = strip.querySelector('.glyph');
  check('原帖字悬停有出处信息', g.dataset.info && g.dataset.info.includes('碑文第'));

  // 6. 历史：导出后自动留档（导出走 canvas，jsdom 只验证 saveHistory 逻辑）
  window.saveHistory({ text: '上善若水 道法自然', book: 'dbt', layout: '条幅', ts: Date.now() });
  window.renderHistory();
  const rows = document.querySelectorAll('.hrow');
  check('历史留档 1 条并渲染出列表', rows.length === 1);
  document.getElementById('btnHistory').click();
  check('历史面板能打开', document.getElementById('historyPanel').classList.contains('open'));

  // 7. 书体切换按钮文本正常
  check('books 元数据修复（不再显示 dbt）', document.getElementById('btnBook').textContent === '多宝塔碑');
} catch (e) {
  fail++;
  console.log('  ✗ 执行异常: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
