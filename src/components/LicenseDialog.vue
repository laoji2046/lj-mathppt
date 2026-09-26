<script setup lang="ts">
/**
 * 【v1674】激活对话框（序列号）
 * 左边：本机机器码（一键复制，发给发号的人）；右边：粘序列号 / 选 .ljsn 文件 → 激活 ✓
 * 样子沿用应用现成的对话框（fixed 蒙层 + 白卡片 + 品牌色主按钮 ✓）。
 */
import { onMounted, ref } from 'vue'
import { useLicense } from '@/composables/useLicense'

const emit = defineEmits<{ (e: 'close'): void }>()
const lic = useLicense()
const text = ref(lic.serial.value || '')
const msg = ref('')
const err = ref('')
const busy = ref(false)
const fileEl = ref<HTMLInputElement | null>(null)

onMounted(() => { void lic.initLicense() })

async function copyMachine() {
  try { await navigator.clipboard.writeText(lic.machine.value); msg.value = '机器码已复制，发给发号的人即可' } catch { msg.value = '复制失败，请手动选中复制' }
}
async function doActivate() {
  busy.value = true; err.value = ''
  try {
    const r = await lic.activate(text.value)
    if (!r.ok) { err.value = String(r.reason || '激活失败'); return }
    msg.value = '激活成功，谢谢！'
    setTimeout(() => emit('close'), 700)
  } finally { busy.value = false }
}
function pickFile() { fileEl.value?.click() }
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = (input.files || [])[0]
  input.value = ''
  if (!f) return
  try { text.value = String(await f.text()).trim(); msg.value = '已读入 ' + f.name + '，点「激活」即可' } catch { err.value = '文件读不出来' }
}
</script>

<template>
  <div class="lic" @click.self="emit('close')">
    <div class="lic__box">
      <header class="lic__head">
        <span>序列号</span>
        <span class="lic__state" :class="{ 'lic__state--on': lic.isActivated.value }">{{ lic.isActivated.value ? '已激活' : '未激活' }}</span>
      </header>
      <div class="lic__body">
        <div class="lic__row">
          <div class="lic__label">本机机器码（发给发号的人）</div>
          <div class="lic__machine">{{ lic.machine.value || '读取中…' }}</div>
          <button class="lic__btn" @click="copyMachine">复制机器码</button>
        </div>
        <div class="lic__row">
          <div class="lic__label">序列号（粘贴，或选授权文件）</div>
          <textarea v-model="text" class="lic__ta" rows="3" placeholder="LJMS-XXXXX-XXXXX-…（也可以直接选 .ljsn 授权文件）"></textarea>
          <div class="lic__acts">
            <button class="lic__btn" @click="pickFile">选授权文件…</button>
            <button class="lic__btn lic__btn--primary" :disabled="busy || !text.trim()" @click="doActivate">{{ busy ? '验证中…' : '激活' }}</button>
          </div>
          <input ref="fileEl" type="file" accept=".ljsn,.txt" style="display:none" @change="onFile" />
        </div>
        <p v-if="err" class="lic__err">{{ err }}</p>
        <p v-else-if="msg" class="lic__ok">{{ msg }}</p>
        <p class="lic__tip">没激活时这几项用不了：数学图形、AI 助手、讲义、试卷编辑；其余功能（编辑、保存、导入、导出、演示、题库）免费用。一个序列号最多两台电脑。</p>
        <p v-if="lic.isActivated.value" class="lic__tip">本机已于 {{ lic.info.value?.issued }} 激活（签发日）。换电脑需要重新发号。<button class="lic__link" @click="lic.deactivate(); msg = '已取消激活（可换号重新激活）'">取消激活</button></p>
      </div>
      <footer class="lic__bar"><button class="lic__btn" @click="emit('close')">关闭</button></footer>
    </div>
  </div>
</template>

<style scoped>
.lic { position: fixed; inset: 0; z-index: 470; background: rgba(20, 24, 34, 0.6); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.lic__box { background: #fff; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); width: min(620px, 94vw); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
.lic__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 15px; font-weight: 700; color: var(--text); }
.lic__state { font-size: 12px; font-weight: 400; color: #c0392b; }
.lic__state--on { color: #1e7a45; }
.lic__body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.lic__label { font-size: 12.5px; color: var(--muted); margin-bottom: 5px; }
.lic__machine { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: var(--text); background: #f7f8fb; border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; word-break: break-all; }
.lic__ta { width: 100%; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; border: 1px solid var(--border-strong); border-radius: 7px; padding: 8px 10px; resize: vertical; }
.lic__acts { display: flex; gap: 8px; margin-top: 8px; }
.lic__btn { border: 1px solid var(--border-strong); background: #fff; color: var(--text); border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px; }
.lic__btn:hover { background: var(--gray-50); }
.lic__btn--primary { background: var(--brand); border-color: var(--brand); color: #fff; }
.lic__btn--primary:disabled { opacity: .55; cursor: default; }
.lic__err { color: #c0392b; font-size: 12.5px; margin: 0; }
.lic__ok { color: #1e7a45; font-size: 12.5px; margin: 0; }
.lic__tip { color: var(--muted); font-size: 11.5px; line-height: 1.6; margin: 0; }
.lic__link { border: none; background: none; color: var(--brand); cursor: pointer; font-size: 11.5px; padding: 0 2px; }
.lic__bar { display: flex; justify-content: flex-end; padding: 12px 16px 14px; border-top: 1px solid var(--border); }
</style>
