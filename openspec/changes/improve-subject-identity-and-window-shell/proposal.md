# Change: 完善科目身份与桌面窗口体验

## Why
无效输入可绕过 AI 命名并成为全局科目名称，造成“1老师”等不自然内容。无边框窗口的实际拖动区域过小，窄窗口下双侧栏还会压缩核心课堂空间。

## What Changes
- 建立统一科目名称校验和显示规则，纯数字、单字符占位符等不得成为正式名称。
- AI 命名失败或结果无效时不再静默创建，要求学生补充具体学习方向。
- 为已有异常名称提供“待命名课程”显示和 AI 完善名称入口。
- 新增科目重命名后端命令并同步标签、面包屑和状态栏。
- 使用程序化窗口拖动和双击最大化，扩大可靠拖动区域。
- 窄窗口首次使用时默认收起检查器，保证课堂宽度。
- 记录教师主动模式为后续待办，本变更不实现。

## Impact
- Affected specs: subject-management, desktop-shell
- Affected code: frontend/app.js、frontend/index.html、frontend/style.css、frontend/subject-naming.js、src-tauri/src/main.rs、tests

