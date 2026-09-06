<script setup lang="ts">
import { computed } from 'vue'
import type { ChartElement } from '@/types'

const props = defineProps<{ el: ChartElement }>()

function tint(hex: string, i: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (c: number) => Math.min(255, Math.round(c + i * 16))
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}

const markup = computed(() => {
  const { w, h, labels, values, color, chartType } = props.el
  const n = values.length || 1
  const max = Math.max(...values, 1)
  const pad = { t: 18, r: 16, b: 28, l: 36 }
  const cw = Math.max(1, w - pad.l - pad.r)
  const ch = Math.max(1, h - pad.t - pad.b)
  let out = ''

  if (chartType === 'bar') {
    const slot = cw / n
    const barW = slot * 0.6
    values.forEach((v, i) => {
      const bh = Math.max(0, (v / max) * ch)
      const bx = pad.l + i * slot + (slot - barW) / 2
      const by = pad.t + ch - bh
      out += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="2" fill="${color}"/>`
      out += `<text x="${pad.l + i * slot + slot / 2}" y="${h - 8}" font-size="12" text-anchor="middle" fill="#555">${labels[i] ?? ''}</text>`
    })
    out += `<line x1="${pad.l}" y1="${pad.t + ch}" x2="${w - pad.r}" y2="${pad.t + ch}" stroke="#aaa" stroke-width="1"/>`
  } else if (chartType === 'line') {
    const pts = values.map((v, i) => {
      const x = pad.l + (n === 1 ? cw / 2 : (i * cw) / (n - 1))
      const y = pad.t + ch - (v / max) * ch
      return `${x},${y}`
    })
    out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    out += pts.map((p, i) => {
      const [x, y] = p.split(',').map(Number)
      return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>` +
        `<text x="${x}" y="${y - 9}" font-size="11" text-anchor="middle" fill="#555">${labels[i] ?? ''}</text>`
    }).join('')
  } else {
    const cx = cw / 2 + pad.l
    const cy = ch / 2 + pad.t
    const r = Math.max(6, Math.min(cw, ch) / 2 - 4)
    const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0) || 1
    let a = -Math.PI / 2
    values.forEach((v, i) => {
      if (v <= 0) return
      const a2 = a + (v / total) * Math.PI * 2
      const x1 = cx + r * Math.cos(a)
      const y1 = cy + r * Math.sin(a)
      const x2 = cx + r * Math.cos(a2)
      const y2 = cy + r * Math.sin(a2)
      const large = a2 - a > Math.PI ? 1 : 0
      out += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${tint(color, i)}"/>`
      const mid = (a + a2) / 2
      const lx = cx + r * 0.62 * Math.cos(mid)
      const ly = cy + r * 0.62 * Math.sin(mid)
      out += `<text x="${lx}" y="${ly}" font-size="12" text-anchor="middle" fill="#fff">${labels[i] ?? ''}</text>`
      a = a2
    })
  }
  return out
})
</script>

<template>
  <div class="chart-el">
    <svg :viewBox="`0 0 ${props.el.w} ${props.el.h}`" width="100%" height="100%" preserveAspectRatio="none" v-html="markup"></svg>
  </div>
</template>

<style scoped>
.chart-el { width: 100%; height: 100%; box-sizing: border-box; }
.chart-el svg { display: block; }
</style>
