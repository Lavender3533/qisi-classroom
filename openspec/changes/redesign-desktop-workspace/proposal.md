# Change: 重构为 VS Code / Obsidian 式桌面学习工作台

## Why
当前界面虽然运行在 Tauri 中，但视觉和交互仍接近网页聊天原型：大圆角、网页卡片、emoji 图标、固定面板和缺少键盘工作流。用户明确要求使用 UI UX Pro Max，并呈现真正的桌面生产力软件形态。

## What Changes
- 按 UI UX Pro Max 规范重做标题栏、Activity Bar、主侧栏、标签工作区、检查器和状态栏。
- 增加 Command Center、键盘快捷键、可折叠面板与面板宽度持久化。
- 将 UI 图标统一为 SVG，移除界面 emoji 图标和网页卡片风格。
- 清除学生未创建的示例笔记、示例作业、示例错题和伪学习进度；无数据时显示空状态。
- 保留摸底、聊天、练习、小测、学习进度及所有 Tauri invoke 命令契约。
- 重构完成后单独审查教学模块，不在 UI 阶段混入教学逻辑重写。

## Impact
- Affected specs: desktop-shell（新增）
- Affected code: frontend/index.html, frontend/tokens.css, frontend/style.css, frontend/app.js
- Preserved code: src-tauri/src/main.rs 命令接口与教学数据结构
