(async function () {
  const m = await import('/src/stores/deck.ts');
  const s = m.useDeckStore();
  const els = s.currentSlide.elements.filter(function (e) { return e.groupId; });
  if (els.length) {
    s.enterGroup(els[0].id);
    // 给组内第 2 个元素换个显眼颜色，直观展示「组内单独改」
    s.selectElement(els[1].id, false);
    s.updateElement(els[1].id, { fill: '#7c3aed' });
    s.selectElement(els[1].id, false);
  }
  await new Promise(function (r) { setTimeout(r, 500); });
  return 'entered group, tip shown';
})()
