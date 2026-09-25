<script setup lang="ts">
/**
 * 【v1642】右侧 DeepSeek 助手（用户要求；按 Tauri 路线重做，不照搬那份 Electron 副本的 <webview> ✗）
 *
 * 为什么不嵌网页：webview 标签是 Electron 专有，Tauri/WebView2 里不存在 ✗；
 *   而 iframe 会被站点的 X-Frame-Options 挡掉 ✗。所以走**官方 API**：
 *   Rust 侧已有 ai_chat（网页端直连 api.deepseek.com 会被 CORS 挡，请求必须在 Rust 侧发 ✓）。
 *
 * 收起时只留一条 40px 竖条；Key 复用「设置 → AI Key」那一份 ✓
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { invoke, isTauri } from '@/composables/useTauri'
import AppIcon from './AppIcon.vue'

const open = ref(false)
const input = ref('')
const busy = ref(false)
const err = ref('')
const listEl = ref<HTMLElement | null>(null)
const msgs = ref<{ role: 'user' | 'ai'; text: string }[]>([])
const keyTick = ref(0)

/** AI Key：名字不写死 —— 设置里存的是哪个键就用哪个（避免和设置面板漂移 ✗）✓ */
function aiKey(): string {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/ai[-_]?key/i.test(k)) continue
      const v = String(localStorage.getItem(k) || '').trim()
      if (v) return v
    }
  } catch { /* 隐私模式读不到就算了 */ }
  return ''
}
const hasKey = computed(() => { void keyTick.value; return !!aiKey() })

const SYSTEM = '你是高中数学老师的备课助手。回答用中文，简洁、可直接放进讲义：公式用 $...$（行内）或 $$...$$（独立行），结论先说，步骤可省。'

async function send() {
  const t = input.value.trim()
  if (!t || busy.value) return
  if (!isTauri()) { err.value = '浏览器预览里不能调用 AI（请求要由桌面端内核发，网页端会被 CORS 挡）'; return }
  const key = aiKey()
  if (!key) { err.value = '还没填 AI Key —— 打开「设置」填一个 DeepSeek Key 就能用 ✓'; keyTick.value++; return }
  err.value = ''
  msgs.value.push({ role: 'user', text: t })
  input.value = ''
  busy.value = true
  await scrollDown()
  try {
    const r = await invoke<{ ok?: boolean; text?: string; content?: string; error?: string }>('ai_chat', {
      baseUrl: '', apiKey: key, model: 'deepseek-chat', system: SYSTEM, userText: t,
    })
    const text = String((r && (r.text || r.content)) || '').trim()
    if (r && r.ok === false) err.value = String(r.error || '调用失败')
    else if (!text) err.value = '模型没有返回内容'
    else msgs.value.push({ role: 'ai', text })
  } catch (e) { err.value = String((e as Error)?.message || e) }
  finally { busy.value = false; await scrollDown() }
}
async function scrollDown() {
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}
/* ---- 【v1643】DeepSeek 网页版：开一个贴在右侧的**真窗口**（方案①）---- */
const webOpen = ref(false)
let timer: number | null = null
const WEB_W = 420
async function toggleWeb() {
  if (!isTauri()) { err.value = '网页版窗口只在桌面端能开（浏览器预览没有窗口能力）'; return }
  try {
    const r = await invoke<{ ok?: boolean; open?: boolean; error?: string }>('ds_webview_open', { width: WEB_W })
    if (r && r.ok === false) { err.value = String(r.error || '打开失败'); return }
    webOpen.value = !!(r && r.open)
  err.value = ''
    if (webOpen.value && timer == null) {
      timer = window.setInterval(() => { void invoke('ds_webview_sync', { width: WEB_W }) }, 500)
    }
    if (!webOpen.value && timer != null) { window.clearInterval(timer); timer = null }
  } catch (e) { err.value = String((e as Error)?.message || e) }
}
onBeforeUnmount(() => { if (timer != null) window.clearInterval(timer) })

function clearAll() { msgs.value = []; err.value = '' }
async function copyOne(t: string) { try { await navigator.clipboard.writeText(t) } catch { /* 忽略 */ } }
</script>

<template>
  <div class="ds">
    <button class="ds__bar" :title="open ? '收起 DeepSeek 助手' : '展开 DeepSeek 助手（用设置里的 AI Key 调官方 API）'" @click="open = !open">
      <AppIcon name="ai" :size="14" />
      <span class="ds__barTxt">DeepSeek</span>
    </button>
    <section v-if="open" class="ds__body">
      <header class="ds__head">
        <span class="ds__title">DeepSeek 助手</span>
        <span class="ds__sub">{{ hasKey ? '已接 AI Key' : '未填 Key' }}</span>
        <button class="ds__btn" :title="webOpen ? '关掉 DeepSeek 网页版窗口' : '开一个贴在右侧的 DeepSeek 网页版窗口（真网页，登录态与浏览器一致）'" @click="toggleWeb">{{ webOpen ? '关网页版' : '网页版' }}</button>
        <button class="ds__btn" title="清空对话" @click="clearAll">清空</button>
        <button class="ds__btn" title="收起" @click="open = false">✕</button>
      </header>
      <div ref="listEl" class="ds__list">
        <div v-if="!msgs.length" class="ds__empty">
          问点什么试试：<br />
          「给一道考查线面平行的例题，附解析」<br />
          「把这段话改成适合板书的短句」
        </div>
        <div v-for="(m, i) in msgs" :key="i" class="ds__msg" :class="'ds__msg--' + m.role">
          <div class="ds__who">{{ m.role === 'user' ? '我' : 'AI' }}</div>
          <div class="ds__text">{{ m.text }}</div>
          <button v-if="m.role === 'ai'" class="ds__mini" @click="copyOne(m.text)">复制</button>
        </div>
        <div v-if="busy" class="ds__msg ds__msg--ai"><div class="ds__who">AI</div><div class="ds__text">正在思考…</div></div>
        <div v-if="err" class="ds__err">{{ err }}</div>
      </div>
      <footer class="ds__foot">
        <textarea v-model="input" class="ds__ta" rows="3" placeholder="输入问题（Enter 发送，Shift+Enter 换行）" @keydown.enter.exact.prevent="send" />
        <button class="ds__send" :disabled="busy || !input.trim()" @click="send">发送</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ds { display: flex; align-items: stretch; flex: 0 0 auto; border-left: 1px solid var(--border); background: var(--panel); }
.ds__bar { width: 40px; border: none; background: var(--panel-2, #faf9f6); color: var(--muted); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 12px; font-size: 11px; }
.ds__bar:hover { color: var(--brand-600, #534AB7); }
.ds__barTxt { writing-mode: vertical-rl; letter-spacing: .12em; }
.ds__body { width: 340px; display: flex; flex-direction: column; min-width: 0; }
.ds__head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.ds__title { font-size: 13px; font-weight: 600; color: var(--text); }
.ds__sub { font-size: 11px; color: var(--muted); }
.ds__btn { margin-left: auto; height: 24px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.ds__btn + .ds__btn { margin-left: 4px; }
.ds__list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
.ds__empty { color: var(--muted); font-size: 12px; line-height: 1.9; }
.ds__msg { display: flex; flex-direction: column; gap: 3px; }
.ds__who { font-size: 11px; color: var(--muted); }
.ds__text { font-size: 12.5px; line-height: 1.75; color: var(--text); white-space: pre-wrap; background: var(--panel-2, #faf9f6); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.ds__msg--user .ds__text { background: #f1efff; border-color: #ded7ff; }
.ds__mini { align-self: flex-end; height: 22px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px; background: #fff; font-size: 11px; cursor: pointer; }
.ds__err { font-size: 12px; color: #b42318; background: #fff2f0; border: 1px solid #f0c9c4; border-radius: 8px; padding: 8px 10px; }
.ds__foot { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.ds__ta { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 12.5px; font-family: inherit; resize: vertical; }
.ds__send { align-self: flex-end; height: 28px; padding: 0 14px; border: 1px solid var(--brand-600, #534AB7); background: var(--brand-600, #534AB7); color: #fff; border-radius: 8px; font-size: 12.5px; cursor: pointer; }
.ds__send:disabled { opacity: .5; cursor: default; }
</style>
