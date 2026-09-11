(async function () {
  const m = await import('/src/stores/deck.ts');
  const s = m.useDeckStore();
  const out = {};

  // 0. 清场：当前页只留 3 个自建方块
  s.setSelection((s.currentSlide?.elements || []).map(function (e) { return e.id; }));
  s.removeSelected();

  // 1. 造 3 个元素
  for (let i = 0; i < 3; i++) {
    s.addElement('shape', { shape: 'rect', x: 100 + i * 150, y: 200, w: 110, h: 90, fill: '#cccccc' });
  }
  const els = s.currentSlide.elements;
  out.step1_created = els.length;

  // 2. 组合
  s.setSelection(els.map(function (e) { return e.id; }));
  s.groupSelection();
  out.step2_groupIds = els.map(function (e) { return e.groupId ? 'g' : '-'; }).join('');

  // 3. 组合后点其中一个 → 应整组选中（3 个）
  s.selectElement(els[1].id, false);
  out.step3_clickGroupSelectsAll = s.selectionCount;

  // 4. 进入组内编辑
  s.enterGroup(els[1].id);
  out.step4_editingGroup = !!s.editingGroupId;
  out.step4_selectedAfterEnter = s.selectionCount;

  // 5. 组内点同组另一个元素 → 仍只选中 1 个
  s.selectElement(els[2].id, false);
  out.step5_clickSiblingInGroup = s.selectionCount;

  // 6. 组内改属性：只有目标元素变色
  s.selectElement(els[1].id, false);
  s.updateElement(els[1].id, { fill: '#ff0000' });
  const now = s.currentSlide.elements;
  out.step6_colors = now.map(function (e) { return e.fill; }).join(',');

  // 7. 组内点组外元素 → 自动退出 + 整组选中
  s.addElement('shape', { shape: 'rect', x: 600, y: 500, w: 80, h: 80, fill: '#00ff00' });
  const outsider = s.currentSlide.elements.slice(-1)[0];
  s.selectElement(outsider.id, false);
  out.step7_exitOnOutsideClick = !s.editingGroupId;
  out.step7_selectedOutside = s.selectionCount;

  // 8. 再进组内，然后 exitGroup → 整组选中(3)
  s.enterGroup(els[0].id);
  const inAgain = !!s.editingGroupId;
  s.exitGroup();
  out.step8_enterThenExit = inAgain && !s.editingGroupId;
  out.step8_selectedAfterExit = s.selectionCount;

  return JSON.stringify(out);
})()
