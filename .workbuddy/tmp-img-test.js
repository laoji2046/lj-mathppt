(async function () {
  const ta = document.querySelector('textarea.pm__input');
  if (!ta) return JSON.stringify({ err: '找不到 pm__input' });

  const md = '# 测试试卷\n\n1. 下图是函数图像，求单调区间。\n\n![图1:float:30%](images/9ti.jpg)\n\n![图2:floatleft:50%](images/4题.jpg)\n';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, md);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 3000); });

  const imgs = Array.from(document.querySelectorAll('.paper-float-img, .paper-img, .paper-img-inline'));
  return JSON.stringify({
    inputLen: ta.value.length,
    imgCount: imgs.length,
    imgs: imgs.map(function (i) {
      return { src: (i.getAttribute('src') || '').slice(0, 70), loaded: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight };
    })
  });
})()
