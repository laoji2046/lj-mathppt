/**
 * Addon 清单的类型 —— 三种 addon 成本差一个数量级，别混为一谈：
 *   1. 内置 addon：随包发布、按需加载（代码已是独立 chunk；可开关）—— 本次做的
 *   2. 外置 addon：不随包，首次使用时下载到本地 —— 需要下载/校验/缓存/回退四件套
 *   3. 元素类型插件：让第三方新增元素类型 —— 需要先给内核加注册表
 *      （ElementFrame 与 renderer 现在是 if 链硬编码），属于动核心的重构，不在本次范围
 */
export type AddonCategory = '导入导出' | '编辑器' | '运行时' | '参数化'

export interface AddonManifest {
  /** 稳定 id（存档/配置里用它，别改） */
  id: string
  name: string
  /** 一句话说明（功能管理页显示用） */
  desc: string
  /** 图标名（见 ui/icons.ts 的 I） */
  icon: string
  category: AddonCategory
  /** 按需加载的那块代码有多大（KB，来自实际构建产物） */
  sizeHint?: number
  /**
   * 这个 addon 依赖的外部运行时（体积大头往往在这里）。
   * 内置阶段它随包发布；将来做外置时，按这个清单决定要不要下载。
   */
  runtime?: { key: string; mb: number; note: string }
  /** 默认是否启用（关掉后入口隐藏、代码永不加载） */
  defaultOn?: boolean
  /** 是否已实现外置下载（true 才允许不随包） */
  canExternalize?: boolean
}