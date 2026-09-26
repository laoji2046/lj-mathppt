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

export function initLicense(): Promise<void> {
  if (inited) return inited
  inited = (async () => {
    machine.value = await readMachine()
    try { serial.value = String(localStorage.getItem(STORE_KEY) || '') } catch { serial.value = '' }
    if (serial.value) {
      const r = await verifySerial(serial.value, machine.value)
      info.value = r.ok ? (r.info || null) : null
    }
    ready.value = true
  })()
  return inited
}

export async function activate(text: string): Promise<{ ok: boolean; reason?: string }> {
  await initLicense()
  const r = await verifySerial(text, machine.value)
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

/** 这个功能能不能用（不在锁定清单里的一律放行 ✓） */
export function licensed(f: LicensedFeature | string): boolean {
  if (info.value) return true
  return LICENSED_FEATURES.indexOf(f as LicensedFeature) < 0
}

export function useLicense() {
  return { serial, info, ready, machine, isActivated, licensed, activate, deactivate, initLicense }
}
