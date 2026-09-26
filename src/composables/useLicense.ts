/**
 * 【v1674】序列号激活状态（用户要求：没序列号时锁住 数学图形 / AI 助手 / 讲义 / 试卷编辑 四项）
 *
 * · 激活信息存在 localStorage（换机器码或清数据就失效 ✓ 重装应用不影响 ✓）；
 * · 机器码由 Rust 侧 machine_code 提供（浏览器预览里退回一个固定的预览机码 ✓，方便我在浏览器里点界面）；
 * · licensed(feature) 是**唯一**的判断入口 —— 四个闸门都调它 ✓，以后想加锁项只改 license.ts 的清单 ✓。
 */
import { computed, ref } from 'vue'
import { invoke, isTauri } from '@/composables/useTauri'
import { verifySerial, LICENSED_FEATURES, type LicenseInfo, type LicensedFeature } from './license'

const STORE_KEY = 'lj-mathslides:license'

/** 【v1675】总开关：false = **授权还没启用**（默认）→ 所有功能都不锁 ✓
 *  用户 2026-09-26 决定：应用还在开发期，先别给自己上锁 ✗（每换机器都要发号太碍事 ✓）。
 *  准备往外分发时，把这一行改成 true 就生效 ✓（四个闸门、激活框、发号工具都是现成的 ✓）。 */
export const LICENSE_ENFORCED = false
const serial = ref('')
const info = ref<LicenseInfo | null>(null)
const machine = ref('')
const ready = ref(false)
let inited: Promise<void> | null = null

export const isActivated = computed(() => !!info.value)

async function readMachine(): Promise<string> {
  try { if (isTauri()) return String((await invoke<string>('machine_code')) || '') } catch { /* 浏览器预览没有这个命令 */ }
  return '浏览器预览机（真机上是 Windows 机器码）'
}

export function machineCode(): string { return machine.value }

/** 【v1680】第一次真正需要用机器码时才读（打开激活框 / 开关打开后验号 ✓）—— 别放在启动路径上 ✗ */
export async function ensureMachine(): Promise<string> {
  if (machine.value) return machine.value
  machine.value = await readMachine()
  return machine.value
}

export function initLicense(): Promise<void> {
  if (inited) return inited
  inited = (async () => {
    // 【v1680】★ **启动时不读机器码** ✗ —— 读它要 spawn 一个 reg 进程（用户实报：刚打开应用点「文件」几秒没反应 ✓），
    //   那只是 Windows 冷启动 + 杀软扫描的正常代价 ✓。改成**第一次真的要用时才读** ✓。
    try { serial.value = String(localStorage.getItem(STORE_KEY) || '') } catch { serial.value = '' }
    // 只有真要卡人时才验号；开关关着（开发期）一律放行 ✓，连机器码都不读 ✓
    if (LICENSE_ENFORCED && serial.value) {
      const mc = await ensureMachine()
      const r = await verifySerial(serial.value, mc)
      info.value = r.ok ? (r.info || null) : null
    }
    ready.value = true
  })()
  return inited
}

export async function activate(text: string): Promise<{ ok: boolean; reason?: string }> {
  await initLicense()
  const mc = await ensureMachine()
  const r = await verifySerial(text, mc)
  if (!r.ok) return { ok: false, reason: r.reason }
  serial.value = String(text || '').trim()
  info.value = r.info || null
  try { localStorage.setItem(STORE_KEY, serial.value) } catch { /* 存不上不影响本次使用 */ }
  return { ok: true }
}

export function deactivate() {
  serial.value = ''
  info.value = null
  try { localStorage.removeItem(STORE_KEY) } catch { /* 忽略 */ }
}

/** 这个功能能不能用（不在锁定清单里的一律放行 ✓；总开关关着时全部放行 ✓） */
export function licensed(f: LicensedFeature | string): boolean {
  if (!LICENSE_ENFORCED) return true        // 开发期：先不锁（见上面的开关说明 ✓）
  if (info.value) return true
  return LICENSED_FEATURES.indexOf(f as LicensedFeature) < 0
}

export function useLicense() {
  return { serial, info, ready, machine, isActivated, licensed, activate, deactivate, initLicense, ensureMachine }
}
