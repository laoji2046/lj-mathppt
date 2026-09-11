import { ref } from 'vue'
export const mdSourceOpen = ref(false)
export function openMdSource() { mdSourceOpen.value = true }
export function closeMdSource() { mdSourceOpen.value = false }
