# Change: 增加教师语音朗读

## Why
当前 AI 老师只能通过文字授课，学生无法像面对真实老师一样直接听讲；同时，未经控制的自动发声会打断学生思考或误读历史消息。

## What Changes
- 使用 Windows WebView2 的本地语音合成朗读教师回复，不依赖聊天模型或在线 TTS 服务。
- 每条教师消息提供可访问的朗读、暂停、继续和停止状态控制。
- 增加关闭、点击朗读、自动朗读三种模式以及语速设置，默认采用点击朗读。
- 自动朗读仅作用于当前课堂中新生成的教师消息，不朗读历史记录、内部指令或流式半成品。
- 切换标签、关闭课堂或隐藏窗口时停止当前朗读；系统不支持语音合成时明确显示不可用。

## Impact
- Affected specs: `teacher-voice`
- Affected code: `frontend/teacher-voice.js`, `frontend/app.js`, `frontend/style.css`, `tests/teacher-voice.test.mjs`, `tests/test_desktop_shell_contract.py`

