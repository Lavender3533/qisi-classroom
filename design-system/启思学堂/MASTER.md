# 启思学堂桌面设计系统

> 来源：UI UX Pro Max 设计系统、颜色/字体/UX 检索结果，并以用户指定的 VS Code / Obsidian 桌面工作台形态为最高约束。

## 1. 产品模式

- **Pattern:** Desktop Knowledge Workbench（桌面知识工作台）
- **目标:** 看起来和操作起来都像桌面生产力软件，而不是聊天网页、落地页或卡片仪表盘。
- **基准尺寸:** 1200×800；最小 900×600。
- **固定区域:** 35px 标题栏、48px Activity Bar、可调整主侧栏、标签工作区、可调整检查器、24px 状态栏。

## 2. 信息架构

1. **Title Bar**：应用标识、桌面菜单、Command Center、窗口控制。
2. **Activity Bar**：课堂、笔记、作业、复习；底部为设置。
3. **Primary Sidebar**：当前模块的树/列表、筛选和新增操作。
4. **Editor Group**：标签栏、面包屑/上下文栏、教学或文档内容。
5. **Inspector**：当前科目、学习进度、课堂状态和快捷操作。
6. **Status Bar**：AI 连接、当前科目、课堂阶段、模型和快捷键信息。

## 3. 颜色

| Token | Value | Usage |
|---|---|---|
| `--activity-bg` | `#1E2B2A` | Activity Bar |
| `--activity-hover` | `#2B3B39` | Activity hover |
| `--titlebar-bg` | `#E9EEEC` | 标题栏 |
| `--sidebar-bg` | `#F2F5F3` | 主侧栏 |
| `--workspace-bg` | `#FBFCFA` | 编辑器画布 |
| `--panel-bg` | `#F6F8F6` | 检查器/次级表面 |
| `--surface` | `#FFFFFF` | 输入区和内容面 |
| `--border` | `#D7DFDB` | 分隔线 |
| `--text` | `#17201E` | 主文字 |
| `--text-muted` | `#5F6B67` | 次级文字 |
| `--primary` | `#0F766E` | 选中、焦点、主操作 |
| `--primary-hover` | `#0B5F59` | 主操作 hover |
| `--accent` | `#EA580C` | 重要学习动作 |
| `--success` | `#15803D` | 正确/在线 |
| `--warning` | `#B45309` | 警告/待完成 |
| `--danger` | `#B42318` | 错误/关闭 hover |
| `--focus-ring` | `#0D9488` | 键盘焦点 |

颜色不是唯一状态提示，必须同时提供文字、图标或形状。

## 4. 字体

- **中文 UI / 正文:** `Noto Sans SC`, `Microsoft YaHei UI`, `Segoe UI`, sans-serif。
- **代码:** `Cascadia Code`, `Consolas`, monospace。
- 标题栏/状态栏 12px；侧栏标签 12–13px；正文 14px；教学正文 15–16px，行高 1.7。
- 不使用展示型、卡通型或手写型字体。

## 5. 几何与密度

- 面板主要通过 1px 分隔线区分，不使用大块浮空卡片。
- 圆角：控件 4px，输入框 6px，浮层 8px；禁止 16–24px 的网页卡片圆角。
- Activity Bar 48px；按钮点击区至少 44×44px。
- 主侧栏默认 248px，可调整 200–360px。
- 检查器默认 280px，可调整 240–380px。
- hover 不缩放、不位移，使用颜色/边框/背景 160–220ms 过渡。

## 6. 图标

- 统一使用 Lucide 风格 24×24 SVG，`stroke-width: 1.8–2`。
- UI 控件、模块入口、状态和按钮禁止使用 emoji。
- 科目可以使用字母/缩写或统一 SVG 学科图标；数据库中的 emoji 不直接渲染为界面图标。

## 7. 交互

- `Ctrl+K` / `Ctrl+P`：打开 Command Center。
- `Ctrl+1…5`：切换 Activity Bar 模块。
- `Ctrl+B`：折叠/展开主侧栏。
- `Ctrl+Shift+I`：折叠/展开检查器。
- 面板宽度与折叠状态使用 localStorage 持久化。
- 所有 icon-only button 必须有 `aria-label` 与 `title`。
- Tab 顺序与视觉顺序一致；`:focus-visible` 使用 2px 高对比焦点环。

## 8. 教学内容区

- 课堂内容是编辑器文档，不是居中的网页聊天卡片。
- 教师消息最大阅读宽度 760px，但画布本身占满编辑区。
- 练习/小测作为 editor 内的专用面板或底部 panel，不做网页弹窗。
- 清楚显示当前阶段、知识点和下一步动作。

## 9. 禁止项

- 禁止落地页、Hero、营销 CTA、瀑布流和作品集模式。
- 禁止满屏渐变、玻璃拟态、巨型圆角卡片和过量阴影。
- 禁止 emoji 作为 UI 图标。
- 禁止隐藏键盘焦点、低对比度次级文字和纯颜色状态。
- 禁止为“看起来丰富”添加与学习任务无关的装饰。

## 10. 交付检查

- [ ] 视觉形态为桌面 workbench，而不是网页。
- [ ] 所有模块使用同一 SVG 图标系统。
- [ ] Activity/侧栏/标签/检查器/状态栏层级清晰。
- [ ] 键盘操作可达且焦点可见。
- [ ] 面板可以折叠和调整宽度。
- [ ] 900×600 与 1200×800 无横向溢出。
- [ ] `prefers-reduced-motion` 生效。
- [ ] 教学模块 DOM 契约和 Tauri invoke 契约未被破坏。
