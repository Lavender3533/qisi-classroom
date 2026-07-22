# Change: 教师纠错后先完整讲解再复查

## Why
现有引导纠错闭环过度强调掌握证据，学生答错后会被要求反复修正原题，老师却不一定完整讲解并公布正确答案。这把日常教学变成了连续测评，也让学生在尚未获得教学时承担“必须答对”的压力。

## What Changes
- 在日常课堂学习模式中，学生首次提交错误答案后，教师直接判断错误、指出具体差异、完整演示正确过程并明确给出正确答案。
- 教师讲解后结束原题，不再要求学生反复提交同一道题或判断自己的答案是否满足标准。
- 理解验证使用一道只改变一个条件的新同构题；新题结果才作为独立掌握证据。
- 摸底、章节评估和明确考试模式继续按测评规则延迟公布答案，避免泄题。
- 客户端纠错状态从“修到原题正确”调整为“已讲解、等待迁移复查”，并兼容恢复旧纠错会话。

## Impact
- Affected specs: `instructional-correction`、`guided-repair-closure`、`continuous-teaching`
- Affected code: `frontend/answer-verifier.js`、`frontend/teacher-engine.js`、`frontend/app.js`、教学质量评测与测试
- API: 不新增原生命令
- Data migration: 旧 `repair_step` / `retry_original` 会话恢复后转为已讲解后的迁移检查
