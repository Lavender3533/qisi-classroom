# Change: 重建讲授优先的课堂节奏

## Why
当前课堂虽然生成了教案，但任务连续性规则和掌握证据门槛会在几乎每轮回应后保留或生成题目。学生追问概念时仍被催促原题，答对后又立刻进入下一题，实际体验成为连续测验，无法沿教案稳定向下学习。

## What Changes
- 教案的 `explain` 和 `model` 阶段允许连续完成概念模型、例子和对比讲解，不要求每轮产生待答任务。
- 学生在任务期间提出概念追问时，暂停当前任务并进入讲解分支；讲清后由教师决定继续讲授或在知识块末尾恢复一次检查。
- 日常课堂答对后先反馈、总结本题揭示的规则并推进教案，不再默认立即生成同构题。
- 仅在教案明确的 `practice`、`check`、复习热身和正式评估阶段生成可评分任务。
- 课堂界面明确区分“正在讲授”和“等待作答”，讲授期间不显示空任务或催答状态。

## Impact
- Affected specs: `continuous-teaching`、`teaching-cadence`
- Affected code: `frontend/teacher-engine.js`、`frontend/answer-verifier.js`、`frontend/app.js`、课堂工作区与教学质量测试
- Data migration: 当前被占位任务阻塞的会话恢复后暂停该任务并继续当前教案讲解

