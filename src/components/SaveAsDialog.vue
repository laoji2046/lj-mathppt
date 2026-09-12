<script setup lang="ts">
/**
 * 桌面端（Tauri/exe）「另存为」对话框：
 * WebView2 不支持浏览器原生的 showSaveFilePicker，这里用 Rust 侧 list_dir / export_json
 * 做一个可浏览、可切换目录的文件夹选择器，用户自己决定存到哪个目录。
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { listDir, userDirs, saveTextToDir, type DirEntry } from '@/composables/useTauri'

const props = defineProps<{ name: string; text: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', path: string): void }>()

const dir = ref('')
const parent = ref('')
const dirs = ref<string[]>([])
const quick = ref<DirEntry[]>([])
const pathInput = ref('')
const fileName = ref(props.name)
const err = ref('')
const busy = ref(false)
const loading = ref(false)

const target = computed(() => join(dir.value, fileName.value.trim()))

function sepOf(p: string) { return p.includes('\\') ? '\\' : '/' }
function join(a: string, b: string) { return a ? a.replace(/[\\/]+$/, '') + sepOf(a) + b : b }
function msg(e: unknown) { return e instanceof Error ? e.message : String(e) }

async function go(p?: string) {
  loading.value = true; err.value = ''
  try {
    const r = await listDir(p)
    dir.value = r.path; parent.value = r.parent; pathInput.value = r.path; dirs.value = r.dirs
  } catch (e) {
    err.value = '读取目录失败：' + msg(e)
  } finally {
    loading.value = false
  }
}
function enter(sub: string) { go(join(dir.value, sub)) }
async function save() {
  const name = fileName.value.trim()
  if (!name) { err.value = '请填写文件名'; return }
  if (!dir.value) { err.value = '请先选择一个目录'; return }
  busy.value = true; err.value = ''
  try {
    const p = await saveTextToDir(dir.value, name, props.text)
    emit('saved', p || target.value)
    emit('close')
  } catch (e) {
    err.value = '保存失败：' + msg(e)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  quick.value = await userDirs()
  await go()
})
</script>

<template>
  <div class="palette" @click.self="emit('close')">
    <div class="palette__box">
      <div class="palette__head">
        <span>另存为</span>
        <button class="palette__close" @click="emit('close')"><AppIcon name="close" :size="13" /></button>
      </div>

      <div v-if="quick.length" class="sa-quick">
        <button v-for="q in quick" :key="q.path" class="sa-chip" :class="{ 'sa-chip--on': q.path === dir }" :title="q.path" @click="go(q.path)">{{ q.label }}</button>
      </div>

      <div class="sa-path">
        <input v-model="pathInput" class="sa-input" spellcheck="false" placeholder="目录路径（可直接粘贴，回车跳转）" @keydown.enter="go(pathInput)" />
        <button class="sa-btn" :disabled="!parent" title="上一级目录" @click="go(parent)"><AppIcon name="up" :size="13" /> 上级</button>
        <button class="sa-btn" title="跳转到输入的目录" @click="go(pathInput)">转到</button>
      </div>

      <div class="sa-list">
        <div v-if="loading" class="sa-hint">读取中…</div>
        <div v-else-if="!dirs.length" class="sa-hint">该目录下没有子文件夹（也可以直接点下面的「保存」存到当前目录）</div>
        <button v-for="d in dirs" :key="d" class="sa-dir" @click="enter(d)">
          <span class="sa-dir__ico"><AppIcon name="folder" :size="14" /></span>{{ d }}
        </button>
      </div>

      <div class="sa-name">
        <span class="sa-name__label">文件名</span>
        <input v-model="fileName" class="sa-input" spellcheck="false" @keydown.enter="save" />
      </div>

      <div class="sa-target" :title="target">保存到：{{ target || '（请选择目录）' }}</div>
      <div v-if="err" class="sa-err">{{ err }}</div>

      <div class="sa-foot">
        <button class="sa-btn" @click="emit('close')">取消</button>
        <button class="sa-btn sa-btn--primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存到该目录' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette { position: fixed; inset: 0; z-index: 400; background: rgba(20, 24, 34, 0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; }
.palette__box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: 14px 16px; max-width: 640px; width: 92vw; display: flex; flex-direction: column; gap: 10px; }
.palette__head { display: flex; align-items: center; justify-content: space-between; font-size: 15px; font-weight: 600; color: var(--text); }
.palette__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; flex: none; cursor: pointer; font-size: 15px; background: var(--panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--gray-600); }
.palette__close:hover { background: var(--danger-soft); border-color: var(--danger-border); color: var(--danger); }
.sa-quick { display: flex; flex-wrap: wrap; gap: 6px; }
.sa-chip { padding: 4px 10px; font-size: 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--panel); color: var(--text); cursor: pointer; }
.sa-chip:hover { background: var(--brand-soft); border-color: var(--brand-400); }
.sa-chip--on { background: var(--brand-100); border-color: var(--brand-400); color: var(--brand-800); font-weight: 600; }
.sa-path { display: flex; gap: 6px; }
.sa-input { flex: 1; box-sizing: border-box; min-width: 0; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: 5px; font-size: 13px; }
.sa-btn { padding: 6px 12px; border: 1px solid var(--border-strong); background: var(--panel); border-radius: 5px; cursor: pointer; font-size: 13px; flex: none; white-space: nowrap; }
.sa-btn:hover:not(:disabled) { background: var(--brand-soft); }
.sa-btn:disabled { opacity: 0.5; cursor: default; }
.sa-btn--primary { background: var(--brand-600); border-color: var(--brand-600); color: #fff; font-weight: 600; }
.sa-btn--primary:hover:not(:disabled) { background: var(--brand-700); }
.sa-list { height: 210px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.sa-dir { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 5px 8px; border: 0; background: transparent; border-radius: 4px; font-size: 13px; color: var(--text); cursor: pointer; }
.sa-dir:hover { background: var(--brand-soft); }
.sa-dir__ico { flex: none; }
.sa-hint { font-size: 12px; color: var(--muted); padding: 8px; line-height: 1.6; }
.sa-name { display: flex; align-items: center; gap: 8px; }
.sa-name__label { font-size: 13px; color: var(--muted); flex: none; }
.sa-target { font-size: 12px; color: var(--muted); word-break: break-all; }
.sa-err { font-size: 12px; color: var(--danger); }
.sa-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
