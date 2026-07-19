# Change: 增加长期教学策略记忆

## Why
当前学习画像只记录知识掌握、错误和复习优先级。即使学生明确要求慢一点，或某种图示/逐步追踪已经被证明有效，下一节课的老师仍可能恢复默认节奏并重复失败过的讲法，这与真人教师的连续观察相差很大。

## What Changes
- 记录学生明确表达的节奏、任务粒度和表示方式偏好，不推断人格或情绪。
- 将学生对待答任务的后续证据归因到上一轮教学策略，区分独立成功、提示后成功、困难和未验证。
- 从跨课时学习事件中提炼已有效策略与应避免重复的策略，并纳入长期学习画像。
- 每轮教师简报和新教案生成都读取教学记忆，优先复用有证据的有效方法，连续失败后换策略。
- 在学习检查器中透明显示老师记住的节奏和教法，避免隐藏式画像。

## Impact
- Affected specs: `continuous-teaching`, `student-app`
- Affected code: `frontend/learning-scheduler.js`, `frontend/teacher-engine.js`, `frontend/app.js`, `src-tauri/src/main.rs`, related tests

