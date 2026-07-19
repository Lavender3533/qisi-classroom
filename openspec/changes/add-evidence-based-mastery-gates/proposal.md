# Change: 增加基于证据的掌握门槛

## Why
当前课时步骤只要收到一次置信度足够的正向学情更新就可能推进。这个更新没有严格绑定当前待答任务、教案步骤和达标标准，也不能区分示范后模仿、提示后完成、独立同构练习与独立变式迁移，因此教师可能把偶然答对误判为掌握并过早进入下一步。

## What Changes
- 为每个教案步骤建立由客户端维护的证据账本，记录来源、待答任务、支持级别、证据角色、结果和对应达标标准。
- 将课堂证据分为理解检查、独立同构应用和独立变式迁移；提示后完成只记录为“仍需无提示复查”。
- 只有与当前任务、知识点和步骤门槛一致的新证据才能推进，重复证据、无任务来源证据和无关知识点证据不得推进。
- 教师提示和自动续讲读取同一份掌握状态，明确下一项待验证证据，避免重复已证明内容或提前宣称掌握。
- 课堂总结只能把账本中已有独立证据的内容列为已证明；其余达标标准列为待验证。
- 学习检查器紧凑显示本节“已证明 / 仍待验证 / 提示后待复查”，并为旧会话明确标记证据分级不可追溯。

## Impact
- Affected specs: `evidence-based-mastery`
- Affected code: `frontend/teacher-engine.js`, `frontend/app.js`, `frontend/style.css`, `src-tauri/src/main.rs`, `tests/teacher-engine.test.mjs`, `tests/real-teacher-turn-eval.mjs`, `tests/test_desktop_shell_contract.py`
- Persistence: 复用 `teaching_sessions.session_json`，不新增 SQLite 表或破坏现有 Tauri 命令参数。

