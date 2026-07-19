# Change: 增加实时草稿辅导

## Why
当前教师只有在学生提交答案后才能判断思路。学生在直接作答编辑器里已经写出过程、出现第一处偏差或停在半步时，教师仍然没有任何反应，体验更像提交表单后的批改器，而不是能看着学生解题的一对一老师。

## What Changes
- 为有隐藏评分契约、需要过程作答的当前任务增加透明且可暂停的“老师看草稿”状态。
- 学生停笔后只对有实质变化的草稿发起临时独立核对；每个任务最多两次并设置冷却，不按键逐次请求模型。
- 将可信的临时结果转成编辑器内的小步反馈：确认当前步骤、要求继续补足，或只指出第一处需要检查的位置。
- 草稿观察严格绑定 task key 与草稿指纹；过期、已变化、已提交或已切换任务的结果一律丢弃。
- 按科目保存唯一当前任务草稿并在刷新后恢复；新任务不会继承旧草稿。
- 草稿、临时核对结论与反馈不写入聊天记录、掌握度、错题、正式判卷证据或长期教师记忆。

## Impact
- Affected specs: `live-draft-coaching`
- Affected code: `frontend/classroom-workspace.js`、`frontend/app.js`、`frontend/style.css`、课堂工作区测试与桌面契约测试
- Data migration: 无；草稿和观察偏好只使用本地存储，不修改 SQLite 结构
- External services: 无新增依赖；复用现有 `verify_student_answer` 独立核对命令与 fast model
