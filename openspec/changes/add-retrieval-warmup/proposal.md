# Change: 新增到期复习检索热身

## Why
应用已经计算到期复习队列，但课堂开场只提供“先复习一道”按钮，老师不会主动使用。真实档案中存在掌握度 0.1、已超过一天的到期知识点，系统仍会直接开始新课；同时若直接复用普通学情更新，到期知识点的正确答案还可能错误推进当前新课步骤。

## What Changes
- 新课开始前检查到期复习，只为至少间隔 12 小时的已学习知识点安排一道低负担检索题。
- 将热身状态持久化为 awaiting_response、remediate 或 completed，重启后不重复出题。
- 热身作答可以更新对应知识画像和触发针对补救，但不得推进当前新课教案步骤。
- 热身独立通过或补救解除后，老师主动引用结果并恢复当前教案，不等待学生再次发话。
- 教师简报显式包含上节课真实证据、到期知识点和当前热身状态，避免跨课时失忆。

## Impact
- Affected specs: continuous-teaching、formative-assessment
- Affected code: frontend/teacher-engine.js、frontend/app.js、frontend/learning-scheduler.js、tests、OpenSpec

