# Change: 增加独立教学内容复核

## Why
学生自由作答已经有独立判卷，但主教师生成的讲解、示例、图示、下一题和隐藏评分键仍在模型返回后直接进入课堂。现有质量门禁只能检查长度、结构、一次一个问题和教学策略，无法识别错误事实、错误推导、不可解题目或答案键冲突；流式纯文本甚至会在校验前直接显示。

## What Changes
- 对引入或纠正学科知识的教师回合，以及生成新可判定任务的回合，在展示前调用隔离上下文的快速模型进行独立教学复核。
- 复核器独立检查中心结论、数学/代码过程、题目条件、隐藏参考答案、评分要点和学生可见反馈是否一致。
- 复核结果只接受高置信度 `pass` 或带逐字问题证据和完整安全替代回合的 `revise`。
- `revise` 时客户端使用复核后的替代回合，但保留独立判卷拥有的学生证据和错因权威，不允许复核器篡改掌握更新。
- 候选流式内容在复核完成前不直接渲染，界面显示准确的“正在复核讲解与题目”状态。
- 复核失败或低置信度时课堂可继续使用现有保守策略，但记录不可用于声称已通过独立教学复核。

## Impact
- Affected specs: `independent-teaching-review`
- Affected code: `frontend/teacher-review.js`, `frontend/app.js`, `src-tauri/src/main.rs`, `tests/teacher-review.test.mjs`, `tests/real-teacher-review-eval.mjs`, `tests/test_desktop_shell_contract.py`
- API: 新增向后兼容的 Tauri 命令 `review_teacher_turn`。
- Latency: 仅复核讲解、示范、纠错反馈和新可判定任务；等待状态明确展示复核阶段。

