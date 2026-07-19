# Change: 增加师生共享课堂工作区

## Why
现有教师已经拥有教案、待答任务、图示和学习证据，但这些状态主要散落在消息历史与检查器中。学生滚动消息后会失去当前任务，回答仍进入通用聊天框，教师无法像真实课堂一样持续维护板书和一个明确的课堂活动。

## What Changes
- 在课堂消息区上方增加持续板书带，展示经过独立复核的当前规则、步骤、对比或纠错要点。
- 在消息区下方增加唯一当前任务工作区，直接显示题目、知识点、期望回答格式与任务绑定的作答编辑器。
- 把快速选项、请求提示和换种讲法纳入当前任务；通用输入框降级为自由提问或补充说明。
- 学生提交时校验任务 key，拒绝已被教师替换的过期任务；有效提交继续进入原有独立判卷、错因诊断与证据链。
- 板书和当前任务写入现有教学会话，刷新、切换标签和续学后恢复；测验或代码练习专用面板打开时不重复显示通用作答区。
- 扩展教师结构化输出和独立内容复核，使 `board_update` 与消息、题目、答案键和图示接受同等级的学科准确性检查。

## Impact
- Affected specs: `shared-classroom-workspace`
- Affected code: `frontend/classroom-workspace.js`、`frontend/teacher-engine.js`、`frontend/teacher-review.js`、`frontend/app.js`、`frontend/style.css`、`src-tauri/src/main.rs`
- Data migration: 无；继续使用 `teaching_sessions.session_json` 的向后兼容字段
- External services: 无新增依赖；继续使用现有教师模型与独立复核模型
