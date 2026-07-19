# Change: 增加随堂测验编辑器

## Why
当前随堂测验以内联消息插入聊天流，题目、作答和反馈混在对话中，缺少独立操作空间，也不符合桌面学习工具的工作台体验。学生需要一个类似代码审阅面板的测验编辑器，在不离开课堂的情况下集中完成答题。

## What Changes
- 将 AI 教师触发的随堂小测从聊天内联卡片改为底部停靠的测验编辑器。
- 提供可拖动高度的标题栏、题目工作区、答题区、即时反馈区和明确的提交/关闭操作。
- 支持现有选择题与填空题数据格式，保留学习事件、错题和教学会话持久化。
- 小窗口下限制面板尺寸，课堂上下文仍可见；支持键盘操作、焦点状态与减少动态效果。
- 本次不增加教师出题后台、富文本公式编辑或新的后端题库模型。

## Impact
- Affected specs: quiz-editor
- Affected code: frontend/app.js、frontend/style.css、tests/test_desktop_shell_contract.py、tests/quiz-editor.test.mjs

