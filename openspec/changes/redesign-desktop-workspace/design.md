## Context
启思学堂是 Tauri v2 学生端 AI 私教。现有 HTML 已包含标题栏、图标栏、侧栏、工作区和右侧栏，但样式与交互偏网页原型。app.js 同时承载教学状态机和 UI 渲染，重构必须避免破坏教学流程。

## Goals / Non-Goals

### Goals
- 建立 VS Code/Obsidian 式桌面 workbench。
- 严格应用 UI UX Pro Max 的可访问性、图标、字体、颜色、交互与交付检查。
- 面板可折叠、可调整宽度，支持桌面快捷键和 Command Center。
- 保持现有教学业务行为和 Tauri invoke 契约。

### Non-Goals
- 本阶段不重写课程状态机、评估算法、知识图谱或 MiMo API。
- 不引入 React/Vue/Tailwind 或新的前端框架。
- 不把应用改成浏览器网站。

## Decisions
- Decision: 继续使用 Tauri v2 + Vanilla JS。Tauri 提供真实 Windows EXE，问题在工作台信息架构而非渲染技术。
- Decision: 保留现有关键 DOM ID（ribbonTop、sidebarBody、tabbar、view、rightPanel、rightBody、statusText、statusModel），降低教学逻辑回归风险。
- Decision: 新增桌面壳交互以独立初始化函数实现；面板状态写入 localStorage。
- Decision: 主题先完成高质量浅色桌面主题，不在本变更内同时扩展完整深色主题。

## Risks / Trade-offs
- app.js 体积较大，UI 与教学逻辑耦合。通过保留 DOM 契约、静态契约测试与浏览器交互回归降低风险。
- UI UX Pro Max 数据库会把 desktop app 误识别为 landing/portfolio。采用其 UX、颜色和字体检索结果，但拒绝与用户桌面形态冲突的页面模板。
- 900px 最小宽度下四列布局紧张。通过可折叠检查器和受限面板宽度解决。

## Migration Plan
1. 建立 UI 契约测试并验证失败。
2. 替换 HTML 桌面外壳，保留关键 ID。
3. 替换 tokens.css 与 style.css。
4. 增加桌面交互初始化、快捷键、面板折叠/调整与 Command Center。
5. 构建、DOM 回归、视觉检查、Tauri dev 验证。
6. UI 验证通过后审查教学模块。
