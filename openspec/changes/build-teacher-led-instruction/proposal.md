# Change: 建立教师主导的教学闭环

## Why
当前模型虽然使用教师语气，但交互仍以自由聊天为主。每轮缺少明确教学意图、证据目标、学生动作和阶段推进，因此学生感受到的是对话机器人，而不是能组织课堂的一对一老师。

## What Changes
- 建立教师动作协议，每轮只能执行诊断、澄清、示范、提问、提示、练习、反馈或总结中的一个动作。
- 摸底访谈按学习目标、已有经验、代表性任务和迁移检查确定性推进。
- 强制模型返回结构化教学回合，包含本轮目的、学生下一步和可验证的学情证据。
- 将教师消息从普通聊天气泡改为课堂讲解块；教学目的集中显示在课堂抬头，每轮回复只显示学生下一步，避免暴露编排术语。
- 使用真实模型场景评估教学主导性、证据约束和阶段推进。

## Impact
- Affected specs: continuous-teaching, formative-assessment
- Affected code: frontend/teacher-engine.js、frontend/app.js、frontend/style.css、tests
