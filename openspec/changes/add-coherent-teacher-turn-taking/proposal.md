# Change: 增加连贯的教师轮次与待答任务

## Why
真实课堂记录中出现了老师在学生尚未回答时连续提出近似问题的情况。当前系统只保存一句 `checkpoint`，无法区分老师正在等待知识答案、作品提交、诊断信息、学习节奏选择还是简单确认，因此非学科回答也可能被误当成掌握证据。

## What Changes
- 每条教师回复生成并持久化结构化待答任务，明确任务类型、证据范围、预期回答格式和知识点。
- 下一轮教师决策必须读取上一条待答任务，知道学生正在回答什么，而不是只按关键词猜测意图。
- 只有知识检查和练习任务允许更新掌握度；诊断回答只允许形成有依据的错因，学习选择和确认不得更新学情。
- 识别犹豫作答、直接索要答案、节奏/负担请求和非知识选择，采用相应教师动作且不伪造掌握证据。
- 主动提醒只提醒尚未完成的原任务，不得生成第二个问题或覆盖原待答任务。

## Impact
- Affected specs: `continuous-teaching`, `formative-assessment`
- Affected code: `frontend/teacher-engine.js`, `frontend/app.js`, `tests/teacher-engine.test.mjs`, `tests/test_desktop_shell_contract.py`

