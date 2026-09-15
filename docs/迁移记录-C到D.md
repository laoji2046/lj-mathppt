# 迁移记录：C 盘 → D 盘

> 执行时间：2026-09-15 · 结论：**D:\vue-app 已可用** ✓

## 一、为什么搬

- C 盘剩 498 GB、D 盘剩 2144 GB（更宽裕 ✓）
- 顺带好处：新路径 **没有中文** ✓（原来是 `C:\Users\老冀\Desktop\vue-app` ✗）
  —— 少一类"非 ASCII 路径"引起的工具兼容问题

## 二、搬了什么

| 内容 | 处理 | 说明 |
|---|---|---|
| 源码 / docs / 参考 / _backup / 发布 | **复制** ✓ | 6.48 GB · 29868 文件 · **FAILED 0** ✓ |
| `.git` | **复制** ✓ | 提交历史完整（HEAD `46bd55d` ✓）|
| `node_modules` | 复制 + `npm rebuild` ✓ | 直接搬比重新 install 快（76 MB ✓）|
| `src-tauri/target` | **复制** ✓ | 8.81 GB —— 省掉一次全量 Rust 编译 ✓ |
| `dist` / `.probe` / `.vite` | 没搬 ✗ | 构建产物与临时脚本，新路径重生成即可 |

**D:\vue-app 现在 15.45 GB。**

## 三、验过的（在 D 盘上实测）

    npm run build   → ✓ built in 13.32s
    dist\index.html → 存在 ✓
    npm run dev     → HTTP 200 ✓（用 3001 端口试的，避开 C 盘那个）
    git log         → 46bd55d ✓（历史完整）
    vite / vue-tsc  → node_modules\.bin 里都在 ✓

**没搬也没验的**：Cargo 的增量缓存与 D 盘机器状态的匹配（第一次在 D 盘
`cargo build --release` 可能仍要重编一部分 ✗，属正常）。

## 四、你要做的两步

1. **把 DSH 的工作区切到 `D:\vue-app`** ✓
   （旧会话仍绑在 C 盘路径上 —— 这是会话级的，改不了 ✗，要新开）
2. **确认没问题后，删掉 C 盘那份** ✓ —— 可释放约 **15.9 GB**
   `C:\Users\老冀\Desktop\vue-app`

> ⚠ **先别急着删**：等你在 D 盘上跑通一次「改代码 → 构建 → 打包 exe」 
> （也就是发布流程 ✓）再删 ✓。发布流程在新路径应当原样可用 ✓（都是相对路径 ✓）。

## 五、踩到的坑（供下次参考）

1. **robocopy 的 `/XD` 用相对名会误伤** ✗ —— 第一次只搬了几个中文目录就没声了；
   改用**全路径**（`/XD "$src\node_modules"` …）+ **把退出码单独取出来** ✓
   就正常了（0–7 成功、≥8 失败 ✓）。
   **教训**：robocopy 的结果不要用管道过滤掉 ✗，`$LASTEXITCODE` 才是结论 ✓。
2. **`npm install` 在 D 盘报 `Invalid Version:`** ✗ —— 堆栈落在
   `arborist/canDedupe → pruneDedupable`，是"树里有版本号为空的节点"；
   排查了 `D:\` 根目录（无 package.json / node_modules 干扰 ✓）仍然复现 ✗。
   **绕过办法**：直接复制已有 `node_modules` + `npm rebuild` ✓（1 分钟搞定 ✓）。
   来源未深究 —— 记录在此，若以后在别的盘重建，先试 `npm install`，
   失败就用这条"复制 + rebuild"的路 ✓。
