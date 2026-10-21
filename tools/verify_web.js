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
// jsdom 没实现 scrollIntoView，补个空壳，否则展开版本区会抛错
window.Element.prototype.scrollIntoView = function () {};

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
  check('原帖字悬停有出处信息', g.dataset.tip && g.dataset.tip.includes('碑文第'));

  // 6. 历史：导出后自动留档（导出走 canvas，jsdom 只验证 saveHistory 逻辑）
  window.saveHistory({ text: '上善若水 道法自然', book: 'dbt', layout: '条幅', ts: Date.now() });
  window.renderHistory();
  const rows = document.querySelectorAll('.hrow');
  check('历史留档 1 条并渲染出列表', rows.length === 1);
  document.getElementById('btnHistory').click();
  check('历史面板能打开', document.getElementById('historyPanel').classList.contains('open'));

  // 7. 书体切换按钮文本正常
  check('books 元数据修复（不再显示 dbt）', document.getElementById('btnBook').textContent === '多宝塔碑');

  // 8. 多版本选择：角标 → 展开 → 选一个 → 同步 → 记忆 → 恢复默认
  const nZhi = window.DATA.by_char['之'].length;
  document.getElementById('input').value = '之';
  window.render();
  let vd = strip.querySelector('.glyph .vdot');
  check('多版本字「之」右下角挂角标', vd !== null);
  check('角标数字 = 碑里该字的写法数（' + nZhi + '）', vd && vd.textContent === String(nZhi));
  check('初始是黄点（未手动选过）', vd && !vd.classList.contains('picked'));

  vd.click();
  const vpanel = document.getElementById('versions');
  check('点角标展开版本选择区', vpanel.classList.contains('open'));
  const items = document.getElementById('vGrid').querySelectorAll('.vitem');
  check('版本区列出全部 ' + nZhi + ' 个写法', items.length === nZhi);
  check('当前在用的那个标为选中', document.getElementById('vGrid').querySelector('.vitem.on') !== null);

  const wantGid = items[2].dataset.gid;
  const wantSrc = window.DATA.glyph_img[wantGid];
  items[2].click();
  check('点一个写法，主区域立刻换', strip.querySelector('.glyph img').getAttribute('src') === wantSrc);
  check('点完面板不关（可以连着试）', vpanel.classList.contains('open'));

  // 【再想想】：改动留着，角标还是黄
  document.getElementById('vLater').click();
  check('【再想想】收起面板', !vpanel.classList.contains('open'));
  vd = strip.querySelector('.glyph .vdot');
  check('【再想想】后角标仍是黄（tentative）',
    vd.classList.contains('tentative') && !vd.classList.contains('picked'));
  check('【再想想】但改动确实存下了',
    JSON.parse(fakeStore.getItem('glyph_pick_v1') || '{}')['dbt:之#0'] === wantGid);

  // 【选好了】：拍板，角标变绿
  strip.querySelector('.glyph .vdot').click();
  check('再点角标能重新展开', vpanel.classList.contains('open'));
  document.getElementById('vConfirm').click();
  check('【选好了】收起面板', !vpanel.classList.contains('open'));
  vd = strip.querySelector('.glyph .vdot');
  check('【选好了】后角标变绿', vd.classList.contains('picked'));
  check('【选好了】写进确认表',
    JSON.parse(fakeStore.getItem('glyph_pick_ok_v1') || '{}')['dbt:之#0'] === 1);

  // 换了版本就该摘掉"已拍板"，避免绿点挂在一个已经不是它的版本上
  strip.querySelector('.glyph .vdot').click();
  document.getElementById('vGrid').querySelectorAll('.vitem')[5].click();
  document.getElementById('vConfirm').click();
  check('改选后重新确认，记录跟着更新',
    JSON.parse(fakeStore.getItem('glyph_pick_v1') || '{}')['dbt:之#0'] ===
    window.DATA.by_char['之'][5]);

  // 自动避复：同一句里同字不同形
  window.clearPick('之', 0);
  window.clearPick('之', 1);
  document.getElementById('input').value = '之之';
  window.render();
  const two = strip.querySelectorAll('.glyph img');
  check('同一句里两次「之」自动用不同写法（避复）',
    two.length === 2 && two[0].getAttribute('src') !== two[1].getAttribute('src'));

  // 逐字可指定：改第 2 个「之」，第 1 个不受影响
  const vdots = strip.querySelectorAll('.glyph .vdot');
  vdots[1].click();
  document.getElementById('vGrid').querySelectorAll('.vitem')[3].click();
  document.getElementById('vConfirm').click();
  const two2 = strip.querySelectorAll('.glyph img');
  check('只改第 2 个「之」，第 1 个不动',
    two2[0].getAttribute('src') === two[0].getAttribute('src') &&
    two2[1].getAttribute('src') === window.DATA.glyph_img[window.DATA.by_char['之'][3]]);

  // 恢复默认：丢掉手动选择，回到自动避复给的那一版
  window.clearPick('之', 0);
  document.getElementById('input').value = '之';
  window.render();
  strip.querySelector('.glyph .vdot').click();
  document.getElementById('vDefault').click();
  check('「恢复默认」后角标变回纯黄（无 tentative 无 picked）', (() => {
    const d = strip.querySelector('.glyph .vdot');
    return !d.classList.contains('picked') && !d.classList.contains('tentative');
  })());
  check('「恢复默认」后清掉记忆',
    JSON.parse(fakeStore.getItem('glyph_pick_v1') || '{}')['dbt:之#0'] === undefined);

  // 改输入 / 换碑时收起版本区（否则面板里的字已经不在句里了）
  window.closeVersions();
  strip.querySelector('.glyph .vdot').click();
  document.getElementById('input').value = '之乎者也';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  check('改输入后版本区自动收起', !vpanel.classList.contains('open'));

  // 避复提示：面板里标出每个写法在本句「别处」还用了几处
  window.clearPick('之', 0);
  window.clearPick('之', 1);
  document.getElementById('input').value = '之之';
  window.render();
  strip.querySelectorAll('.glyph .vdot')[0].click();
  const vs0 = document.getElementById('vGrid').querySelectorAll('.vitem');
  check('当前在用的写法标「未使用」',
    vs0[0].querySelector('.vused').textContent === '未使用');
  check('已被别处占用的写法标红警示',
    vs0[1].querySelector('.vused').classList.contains('dup') &&
    vs0[1].querySelector('.vused').textContent === '另有 1 处已用');
  check('红字上能看出撞在本句第几个字',
    (vs0[1].querySelector('.vused').dataset.tip || '').includes('第 2 个字'));

  // 就算故意选了撞车的那版，也照样标红——提醒你"这版跟别处重了"
  document.getElementById('vGrid').querySelectorAll('.vitem')[1].click();
  const again = document.getElementById('vGrid').querySelectorAll('.vitem')[1];
  check('选中撞车的写法后依然标红', again.classList.contains('on') &&
    again.querySelector('.vused').classList.contains('dup'));
  window.closeVersions();

  // 主区域也要看得见同字同形——收起面板后不能就这么忘了
  window.clearPick('之', 0);
  window.clearPick('之', 1);
  window.render();
  check('自动避复下不会撞', strip.querySelectorAll('.glyph.dup').length === 0);
  window.setPick('之', 0, window.DATA.by_char['之'][0]);
  window.setPick('之', 1, window.DATA.by_char['之'][0]);   // 故意挑成一样
  window.render();
  check('手动挑成一样时，两个格子都标出同字同形',
    strip.querySelectorAll('.glyph.dup').length === 2);
  check('状态栏报出同字同形处数',
    document.getElementById('stateInfo').textContent.includes('2 处同字同形'));
  window.clearPick('之', 0);
  window.clearPick('之', 1);

  // 按钮悬浮说明（白星 2026-10-21 要的）
  check('【选好了】有悬浮说明', !!document.getElementById('vConfirm').dataset.tip);
  check('【再想想】有悬浮说明', !!document.getElementById('vLater').dataset.tip);
  check('【恢复默认】有悬浮说明', !!document.getElementById('vDefault').dataset.tip);

  // 9. 单版本字不该挂角标
  const single = Object.keys(window.DATA.by_char).find((c) => window.DATA.by_char[c].length === 1);
  if (single) {
    document.getElementById('input').value = single;
    window.render();
    check('只有一个写法的字「' + single + '」不挂角标', strip.querySelector('.vdot') === null);
  }

  // 10. 红线：颜勤礼碑还没录数据，切过去必须如实留空，
  //     绝不能拿多宝塔碑的字顶上（否则用户会以为是颜体）
  document.getElementById('btnBook').click();   // dbt -> yql
  document.getElementById('input').value = '上善若水';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  check('颜勤礼碑无数据时全部如实留空',
    strip.querySelectorAll('.glyph.missing').length === 4 &&
    strip.querySelectorAll('img').length === 0);
  check('颜勤礼碑下也不挂多版本角标', strip.querySelector('.vdot') === null);
  document.getElementById('btnBook').click();   // 切回多宝塔碑
} catch (e) {
  fail++;
  console.log('  ✗ 执行异常: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
