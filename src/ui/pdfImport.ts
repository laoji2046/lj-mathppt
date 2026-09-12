import { ref } from 'vue'

/** PDF 导入弹窗：先探测（有没有文本层），再让用户确认模式与页码范围 */
export const pdfImportOpen = ref(false)
export const pdfImportFile = ref<File | null>(null)

export function openPdfImport(file: File) {
  pdfImportFile.value = file
  pdfImportOpen.value = true
}
export function closePdfImport() {
  pdfImportOpen.value = false
  pdfImportFile.value = null
}
