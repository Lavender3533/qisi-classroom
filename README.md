# 启思学堂

启思学堂是一款面向学生的本地优先 AI 私教 Windows 桌面应用。AI 老师会结合摸底结果、知识点掌握度、错题和课堂记录，安排讲解、追问、练习、小测与复习。

## 技术架构

- Tauri v2：Windows 桌面壳与系统能力
- Vanilla JavaScript + Vite：桌面学习工作台
- Rust + rusqlite + SQLite：本地数据、课程状态与练习执行
- OpenAI-compatible API：AI 教师对话与任务模型
- CodeMirror 6：Python 随堂练习和项目文件编辑

有效前端源码位于 `frontend/`，Tauri/Rust 源码位于 `src-tauri/`。

## 开发环境

需要 Node.js、npm、Rust 和 Tauri v2 的 Windows 系统依赖。

```powershell
npm install
npm run tauri:dev
```

只调试浏览器界面时：

```powershell
npm run dev
```

浏览器地址为 `http://localhost:8090`。部分 SQLite 和系统能力只有在 Tauri 窗口中可用。

## 构建

```powershell
npm run build
npm run tauri:build
```

## 测试

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "test_*.py"
cd src-tauri
cargo test
```

## 配置

首次启动后在“设置”中填写模型网关地址、API Key 和聊天模型。应用也支持从本机 Hermes 当前 provider 导入配置。密钥不会显示在状态栏或课堂内容中。

## 主要流程

1. 创建学习科目。
2. 完成基础摸底。
3. AI 老师根据薄弱点确定本节目标。
4. 依次进行讲解、理解检查、练习、小测和总结。
5. 笔记、作业、错题和学习事件保存在本机 SQLite 数据库中。
