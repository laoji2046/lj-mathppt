/**
 * 3D 立体图嵌入（v1436）—— 用户拍的方案：**three.js 懒加载 + AI 生成场景 + 拖=转场景**
 *
 * 设计要点（都是本次讨论定下来的）：
 * 1. **离线**：three 打包成 `public/three/three.iife.js`（726KB，只有 3D 嵌入的 iframe 才会去取 → 不进启动包 ✓）
 * 2. **安全**：AI 只能产出**数据化场景描述**（下面的 Scene3D），**绝不让模型产出可执行代码** ✗
 *    iframe 里是个小解释器：看得懂的字段才画，看不懂的忽略 ✓
 * 3. **交互**：拖=转场景；**按住 Ctrl/空格 拖 = 交给父页面移动元素**（用 postMessage 把位移发出去 ✓）
 *    —— iframe 自己是 `pointer-events:auto`（否则收不到拖拽 ✓），所以"移动元素"这件事必须由它转发给父页面 ✓
 */

/** 场景里能画的物体（**数据**，不是代码 ✓） */
export type Scene3DObject =
  | { kind: 'box'; size?: number[]; at?: number[]; color?: string; edges?: boolean }
  | { kind: 'sphere'; r?: number; at?: number[]; color?: string; wire?: boolean }
  | { kind: 'cylinder'; r?: number; h?: number; at?: number[]; color?: string; edges?: boolean }
  | { kind: 'cone'; r?: number; h?: number; at?: number[]; color?: string; edges?: boolean }
  | { kind: 'plane'; size?: number[]; at?: number[]; rot?: number[]; color?: string; opacity?: number }
  | { kind: 'line'; from: number[]; to: number[]; color?: string }
  | { kind: 'point'; at: number[]; label?: string; color?: string }

export interface Scene3D {
  /** 标题（画在左上角，可空） */
  title?: string
  /** 显示坐标轴 + 网格（教学常用 ✓ 默认开） */
  axis?: boolean
  /** 自动缓慢旋转（默认开，看着就知道是 3D ✓） */
  spin?: boolean
  /** 相机距离（默认 6） */
  dist?: number
  objects: Scene3DObject[]
}

/** 默认场景：正方体 + 三条坐标轴（插进来就能转，第一眼就知道能用 ✓） */
export function default3DScene(): Scene3D {
  return {
    title: '正方体（拖动旋转）',
    axis: true,
    spin: true,
    dist: 6,
    objects: [{ kind: 'box', size: [2, 2, 2], at: [0, 0, 1], color: '#5b8ff9', edges: true }],
  }
}

/** 生成嵌入用的自包含 HTML（`threeSrc` 默认走 app 根路径 → 打包后能取到 public/three ✓；
 *  单测/截图时传相对路径即可，因为本地文件里 `/three/...` 会解析到磁盘根 ✗） */
export function applet3dHtml(spec: Scene3D, opt?: { threeSrc?: string; height?: string }): string {
  const src = opt?.threeSrc || '/three/three.iife.js'
  const data = JSON.stringify(spec).replace(/</g, '\\u003c')   // 防止 </script> 之类把 HTML 撕开
  const js = [
    'var SPEC = ' + data + ';',
    'var host = document.getElementById("h");',
    'var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });',
    'renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));',
    'host.appendChild(renderer.domElement);',
    'var scene = new THREE.Scene();',
    'var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);',
    'var dist = SPEC.dist || 6, yaw = -0.6, pitch = 0.5;',
    'function place() {',
    '  var r = dist, cp = Math.cos(pitch);',
    '  camera.position.set(r * cp * Math.sin(yaw), r * Math.sin(pitch), r * cp * Math.cos(yaw));',
    '  camera.lookAt(0, 0, 0.6);',
    '}',
    'place();',
    'scene.add(new THREE.AmbientLight(0xffffff, 0.75));',
    'var d1 = new THREE.DirectionalLight(0xffffff, 0.9); d1.position.set(4, 8, 6); scene.add(d1);',
    'var d2 = new THREE.DirectionalLight(0xffffff, 0.35); d2.position.set(-6, -4, -6); scene.add(d2);',
    'function V(a, d) { return new THREE.Vector3(a ? a[0] : d, a ? a[1] : 0, a ? a[2] : 0); }',
    'function addEdges(g, color) {',
    '  var e = new THREE.EdgesGeometry(g);',
    '  scene.add(new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color: color || 0x1a1a1a })));',
    '}',
    'function add(o) {',
    '  var col = o.color || "#5b8ff9";',
    '  var at = o.at || [0, 0, 0];',
    '  if (o.kind === "box") {',
    '    var s = o.size || [1, 1, 1];',
    '    var g = new THREE.BoxGeometry(s[0], s[1], s[2]);',
    '    var m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.55 }));',
    '    m.position.set(at[0], at[1], at[2]); scene.add(m);',
    '    if (o.edges !== false) { var e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x1a1a1a })); e.position.copy(m.position); scene.add(e); }',
    '  } else if (o.kind === "sphere") {',
    '    var g2 = new THREE.SphereGeometry(o.r || 1, 32, 20);',
    '    var m2 = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ color: col, wireframe: !!o.wire, transparent: !o.wire, opacity: 0.6 }));',
    '    m2.position.set(at[0], at[1], at[2]); scene.add(m2);',
    '  } else if (o.kind === "cylinder" || o.kind === "cone") {',
    '    var g3 = o.kind === "cylinder" ? new THREE.CylinderGeometry(o.r || 1, o.r || 1, o.h || 2, 40) : new THREE.ConeGeometry(o.r || 1, o.h || 2, 40);',
    '    var m3 = new THREE.Mesh(g3, new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: 0.55 }));',
    '    m3.position.set(at[0], at[1] + (o.h || 2) / 2, at[2]); scene.add(m3);',
    '    if (o.edges !== false) { var e3 = new THREE.LineSegments(new THREE.EdgesGeometry(g3), new THREE.LineBasicMaterial({ color: 0x1a1a1a })); e3.position.copy(m3.position); scene.add(e3); }',
    '  } else if (o.kind === "plane") {',
    '    var s2 = o.size || [3, 3];',
    '    var g4 = new THREE.PlaneGeometry(s2[0], s2[1]);',
    '    var m4 = new THREE.Mesh(g4, new THREE.MeshLambertMaterial({ color: col, transparent: true, opacity: o.opacity == null ? 0.35 : o.opacity, side: THREE.DoubleSide }));',
    '    m4.position.set(at[0], at[1], at[2]);',
    '    if (o.rot) m4.rotation.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0);',
    '    scene.add(m4);',
    '  } else if (o.kind === "line") {',
    '    var gm = new THREE.BufferGeometry().setFromPoints([V(o.from), V(o.to)]);',
    '    scene.add(new THREE.Line(gm, new THREE.LineBasicMaterial({ color: o.color || 0xc0392b })));',
    '  } else if (o.kind === "point") {',
    '    var p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: o.color || 0xc0392b }));',
    '    p.position.set(at[0], at[1], at[2]); scene.add(p);',
    '  }',
    '}',
    '(SPEC.objects || []).forEach(add);',
    'if (SPEC.axis !== false) {',
    '  var ax = new THREE.AxesHelper(3); scene.add(ax);',
    '  var gr = new THREE.GridHelper(6, 12, 0xd8dee9, 0xeef2f7); scene.add(gr);',
    '}',
    'function resize() {',
    '  var w = host.clientWidth || 640, h = host.clientHeight || 400;',
    '  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();',
    '}',
    'window.addEventListener("resize", resize); resize();',
    'var dragging = false, lx = 0, ly = 0, parentDrag = false;',
    'host.addEventListener("pointerdown", function (e) {',
    '  dragging = true; lx = e.clientX; ly = e.clientY;',
    '  parentDrag = !!(e.ctrlKey || e.metaKey || e.shiftKey || keys[" "]);',
    '  host.setPointerCapture(e.pointerId);',
    '});',
    'var keys = {};',
    'window.addEventListener("keydown", function (e) { keys[e.key] = true; });',
    'window.addEventListener("keyup", function (e) { keys[e.key] = false; });',
    'host.addEventListener("pointermove", function (e) {',
    '  if (!dragging) return;',
    '  var dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;',
    '  if (parentDrag) { try { parent.postMessage({ t: "applet3d-move", dx: dx, dy: dy }, "*"); } catch (err) {} return; }',
    '  yaw += dx * 0.01; pitch = Math.max(-1.3, Math.min(1.3, pitch + dy * 0.01)); place();',
    '});',
    'host.addEventListener("pointerup", function () { dragging = false; parentDrag = false; });',
    'host.addEventListener("wheel", function (e) { e.preventDefault(); dist = Math.max(2, Math.min(20, dist + (e.deltaY > 0 ? 0.5 : -0.5))); place(); }, { passive: false });',
    'function tick() { if (SPEC.spin !== false && !dragging) { yaw += 0.004; place(); } renderer.render(scene, camera); requestAnimationFrame(tick); }',
    'tick();',
    'try { parent.postMessage({ t: "applet3d-ready" }, "*"); } catch (err) {}',
  ].join('\n')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif}',
    '#h{width:100%;height:' + (opt?.height || '100%') + '}',
    '#t{position:absolute;left:8px;top:6px;font-size:13px;color:#475569}',
    '</style></head><body><div id="h"></div><div id="t"></div>',
    '<script src="' + src + '"><\/script>',
    '<script>' + js + '<\/script>',
    '</body></html>',
  ].join('')
}
