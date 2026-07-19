# Change: 增加逐步错因定位

## Why
当前独立判卷能可靠判断整份作答正确或错误，但多步骤答案仍只有整体结论和自由文本理由。客户端无法验证教师是否保留了学生已经做对的部分、是否找到了第一处错误，也无法阻止主教师把具体步骤错误泛化为“概念不懂”后从头重讲。

## What Changes
- 独立判卷为错误作答返回可逐字核验的已成立片段、第一处错误片段、错误类型和单一修正原则。
- 客户端验证引用是否来自学生本轮原话、正确片段是否位于错误片段之前；定位证据无效时不得形成具体错因。
- 客户端用可信定位结果构造权威错因诊断，覆盖主教师自行猜测的诊断标签。
- 教师反馈保留学生已做对的步骤，只处理第一处错误，并把下一任务缩小到对该错误的最小修正或辨析。
- 增加数学多步推理、代码边界、只有最终答案和答案注入场景的真实模型评测。

## Impact
- Affected specs: `stepwise-error-localization`
- Affected code: `frontend/answer-verifier.js`, `frontend/teacher-engine.js`, `frontend/app.js`, `src-tauri/src/main.rs`, `tests/answer-verifier.test.mjs`, `tests/teacher-engine.test.mjs`, `tests/real-stepwise-diagnosis-eval.mjs`
- API: 扩展现有 `verify_student_answer` 返回 JSON；命令名称和参数保持兼容。
- Persistence: 复用现有 `learning_diagnosis` 学习事件和教学会话字段，不新增数据库表。

