# Project Context

## Purpose
启思学堂是面向学生的 AI 私教 Windows 桌面应用。学生按科目进入摸底、引导式讲解、即时练习、小测、章节评估与复习流程。

## Tech Stack
- Tauri v2（Rust 原生桌面壳）
- Vanilla JavaScript + Vite
- Rust + rusqlite + SQLite
- MiMo OpenAI-compatible API

## Project Conventions

### Code Style
- 所有文本文件使用 UTF-8。
- 前端使用语义化 HTML、CSS 自定义属性和小型纯函数；不引入 UI 框架。
- 界面图标统一使用 SVG，不以 emoji 充当 UI 图标。
- Rust 命令参数和现有 Tauri invoke 名称保持向后兼容。

### Architecture Patterns
- 桌面外壳采用 VS Code/Obsidian 式 workbench：标题栏、Activity Bar、主侧栏、标签工作区、右侧检查器、状态栏。
- 教学状态与渲染逻辑保留在 frontend/app.js；本地持久化和系统能力位于 src-tauri/src/main.rs。
- UI 设计以 design-system/启思学堂/MASTER.md 为唯一视觉规范。

### Testing Strategy
- UI 重构先写静态契约测试并验证失败，再实现。
- 使用 Vite 构建验证、浏览器 DOM/交互回归和 Tauri dev 真实进程验证。
- Rust 变更运行 cargo test；本次纯 UI 重构不得修改教学命令契约。

### Git Workflow
当前目录尚未初始化 Git；修改前保留明确的 OpenSpec 变更记录和验证证据。

## Domain Context
- 学生端，不是教师端。
- 教学模式包括引导学习与学生问答。
- 课程流程：引言 → 分步讲解（图示/练习）→ 即时小测 → 章节评估。
- 零基础学生需要视觉讲解与明确的下一步，不应只得到长段文字。

## Important Constraints
- 最终交付是 Windows 桌面 EXE，不是浏览器网站。
- UI 必须具有桌面软件的信息密度、可调整面板、标签页、快捷键和本地状态感。
- 最小窗口 900×600，主要设计基准 1200×800。
- UI 重构不得破坏摸底、聊天、练习、答题与 SQLite 数据流。

## External Dependencies
- MiMo API: http://43.131.247.174:3000/v1
- Google Fonts（仅字体加载；必须提供系统字体回退）
