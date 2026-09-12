/**
 * vite.config.ts 是项目里唯一在 Node 环境执行的文件（构建配置），
 * 但本项目没有安装 @types/node —— 装了会把 Node 的全局类型混进这个 DOM 项目，
 * 例如 setTimeout 的返回值会从 number 变成 NodeJS.Timeout，引发一批无关的新报错。
 * 所以这里只补声明它实际用到的两样东西：node:url 的 fileURLToPath 和 process.env。
 */
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
  // node:url 也导出 URL（与全局同名），vite.config.ts 显式 import 了它
  export const URL: typeof globalThis.URL
}

declare const process: { env: Record<string, string | undefined> }
