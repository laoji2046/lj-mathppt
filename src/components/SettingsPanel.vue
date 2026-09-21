<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDeckStore } from '@/stores/deck'
import AppIcon from './AppIcon.vue'
import { APP_NAME, APP_VERSION, COPYRIGHT, COPYRIGHT_NOTE } from '@/ui/appInfo'
import { REVEAL_SPEEDS, REVEAL_THEMES, REVEAL_TRANSITIONS } from '@/types'

const store = useDeckStore()
const emit = defineEmits<{ (e: 'close'): void }>()

// ── AI 助手（v1439：从「试题库」搬到这里 —— 旧题库整体移除后，Key 得有个正经的家）──
// 只存本机 localStorage，不写进源码、不上传；AI 功能（一句话生成 3D 等）读的就是这个 Key ✓
const AI_KEY = 'lj-mathslides:ai-key'
const aiKey = ref('')
onMounted(() => { try { aiKey.value = localStorage.getItem(AI_KEY) || '' } catch { /* 隐私模式忽略 */ } })
function saveAiKey(v: string) {
  aiKey.value = v
  try {
    if (v.trim()) localStorage.setItem(AI_KEY, v.trim())
    else localStorage.removeItem(AI_KEY)
  } catch { /* 忽略 */ }
}

// ── 【v1501】MinerU Token 挪到设置里（原来只在「试题录入」对话框里填 ✗ 老师要求挪过来 ✓）
//    ⚠ 键必须是 'lj-mathslides:mineru-token' ✓ —— 录入对话框读的也是这个 ✓ 两边共用、改哪边都生效 ✓
const MINERU_KEY = 'lj-mathslides:mineru-token'
const mineruKey = ref('')
const mineruShow = ref(false)
onMounted(() => { try { mineruKey.value = localStorage.getItem(MINERU_KEY) || '' } catch { /* 忽略 */ } })
function saveMineruKey(v: string) {
  mineruKey.value = v
  try {
    if (v.trim()) localStorage.setItem(MINERU_KEY, v.trim())
    else localStorage.removeItem(MINERU_KEY)
  } catch { /* 忽略 */ }
}

// ── 【v1501】「启动时显示开始向导」开关 —— 关掉后打开应用直接进文稿 ✓
//    NewDeckWizard 读的就是这个键 ✓（'off' = 不再自动弹 ✓）
const WIZ_KEY = 'lj-mathslides-vue:newdeck-wizard'
const wizardOn = ref(true)
onMounted(() => { try { wizardOn.value = localStorage.getItem(WIZ_KEY) !== 'off' } catch { /* 忽略 */ } })
function setWizardOn(v: boolean) {
  wizardOn.value = v
  try {
    if (v) localStorage.removeItem(WIZ_KEY)
    else localStorage.setItem(WIZ_KEY, 'off')
  } catch { /* 忽略 */ }
}
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>设置</span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>

      <label class="field"><span>标题</span>
        <input class="prop-input" type="text" :value="store.deck.title" @input="store.updateDeckMeta({ title: ($event.target as HTMLInputElement).value })" />
      </label>
      <label class="field"><span>描述</span>
        <textarea class="prop-textarea" rows="2" :value="store.deck.description || ''" @input="store.updateDeckMeta({ description: ($event.target as HTMLTextAreaElement).value })"></textarea>
      </label>

      <label class="field"><span>主题（Reveal）</span>
        <select :value="store.deck.revealTheme || 'white'" @change="store.updateDeckMeta({ revealTheme: ($event.target as HTMLSelectElement).value })">
          <option v-for="t in REVEAL_THEMES" :key="t.v" :value="t.v">{{ t.label }}</option>
        </select>
      </label>
      <label class="field"><span>字体</span>
        <select :value="store.deck.font || ''" @change="store.updateDeckMeta({ font: ($event.target as HTMLSelectElement).value })">
          <option value="">默认</option>
          <option value="Montserrat">Montserrat</option>
          <option value="Open Sans">Open Sans</option>
          <option value="Lato">Lato</option>
          <option value="Roboto">Roboto</option>
          <option value="思源黑体">思源黑体</option>
        </select>
      </label>
      <label class="field"><span>过渡动画</span>
        <select :value="store.deck.transition || 'slide'" @change="store.updateDeckMeta({ transition: ($event.target as HTMLSelectElement).value })">
          <option v-for="t in REVEAL_TRANSITIONS" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <label class="field"><span>切换速度</span>
        <select :value="store.deck.transitionSpeed || 'default'" @change="store.updateDeckMeta({ transitionSpeed: ($event.target as HTMLSelectElement).value })">
          <option v-for="s in REVEAL_SPEEDS" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <p class="hint">主题 / 字体 / 过渡 / 速度用于「▶ 演示」与导出；标题、描述为文稿元信息。改完点演示即生效。</p>

      <!-- AI 助手：DeepSeek Key（本机保存） -->
      <div class="ai">
        <div class="ai__title">AI 助手（DeepSeek）</div>
        <label class="field"><span>API Key（sk-…）</span>
          <input
            class="prop-input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="sk-…"
            :value="aiKey"
            @input="saveAiKey(($event.target as HTMLInputElement).value)"
          />
        </label>
        <p class="hint">只保存在本机（不上传、不写进源码）；用于「一句话生成 3D 场景」等 AI 功能。留空＝不用 AI，其它功能照常。</p>
      </div>

      <!-- 【v1501】MinerU Token：PDF 识别用（原来只在「试题录入」里填 ✓ 现在设置里也能填 ✓ 两边共用 ✓） -->
      <div class="ai">
        <div class="ai__title">PDF 识别（MinerU）</div>
        <label class="field"><span>MinerU Token</span>
          <input
            class="prop-input"
            :type="mineruShow ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            placeholder="在 mineru.net 申请，粘到这里"
            :value="mineruKey"
            @input="saveMineruKey(($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field field--row"><span>显示明文</span>
          <input type="checkbox" :checked="mineruShow" @change="mineruShow = ($event.target as HTMLInputElement).checked" />
        </label>
        <p class="hint">只保存在本机；**试题录入里选 .pdf 时**用它做云端识别（识别产物缓存本机 ✓）。与上面的 AI Key 是两回事 ✓ 都不填也能用 MD / JSON / 粘贴录入 ✓。</p>
      </div>

      <!-- 【v1501】启动时显示开始向导 -->
      <div class="ai">
        <div class="ai__title">启动</div>
        <label class="field field--row"><span>启动时显示「开始向导」</span>
          <input type="checkbox" :checked="wizardOn" @change="setWizardOn(($event.target as HTMLInputElement).checked)" />
        </label>
        <p class="hint">关掉后打开应用**直接进当前文稿**，不再弹新建向导 ✓（想再打开：勾回来，或点工具栏「新建」✓）</p>
      </div>

      <!-- 关于 / 版权：只在设置面板里出现，「演示」与导出的 HTML / PDF 都不带 -->
      <div class="about">
        <span class="about__name">{{ APP_NAME }}</span>
        <span class="about__ver">v{{ APP_VERSION }}</span>
        <span class="about__copy">{{ COPYRIGHT }}</span>
        <span class="about__note">{{ COPYRIGHT_NOTE }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 16px 18px; width: 92vw; max-width: 420px; max-height: 82vh; overflow: auto;}
.palette__head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--text); margin-bottom: 14px; }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); transition: background var(--dur-1) var(--ease), color var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease); }
.field { display: block; margin-bottom: 10px; font-size: 12px; color: var(--muted); }
.field > span { display: block; margin-bottom: 3px; }
.prop-input, .field input[type="text"], .field select, .prop-textarea {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px;
}
.prop-textarea { resize: vertical; line-height: 1.5; }
.prop-input { font-size: 13px; }
.hint { margin-top: 10px; font-size: 12px; color: var(--muted); line-height: 1.6; }
.ai { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.ai__title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.about { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 12px; color: var(--muted); }
.about__name { font-size: 13px; font-weight: 600; color: var(--text); }
.about__ver { font-variant-numeric: tabular-nums; opacity: 0.8; }
.about__copy, .about__note { width: 100%; line-height: 1.6; }
.about__note { opacity: 0.85; }
</style>
