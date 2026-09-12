/* solidfit · 线稿自动矢量化：位图 → 顶点 + 边表
 *
 * 流程：二值化 → 连通域分类（挑出字母并抹掉，细长短划成组的留下当虚线）
 *      → Zhang-Suen 细化 → 骨架图 → 追路径 → 去毛刺 → Douglas-Peucker 简化
 *      → 共线短划合并成虚线 → 顶点吸附合并 → 解消十字交叉 → 去重
 *
 * 纯浏览器 JS，无依赖（用 canvas 解 PNG）。结果写进 DOM 供 chrome --dump-dom 取。
 */
'use strict';

function loadImage(src) {
  return new Promise(function (res, rej) {
    var im = new Image();
    im.onload = function () { res(im); };
    im.onerror = rej;
    im.src = src;
  });
}

// ---------- 二值化 ----------
function toInk(img, crop) {
  var W = img.width, H = img.height;
  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  var d = g.getImageData(0, 0, W, H).data;
  var ink = new Uint8Array(W * H);
  var x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (crop) { x0 = crop[0]; y0 = crop[1]; x1 = crop[2]; y1 = crop[3]; }
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      var p = (y * W + x) * 4;
      var lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      if (d[p + 3] > 100 && lum < 150) ink[y * W + x] = 1;
    }
  }
  return { ink: ink, W: W, H: H, box: [x0, y0, x1, y1] };
}

// ---------- 连通域 ----------
function components(ink, W, H, box) {
  var seen = new Uint8Array(W * H);
  var list = [];
  var stack = [];
  for (var y = box[1]; y < box[3]; y++) {
    for (var x = box[0]; x < box[2]; x++) {
      var s = y * W + x;
      if (!ink[s] || seen[s]) continue;
      var comp = { n: 0, x0: x, y0: y, x1: x, y1: y, sx: 0, sy: 0, pix: [] };
      stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        var i = stack.pop();
        var px = i % W, py = (i / W) | 0;
        comp.n++; comp.pix.push(i);
        comp.sx += px; comp.sy += py;
        if (px < comp.x0) comp.x0 = px;
        if (py < comp.y0) comp.y0 = py;
        if (px > comp.x1) comp.x1 = px;
        if (py > comp.y1) comp.y1 = py;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = px + dx, ny = py + dy;
            if (nx < box[0] || ny < box[1] || nx >= box[2] || ny >= box[3]) continue;
            var j = ny * W + nx;
            if (ink[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
          }
        }
      }
      comp.cx = comp.sx / comp.n; comp.cy = comp.sy / comp.n;
      comp.bw = comp.x1 - comp.x0 + 1; comp.bh = comp.y1 - comp.y0 + 1;
      comp.diag = Math.hypot(comp.bw, comp.bh);
      comp.fill = comp.n / (comp.bw * comp.bh);
      list.push(comp);
    }
  }
  return list;
}

/** 用二阶矩求细长块的主轴方向与长度（对角短划也必须算对，不能只看 bbox 长短边） */
function axisOf(c, W) {
  var mxx = 0, mxy = 0, myy = 0, k, x, y, dx, dy;
  for (k = 0; k < c.pix.length; k++) {
    x = c.pix[k] % W; y = (c.pix[k] / W) | 0;
    dx = x - c.cx; dy = y - c.cy;
    mxx += dx * dx; mxy += dx * dy; myy += dy * dy;
  }
  mxx /= c.n; mxy /= c.n; myy /= c.n;
  var th = 0.5 * Math.atan2(2 * mxy, mxx - myy);
  var ux = Math.cos(th), uy = Math.sin(th);
  var minT = 1e9, maxT = -1e9;
  for (k = 0; k < c.pix.length; k++) {
    x = c.pix[k] % W; y = (c.pix[k] / W) | 0;
    var t = (x - c.cx) * ux + (y - c.cy) * uy;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  return { ux: ux, uy: uy, len: maxT - minT };
}

// ---------- 挑字母：细长实心块成组的是虚线短划，孤立的是笔画 ----------
function stripText(comp, W, diag, ink, opt) {
  var smallMax = (opt && opt.textMax) || 0.16;
  var bars = [], texts = [];
  for (var i = 0; i < comp.length; i++) {
    var c = comp[i];
    if (c.diag >= smallMax * diag) continue;   // 大块 = 线网本体，留下
    // 小块：对角短划的 fill 很低，不能用"实心度"区分，只能靠"共线成组"来判定
    var ax = axisOf(c, W);
    c.ux = ax.ux; c.uy = ax.uy; c.len = ax.len;
    bars.push(c);
  }
  var used = new Array(bars.length).fill(false);
  var groups = [];
  for (var a = 0; a < bars.length; a++) {
    if (used[a]) continue;
    var grp = [bars[a]]; used[a] = true;
    var grow = true;
    while (grow) {
      grow = false;
      for (var k = 0; k < bars.length; k++) {
        if (used[k]) continue;
        var B = bars[k];
        for (var g = 0; g < grp.length; g++) {
          var A = grp[g];
          if (Math.abs(A.ux * B.ux + A.uy * B.uy) < 0.985) continue;
          var vx = B.cx - A.cx, vy = B.cy - A.cy;
          var d = Math.hypot(vx, vy);
          if (d > 8 + 6 * Math.max(A.len, B.len)) continue;
          var perp = Math.abs(vx * -A.uy + vy * A.ux);
          if (perp > 4) continue;
          var tB = vx * A.ux + vy * A.uy;
          var need = 0.5 * (A.len + B.len) + 2;
          if (Math.abs(tB) > need + 12) continue;
          grp.push(B); used[k] = true; grow = true; break;
        }
        if (grow) break;
      }
    }
    if (grp.length >= 3) groups.push(grp);
    else for (var q = 0; q < grp.length; q++) texts.push(grp[q]);
  }
  var out = ink.slice();
  for (var t = 0; t < texts.length; t++) {
    var cc = texts[t];
    for (var p = 0; p < cc.pix.length; p++) out[cc.pix[p]] = 0;
  }
  var anchors = texts.map(function (c2) { return { x: c2.cx, y: c2.cy, w: c2.bw, h: c2.bh, n: c2.n }; });
  return { ink: out, anchors: anchors, dashGroups: groups.length, barCount: bars.length, textCount: texts.length };
}

// ---------- Zhang-Suen 细化 ----------
function thin(src, W, H) {
  var w = W + 2, h = H + 2;
  var img = new Uint8Array(w * h);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) img[(y + 1) * w + (x + 1)] = src[y * W + x];
  var changed = true, guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    for (var step = 0; step < 2; step++) {
      var del = [];
      for (var yy = 1; yy < h - 1; yy++) {
        for (var xx = 1; xx < w - 1; xx++) {
          var i = yy * w + xx;
          if (!img[i]) continue;
          var p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1],
              p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1];
          var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          var seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          var A = 0;
          for (var q = 0; q < 8; q++) if (seq[q] === 0 && seq[q + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
          del.push(i);
        }
      }
      if (del.length) { changed = true; for (var d2 = 0; d2 < del.length; d2++) img[del[d2]] = 0; }
    }
  }
  var out = new Uint8Array(W * H);
  for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) out[y2 * W + x2] = img[(y2 + 1) * w + (x2 + 1)];
  return out;
}

// ---------- 骨架 → 节点 + 路径 ----------
/** p 的 8 邻域按"彼此 8 相邻"分组；有几组 = 骨架在这里有几条岔路。
 *  不做这一步，浅斜率的粗线细化后会留下一堆"台阶三邻点"，被当成岔路口，一条直线被切成十几段。 */
function groupNeighbors(N, W) {
  var n = N.length, seen = [], out = [], i, j;
  for (i = 0; i < n; i++) seen.push(false);
  for (i = 0; i < n; i++) {
    if (seen[i]) continue;
    var stack = [i], grp = [];
    seen[i] = true;
    while (stack.length) {
      var k = stack.pop();
      grp.push(N[k]);
      var ax = N[k] % W, ay = (N[k] / W) | 0;
      for (j = 0; j < n; j++) {
        if (seen[j]) continue;
        var bx = N[j] % W, by = (N[j] / W) | 0;
        if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) { seen[j] = true; stack.push(j); }
      }
    }
    out.push(grp);
  }
  return out;
}

function buildGraph(sk, W, H) {
  function nbrs(i) {
    var x = i % W, y = (i / W) | 0, a = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var j = ny * W + nx;
      if (sk[j]) a.push(j);
    }
    return a;
  }
  var pix = [];
  for (var i = 0; i < W * H; i++) if (sk[i]) pix.push(i);
  // 岔路判定用"交叉数"（8 邻域绕一圈 0→1 的次数）：路径点恒为 2，
  // 端点 1、三岔 3。用"邻域分组数"是错的——斜线的台阶点（W 与 S 互为 8 邻）会被算成 1 组，
  // 于是整条斜线每个台阶都被当成岔路口，一条直线被切成十几段。
  function crossNum(p) {
    var x = p % W, y = (p / W) | 0;
    var s = [0, 0, 0, 0, 0, 0, 0, 0];
    var dxs = [0, 1, 1, 1, 0, -1, -1, -1], dys = [-1, -1, 0, 1, 1, 1, 0, -1];
    for (var q = 0; q < 8; q++) {
      var xx = x + dxs[q], yy = y + dys[q];
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (sk[yy * W + xx]) s[q] = 1;
    }
    var a = 0;
    for (var q2 = 0; q2 < 8; q2++) if (s[q2] === 0 && s[(q2 + 1) % 8] === 1) a++;
    return a;
  }
  var isNode = new Uint8Array(W * H);
  for (var k = 0; k < pix.length; k++) if (crossNum(pix[k]) !== 2) isNode[pix[k]] = 1;
  var nodeId = new Int32Array(W * H).fill(-1);
  var nodes = [];
  for (var a = 0; a < pix.length; a++) {
    var s = pix[a];
    if (!isNode[s] || nodeId[s] >= 0) continue;
    var id = nodes.length, stack = [s], members = [];
    nodeId[s] = id;
    while (stack.length) {
      var j2 = stack.pop(); members.push(j2);
      var nb2 = nbrs(j2);
      for (var b = 0; b < nb2.length; b++) {
        if (isNode[nb2[b]] && nodeId[nb2[b]] < 0) { nodeId[nb2[b]] = id; stack.push(nb2[b]); }
      }
    }
    var sx = 0, sy = 0;
    for (var m = 0; m < members.length; m++) { sx += members[m] % W; sy += (members[m] / W) | 0; }
    nodes.push({ cx: sx / members.length, cy: sy / members.length });
  }
  var usedPix = new Uint8Array(W * H);
  function nextPixel(cur, prev) {
    var gs = groupNeighbors(nbrs(cur), W);
    var gi = -1, i2, k2, q;
    for (i2 = 0; i2 < gs.length; i2++) {
      for (k2 = 0; k2 < gs[i2].length; k2++) if (gs[i2][k2] === prev) gi = i2;
    }
    for (i2 = 0; i2 < gs.length; i2++) {           // 优先走"另一组"
      if (i2 === gi) continue;
      for (k2 = 0; k2 < gs[i2].length; k2++) { q = gs[i2][k2]; if (!usedPix[q]) return q; }
    }
    if (gi >= 0) {                                  // 没有别的组：骨架在这里有 2px 宽，接着走
      for (k2 = 0; k2 < gs[gi].length; k2++) { q = gs[gi][k2]; if (q !== prev && !usedPix[q]) return q; }
    }
    return -1;
  }
  var paths = [];
  for (var s2 = 0; s2 < pix.length; s2++) {
    var start = pix[s2];
    if (!isNode[start]) continue;
    var nb3 = groupNeighbors(nbrs(start), W);
    for (var n = 0; n < nb3.length; n++) {
      var first = -1;
      for (var nk = 0; nk < nb3[n].length; nk++) if (!usedPix[nb3[n][nk]]) { first = nb3[n][nk]; break; }
      if (first < 0 || isNode[first]) continue;
      var pts = [start], prev = start, cur = first, guard = 0;
      usedPix[first] = 1;
      while (guard++ < 500000) {
        pts.push(cur);
        if (isNode[cur]) break;
        var nx2 = nextPixel(cur, prev);
        if (nx2 < 0) break;
        usedPix[nx2] = 1; prev = cur; cur = nx2;
      }
      var lastPix = pts[pts.length - 1];
      var xy = [];
      for (var p = 0; p < pts.length; p++) xy.push([pts[p] % W, (pts[p] / W) | 0]);
      paths.push({ pts: xy, aId: nodeId[pts[0]], bId: isNode[lastPix] ? nodeId[lastPix] : -1 });
    }
  }
  // 只有"引出 >= 2 条路径"的节点才算顶点；度 1 的节点是自由端（短划的端头、线的断头）
  var stubs = new Int32Array(nodes.length);
  for (var sp = 0; sp < paths.length; sp++) { stubs[paths[sp].aId]++; if (paths[sp].bId >= 0) stubs[paths[sp].bId]++; }
  for (var pp = 0; pp < paths.length; pp++) {
    if (paths[pp].aId >= 0 && stubs[paths[pp].aId] < 2) paths[pp].aId = -1;
    if (paths[pp].bId >= 0 && stubs[paths[pp].bId] < 2) paths[pp].bId = -1;
  }
  return { nodes: nodes, paths: paths, stubs: stubs };
}

// ---------- Douglas-Peucker ----------
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  function dist(p, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1];
    var len2 = vx * vx + vy * vy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
  }
  var keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  var stack = [[0, pts.length - 1]];
  while (stack.length) {
    var seg = stack.pop(), i0 = seg[0], i1 = seg[1], best = -1, bd = eps;
    for (var i = i0 + 1; i < i1; i++) { var dd = dist(pts[i], pts[i0], pts[i1]); if (dd > bd) { bd = dd; best = i; } }
    if (best > 0) { keep[best] = 1; stack.push([i0, best]); stack.push([best, i1]); }
  }
  var out = [];
  for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
  return out;
}

function plen(pts) {
  var L = 0;
  for (var i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}

// ---------- 主流程 ----------
function vectorizeImage(img, opt) {
  opt = opt || {};
  var m = toInk(img, opt.crop);
  var W = m.W, H = m.H, box = m.box;
  var diag = Math.hypot(box[2] - box[0], box[3] - box[1]);
  var comp = components(m.ink, W, H, box);
  var st = stripText(comp, W, diag, m.ink, opt);
  var sk = thin(st.ink, W, H);
  var G = buildGraph(sk, W, H);

  // 去毛刺：一端是节点、另一端悬空、且很短的路径（细化在斜线拐角处会留小刺）
  var spur = opt.spur || 6;
  var paths = G.paths.filter(function (P) {
    var freeA = P.aId < 0, freeB = P.bId < 0;
    if (freeA && freeB) return true;                 // 短划，保留
    if (!freeA && !freeB) return true;               // 节点间，保留
    return plen(P.pts) > spur;
  });

  // 路径 → 直线段
  var segs = [];
  for (var i = 0; i < paths.length; i++) {
    var P = paths[i];
    if (P.pts.length < 2) continue;
    var poly = rdp(P.pts, opt.eps || 2.2);
    for (var k = 0; k < poly.length - 1; k++) {
      var a = poly[k], b = poly[k + 1];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 2) continue;
      segs.push({
        a: a, b: b, len: len,
        aId: (k === 0) ? P.aId : -1,
        bId: (k === poly.length - 2) ? P.bId : -1,
      });
    }
  }

  // 虚线：两端悬空的短段按共线连成链
  var maxPiece = (opt.pieceMax || 0.115) * diag;
  function linkOK(A, B) {
    var ux = A.b[0] - A.a[0], uy = A.b[1] - A.a[1];
    var ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    var vx = B.b[0] - B.a[0], vy = B.b[1] - B.a[1];
    var vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
    if (Math.abs(ux * vx + uy * vy) < 0.985) return false;
    function perp(p) { return Math.abs((p[0] - A.a[0]) * -uy + (p[1] - A.a[1]) * ux); }
    if (perp(B.a) > 4 || perp(B.b) > 4) return false;
    function along(p) { return (p[0] - A.a[0]) * ux + (p[1] - A.a[1]) * uy; }
    var b0 = along(B.a), b1 = along(B.b);
    var lo = Math.min(b0, b1), hi = Math.max(b0, b1);
    var gap = Math.max(0 - hi, lo - ul);
    return gap <= Math.max(20, 3.5 * Math.max(ul, vl));
  }
  var freeIdx = [], fixedSegs = [];
  for (var s = 0; s < segs.length; s++) {
    if (segs[s].aId < 0 && segs[s].bId < 0 && segs[s].len <= maxPiece) freeIdx.push(s);
    else fixedSegs.push(segs[s]);
  }
  var usedS = new Array(freeIdx.length).fill(false);
  var chains = [], leftover = [];
  for (var f = 0; f < freeIdx.length; f++) {
    if (usedS[f]) continue;
    var chain = [segs[freeIdx[f]]]; usedS[f] = true;
    var grow = true;
    while (grow) {
      grow = false;
      for (var g = 0; g < freeIdx.length; g++) {
        if (usedS[g]) continue;
        var B = segs[freeIdx[g]];
        for (var c = 0; c < chain.length; c++) {
          if (linkOK(chain[c], B) || linkOK(B, chain[c])) { chain.push(B); usedS[g] = true; grow = true; break; }
        }
        if (grow) break;
      }
    }
    if (chain.length >= 2) chains.push(chain); else leftover.push(chain[0]);
  }

  var edges = [];
  function push(id0, id1, a, b, dash) { edges.push({ aId: id0, bId: id1, a: a, b: b, dash: dash }); }
  for (var fx = 0; fx < fixedSegs.length; fx++) push(fixedSegs[fx].aId, fixedSegs[fx].bId, fixedSegs[fx].a, fixedSegs[fx].b, 0);
  for (var lf = 0; lf < leftover.length; lf++) push(-1, -1, leftover[lf].a, leftover[lf].b, 0);
  for (var ch = 0; ch < chains.length; ch++) {
    var C = chains[ch];
    var ux = C[0].b[0] - C[0].a[0], uy = C[0].b[1] - C[0].a[1];
    var ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    var base = C[0].a, best0 = null, best1 = null, minT = 1e9, maxT = -1e9;
    for (var e = 0; e < C.length; e++) {
      var two = [C[e].a, C[e].b];
      for (var q = 0; q < 2; q++) {
        var t = (two[q][0] - base[0]) * ux + (two[q][1] - base[1]) * uy;
        if (t < minT) { minT = t; best0 = two[q]; }
        if (t > maxT) { maxT = t; best1 = two[q]; }
      }
    }
    push(-1, -1, best0, best1, 1);
  }

  // 顶点
  var verts = [];
  var nodeVert = new Int32Array(G.nodes.length).fill(-1);
  for (var ni = 0; ni < G.nodes.length; ni++) {
    if (G.stubs[ni] < 2) continue;                 // 自由端不算顶点，靠坐标吸附决定归属
    nodeVert[ni] = verts.length;
    verts.push({ x: G.nodes[ni].cx, y: G.nodes[ni].cy });
  }
  var snapR = opt.snapR || 14;
  function nearest(x, y, r) {
    var bi = -1, bd = r;
    for (var i2 = 0; i2 < verts.length; i2++) {
      var d = Math.hypot(verts[i2].x - x, verts[i2].y - y);
      if (d < bd) { bd = d; bi = i2; }
    }
    return bi;
  }
  function addV(x, y) { verts.push({ x: x, y: y }); return verts.length - 1; }
  var outEdges = [];
  for (var ei = 0; ei < edges.length; ei++) {
    var E = edges[ei];
    var ai = E.aId >= 0 ? nodeVert[E.aId] : nearest(E.a[0], E.a[1], snapR);
    if (ai < 0) ai = addV(E.a[0], E.a[1]);
    var bi = E.bId >= 0 ? nodeVert[E.bId] : nearest(E.b[0], E.b[1], snapR);
    if (bi < 0) bi = addV(E.b[0], E.b[1]);
    if (ai === bi) continue;
    if (Math.hypot(verts[ai].x - verts[bi].x, verts[ai].y - verts[bi].y) < 4) continue;
    outEdges.push([ai, bi, E.dash]);
  }

  function mergeVerts(r) {
    var again = true;
    while (again) {
      again = false;
      outer:
      for (var i3 = 0; i3 < verts.length; i3++) {
        for (var j3 = i3 + 1; j3 < verts.length; j3++) {
          if (Math.hypot(verts[i3].x - verts[j3].x, verts[i3].y - verts[j3].y) < r) {
            verts[i3].x = (verts[i3].x + verts[j3].x) / 2;
            verts[i3].y = (verts[i3].y + verts[j3].y) / 2;
            for (var e3 = 0; e3 < outEdges.length; e3++) {
              if (outEdges[e3][0] === j3) outEdges[e3][0] = i3;
              if (outEdges[e3][1] === j3) outEdges[e3][1] = i3;
            }
            verts.splice(j3, 1);
            // 删掉一个顶点后，比它大的下标全要前移，否则边会指到不存在的顶点上
            for (var e8 = 0; e8 < outEdges.length; e8++) {
              if (outEdges[e8][0] > j3) outEdges[e8][0]--;
              if (outEdges[e8][1] > j3) outEdges[e8][1]--;
            }
            again = true; break outer;
          }
        }
      }
    }
  }
  function dedupe() {
    var seenE = {}, out = [];
    for (var e4 = 0; e4 < outEdges.length; e4++) {
      var E4 = outEdges[e4];
      if (E4[0] === E4[1]) continue;
      var key = Math.min(E4[0], E4[1]) + '_' + Math.max(E4[0], E4[1]);
      if (seenE[key] !== undefined) { if (E4[2] === 0) out[seenE[key]][2] = 0; continue; }
      seenE[key] = out.length;
      out.push([E4[0], E4[1], E4[2]]);
    }
    outEdges = out;
  }
  mergeVerts(opt.mergeR || 8);
  dedupe();

  // 解消十字交叉：度为 4 且两两反向共线的节点不是顶点
  var again2 = true, guard2 = 0;
  while (again2 && guard2++ < 200) {
    again2 = false;
    var inc = verts.map(function () { return []; });
    for (var e5 = 0; e5 < outEdges.length; e5++) { inc[outEdges[e5][0]].push(e5); inc[outEdges[e5][1]].push(e5); }
    for (var v = 0; v < verts.length; v++) {
      if (inc[v].length !== 4) continue;
      var dirs = inc[v].map(function (ei2) {
        var E2 = outEdges[ei2];
        var o = E2[0] === v ? E2[1] : E2[0];
        var dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y;
        var L = Math.hypot(dx, dy) || 1;
        return { ei: ei2, o: o, dx: dx / L, dy: dy / L };
      });
      var pairs = [], used2 = [false, false, false, false], okAll = true;
      for (var a1 = 0; a1 < 4; a1++) {
        if (used2[a1]) continue;
        var found = -1;
        for (var b1 = a1 + 1; b1 < 4; b1++) {
          if (used2[b1]) continue;
          if (dirs[a1].dx * dirs[b1].dx + dirs[a1].dy * dirs[b1].dy < -0.97) { found = b1; break; }
        }
        if (found < 0) { okAll = false; break; }
        used2[a1] = used2[found] = true;
        pairs.push([dirs[a1], dirs[found]]);
      }
      if (!okAll) continue;
      var dropSet = {}, add = [];
      for (var pi = 0; pi < pairs.length; pi++) {
        var p1 = pairs[pi][0], p2 = pairs[pi][1];
        dropSet[p1.ei] = 1; dropSet[p2.ei] = 1;
        add.push([p1.o, p2.o, (outEdges[p1.ei][2] || outEdges[p2.ei][2]) ? 1 : 0]);
      }
      var kept = [];
      for (var e6 = 0; e6 < outEdges.length; e6++) if (!dropSet[e6]) kept.push(outEdges[e6].slice());
      for (var ad = 0; ad < add.length; ad++) kept.push(add[ad]);
      outEdges = kept;
      verts.splice(v, 1);
      for (var e7 = 0; e7 < outEdges.length; e7++) {
        if (outEdges[e7][0] > v) outEdges[e7][0]--;
        if (outEdges[e7][1] > v) outEdges[e7][1]--;
      }
      again2 = true;
      break;
    }
  }
  dedupe();
  mergeVerts(opt.mergeR || 8);
  dedupe();

  // 虚线的短划天然够不到交点（差着一两个划的间距），沿自身方向往外延长，吸附到近旁的顶点上
  function extendDashed() {
    for (var i = 0; i < outEdges.length; i++) {
      if (!outEdges[i][2]) continue;
      var A = verts[outEdges[i][0]], B = verts[outEdges[i][1]];
      var dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      var na = findAlong(A, -dx, -dy), nb = findAlong(B, dx, dy);
      if (na >= 0 && na !== outEdges[i][1]) outEdges[i][0] = na;
      if (nb >= 0 && nb !== outEdges[i][0]) outEdges[i][1] = nb;
      if (outEdges[i][0] === outEdges[i][1]) outEdges[i][2] = -1;   // 标废，稍后 dedupe 去掉
    }
    var keep = [];
    for (var k = 0; k < outEdges.length; k++) if (outEdges[k][2] !== -1) keep.push(outEdges[k]);
    outEdges = keep;
  }
  function findAlong(p, dx, dy) {
    var r = opt.extendR || 72, i;
    var deg = new Array(verts.length).fill(0);
    for (i = 0; i < outEdges.length; i++) { deg[outEdges[i][0]]++; deg[outEdges[i][1]]++; }
    var best = -1, bestJ = -1, bd = 1e9, bdJ = 1e9;
    for (i = 0; i < verts.length; i++) {
      var vx = verts[i].x - p.x, vy = verts[i].y - p.y;
      var d = Math.hypot(vx, vy);
      if (d < 3 || d > r) continue;
      if ((vx / d) * dx + (vy / d) * dy < 0.90) continue;   // 偏离方向 25° 以上不要
      // 岔路口（度 >= 2）比"上一条短划的断头"更可能是这条虚线真正的落点
      if (deg[i] >= 2) { if (d < bdJ) { bdJ = d; bestJ = i; } }
      else if (d < bd) { bd = d; best = i; }
    }
    return bestJ >= 0 ? bestJ : best;
  }

  // 度 2 且几乎在一条直线上的顶点 = 直线被切出来的假顶点，合并掉它两侧的边
  function collinearSimplify() {
    var again = true, guard = 0;
    while (again && guard++ < 500) {
      again = false;
      var inc2 = verts.map(function () { return []; });
      for (var i = 0; i < outEdges.length; i++) { inc2[outEdges[i][0]].push(i); inc2[outEdges[i][1]].push(i); }
      for (var v = 0; v < verts.length; v++) {
        if (inc2[v].length !== 2) continue;
        var e1 = outEdges[inc2[v][0]], e2 = outEdges[inc2[v][1]];
        var a = e1[0] === v ? e1[1] : e1[0];
        var b = e2[0] === v ? e2[1] : e2[0];
        if (a === b) continue;
        var ux = verts[v].x - verts[a].x, uy = verts[v].y - verts[a].y;
        var wx = verts[b].x - verts[v].x, wy = verts[b].y - verts[v].y;
        var lu = Math.hypot(ux, uy) || 1, lw = Math.hypot(wx, wy) || 1;
        if ((ux / lu) * (wx / lw) + (uy / lu) * (wy / lw) < 0.995) continue;  // 真有转折，保留
        var dash = (e1[2] && e2[2]) ? 1 : 0;
        var kept = [];
        for (var k = 0; k < outEdges.length; k++) if (k !== inc2[v][0] && k !== inc2[v][1]) kept.push(outEdges[k].slice());
        kept.push([a, b, dash]);
        outEdges = kept;
        verts.splice(v, 1);
        for (var k2 = 0; k2 < outEdges.length; k2++) {
          if (outEdges[k2][0] > v) outEdges[k2][0]--;
          if (outEdges[k2][1] > v) outEdges[k2][1]--;
        }
        again = true;
        break;
      }
    }
  }

  // 过短的边：两端其实是一个点（粗细线上的一点小结构），收缩成一个顶点
  function contractShort(maxLen) {
    var again = true, guard = 0;
    while (again && guard++ < 300) {
      again = false;
      for (var i = 0; i < outEdges.length; i++) {
        var E = outEdges[i];
        var A2 = verts[E[0]], B2 = verts[E[1]];
        if (Math.hypot(A2.x - B2.x, A2.y - B2.y) > maxLen) continue;
        A2.x = (A2.x + B2.x) / 2; A2.y = (A2.y + B2.y) / 2;
        var j = E[1], kk = E[0], m;
        for (m = 0; m < outEdges.length; m++) {
          if (outEdges[m][0] === j) outEdges[m][0] = kk;
          if (outEdges[m][1] === j) outEdges[m][1] = kk;
        }
        verts.splice(j, 1);
        for (m = 0; m < outEdges.length; m++) {
          if (outEdges[m][0] > j) outEdges[m][0]--;
          if (outEdges[m][1] > j) outEdges[m][1]--;
        }
        dedupe();
        again = true;
        break;
      }
    }
  }
  function dropIsolated() {
    var used = new Array(verts.length).fill(false);
    for (var i = 0; i < outEdges.length; i++) { used[outEdges[i][0]] = true; used[outEdges[i][1]] = true; }
    for (var v = verts.length - 1; v >= 0; v--) {
      if (used[v]) continue;
      verts.splice(v, 1);
      for (var m = 0; m < outEdges.length; m++) {
        if (outEdges[m][0] > v) outEdges[m][0]--;
        if (outEdges[m][1] > v) outEdges[m][1]--;
      }
    }
  }

  // 交点精修：粗线在拐角处细化后，骨架的"角"会往里缩一圈（实测偏 2%~3%，十几二十像素）。
  // 用交于该点的各条边的直线做最小二乘求交，把顶点推回真正的角上。
  // 把 (x,y) 吸附到最近的骨架像素，用来取"边上真正的点"
  function snapSkel(x, y) {
    var bx = x, by = y, bd = 1e9;
    var x0 = Math.max(0, Math.round(x) - 7), x1 = Math.min(W - 1, Math.round(x) + 7);
    var y0 = Math.max(0, Math.round(y) - 7), y1 = Math.min(H - 1, Math.round(y) + 7);
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        if (!sk[yy * W + xx]) continue;
        var d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
        if (d < bd) { bd = d; bx = xx; by = yy; }
      }
    }
    return bd < 64 ? [bx, by] : null;
  }
  // 交点精修：粗线在拐角处细化后，骨架的"角"会往里缩一圈（实测偏 2%~3%，十几二十像素）。
  // 用交于该点的各条边的直线做最小二乘求交，把顶点推回真正的角上。
  // 边的直线取"边上两个真实骨架点"来定方向——不能用两个顶点，那两条线必然过当前顶点，白算。
  function refineCorners(maxMove) {
    for (var it = 0; it < 4; it++) {
      var inc3 = verts.map(function () { return []; });
      for (var i = 0; i < outEdges.length; i++) {
        inc3[outEdges[i][0]].push(outEdges[i][1]);
        inc3[outEdges[i][1]].push(outEdges[i][0]);
      }
      var moved = false;
      for (var v = 0; v < verts.length; v++) {
        if (inc3[v].length < 2) continue;
        var a = 0, bb = 0, c = 0, rx = 0, ry = 0, used = 0, k;
        for (k = 0; k < inc3[v].length; k++) {
          var o = inc3[v][k];
          var dx = verts[o].x - verts[v].x, dy = verts[o].y - verts[v].y;
          var L = Math.hypot(dx, dy);
          if (L < 10) continue;
          var p1 = snapSkel(verts[v].x + dx * 0.35, verts[v].y + dy * 0.35);
          var p2 = snapSkel(verts[v].x + dx * 0.7, verts[v].y + dy * 0.7);
          var ux, uy, px, py;
          if (p1 && p2 && Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > 3) {
            ux = p2[0] - p1[0]; uy = p2[1] - p1[1];
            var ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
            px = p1[0]; py = p1[1];
          } else {
            ux = dx / L; uy = dy / L; px = verts[o].x; py = verts[o].y;
          }
          var nx2 = -uy, ny2 = ux;                        // 边的法向
          a += nx2 * nx2; bb += nx2 * ny2; c += ny2 * ny2;
          var dot = nx2 * px + ny2 * py;
          rx += nx2 * dot; ry += ny2 * dot;
          used++;
        }
        if (used < 2) continue;
        var det = a * c - bb * bb;
        if (Math.abs(det) < 1e-9) continue;
        var X = (c * rx - bb * ry) / det;
        var Y = (a * ry - bb * rx) / det;
        var ddx = X - verts[v].x, ddy = Y - verts[v].y;
        var dd = Math.hypot(ddx, ddy);
        if (dd < 0.4) continue;
        if (dd > maxMove) { ddx *= maxMove / dd; ddy *= maxMove / dd; }
        verts[v].x += ddx; verts[v].y += ddy;
        moved = true;
      }
      if (!moved) break;
    }
  }

  extendDashed();
  collinearSimplify();
  contractShort((opt.short || 0.035) * diag);
  mergeVerts(opt.mergeR || 8);
  dropIsolated();
  dedupe();
  refineCorners((opt.refine || 0.03) * diag);
  dropIsolated();
  dedupe();

  var pts = [];
  for (var vv = 0; vv < verts.length; vv++) {
    pts.push(+((verts[vv].x - box[0]) / (box[2] - box[0])).toFixed(4));
    pts.push(+((verts[vv].y - box[1]) / (box[3] - box[1])).toFixed(4));
  }
  var anchors = st.anchors.map(function (an) {
    return { x: +((an.x - box[0]) / (box[2] - box[0])).toFixed(4), y: +((an.y - box[1]) / (box[3] - box[1])).toFixed(4) };
  });
  var dashN = 0;
  for (var dn = 0; dn < outEdges.length; dn++) if (outEdges[dn][2]) dashN++;
  return {
    W: box[2] - box[0], H: box[3] - box[1],
    points: pts, edges: outEdges, anchors: anchors,
    stats: { verts: verts.length, edges: outEdges.length, dash: dashN, text: st.textCount, bars: st.barCount, dashGroups: st.dashGroups },
  };
}

window.solidfit = {
  loadImage: loadImage, vectorizeImage: vectorizeImage,
  // 调试用
  toInk: toInk, components: components, stripText: stripText, thin: thin, buildGraph: buildGraph, rdp: rdp,
};