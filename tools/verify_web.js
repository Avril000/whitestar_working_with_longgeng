/* 无头验证 web 前端：加载 index.html + data.js + app.js，跑关键交互
   （不需要真浏览器，img 不会真的渲染，但 DOM 逻辑全部能验证） */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WEB = 'D:/wockbuddy/工作空间/2026-10-15-19-35-52/whitestar_working_with_longgeng/web';
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'style.css'), 'utf8');
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

// 改面板设置的统一走法：打开抽屉 → 点 → 【应用改动】→ 收起。
// 设置不再实时生效（要先过预览），所以每条用例都得走完这四步。
function panelSet(seg, v) {
  document.getElementById('btnAdjust').click();
  document.querySelector(seg + ' .segbtn[data-v="' + v + '"]').click();
  document.getElementById('btnApply').click();
  document.getElementById('drawerClose').click();
}

try {
  window.eval(dataJs);
  window.eval(appJs);

  // 1. 默认渲染：8 个字全部有图
  const strip = document.getElementById('strip');
  let imgs = strip.querySelectorAll('img');
  check('默认句「上善若水 道法自然」渲染出 8 张字形图', imgs.length === 8);
  check('状态栏显示"全部来自原帖"', document.getElementById('stateInfo').textContent.includes('全部来自原帖'));
  check('输入框下面不再挂碑本简介（已搬进面板）', document.getElementById('intro') === null);
  check('底本名仍显示在底部状态栏', document.getElementById('srcInfo').textContent.includes('多宝塔碑'));

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
  window.render();
  panelSet('#segLayout', '对联');
  const cols = strip.querySelectorAll('.col');
  check('对联模式分两列', cols.length === 2);
  check('DOM 第一列（屏显右侧）是上联"上善若水"', cols[0].querySelector('.glyph img') && cols[0].querySelectorAll('.glyph').length === 4);
  check('strip 有 duilian 类', strip.classList.contains('duilian'));
  check('分段按钮：对联点亮、条幅熄灭',
    document.querySelector('#segLayout .segbtn[data-v="对联"]').classList.contains('on') &&
    !document.querySelector('#segLayout .segbtn[data-v="条幅"]').classList.contains('on'));
  panelSet('#segLayout', '条幅'); // 切回条幅

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

  // 7. 集字调整抽屉：目录 / 碑本按钮 / 分段按钮
  const drawer = document.getElementById('drawer');
  check('抽屉初始是收起的', !drawer.classList.contains('open'));
  document.getElementById('input').value = '上善若水 道法自然';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('btnAdjust').click();
  check('点【集字调整】抽屉滑出', drawer.classList.contains('open'));
  check('样式窗格默认打开', document.querySelector('.dpane[data-key="style"]').classList.contains('on'));

  const menu = document.querySelectorAll('#dmenu .dmi');
  check('目录列出全部 5 项（样式/成册/间距/遮罩/朱笔）', menu.length === 5);
  check('只有"样式"是亮的可用的', menu[0].classList.contains('on') && !menu[0].classList.contains('todo'));
  check('后四项灰着标 todo', menu[1].classList.contains('todo') && menu[4].classList.contains('todo'));
  check('todo 项也有说明，说清排第几', (menu[1].dataset.tip || '').includes('第 2 项'));

  const bkbtns = document.querySelectorAll('#bookSeg .segbtn');
  check('碑本按钮列出 books.json 里登记的两块碑', bkbtns.length === 2);
  check('多宝塔碑（有字）可选且默认选中', bkbtns[0].classList.contains('on') && !bkbtns[0].classList.contains('off'));
  check('颜勤礼碑（未入库）灰着，名字上写明待入库',
    bkbtns[1].classList.contains('off') && bkbtns[1].textContent.includes('待入库'));
  check('颜勤礼碑说明里讲明绝不拿别碑顶上',
    (bkbtns[1].dataset.tip || '').includes('绝不拿别碑'));
  check('详情格只显示选中那块的馆藏', document.getElementById('bookInfo').textContent.includes('西安碑林博物馆藏'));
  check('详情格带珍宝馆原帖链接', document.querySelector('#bookInfo a.bksrc') !== null);
  check('详情格报出入库字数', document.getElementById('bookInfo').textContent.includes('个字形已入库'));

  // 预览窗格跟着抽屉一起开：主区域是改动前，预览是改动后
  check('抽屉打开时预览窗格也滑出',
    document.getElementById('preview').classList.contains('open') &&
    document.body.classList.contains('previewing'));
  check('预览区渲染出同样 8 个字', document.querySelectorAll('#previewStrip img').length === 8);
  check('预览里不挂多版本角标（选字只在主区域做）',
    document.querySelector('#previewStrip .vdot') === null);

  // 12. 草稿机制：改设置不立刻作用到主区域，只进预览
  document.getElementById('input').value = '上善若水 道法自然';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#segInk .segbtn[data-v="red"]').click();
  check('改了字色，主区域不跟着变（仍是改动前）', !document.getElementById('mainPaper').classList.contains('ink-red'));
  check('预览里已经变成朱砂', document.getElementById('previewPaper').classList.contains('ink-red'));
  check('抽屉底部提示"有改动还没应用"', document.getElementById('dfnote').classList.contains('on'));
  check('【集字调整】按钮上标出未应用', document.getElementById('btnAdjust').classList.contains('dirty'));

  document.getElementById('btnCancel').click();
  check('【放弃】后预览回到墨色',
    !document.getElementById('previewPaper').classList.contains('ink-red'));
  check('【放弃】后不再提示未应用', !document.getElementById('dfnote').classList.contains('on'));

  document.querySelector('#segInk .segbtn[data-v="red"]').click();
  document.getElementById('btnApply').click();
  check('【应用改动】后主区域才变朱砂', document.getElementById('mainPaper').classList.contains('ink-red'));
  check('应用后预览和主区域一致',
    document.getElementById('previewPaper').classList.contains('ink-red'));

  // 13. 落款 / 印章：两个独立开关
  check('落款默认开着，主区域有落款行', document.getElementById('credit').textContent.includes('集字'));
  document.querySelector('#segTail .segbtn[data-v="credit"]').click();
  check('关掉落款，预览里就不画了', document.getElementById('previewCredit').style.display === 'none');
  check('主区域的落款还在（改动没应用）', document.getElementById('credit').style.display !== 'none');
  document.getElementById('btnApply').click();
  check('应用后主区域落款才真的消失', document.getElementById('credit').style.display === 'none');

  document.querySelector('#segTail .segbtn[data-v="seal"]').click();
  document.getElementById('btnApply').click();
  check('关掉印章，主区域印章隐藏', document.getElementById('seal').style.display === 'none');
  document.querySelector('#segTail .segbtn[data-v="seal"]').click();
  document.querySelector('#segTail .segbtn[data-v="credit"]').click();
  document.getElementById('btnApply').click();
  check('两个开关各自独立，能分别开回来',
    document.getElementById('seal').style.display !== 'none' &&
    document.getElementById('credit').style.display !== 'none');

  // 14. 印章管线：默认用内置的，也能换成自己上传的
  check('默认没有自定义印章', window.sealImage === null);
  check('印章预览格标着"默认「集字」印"',
    document.getElementById('sealPrevTxt').textContent.includes('集字') &&
    document.getElementById('sealPrevImg').classList.contains('empty'));
  check('印章上传入口存在且不外传（type=file，本机处理）',
    document.getElementById('sealFile').type === 'file');
  check('去白底强度滑杆有默认值', document.getElementById('sealThr').value === '235');

  // 放大：长对联时把预览铺满整块屏幕，左右两栏并排——改动前 / 改动后
  document.querySelector('#segInk .segbtn[data-v="ink"]').click();
  document.getElementById('btnApply').click();                        // 先把主区域恢复成墨色
  document.querySelector('#segInk .segbtn[data-v="red"]').click();   // 只改草稿，不应用
  document.getElementById('btnZoom').click();
  check('点【放大】切到全屏对比',
    document.body.classList.contains('zoomed') &&
    document.getElementById('pbody').classList.contains('side'));
  check('放大后左边多出"改动前"一栏，同样渲染出 8 个字',
    document.querySelectorAll('#beforeStrip img').length === 8);
  check('改动前那一栏还是墨色（改动没应用）',
    !document.getElementById('beforePaper').classList.contains('ink-red'));
  check('改动后那一栏已经是朱砂',
    document.getElementById('previewPaper').classList.contains('ink-red'));
  document.getElementById('btnCancel').click();
  document.getElementById('btnZoom').click();
  check('再点还原', !document.body.classList.contains('zoomed'));

  document.getElementById('drawerClose').click();
  check('【收起】能关掉抽屉', !drawer.classList.contains('open'));
  check('收起抽屉时预览窗格一起收', !document.getElementById('preview').classList.contains('open'));

  // 收起后未应用的改动要保留（关了再开还在）
  document.getElementById('btnAdjust').click();
  document.querySelector('#segLayout .segbtn[data-v="对联"]').click();
  document.getElementById('drawerClose').click();
  check('关掉面板不会丢掉没应用的改动', window.isDirty());
  document.getElementById('btnCancel').click();
  document.getElementById('drawerClose').click();

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

  // 9b. 版本面板里的写法缩略图也跟着字色走（挑写法时看到的得和主区域一致）
  document.getElementById('input').value = '之';
  window.render();
  strip.querySelector('.glyph .vdot').click();
  const vitem0 = document.getElementById('vGrid').querySelector('.vitem');
  check('每个写法缩略图都挂着遮罩图（--gimg）',
    (vitem0.style.getPropertyValue('--gimg') || '').startsWith('url('));
  panelSet('#segInk', 'red');
  check('朱砂模式下版本面板也挂 ink-red', document.getElementById('versions').classList.contains('ink-red'));
  panelSet('#segInk', 'ink');
  check('切回墨色，版本面板的 ink-red 也摘掉',
    !document.getElementById('versions').classList.contains('ink-red'));
  window.closeVersions();
  document.getElementById('input').value = '上善若水 道法自然';
  window.render();
  }

  // 10. 红线：颜勤礼碑还没录数据，切过去必须如实留空，
  //     绝不能拿多宝塔碑的字顶上（否则用户会以为是颜体）
  window.state.book = 'yql';   // dbt -> yql（未入库，卡片是灰的，直接切状态）
  window.render();
  document.getElementById('input').value = '上善若水';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  check('颜勤礼碑无数据时全部如实留空',
    strip.querySelectorAll('.glyph.missing').length === 4 &&
    strip.querySelectorAll('img').length === 0);
  check('颜勤礼碑下也不挂多版本角标', strip.querySelector('.vdot') === null);
  window.state.book = 'dbt';   // 切回多宝塔碑
  window.syncPanel();
  window.render();

  // 11. 三种样式：墨色 / 朱砂 / 原图
  //     字形图是「透明底 + 单色墨」，颜色事后给——所以三种样式不额外存任何图
  document.getElementById('input').value = '上善若水 道法自然';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));

  const segInk = (v) => document.querySelector('#segInk .segbtn[data-v="' + v + '"]');
  // 现在改设置走草稿：选完必须点【应用改动】，主区域才真的变
  const useInk = (v) => {
    document.getElementById('btnAdjust').click();
    segInk(v).click();
    document.getElementById('btnApply').click();
    document.getElementById('drawerClose').click();
  };

  useInk('ink');
  check('字色点亮「墨色」', segInk('ink').classList.contains('on'));
  check('每个字形盒都挂着遮罩图（--gimg）',
    Array.from(strip.querySelectorAll('.glyph')).every((b) => (b.style.getPropertyValue('--gimg') || '').startsWith('url(')));

  useInk('red');
  check('选「朱砂」并应用，body 挂 ink-red', document.getElementById('mainPaper').classList.contains('ink-red'));
  check('朱砂点亮、墨色熄灭', segInk('red').classList.contains('on') && !segInk('ink').classList.contains('on'));
  check('朱砂态下字形仍在（只是换了颜色）', strip.querySelectorAll('img').length === 8);

  useInk('rub');
  check('选「原图」并应用，body 挂 ink-rub', document.getElementById('mainPaper').classList.contains('ink-rub'));
  check('原图态不会同时挂 ink-red', !document.getElementById('mainPaper').classList.contains('ink-red'));

  useInk('ink');
  check('选回「墨色」，两个样式类都清掉',
    !document.getElementById('mainPaper').classList.contains('ink-red') &&
    !document.getElementById('mainPaper').classList.contains('ink-rub'));
  check('样式切换不影响字本身', strip.querySelectorAll('img').length === 8);

  // 15. 回归：字色不许互相污染（白星 2026-10-25 报的 bug）
  //     当时的根因：字色挂在 body 上，--ink 是继承属性、.paper 反色规则也会命中预览那张纸，
  //     于是主区域应用过的颜色渗进预览——"选墨色没变化""选朱砂变黑底蓝字"。
  //     现在的规矩：字色只上在各自的 .paper 上，主区域和预览各管各的。
  check('字色规则不写在 body 上（写在 body 会渗进预览窗格）', !/body\.ink-/.test(css));

  const mainPaper = document.getElementById('mainPaper');
  const pvPaper = document.getElementById('previewPaper');
  const ensureDrawer = () => {
    if (!document.getElementById('drawer').classList.contains('open')) {
      document.getElementById('btnAdjust').click();
    }
  };
  const pickInk = (v) => { ensureDrawer(); segInk(v).click(); };   // 只改草稿，不应用

  // 主区域已应用朱砂，再在预览里改选别的颜色
  useInk('red');
  pickInk('ink');
  check('主区域朱砂 + 预览选墨色：预览两个类都清掉',
    !pvPaper.classList.contains('ink-red') && !pvPaper.classList.contains('ink-rub'));
  check('主区域朱砂 + 预览选墨色：主区域仍是朱砂（改动前不动）',
    mainPaper.classList.contains('ink-red') && !mainPaper.classList.contains('ink-rub'));
  check('字色绝不上到 body（这是污染预览的根源）',
    !document.body.classList.contains('ink-red') && !document.body.classList.contains('ink-rub'));

  pickInk('rub');
  check('主区域朱砂 + 预览选原图：预览只上 ink-rub，不叠加 ink-red',
    pvPaper.classList.contains('ink-rub') && !pvPaper.classList.contains('ink-red'));

  document.getElementById('btnCancel').click();
  document.getElementById('drawerClose').click();

  // 反过来：主区域是原图，预览里选朱砂——以前正是"黑底蓝字"那一下
  useInk('rub');
  pickInk('red');
  check('主区域原图 + 预览选朱砂：预览只上 ink-red，不带原图的反色',
    pvPaper.classList.contains('ink-red') && !pvPaper.classList.contains('ink-rub'));
  check('主区域原图 + 预览选朱砂：主区域仍是原图',
    mainPaper.classList.contains('ink-rub') && !mainPaper.classList.contains('ink-red'));

  pickInk('ink');
  check('主区域原图 + 预览选墨色：预览两个类都清掉',
    !pvPaper.classList.contains('ink-red') && !pvPaper.classList.contains('ink-rub'));

  document.getElementById('btnCancel').click();
  document.getElementById('drawerClose').click();
  useInk('ink');
} catch (e) {
  fail++;
  console.log('  ✗ 执行异常: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
