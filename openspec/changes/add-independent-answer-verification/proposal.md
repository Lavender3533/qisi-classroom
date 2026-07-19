# Change: 增加独立作答判卷

## Why
自由对话和代码练习中的学生作答目前由主教师模型同时讲解、判对错并生成 `student_state_update`。客户端只校验字段格式、置信度和证据长度，无法阻止教师模型把错误答案判对或把正确答案判错；一旦误判，知识画像和掌握门槛都会接受错误证据。

## What Changes
- 每个可形成掌握证据的待答任务携带不向学生展示的参考答案、评分要点和允许等价表达，供后续独立判卷使用。
- 学生回答知识检查或练习后，在主教师回复前调用隔离上下文的快速模型进行独立判卷；随堂测验继续使用现有确定性判定，不重复调用模型。
- 独立判卷只读取当前任务、学生本轮答案和必要学科上下文，不读取主教师即将生成的判断，避免同一回复自判自证。
- 客户端以独立判卷结果构造学情更新并约束主教师回复；模型自报的正负更新不得覆盖判卷结果。
- 判卷无效、置信度不足、服务失败或任务本身不可判定时，课堂可以继续，但本轮不得更新掌握度、推进教案或形成具体错因。
- 教师回复若与独立判卷结论矛盾，客户端使用准确、克制的反馈替换矛盾判断并安排必要复查。
- 课堂等待状态显示“正在独立核对答案”，让新增延迟有明确反馈。

## Impact
- Affected specs: `independent-answer-verification`
- Affected code: `frontend/answer-verifier.js`, `frontend/teacher-engine.js`, `frontend/app.js`, `src-tauri/src/main.rs`, `tests/answer-verifier.test.mjs`, `tests/teacher-engine.test.mjs`, `tests/real-answer-verification-eval.mjs`
- API: 新增向后兼容的 Tauri 命令 `verify_student_answer`，不修改现有命令参数。
- Persistence: 隐藏评分契约随现有 `pendingStudentTask` 保存在课堂会话 JSON 中，不新增数据库表。

