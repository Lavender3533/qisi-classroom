# 教学模块专项审计

## 结论

当前教学模块已经具备“可运行的摸底 + 问答 + 结构化动作原型”，但**还不是完整的引导式课程闭环**。主要问题不是界面，而是课程编排、讲解配图、学习事件和章节评估没有接通。

## 已可用并在本次修复的部分

- 摸底聊天可以调用 MiMo 生成题目，答题后写入知识点并标记摸底完成：`frontend/app.js:911`、`frontend/app.js:1174`。
- “开始学习”原先会因 `subj` 越出块作用域抛 `ReferenceError`；现在通过可测试的 `promoteAssessmentTab()` 正确进入课堂。
- AI 返回裸结构化 JSON 时，协议内容原先会直接显示给学生；现在由 `frontend/teaching-protocol.js` 正确提取可见消息。
- 空题集、坏题型、无效答案索引现在会被拒绝，不再以 0 分误标摸底完成。
- 普通课堂聊天现在通过 `get_chat_history` / `save_chat_message` 读写 SQLite，重启后可以恢复：`frontend/app.js:1271`。
- 结构化动作可以打开代码练习面板或即时小测：`frontend/app.js:279`、`frontend/app.js:319`。
- Python 练习调用名已与 Rust 对齐为 `run_python_code`：`frontend/app.js:261`、`src-tauri/src/main.rs:440`。

## 尚未闭环的问题

### P0 — 零基础讲解配图没有实现

设计协议包含 `visual`，但前端没有任何 `structured.visual` 处理。当前讲解仍以文字为主，不符合“每个概念必须配图、程序生成讲解图”的产品要求。

### P0 — 引导式课程编排没有接通

Rust 已有课程计划、教案、学习事件命令：

- `get_course_plan` / `save_course_plan`：`src-tauri/src/main.rs:159`、`:172`
- `save_lesson_plan` / `get_current_lesson`：`src-tauri/src/main.rs:758`、`:775`
- `save_learning_event`：`src-tauri/src/main.rs:721`

但前端调用数为 **0**。摸底后直接进入通用聊天，没有“引言 → 当前知识点 → 讲解 → 检查理解 → 练习 → 小测 → 总结”的确定性编排。

### P0 — 即时小测和练习结果没有形成学习记录

`renderInlineQuiz()` 只在 DOM 中判断答案；未调用 `save_mistake`、`update_knowledge_mastery` 或 `save_learning_event`。`practicePanel.runCode()` 只显示运行结果，没有按 `expected_output` / `validation_type` / `validation_rule` 判题，也没有把结果交给老师反馈。

### P0 — 章节评估尚不存在

当前只有入门摸底和聊天中的单题小测，没有章节题集、章节通过标准、补学分支或章节成绩持久化。设计文档把它列为后续版本，但当前产品要求已经明确需要章节考试。

### P1 — 摸底过程不能断点恢复

普通课堂聊天已持久化，但摸底阶段的聊天、当前题号、答案和测试阶段仍只存在内存中。应用中途关闭后会重新开始摸底。

### P1 — 代码沙箱与判题仍是开发级

Rust 目前有超时、危险字符串拦截和输出截断，但没有真正的内存上限、网络隔离或文件系统沙箱；前端也没有使用 `validate_code_ast` 和 `check_answer` 完成题目规则判定。

### P1 — AI 请求暴露在 WebView 前端

普通聊天从前端直接请求模型服务并持有 API key。正式版本应由 Rust 后端代理请求，集中处理密钥、超时、取消、重试和日志脱敏。

## 建议实施顺序

1. **讲解可视化渲染器**：先支持受控 JSON → SVG 的变量盒子、流程图、数轴、几何图等，再接图片生成服务。
2. **课程会话与状态机**：摸底完成后生成/读取课程计划和当前教案，禁止退化为自由聊天。
3. **练习/小测事件闭环**：每次作答和代码运行都持久化，并更新画像、错题和下一步分支。
4. **章节评估**：独立于即时小测，支持题集、通过标准、补学和重测。
5. **后端 AI 代理与沙箱加固**。

## 验证证据

- Node 教学协议测试：5/5 通过。
- Python 桌面/数据契约测试：7/7 通过。
- `npm run build`：通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
