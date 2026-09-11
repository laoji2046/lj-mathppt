(async function () {
  const btns = Array.from(document.querySelectorAll('button'));
  const paperBtn = btns.find(function (b) { return /试卷|讲义/.test(b.textContent || ''); });
  if (paperBtn) paperBtn.click();
  await new Promise(function (r) { setTimeout(r, 1500); });

  const tas = Array.from(document.querySelectorAll('textarea'));
  const info = {
    modalOpen: !!document.querySelector('.pm, .pm__input, [class*="paper"]'),
    textareaCount: tas.length,
    textareaClasses: tas.map(function (t) { return t.className; }),
    allImgs: document.querySelectorAll('img').length,
    paperImgs: document.querySelectorAll('[class*="paper"] img').length,
    bodyHasPaper: document.body.innerHTML.indexOf('paper-') >= 0
  };
  return JSON.stringify(info);
})()
