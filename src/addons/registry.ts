/**
 * Addon 注册表：只做「登记 + 开关 + 查询」，不碰功能实现。
 *
 * 设计要点：
 * - 开关状态存 localStorage（app 级设置，不进文稿 JSON —— 换个电脑不该丢）；
 * - 组件/入口一律按需加载（各 addon 自己用 defineAsyncComponent / await import()）；
 * - 关掉一个 addon = 入口隐藏 + 代码不加载，不动任何已有实现（可随时开回来）。
 */
import { reactive, ref } from 'vue'
import type { AddonManifest } from './types'

const KEY = 'lj-mathslides-vue:addons'

/** 已注册的清单（内置；将来外置的也往这里加） */
const manifests = new Map<string, AddonManifest>()

/** 开关状态（响应式，界面直接用） */
export const addonState = reactive<{ enabled: Record<string, boolean> }>({ enabled: {} })

function persist() {
  try {
    const on: string[] = []
    for (const [id, v] of Object.entries(addonState.enabled)) if (v) on.push(id)
    localStorage.setItem(KEY, JSON.stringify(on))
  } catch { /* 存不上也不影响使用 */ }
}

/** 【v1678】一次性迁移：用户要求关掉「PDF 导入 / Word 导入」✓
 *  ⚠ 光给 manifest 加 defaultOn:false **不管用** ✗ —— restore 的口径是"存过就以存档为准"，
 *  而用户机器上的存档里这两项是开着的 ✓（实测：用户报"两个功能都还在" ✓）→ 必须把它从存档里摘掉一次 ✓。
 *  只摘一次（留个迁移标记 ✓）：之后用户在「功能管理」里想再打开照样能打开 ✓（可逆 ✓）。
 */
const MIG_KEY = 'lj-mathslides-vue:addons-mig-1678'
const OFF_BY_REQUEST = ['pdf-import', 'docx-import']
function migrateOnce() {
  try {
    if (localStorage.getItem(MIG_KEY)) return
    const raw = localStorage.getItem(KEY)
    const on = raw ? JSON.parse(raw) : null
    if (Array.isArray(on)) {
      const next = on.filter((id: string) => OFF_BY_REQUEST.indexOf(id) < 0)
      localStorage.setItem(KEY, JSON.stringify(next))
    }
    localStorage.setItem(MIG_KEY, '1')
  } catch { /* 读不到/存不上都不影响启动 */ }
}

function restore() {
  migrateOnce()
  let on: string[] | null = null
  try { on = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { on = null }
  for (const m of manifests.values()) {
    // 没存过 → 用清单默认值；存过 → 以存档为准（用户关过的不被默认值顶回来）
    addonState.enabled[m.id] = on ? on.includes(m.id) : m.defaultOn !== false
  }
}

/** 注册一个 addon 清单（内置清单在 index.ts 里登记） */
export function registerAddon(m: AddonManifest) {
  manifests.set(m.id, { defaultOn: true, ...m })
}

/** 全部清单 */
export function listAddons(): AddonManifest[] {
  return [...manifests.values()]
}

export function isEnabled(id: string): boolean {
  return addonState.enabled[id] !== false
}

export function setEnabled(id: string, on: boolean) {
  addonState.enabled[id] = on
  persist()
}

/** 启动时调一次（读存档） */
export function initAddons() {
  restore()
}

/** 按需加载某个 addon 的代码 —— addon 自己给出加载函数 */
export async function loadAddon<T>(id: string, loader: () => Promise<T>): Promise<T | null> {
  if (!isEnabled(id)) return null
  return loader()
}
/**
 * **动作级守卫** ✓ —— 关掉的功能即使还有别的入口（菜单、浮层、属性面板…）也进不去 ✗。
 *
 * 为什么必须放在这里 ✗：v1287 我只给入口挂了 `v-if` ✓，结果**挂不全** ✓ ——
 * 用户实测：把「三维立体图」关掉后，**数学图形弹窗里那个入口照样能打开** ✗（漏了一处 ✓）。
 * 入口有十几处 ✓ 且以后还会加 ✗；**守卫放进动作本身** ✓ 才是唯一可靠的写法 ✓。
 */
export const addonNotice = ref('')
let noticeTimer: number | undefined
export function requireAddon(id: string): boolean {
  if (isEnabled(id)) return true
  const m = manifests.get(id)
  addonNotice.value = (m ? m.name : id) + ' 已在「功能管理」里关掉 —— 打开它才能用'
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { addonNotice.value = '' }, 3200)
  return false
}