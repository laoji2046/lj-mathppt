/**
 * 应用信息与版权声明 —— 唯一来源，改文案只改这里。
 *
 * 版权信息**只在编辑器界面出现**（画布右下状态栏 + 设置面板底部）。
 * 「演示」状态与导出的 HTML / PDF **一律不带**：那是给学生看的内容，屏幕上的软件署名不该出现在课件里。
 * 两处保险：状态栏那一条额外用 `v-if="!presenting"` 收口，导出侧（reveal/renderer.ts）完全不引用本文件。
 */
export const APP_NAME = 'LJ-MathSlides'

/** 版权归属方（要改署名只动这里） */
export const COMPANY = 'LTJ Studio'

/** 一句话版权（界面上显示的就是它） */
export const COPYRIGHT = `© ${new Date().getFullYear()} ${APP_NAME} · ${COMPANY} 保留所有权利`

/** 设置面板里的补充说明 */
export const COPYRIGHT_NOTE = '课件内容（文字 / 图形 / 公式）的著作权归制作者本人所有。'

/** 版本号：由 vite.config.ts 的 define 从 package.json 注入，避免手写漂移 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
