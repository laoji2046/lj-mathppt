(async function () {
  const m = await import('/src/stores/deck.ts');
  const s = m.useDeckStore();
  const out = {};

  // 前置：确保不在组内编辑态，且整组选中
  s.exitGroup();
  const frames = Array.from(document.querySelectorAll('.el-frame'));
  out.frameCount = frames.length;

  // 取组内第 2 个元素对应的 DOM，派发真实 dblclick
  const target = frames[1];
  if (!target) return JSON.stringify({ err: '找不到 .el-frame' });
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await new Promise(function (r) { setTimeout(r, 300); });

  out.afterDblClick_editing = !!s.editingGroupId;
  out.afterDblClick_selected = s.selectionCount;

  // 提示条是否出现
  await new Promise(function (r) { setTimeout(r, 200); });
  out.tipVisible = !!document.querySelector('.grp-tip');

  // 点提示条的「退出组合编辑」按钮
  const btn = document.querySelector('.grp-tip__btn');
  out.exitBtnFound = !!btn;
  if (btn) {
    btn.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    out.afterExitBtn_editing = !!s.editingGroupId;
    out.afterExitBtn_selected = s.selectionCount;
    out.tipGone = !document.querySelector('.grp-tip');
  }
  return JSON.stringify(out);
})()
