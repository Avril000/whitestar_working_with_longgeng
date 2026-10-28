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

  // 2b. 映射要"挑库里真有的那一个"：表里第一候选是繁体、碑上写的却是简体时，
  //     不能因为只取第一候选就把明明有的字判成缺字（静 → 表里是「靜」，碑上是「静」）
  document.getElementById('input').value = '静';
  window.render();
  check('库里存的是简体就取简体（「静」不被映射成「靜」而误判缺字）',
    strip.querySelectorAll('img').length === 1);

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
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
  document.getElementById('btnAdjust').click();
  check('点【集字调整】抽屉滑出', drawer.classList.contains('open'));
  check('样式窗格默认打开', document.querySelector('.dpane[data-key="style"]').classList.contains('on'));

  const menu = document.querySelectorAll('#dmenu .dmi');
  check('目录列出全部 6 项（样式/成册/间距/遮罩/朱笔/借字）', menu.length === 6);
  check('只有"样式"是亮的可用的', menu[0].classList.contains('on') && !menu[0].classList.contains('todo'));
  check('六项全部做完，目录里没有灰着的了',
    Array.from(menu).length === 6 &&
    Array.from(menu).every(b => !b.classList.contains('todo')));

  const bkbtns = document.querySelectorAll('#bookSeg .segbtn');
  check('碑本按钮列出 books.json 里登记的两块碑', bkbtns.length === 2);
  check('多宝塔碑（有字）可选且默认选中', bkbtns[0].classList.contains('on') && !bkbtns[0].classList.contains('off'));
  // 2026-10-26：颜勤礼碑的卡片收回来、跑完收卡片管线，按钮自己亮了（前端一行没改）
  check('颜勤礼碑入库后自己亮起来（不灰、不再标待入库）',
    !bkbtns[1].classList.contains('off') && !bkbtns[1].textContent.includes('待入库'));
  check('可点的碑本说明里报出这一块入库了几个字形',
    (bkbtns[1].dataset.tip || '').includes('个字形'));
  check('没录字的碑才灰着：库里没有第三种碑可冒充',
    Array.from(bkbtns).every(b => !b.classList.contains('off')));
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
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
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
  // ⚠️ by_char 是跨碑的大索引（之 在两块碑里合计 57 个），
  //    角标上写的必须是**当前这块碑**里的写法数——别的碑有也不许拿来用。
  const nZhi = window.versionsOf('之', 'dbt').length;
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
  // 存下 = 主区域这个字现在用的就是挑的那版（不再查 localStorage，见下）
  check('【再想想】但改动确实存下了',
    strip.querySelector('.glyph').dataset.gid === wantGid);

  // 【选好了】：拍板，角标变绿
  strip.querySelector('.glyph .vdot').click();
  check('再点角标能重新展开', vpanel.classList.contains('open'));
  document.getElementById('vConfirm').click();
  check('【选好了】收起面板', !vpanel.classList.contains('open'));
  vd = strip.querySelector('.glyph .vdot');
  check('【选好了】后角标变绿', vd.classList.contains('picked'));
  check('【选好了】拍板的就是当前用的那版',
    strip.querySelector('.glyph').dataset.gid === wantGid);

  // 换了版本就该摘掉"已拍板"，避免绿点挂在一个已经不是它的版本上
  strip.querySelector('.glyph .vdot').click();
  document.getElementById('vGrid').querySelectorAll('.vitem')[5].click();
  document.getElementById('vConfirm').click();
  check('改选后重新确认，用上的就是新挑的那版',
    strip.querySelector('.glyph').dataset.gid === window.DATA.by_char['之'][5]);

  // 2026-10-25 改：挑的写法只在**当前这句话**里算数，不再写进 localStorage。
  // 以前跨句子沿用，【道可道非常道】挑的写法会莫名其妙带进【道法不同】。
  check('挑的写法不再落盘（换句子、关网页都回到自动避复）',
    fakeStore.getItem('glyph_pick_v1') === null &&
    fakeStore.getItem('glyph_pick_ok_v1') === null);
  document.getElementById('input').value = '道法不同';
  window.render();
  const daoBox = strip.querySelector('.glyph');
  check('换一句话，不再沿用上一句挑的写法（回到自动避复）',
    daoBox.dataset.gid !== wantGid &&
    !daoBox.querySelector('.vdot').classList.contains('tentative'));
  document.getElementById('input').value = '之';
  window.render();

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
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
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
  // 遮罩上场后，同字同形不能用虚线框了——格子里本来就有辅助线，会打架
  check('同字同形的两格各挂一枚红色感叹号角标',
    strip.querySelectorAll('.glyph.dup .warnsign').length === 2);
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

  // 16. 成册界行：开关 / 方向 / 颜色 / 粗细。它是叠在排版之上的一层
  const menu2 = document.querySelectorAll('#dmenu .dmi');
  check('目录里「成册」已经做完，不再是灰的', !menu2[1].classList.contains('todo'));

  document.getElementById('input').value = '上善若水 道法自然';
  window.render();
  check('默认不画界行', !strip.classList.contains('ruled'));

  const segR = (id, v) => document.querySelector('#' + id + ' .segbtn[data-v="' + v + '"]');
  document.getElementById('btnAdjust').click();
  segR('segRuled', 'on').click();
  check('草稿里打开界行，主区域不动', !strip.classList.contains('ruled'));
  check('预览里已经画上界行',
    document.getElementById('previewStrip').classList.contains('ruled'));
  check('默认竖排（不挂 heng）',
    !document.getElementById('previewStrip').classList.contains('heng'));

  segR('segRuleDir', '横').click();
  check('切成横排，预览挂上 heng',
    document.getElementById('previewStrip').classList.contains('heng'));

  // 线色线宽挂在**纸**上（strip 和外框的伪元素都要用），不挂在 strip 上
  const pvPaper2 = document.getElementById('previewPaper');
  segR('segRuleColor', 'ink').click();
  check('墨色界行：--rule 换成墨色',
    pvPaper2.style.getPropertyValue('--rule').indexOf('58, 54, 48') >= 0);
  segR('segRuleColor', 'red').click();
  check('朱砂界行：--rule 换回朱砂',
    pvPaper2.style.getPropertyValue('--rule').indexOf('158, 61, 50') >= 0);

  segR('segRuleWidth', '粗').click();
  check('粗细三档：粗 = 3px',
    pvPaper2.style.getPropertyValue('--rule-w') === '3px');
  segR('segRuleWidth', '细').click();
  check('粗细三档：细 = 1px',
    pvPaper2.style.getPropertyValue('--rule-w') === '1px');

  segR('segRuleDir', '竖').click();   // 回到竖排：对联是竖排的概念
  document.getElementById('btnApply').click();
  check('应用后主区域也画上界行', strip.classList.contains('ruled'));
  check('界行是叠加层：对联排版照样能用', (() => {
    panelSet('#segLayout', '对联');
    const ok = strip.classList.contains('duilian') && strip.classList.contains('ruled');
    panelSet('#segLayout', '条幅');
    return ok;
  })());

  /* 界行线的方向必须跟着排列方向走：界行是「行与行之间的分界线」，
     必然和字的走向垂直——竖排（成列）配竖线，横排（成行）配横线。
     线的"厚度"方向就是区分点：竖线 width=线宽，横线 height=线宽。 */
  const mpDeco = document.getElementById('mainPaper');
  segR('segRuleDir', '横').click();
  document.getElementById('btnApply').click();
  check('横排：字从右到左成行（挂 heng，且不再加 duilian）',
    strip.classList.contains('heng') && !strip.classList.contains('duilian'));
  const hl = mpDeco.querySelectorAll('.rule-v');
  check('横排的界行是横线：每段上下各一条（1 段 = 2 条）',
    hl.length === 2 && hl[0].style.height === '1px');
  segR('segRuleDir', '竖').click();
  document.getElementById('btnApply').click();
  const vl = mpDeco.querySelectorAll('.rule-v');
  check('竖排的界行是竖线：每段左右各一条（1 段 = 2 条）',
    vl.length === 2 && vl[0].style.width === '1px');

  // 外框（版框）：关 / 单边 / 文武（一粗一细）。**只框字区**，落款在框外下方
  const mainPaper2 = document.getElementById('mainPaper');
  const pf = () => mainPaper2.querySelectorAll('.pframe');
  check('外框默认是一粗一细的文武框（两条线）',
    pf().length === 2 &&
    mainPaper2.querySelector('.pframe.thick') !== null &&
    mainPaper2.querySelector('.pframe.thin') !== null);
  segR('segFrame', '单边').click();
  document.getElementById('btnApply').click();
  check('单边：只有一条细线',
    pf().length === 1 && mainPaper2.querySelector('.pframe.thin') !== null);
  segR('segFrame', '关').click();
  document.getElementById('btnApply').click();
  check('关：一条框线都没有', pf().length === 0);
  check('外框颜色跟着界行颜色走（--rule 挂在纸上，不是 strip 上）',
    mainPaper2.style.getPropertyValue('--rule').indexOf('158, 61, 50') >= 0);
  segR('segFrame', '文武').click();
  document.getElementById('btnApply').click();

  // 回归：框必须在字格排好版**之后**才画。画早了（刚 innerHTML='' 清空完）
  // 量到的 offsetWidth/Height 是 0，框会缩成一小团贴在纸顶上。
  const allCols = Array.from(mainPaper2.querySelectorAll('.col'));
  const firstFrame = mainPaper2.querySelector('.pframe');
  // 4 = DOCUMENT_POSITION_FOLLOWING（firstFrame 排在最后一个字列之后）
  check('版框排在字格之后（画早了会量到 0 宽高，框缩成一团）',
    allCols.length > 0 && firstFrame !== null &&
    !!(allCols[allCols.length - 1].compareDocumentPosition(firstFrame) & 4));
  // 根治（2026-10-25）：原碑模式**不再反整张纸**——
  // 反整张纸会让纸里每加一样装饰就变蓝一次（框、界行、印章、版本角标…报了四次）。
  // 改成"纸铺黑 + 字给白"，观感一样，纸上的东西一律保持本色。
  const rubPaper = css.match(/\.paper\.ink-rub\s*\{[^}]*\}/);
  check('原碑模式不反整张纸，改成纸铺黑 + 字给白',
    rubPaper !== null && !/filter/.test(rubPaper[0]) &&
    /background:\s*#0A0B0E/.test(rubPaper[0]) && /--ink:/.test(rubPaper[0]));
  check('版框、界行、印章都不再需要反色补丁（留着反而会反成蓝色）',
    !/\.paper\.ink-rub\s+\.(pframe|rule-h|rule-v|seal)\s*\{/.test(css));
  check('版本角标也不需要特殊处理（整纸不反，角标就是本色）',
    !/\.paper\.ink-rub[^{]*\.vdot/.test(css));
  // 版本面板同病（面板里也有朱砂提示：「标红」「另有 N 处已用」）
  const rubVers = css.match(/\.versions\.ink-rub\s*\{[^}]*\}/);
  check('版本面板也不反整幅（改成黑底白字）',
    rubVers !== null && !/filter/.test(rubVers[0]) && /--ink:/.test(rubVers[0]));
  check('面板里的朱砂提示保持本色（撞字的「已用」、说明里的「标红」）',
    !/\.versions\.ink-rub[^{]*\.(warn|dup)/.test(css) &&
    /\.vhint b\.warn\s*\{\s*color:\s*#9E3D32/.test(css));

  // 落款：集字内容单独成行（挤在一行会上下错位，且 canvas 不会自动换行）
  const cr = document.getElementById('credit');
  check('落款分成两行：碑名作者 + 集字内容', cr.textContent.split('\n').length === 2);
  check('第一行是「碑名　作者　集字」', cr.textContent.split('\n')[0].indexOf('集字') >= 0);
  check('第二行集字内容单独占一行',
    cr.textContent.split('\n')[1].indexOf('上善若水 道法自然'.replace(/\s/g, '')) >= 0);
  check('落款保留换行（white-space: pre-line）',
    /pre-line/.test(css.match(/\.credit\s*\{[^}]*\}/)[0]));

  // jsdom 不做布局，offsetWidth/Height 恒为 0，上面只能验 DOM 顺序。
  // 这里给字列打桩造出尺寸，真正验一次"只框字区"的并集算法：
  // 拿 strip 的盒子画会撑满整张纸（桩里给 600），拿字列并集画才是字区（90）。
  const HProto = Object.getPrototypeOf(document.createElement('div'));
  const saved = {};
  ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop'].forEach(function (k) {
    saved[k] = Object.getOwnPropertyDescriptor(HProto, k);
    Object.defineProperty(HProto, k, {
      configurable: true,
      get: function () {
        if (!this.classList || !this.classList.contains('col')) return 0;
        if (k === 'offsetWidth') return 90;
        if (k === 'offsetHeight') return 180;
        if (k === 'offsetTop') return 0;
        var p = this.parentNode;
        return p ? Array.prototype.indexOf.call(p.children, this) * 120 : 0;
      }
    });
  });
  segR('segFrame', '关').click();
  document.getElementById('btnApply').click();
  segR('segFrame', '文武').click();
  document.getElementById('btnApply').click();
  const thinF = mainPaper2.querySelector('.pframe.thin');
  check('框按字列并集定位，不是按整条 strip（拿 strip 会撑满纸宽）',
    thinF !== null && thinF.style.width === '106px' && thinF.style.left === '-8px');
  check('框的高度同样取自字列（上下各留 8px）',
    thinF !== null && thinF.style.height === '196px' && thinF.style.top === '-8px');

  // 竖界：改成 JS 画的独立元素（原来是字列的 border，会被整纸反色带成蓝色）
  segR('segRuled', 'on').click();
  segR('segRuleDir', '竖').click();
  segR('segRuleWidth', '细').click();
  document.getElementById('btnApply').click();
  const vs = mainPaper2.querySelectorAll('.rule-v');
  check('竖界是独立元素，每列左右各一条',
    vs.length === mainPaper2.querySelectorAll('.col').length * 2 && vs.length > 0);
  check('竖界线按字列的实际盒子定位（细 = 1px，贴在列的外沿）',
    vs.length > 0 && vs[0].style.width === '1px' && vs[0].style.left === '0px' &&
    vs[0].style.height === '180px');
  check('竖界不再画在字列的 border 上（border 会跟着整纸 invert）',
    !/border-(left|right)/.test(css.match(/\.strip\.ruled\s+\.col\s*\{[^}]*\}/)[0]));
  check('被标注的格子在原碑模式下也给了深色底（浅底在黑纸上像打补丁）',
    /\.paper\.ink-rub\s+\.glyph\.borrowed/.test(css));
  segR('segRuled', 'off').click();
  document.getElementById('btnApply').click();
  check('关掉界行后竖界线也一并清掉', mainPaper2.querySelectorAll('.rule-v').length === 0);

  ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop'].forEach(function (k) {
    if (saved[k]) Object.defineProperty(HProto, k, saved[k]);
    else delete HProto[k];
  });

  // 收尾：关掉界行，恢复默认，免得影响后面的用例
  segR('segRuled', 'off').click();
  document.getElementById('btnApply').click();
  document.getElementById('drawerClose').click();
  check('关掉界行后主区域不再画线', !strip.classList.contains('ruled'));

  // ===== 第 3 项【间距】：字距 / 行距 / 页边距（三档预设 + 三个滑杆）=====
  const mp = document.getElementById('mainPaper');
  panelSet('#segPreset', '疏');
  check('预设「疏朗」一次设好三项：字距 16 / 行距 52 / 页边距 50',
    mp.style.getPropertyValue('--gg') === '16px' &&
    mp.style.getPropertyValue('--gr') === '52px' &&
    mp.style.getPropertyValue('--ppad-y') === '50px');
  check('页边距左右比上下宽（竖幅该有的样子，1.3 倍）',
    mp.style.getPropertyValue('--ppad-x') === '65px');
  panelSet('#segPreset', '紧');
  check('预设「紧凑」：字距 3 / 行距 20 / 页边距 20',
    mp.style.getPropertyValue('--gg') === '3px' &&
    mp.style.getPropertyValue('--gr') === '20px' &&
    mp.style.getPropertyValue('--ppad-y') === '20px');
  panelSet('#segPreset', '中');
  check('预设「适中」回到默认 8 / 34 / 34',
    mp.style.getPropertyValue('--gg') === '8px' &&
    mp.style.getPropertyValue('--gr') === '34px' &&
    mp.style.getPropertyValue('--ppad-y') === '34px');

  // 滑杆微调：拖动时改的是预览，应用后主区域才动；微调过预设就不再高亮
  document.getElementById('btnAdjust').click();
  const pvSpace = document.getElementById('previewPaper');
  const rngGap = document.getElementById('rngGap');
  rngGap.value = '12';
  rngGap.dispatchEvent(new window.Event('input'));
  check('拖字距滑杆，数值那一项立刻更新',
    document.getElementById('valGap').textContent === '12 px');
  check('微调过之后三档预设都不再高亮（宁可不高亮，也不骗人）',
    Array.from(document.querySelectorAll('#segPreset .segbtn'))
      .every(b => !b.classList.contains('on')));
  check('滑杆改的是预览，主区域还是改动前',
    pvSpace.style.getPropertyValue('--gg') === '12px' &&
    mp.style.getPropertyValue('--gg') === '8px');
  document.getElementById('btnApply').click();
  check('应用改动之后主区域才跟着变', mp.style.getPropertyValue('--gg') === '12px');
  panelSet('#segPreset', '中');
  document.getElementById('drawerClose').click();

  // 导出必须和屏幕一致：不再写死常量，按字格比例换算（屏幕 76 → 导出 160）
  check('导出不写死间距，改成按字格比例换算',
    /var K = SIZE \/ 76/.test(appJs) && /PADX/.test(appJs) && !/var PAD = /.test(appJs));
  check('导出的间距按字格比例换算（以前列间距写死 GAP*2，和屏幕差一倍）',
    /var gapX = heng \? GAPT : ROWG/.test(appJs) && !/GAP \* 2/.test(appJs));
  // 版框的四条边必须由 cellAt 推出，不许另外手算：
  // 手算漏过一次 SIZE（写成 (nX-1)*gapX），横排时框直接飞到纸右边（白星 2026-10-25 报的）
  check('导出的版框边界由 cellAt 推导，不手算',
    /var bL = cellAt\(nX - 1, 0\)\.x/.test(appJs) &&
    !/bL = W - PADX - SIZE - \(nX - 1\) \* gapX/.test(appJs));

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

  // 10. 第二块碑（颜勤礼碑 2026-10-26 入库）：碑本切换走一遍真的，
  //     再双向验红线——两块碑各成一套，谁也不许拿谁的字顶。
  const setInput = (s) => {
    document.getElementById('input').value = s;
    document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
    window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
    window.render();
  };
  const setBook = (i) => {
    document.getElementById('btnAdjust').click();
    document.querySelectorAll('#bookSeg .segbtn')[i].click();
    document.getElementById('btnApply').click();
    document.getElementById('drawerClose').click();
  };

  setBook(1);
  check('点了颜勤礼碑，按钮自己变选中',
    document.querySelectorAll('#bookSeg .segbtn')[1].classList.contains('on'));
  check('切换后底部状态栏报「颜勤礼碑」',
    document.getElementById('srcInfo').textContent.includes('颜勤礼碑'));

  setInput('江');
  check('颜勤礼碑模式下出的是颜勤礼碑的字（江 只有这块碑有）',
    strip.querySelectorAll('img').length === 1 &&
    /^y/.test(strip.querySelector('.glyph').dataset.gid || ''));

  setBook(0);
  setInput('江');
  check('多宝塔碑没有「江」，如实留空（不拿颜勤礼碑的字顶）',
    strip.querySelectorAll('img').length === 0 &&
    strip.querySelectorAll('.glyph.missing').length === 1);

  setInput('静');
  check('多宝塔碑有「静」，正常出图', strip.querySelectorAll('img').length === 1);
  window.state.book = 'yql';
  window.syncPanel();
  setInput('静');
  check('颜勤礼碑没有「静」，也如实留空（反向一样不串碑）',
    strip.querySelectorAll('img').length === 0 &&
    strip.querySelectorAll('.glyph.missing').length === 1);

  window.state.book = 'dbt';   // 切回多宝塔碑
  window.syncPanel();
  setInput('上善若水 道法自然');

  // 10b. 借字（2026-10-27）：三档开关 + 借了必须认得出来
  const setBorrow = (v) => {
    document.getElementById('btnAdjust').click();
    document.querySelector('#segBorrow .segbtn[data-v="' + v + '"]').click();
    document.getElementById('btnApply').click();
    document.getElementById('drawerClose').click();
  };
  const toggleBookCb = (on) => {
    document.getElementById('btnAdjust').click();
    const cb = document.querySelector('#borrowBooks input[type="checkbox"]');
    cb.checked = on;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
    document.getElementById('btnApply').click();
    document.getElementById('drawerClose').click();
  };

  setInput('江');
  check('默认不借：多宝塔碑没有「江」就如实留空',
    strip.querySelectorAll('img').length === 0 &&
    strip.querySelectorAll('.glyph.missing').length === 1);

  document.getElementById('btnAdjust').click();
  check('可借的碑里没有当前底本自己',
    document.querySelectorAll('#borrowBooks input').length === 1 &&
    !Array.from(document.querySelectorAll('#borrowBooks label'))
      .some(l => l.textContent.includes('多宝塔')));
  document.getElementById('drawerClose').click();

  setBorrow('fill');
  setInput('江');
  check('补缺档：碑里没有的「江」从别碑借来了', strip.querySelectorAll('img').length === 1);
  const borBox = strip.querySelector('.glyph');
  check('借来的字标了 borrowed（朱砂虚线框 + 角标）',
    borBox && borBox.classList.contains('borrowed'));
  check('借的确实是别的碑的字（不是本碑自己的）',
    borBox && /^y/.test(borBox.dataset.gid || ''));
  check('悬停说明写明这是借来的、出自哪块碑',
    (borBox.dataset.tip || '').includes('借') &&
    (borBox.dataset.tip || '').includes('颜勤礼'));
  check('状态栏如实报出借了字',
    document.getElementById('stateInfo').textContent.includes('借'));

  toggleBookCb(false);
  setInput('江');
  check('把唯一可借的碑勾掉后，「江」又如实留空（没的借就不造）',
    strip.querySelectorAll('img').length === 0 &&
    strip.querySelectorAll('.glyph.missing').length === 1);
  toggleBookCb(true);

  setBorrow('mix');
  setInput('山');
  const nMix = window.versionsInBook('山', 'dbt').length + window.versionsInBook('山', 'yql').length;
  check('混搭档：本碑有这个字，也把别碑写法并进来',
    parseInt(strip.querySelector('.vdot').textContent, 10) === nMix);
  strip.querySelector('.vdot').click();
  check('版本面板里借来的写法套了虚线标识',
    document.querySelectorAll('#vGrid .vitem.vborrow').length ===
    window.versionsInBook('山', 'yql').length);
  check('版本面板写明借自哪一块碑',
    (document.querySelector('#vGrid .vbfrom') || {}).textContent &&
    document.querySelector('#vGrid .vbfrom').textContent.includes('颜勤礼'));
  window.closeVersions();

  setBorrow('off');
  setInput('山');
  check('切回不借：别碑的写法立刻收回，只剩本碑的',
    parseInt(strip.querySelector('.vdot').textContent, 10) ===
    window.versionsInBook('山', 'dbt').length);

  // 设计稿里标过的两个风险点
  setBorrow('fill');
  setInput('江江');
  const jj = Array.from(strip.querySelectorAll('.glyph')).map(b => b.dataset.gid);
  check('同一个字借来多个写法时，也能自动避复（第 2 个 ≠ 第 1 个）',
    jj.length === 2 && jj[0] && jj[1] && jj[0] !== jj[1]);
  check('借来的两个字都标了 borrowed',
    strip.querySelectorAll('.glyph.borrowed').length === 2);

  setBook(1);   // 切到颜勤礼碑——那里本来就有「江」
  setInput('江');
  const ownBox = strip.querySelector('.glyph');
  check('切到有这个字的碑，「江」变成本碑写法、不再是借来的',
    ownBox && /^y/.test(ownBox.dataset.gid) && !ownBox.classList.contains('borrowed'));
  setBook(0);

  // 白星 2026-10-26 提的那个场景：多宝塔碑里凑「江山如画」
  setInput('江山如画');
  setBorrow('fill');
  setInput('江山如画');
  check('补缺档下「江山如画」在多宝塔碑里凑齐了（只有「江」是借的）',
    strip.querySelectorAll('img').length === 4 &&
    strip.querySelectorAll('.glyph.borrowed').length === 1 &&
    strip.querySelectorAll('.glyph.missing').length === 0);
  setBorrow('off');
  setInput('江山如画');
  check('关掉借字，同一句立刻退回如实留空的老样子',
    strip.querySelectorAll('img').length === 3 &&
    strip.querySelectorAll('.glyph.missing').length === 1);

  /* 10-27 报的 bug：导出时落款的借用说明一个字都没出，红框却画了。
     根因是「是不是借来的」这个判定写了两处，只改了画框那一处，
     收集落款文案那一处还是老的 nature 判定（两块碑 nature 都是「原碑拓本」，永远不成立）。
     所以这里立一条护栏：**这个判定全项目只能有一处**。 */
  const natureChecks = (appJs.match(/nature\s*!==\s*'原碑拓本'/g) || []).length;
  check('「是否借来的」判定全项目只有一处（都在 isBorrowed 里）', natureChecks === 1);
  check('落款的借用说明走的是 isBorrowed，不是老的 nature 判定',
    /isBorrowed\(rec, state\)\s*\)\s*\{\s*borrowLog\.push/.test(appJs));

  /* 编辑时明示，成品时干净（2026-10-27 白星拍板）：
     屏幕上有红框（编辑时看得清哪个是借的），导出一律不画（成品要能拿出去展示）。
     诚实性不靠红框——靠落款那句按碑汇总的借用说明。 */
  check('导出不画借字的红框（成品要能用）',
    !/isBorrowed\(rec, state\)\s*\)\s*\{\s*\n\s*var q/.test(appJs));
  check('借字的出处改由落款那一句担着（红框没了，说明不能没）',
    /drawWrapped\(ctx, borrowSummary\(borrowLog\)/.test(appJs));
  check('屏幕上照样有红框（编辑时要看得清）',
    /box\.classList\.add\('borrowed'\)/.test(appJs));

  // 落款：按碑汇总成一行，不逐字列
  const bs = window.borrowSummary;
  check('落款一句话汇总（只借一块碑时）',
    bs([{ ch: '江', book: 'yql' }, { ch: '書', book: 'yql' }]) === '其中 2 字借自《颜勤礼碑》');
  check('借多块碑也一行写完（不把落款撑成小作文）',
    bs([{ ch: '江', book: 'yql' }, { ch: '山', book: 'yql' }, { ch: '之', book: 'dbt' }]) ===
    '其中 3 字借自《颜勤礼碑》2、《多宝塔碑》1');

  // 「本句用字清单」
  setBorrow('fill');
  setInput('江山如画');
  document.getElementById('btnAdjust').click();
  const blist = document.getElementById('borrowList');
  document.getElementById('borrowTip').click();
  check('点那句活提示能展开本句用字清单', blist.hidden === false);
  check('清单列出这一句的每一个字', blist.querySelectorAll('.brow').length === 4);
  check('清单里借来的那一行写明出自哪块碑',
    Array.from(blist.querySelectorAll('.brow.is-borrow .bfrom'))
      .some(e => e.textContent.includes('借自《颜勤礼碑》')));
  check('清单里本碑的字标明是本碑的（借与本一眼分得开）',
    blist.querySelectorAll('.brow:not(.is-borrow):not(.is-miss)').length === 3);
  document.getElementById('borrowTip').click();
  check('再点一次把清单收起来', blist.hidden === true);
  document.getElementById('drawerClose').click();
  setBorrow('off');

  // 11. 三种样式：墨色 / 朱砂 / 原图
  //     字形图是「透明底 + 单色墨」，颜色事后给——所以三种样式不额外存任何图
  document.getElementById('input').value = '上善若水 道法自然';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地

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

// 面板文案：字色要写明是「全局」的，不然会以为是给某一个字上色（和朱笔混淆）
check('字色标注了「全局」', /字色（全局）/.test(html));
check('字色下面说明了是整幅一起变', /整幅字的颜色/.test(html));

// ===== 纸的宽窄：字不许跑到纸外面（白星 2026-10-25 报的"顶出屏幕"）=====
/* 病根两条，缺一条就复发：
   ① 纸是 flex 子项，最小宽写死成一个比内容小的数，就会被压得比字区还窄 → 字溢出；
   ② 容器居中用普通 center，溢出时左半边被推到滚动区外，看不见也没有滚动条。 */
check('纸的最小宽 = 内容宽（不再写死 190px 把纸压窄）',
  /\.paper\s*\{[\s\S]*?min-width:\s*min-content/.test(css) && !/min-width:\s*190px/.test(css));
check('舞台放不下纸时能横向滚', /\.stage\s*\{[\s\S]*?overflow-x:\s*auto/.test(css));
check('居中用 safe center：溢出时退回左对齐，左半边才滚得到',
  (css.match(/justify-content:\s*safe center/g) || []).length >= 2);

// 纸一变形（开合抽屉改 main 内边距 / 窗口缩放 / 放大对比）版框就得按新坐标重画
check('盯着纸的尺寸变化重画版框（ResizeObserver）', /ResizeObserver/.test(appJs));
check('没有 ResizeObserver 的环境还有 resize 兜底',
  /addEventListener\('resize'/.test(appJs));
check('抽屉开合的过渡结束后再补画一次', /transitionend/.test(appJs));
try {
  const before = document.querySelectorAll('#mainPaper .pframe').length;
  window.dispatchEvent(new window.Event('resize'));
  check('窗口缩放后版框数量不变、没有报错',
    document.querySelectorAll('#mainPaper .pframe').length === before && before > 0);
} catch (e) {
  fail++;
  console.log('  ✗ 缩放重画异常: ' + e.message);
}

// ===== 第 4 项【遮罩】：田字格 / 米字格 / 九宫格 =====
try {
  const mp2 = document.getElementById('mainPaper');
  const pv2 = document.getElementById('previewPaper');
  const menuMask = Array.from(document.querySelectorAll('#dmenu .dmi'))
    .find(b => b.textContent === '遮罩');
  const hasMask = () => /\bmask-(tian|mi|jiu)\b/.test(mp2.className);

  check('目录里【遮罩】已经是可点的（不再灰着）',
    !!menuMask && !menuMask.classList.contains('todo'));
  check('默认不叠遮罩', !hasMask());

  panelSet('#segMask', '田');
  check('选「田字格」并应用：纸挂上 mask-tian', mp2.classList.contains('mask-tian'));
  check('田字格 = 过中心的一横一竖',
    /\.paper\.mask-tian \.glyph::after \{[\s\S]*?50% 0 \/ 1px 100%[\s\S]*?0 50% \/ 100% 1px/.test(css));

  panelSet('#segMask', '米');
  check('换「米字格」：田字格那个 class 摘掉了（三种互斥）',
    mp2.classList.contains('mask-mi') && !mp2.classList.contains('mask-tian'));
  check('米字格比田字格多两条对角线',
    /\.paper\.mask-mi \.glyph::after \{[\s\S]*?to bottom right[\s\S]*?to bottom left/.test(css));

  panelSet('#segMask', '九');
  check('换「九宫格」：井字线，一格分成九块',
    mp2.classList.contains('mask-jiu') && /calc\(200% \/ 3\)/.test(css));

  // 遮罩也走"先预览、后应用"这套
  document.getElementById('btnAdjust').click();
  document.querySelector('#segMask .segbtn[data-v="田"]').click();
  check('改遮罩先只动预览，主区域还是改动前',
    pv2.classList.contains('mask-tian') && !mp2.classList.contains('mask-tian'));
  document.getElementById('btnCancel').click();
  document.getElementById('drawerClose').click();

  panelSet('#segMask', '关');
  check('选「关」：三个遮罩 class 全部清掉', !hasMask());
} catch (e) {
  fail++;
  console.log('  ✗ 遮罩执行异常: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

// 遮罩是辅助线，不是字形：颜色跟着纸走；导出也要画，才能打印出来描
check('遮罩线色挂在纸上（变量 --mask），黑底模式自动换成淡灰白',
  /\.paper \{[\s\S]*?--mask:/.test(css) && /\.paper\.ink-rub \{[\s\S]*?--mask:/.test(css));
check('导出 PNG 里也画遮罩（打印出来能描）', /MASK_CLS\[state\.mask\]/.test(appJs));
check('同字同形不再用虚线框（遮罩一上场会和辅助线打架）',
  /\.glyph\.dup \{[^}]*background/.test(css) && !/\.glyph\.dup \{[^}]*outline/.test(css) &&
  /\.glyph \.warnsign \{/.test(css));
check('遮罩那一项在面板里有说明', /id="segMask"/.test(html) && /辅助线叠在每一个字格上/.test(html));

// ===== 第 5 项【朱笔】：逐字染朱砂标重点 =====
try {
  const stripB = document.getElementById('strip');
  const mp3 = document.getElementById('mainPaper');
  const pv3 = document.getElementById('previewPaper');
  const glyphs = () => Array.from(stripB.querySelectorAll('.glyph:not(.missing)'));

  check('目录里【朱笔】也已经可点',
    Array.from(document.querySelectorAll('#dmenu .dmi'))
      .some(b => b.textContent === '朱笔' && !b.classList.contains('todo')));

  // 默认关着：纸不进"可点"状态，字格也没有可点的标记
  check('默认不进朱笔模式', !mp3.classList.contains('brushing'));

  panelSet('#segBrush', 'on');
  check('开了朱笔：纸进入可点字的状态', mp3.classList.contains('brushing'));
  check('开了朱笔：每个字格都挂上可点标记',
    glyphs().length > 0 && glyphs().every(g => g.classList.contains('pickable')));
  check('开了但还没点：一个字都没染', stripB.querySelectorAll(".glyph.brushed").length === 0);

  /* 换成「之之」这句：同一个字连着出现两次，正好验"逐字"——
     标第 1 个，第 2 个不该跟着变。（键是"碑:字#本句第几次"。） */
  document.getElementById('input').value = '之之';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
  /* ⚠️ render() 会把字格整个重建，所以点完之后必须**重新查**一次 DOM——
     拿着点之前那个元素对象去验，验的是已经被换掉的旧格子。 */
  const brushed = () => glyphs().filter(g => g.classList.contains('brushed'));
  const type = (t) => {
    document.getElementById('input').value = t;
    document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
    window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
  };

  if (glyphs().length === 2) {
    glyphs()[0].click();
    check('点第 1 个「之」，只有它被染成朱砂（逐字，不是整幅）',
      brushed().length === 1 && glyphs()[0].classList.contains('brushed'));
    check('同一个字的另一次出现不受牵连（第 1 个之 ≠ 第 2 个之）',
      !glyphs()[1].classList.contains('brushed'));
    check('预览窗格跟着一起标（同一句、同一套标记）',
      pv3.querySelectorAll('.glyph.brushed').length === 1);
    glyphs()[0].click();
    check('再点一下取消', brushed().length === 0);
    glyphs()[0].click();
    glyphs()[1].click();
    check('两个「之」分别标上', brushed().length === 2);
    check('面板里报出标了几个字',
      document.getElementById('brushTip').textContent.includes('已标 2 个字'));

    document.getElementById('btnBrushClear').click();
    check('【全部取消】一次清空', brushed().length === 0);
  } else {
    check('「之之」要排出两个字格才能验"逐字"', false);
  }

  // 换了句子：上一句标的不作数（和版本选择同一套规矩）
  glyphs()[0].click();
  const before = brushed().length;
  type('道法自然');
  document.getElementById('input').value = '道法自然';
  document.getElementById('input').dispatchEvent(new window.Event('input', { bubbles: true }));
  window.flushPendingRender();   // 输入渲染有防抖，测试里直接落地
  check('换了句子，上一句标的朱笔自动清空（不跟到下一句）',
    before > 0 && brushed().length === 0);
  type('上善若水 道法自然');

  panelSet('#segBrush', 'off');
  check('关掉朱笔：纸退出可点状态', !mp3.classList.contains('brushing'));
} catch (e) {
  fail++;
  console.log('  ✗ 朱笔执行异常: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
}

/* 原碑模式在导出里是**整幅反色**，凡是"标记"（朱砂的、灰的）画在反色之前就会被反成青蓝。
   这一天已经栽了五次——版框 / 界行 / 印章 / 版本角标 / 朱笔 / 缺字框，全是同一个根因。
   所以这里立的不是"朱笔修好了"，而是"以后再加任何标记，也不许画在反色之前"。 */
const PD = appJs.indexOf('function paintDecor()');
const PS = appJs.indexOf('function paintSeal()');
const DIFF = appJs.indexOf("globalCompositeOperation = 'difference'");
const CALL = appJs.lastIndexOf('paintDecor();');
check('反色发生在补画之前（paintDecor / paintSeal 排在反色之后）',
  DIFF > 0 && CALL > DIFF && PD > 0 && PS > PD);
check('朱笔的字排在反色之后画（反色前画，原碑模式会把朱砂反成青蓝）',
  appJs.indexOf('brushJobs.forEach') > PD && appJs.indexOf('brushJobs.forEach') < PS);
check('缺字的虚线框也排在反色之后（灰的被反成深蓝灰，黑纸上看不见）',
  appJs.indexOf('missJobs.forEach') > PD && appJs.indexOf('missJobs.forEach') < PS);
check('字循环里朱笔只登记、不落笔（落笔交给 paintDecor，反色之后）',
  /isBrushed\(ch, cell\.idx, state\.book\)\) \{\s*brushJobs\.push/.test(appJs) &&
  !/isBrushed[\s\S]{0,60}tintImage/.test(appJs));
check('字循环里缺字也只登记、不落笔（虚线框交给 paintDecor）',
  /if \(!im\) \{[\s\S]{0,160}missJobs\.push/.test(appJs) &&
  !/missJobs\.push[\s\S]{0,60}strokeRect/.test(appJs));

// 朱笔的颜色：字形图是遮罩，颜色由 --ink 给，所以换 --ink 就够了，不用另存图
check('朱笔只换这一格的 --ink（不另存图、不重画）', /\.glyph\.brushed \{ --ink:/.test(css));
check('整幅已是朱砂时，朱笔反过来染墨色（不然满纸皆红看不出标了哪个）',
  /\.paper\.ink-red \.glyph\.brushed \{ --ink: #1A1A1A/.test(css));
check('黑底模式用亮一档的朱砂（暗朱砂在黑纸上看不见）',
  /\.paper\.ink-rub \.glyph\.brushed \{ --ink: #C45A48/.test(css));
check('上色的取法和导出 PNG 共用同一个函数（两边必然一致）',
  /function brushInk/.test(appJs) && /brushInk\(state\.ink\)/.test(appJs));
check('缺字的格子不许标朱笔（没有字可染）',
  /if \(cfg\.brushOn\) \{[\s\S]*?isBrushed/.test(appJs) &&
  /box\.classList\.add\('missing'\);[\s\S]*?return box;/.test(appJs));

/* ---------- 印章不压落款 / 提示框贴底翻身 ----------
   两条都是 2026-10-28 小组组会当场报的：
   ① 印章钉死在纸的右下角，落款一长（缺字多、或挂着借字说明）就被压住；
   ② 抽屉最底下那两个按钮（应用改动 / 放弃），说明文字掉到页面外面去了。
   立的同样是"以后别再改回去"的护栏，不是"这次修好了"的行为测试。 */

// ① 页面印章：必须排在落款**之后的正常流**里，落款长它就跟着往下走
const SEAL_AT = css.indexOf('.seal {');
const sealCss = css.slice(SEAL_AT, css.indexOf('.seal::before', SEAL_AT));
check('页面印章排在正常流里（不再 absolute 钉死在纸角上）',
  /position:\s*relative/.test(sealCss) && !/position:\s*absolute/.test(sealCss));
check('页面印章靠右、和落款同一条右边界（margin-left:auto）',
  /margin:\s*12px 0 0 auto/.test(sealCss));
check('印章在 DOM 里排在落款后面（正常流才压得到它下面）',
  html.indexOf('id="credit"') > 0 && html.indexOf('id="credit"') < html.indexOf('id="seal"'));

// 导出那侧：印章不许再被夹回 H - 60——夹回去正好压在落款最后几行上
const psSrc = appJs.slice(PS, PS + 800);
check('导出印章不再夹回画布底部（Math.min(H - 60) 就是压住落款的元凶）',
  !/Math\.min\(H\s*-\s*60/.test(appJs) && /ly \+ used \* LH \+ 12/.test(psSrc));
check('落款太长时画布自动接长（宁可纸高，也不压字）',
  /var needH = ly \+ used \* LH/.test(appJs) && /x2\.drawImage\(c, 0, 0\)/.test(appJs));
check('接长发生在反色之前（不然新长出来那截反不到，会留一条白边）',
  appJs.indexOf('var needH =') > 0 &&
  appJs.indexOf('var needH =') < DIFF && appJs.indexOf('var needH =') < CALL);
check('印章尺寸只写一处（SEAL_S，以前是写死的 40 改一次要改两处）',
  /var SEAL_S = 40;/.test(appJs) &&
  (appJs.match(/drawSeal\(ctx, W - PADX - SEAL_S, ly \+ used \* LH \+ 12, SEAL_S\)/g) || []).length === 1);

// ② 提示框：下方放不下就翻到元素上方
const BT = appJs.indexOf('function bindTooltip()');
const btSrc = appJs.slice(BT, BT + 1200);
check('提示框下方放不下时翻到元素上方（贴窗口底边的按钮不掉出页面）',
  /r\.top\s*-\s*th\s*-\s*8/.test(btSrc));
check('提示框横向也不许出界（按实际宽度夹，不再写死 300）',
  /window\.innerWidth\s*-\s*tw\s*-\s*8/.test(btSrc));
check('量高宽之前先 show（display:none 量出来高宽都是 0）',
  btSrc.indexOf("classList.add('show')") > 0 &&
  btSrc.indexOf("classList.add('show')") < btSrc.indexOf('tip.offsetHeight'));

/* ---------- 简繁反查表 ----------
   2026-10-28 白星在颜勤礼碑输入「书」查不出任何东西，输入「書」却能查出来。
   根因不是某一块碑的对照有问题，是**那张表只手写了演示例句那 12 个字**——
   任何不在这 12 个字里的简体字（书、学、国、龙…）都查不出来。
   现在表改成从库里反推自动生成（tools/build_variants.py），
   并且挑候选时**先按当前这块碑挑**（不然一对多的字会挑到只在别碑有的写法）。 */

const VAR_N = Object.keys(window.DATA.variants || {}).length;
check('反查表不再只有手写那 12 条（全库 1193 个字反推生成）', VAR_N > 100);
check('反查表是自动生成的文件（不是 goals.json 里那 12 条手写表）',
  fs.existsSync(path.join(WEB, '../data/metadata/简繁对照.json')));

check('简体「书」在颜勤礼碑映射到「書」', window.eval("mapChar('书','yql')") === '書');
check('繁体「書」本来就库里有，原样取用', window.eval("mapChar('書','yql')") === '書');
check('简体「书」在颜勤礼碑真的取得到版本', window.eval("versionsInBook('书','yql').length") > 0);
check('别的简体字也通了（学→學、国→國）',
  window.eval("mapChar('学','dbt')") === '學' && window.eval("mapChar('国','dbt')") === '國');

// 端到端：切到颜勤礼碑，输入「书」，不该再是缺字
const bookWas = window.eval('state.book');
window.eval("state.book='yql'");
document.getElementById('input').value = '书';
window.render();
const yqlStrip = document.getElementById('strip');
check('颜勤礼碑输入「书」能出图（就是白星报的那个现象）',
  yqlStrip.querySelectorAll('img').length === 1 && !yqlStrip.querySelector('.glyph.missing'));
window.eval("state.book='" + bookWas + "'");
document.getElementById('input').value = '上善若水 道法自然';
window.render();

/* 一对多的字（「为」→爲/為，「发」→發/髮）：候选里可能有的只在一块碑里有。
   挑的时候必须**先看当前这块碑**，不能按表的顺序盲取第一个——
   取到只在别碑有的那个，本碑照样是缺字。 */
const savedVar = window.eval("window.DATA.variants['书']");
window.eval("window.DATA.variants['书'] = ['西','書']");   // 西 只在多宝塔，書 两块碑都有
check('一对多候选按碑挑：颜勤礼碑跳过只在多宝塔有的「西」',
  window.eval("mapChar('书','yql')") === '書');
check('一对多候选按碑挑：多宝塔碑就用「西」',
  window.eval("mapChar('书','dbt')") === '西');
window.eval("window.DATA.variants['书'] = " + JSON.stringify(savedVar) + ";");
check('挑完要还原，别把表改脏了', window.eval("mapChar('书','yql')") === '書');

check('mapChar 带碑参数（一对多的字要按碑挑，只看全库会挑错）',
  /function mapChar\(ch, book\)/.test(appJs));
check('versionsInBook 把碑传给 mapChar（内核查版本时也要按碑）',
  /by_char \|\| \{\}\)\[mapChar\(ch, book\)\]/.test(appJs));

/* ---------- 输入区：多行 / 放大 / 字数 / 超长兜底 ----------
   2026-10-28 白星提的：有人会输入超长文本。
   ① 输入框要能放大、能滚动；② Enter 也要能当分段符。
   ② 其实**不用写代码**——切分用的是 \s+，本来就含 \n，
      卡点只是单行 input 根本输不进换行符，换成 textarea 就自动通了。 */

const inp = document.getElementById('input');
check('输入框是 textarea（单行 input 吃不下换行符）',
  inp && inp.tagName === 'TEXTAREA');
check('输入框只有一个真源（不许再开一个多行框互相同步）',
  (html.match(/id="input"/g) || []).length === 1);
check('textarea 不许手动拖拽改尺寸（要放大就点按钮，只留一个入口）',
  /#input \{[\s\S]*?resize: none/.test(css));

// 换行 = 空格 = 分段符（对联模式下分几段就排几列）
window.eval("state.layout='对联'");
inp.value = '上善若水\n道法自然';
window.render();
check('换行和空格一样是分段符（对联模式排成两列）',
  document.getElementById('strip').querySelectorAll('.col').length === 2);
window.eval("state.layout='条幅'");
inp.value = '上善若水 道法自然';
window.render();

// 【放大】：就地展开，再点还原
const zoom = document.getElementById('btnInputZoom');
const row = document.getElementById('inputRow');
zoom.click();
check('点【放大】输入框就地展开', row.classList.contains('big'));
check('放大后按钮变成【还原】', zoom.textContent === '还原');
zoom.click();
check('再点一次还原', !row.classList.contains('big') && zoom.textContent === '放大');
check('放大态是固定高度（CSS 里的 .row.big #input），不再跟着内容长',
  /\.row\.big #input \{ height: 240px/.test(css));

// 字数提示：到点之前就打招呼，别等点了导出才撞墙
inp.value = '之'.repeat(30);
window.refreshInput();
check('字数提示报出字数', document.getElementById('lenInfo').textContent.includes('共 30 字'));
inp.value = '之'.repeat(160);
window.refreshInput();
const li = document.getElementById('lenInfo');
check('超过上限：提示 + 标红', li.classList.contains('warn') && li.textContent.includes('超过'));
inp.value = '上善若水 道法自然';
window.refreshInput();

// 超长句子的导出兜底：canvas 超限后 toDataURL **不报错**，只会给一张白图
check('超长句子导出有上限检查（不然画布超限会静默出白图）',
  /MAX_SIDE/.test(appJs) && /超过了浏览器的上限/.test(appJs));
check('尺寸检查排在真正建画布之前（算完就查，不画了才发现）',
  appJs.indexOf('var MAX_SIDE') > 0 &&
  appJs.indexOf('var MAX_SIDE') < appJs.indexOf("document.createElement('canvas')",
                                                appJs.indexOf('var MAX_SIDE')));

// 防抖：长句子每敲一个字全量重画两遍会卡
check('实时渲染有防抖', /setTimeout\(flushPendingRender/.test(appJs));
check('防抖要有 flush 出口（自检是同步的，等不了那 180ms）',
  /function flushPendingRender/.test(appJs));

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
