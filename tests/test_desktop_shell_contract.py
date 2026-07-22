from html.parser import HTMLParser
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


class ShellParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.classes = set()
        self.buttons = []
        self._button_stack = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if "class" in attrs:
            self.classes.update(attrs["class"].split())
        if tag == "button":
            button = {"attrs": attrs, "text": ""}
            self.buttons.append(button)
            self._button_stack.append(button)

    def handle_endtag(self, tag):
        if tag == "button" and self._button_stack:
            self._button_stack.pop()

    def handle_data(self, data):
        if self._button_stack:
            self._button_stack[-1]["text"] += data.strip()


class DesktopShellContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (FRONTEND / "index.html").read_text(encoding="utf-8")
        cls.css = (FRONTEND / "style.css").read_text(encoding="utf-8")
        cls.tokens = (FRONTEND / "tokens.css").read_text(encoding="utf-8")
        cls.js = (FRONTEND / "app.js").read_text(encoding="utf-8")
        cls.parser = ShellParser()
        cls.parser.feed(cls.html)

    def test_workbench_has_all_desktop_regions(self):
        required_classes = {
            "titlebar",
            "activity-bar",
            "primary-sidebar",
            "editor-group",
            "inspector",
            "statusbar",
        }
        self.assertTrue(required_classes.issubset(self.parser.classes))
        required_ids = {
            "commandCenter",
            "sidebarResizer",
            "inspectorResizer",
            "commandPalette",
            "sidebarToggle",
            "inspectorToggle",
        }
        self.assertTrue(required_ids.issubset(self.parser.ids))

    def test_static_icon_buttons_are_accessibly_named(self):
        icon_classes = {"titlebar-btn", "icon-btn", "panel-action"}
        unnamed = []
        for button in self.parser.buttons:
            classes = set(button["attrs"].get("class", "").split())
            if classes & icon_classes and not button["attrs"].get("aria-label"):
                unnamed.append(button["attrs"].get("id", button["attrs"].get("class", "button")))
        self.assertEqual([], unnamed)

    def test_shell_supports_focus_reduced_motion_and_panel_resizing(self):
        self.assertIn(":focus-visible", self.css)
        self.assertIn("prefers-reduced-motion", self.css)
        self.assertIn(".panel-resizer", self.css)
        self.assertIn("--sidebar-width", self.tokens)
        self.assertIn("--inspector-width", self.tokens)

    def test_desktop_shortcuts_and_layout_state_are_initialized(self):
        self.assertIn("function initDesktopShell", self.js)
        self.assertIn("Ctrl+K", self.js)
        self.assertIn("Ctrl+B", self.js)
        self.assertIn("Ctrl+Shift+I", self.js)
        self.assertRegex(self.js, r"localStorage\.(getItem|setItem)")

    def test_custom_titlebar_supports_programmatic_dragging(self):
        self.assertIn("appWindow.startDragging()", self.js)
        self.assertIn("titlebar?.addEventListener('dblclick'", self.js)
        self.assertIn("isInteractiveTarget", self.js)

    def test_application_overlays_leave_the_titlebar_draggable(self):
        for selector in (
            ".info-dialog-overlay",
            ".command-palette-overlay",
            ".modal-overlay",
        ):
            rule = re.search(
                rf"{re.escape(selector)}\s*\{{(?P<body>[\s\S]*?)\}}",
                self.css,
            )
            self.assertIsNotNone(rule, f"missing overlay rule: {selector}")
            self.assertIn(
                "inset: var(--titlebar-height) 0 0",
                rule.group("body"),
                f"{selector} must not intercept titlebar dragging",
            )

    def test_narrow_window_prioritizes_the_classroom(self):
        self.assertIn("window.innerWidth < 1050", self.js)
        self.assertIn("narrowWorkbench || storedInspectorCollapsed === 'true'", self.js)
        self.assertIn("nextNarrowWorkbench && !narrowWorkbench", self.js)

    def test_inspector_exposes_evidence_based_lesson_status(self):
        self.assertIn("buildLessonMasterySnapshot", self.js)
        self.assertIn("lesson-evidence-panel", self.js)
        self.assertIn("lesson-evidence-panel", self.css)
        for label in ("已证明", "待复查", "待验证"):
            self.assertIn(label, self.js)

    def test_free_response_grading_is_independent_and_visible(self):
        self.assertIn("verify_student_answer", self.js)
        self.assertIn("APP_CONFIG.models.fast || APP_CONFIG.models.chat", self.js)
        self.assertIn("正在独立核对答案", self.js)
        self.assertIn("applyAnswerVerificationToTeacherTurn", self.js)
        footer = re.search(
            r"function renderTeacherMoveFooter\([\s\S]*?\n\}",
            self.js,
        )
        self.assertIsNotNone(footer)
        self.assertNotIn("assessment", footer.group(0))
        self.assertNotIn("referenceAnswer", footer.group(0))

    def test_knowledge_bearing_teacher_content_is_reviewed_before_rendering(self):
        backend = (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        self.assertIn("review_teacher_turn", self.js)
        self.assertIn("review_teacher_turn", backend)
        self.assertIn("APP_CONFIG.models.fast || APP_CONFIG.models.chat", self.js)
        self.assertIn("正在复核讲解与题目", self.js)
        self.assertIn("shouldReviewTeacherTurn", self.js)
        self.assertIn("normalizeTeacherReview", self.js)
        self.assertIn("applyTeacherReview", self.js)
        stream_blocks = re.findall(
            r"const unlisten = await listen\('chat-stream'[\s\S]*?payload\.type === 'done'",
            self.js,
        )
        stream_content = next(
            (block for block in stream_blocks if "老师正在组织讲解" in block),
            None,
        )
        self.assertIsNotNone(stream_content)
        self.assertIn("payload.requestId !== requestId", stream_content)
        self.assertIn("botText += payload.text", stream_content)
        self.assertNotIn("botEl.textContent = botText", stream_content)

    def test_assessment_never_streams_internal_teacher_protocol(self):
        assessment = re.search(
            r"async function sendChat[\s\S]*?quickRepliesEl\?\.addEventListener",
            self.js,
        )
        self.assertIsNotNone(assessment)
        self.assertIn("parsed.unsafe", assessment.group(0))
        self.assertNotIn("botEl.textContent = botText", assessment.group(0))
        self.assertIn("老师正在组织下一个摸底任务", assessment.group(0))

    def test_stream_events_are_isolated_per_request(self):
        backend = (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        self.assertIn('request_id: String', backend)
        self.assertIn('"requestId": request_id', backend)
        self.assertEqual(self.js.count("const requestId = crypto.randomUUID()"), 3)
        self.assertGreaterEqual(self.js.count("payload.requestId !== requestId"), 3)

    def test_static_shell_does_not_use_emoji_as_ui_icons(self):
        titlebar = re.search(r'<header class="titlebar"[\s\S]*?</header>', self.html)
        self.assertIsNotNone(titlebar)
        forbidden = ["📚", "⚙", "➕", "🔍"]
        for symbol in forbidden:
            self.assertNotIn(symbol, titlebar.group(0))

    def test_backend_does_not_seed_demo_subjects(self):
        backend = (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        for subject_id in ("python", "math", "eng", "physics"):
            self.assertNotIn(
                f"VALUES ('{subject_id}'",
                backend,
                f"backend still seeds demo subject: {subject_id}",
            )
        self.assertIn(
            "remove_demo_subjects_v1",
            backend,
            "backend must include a one-time cleanup migration for existing demo rows",
        )

    def test_teaching_chat_uses_persistent_history(self):
        self.assertIn("invoke('get_chat_history'", self.js)
        self.assertIn("invoke('save_chat_message'", self.js)

    def test_model_settings_save_and_import_real_configuration(self):
        self.assertIn("invoke('save_config'", self.js)
        self.assertIn("invoke('import_hermes_config'", self.js)
        self.assertIn('id="settingsApiKey"', self.js)
        self.assertIn('id="settingsSave"', self.js)

    def test_tauri_csp_allows_the_configured_model_gateway(self):
        tauri_config = (ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
        self.assertIn("connect-src", tauri_config)
        self.assertIn("http:", tauri_config)
        self.assertIn("https:", tauri_config)

    def test_top_menus_use_the_shared_command_registry(self):
        for menu in ("file", "view", "learning", "help"):
            self.assertIn(f'data-menu="{menu}"', self.html)
        self.assertIn("function initDesktopMenus", self.js)
        self.assertIn("createCommandRegistry", self.js)
        self.assertIn("openTab('setting-set1', '模型设置', 'settings')", self.js)

    def test_learning_modules_expose_real_actions(self):
        for control_id in ("homeworkCreateToggle", "homeworkCreate", "homeworkTitle"):
            self.assertIn(f'id="{control_id}"', self.js)
        self.assertIn("update_homework_status", self.js)
        self.assertIn("hw-ask", self.js)
        self.assertIn("review-point-action", self.js)
        self.assertIn("review-mistake-action", self.js)

    def test_notes_use_workbench_feedback_instead_of_browser_alerts(self):
        self.assertNotIn("alert('", self.js)
        self.assertIn("showToast('笔记已保存'", self.js)

    def test_practice_checks_match_boolean_tauri_contracts(self):
        self.assertIn("const answerCorrect = await invoke('check_answer'", self.js)
        self.assertIn("const astValid = await invoke('validate_code_ast'", self.js)
        self.assertNotIn("checkResult.correct", self.js)
        self.assertNotIn("astResult.valid", self.js)
        self.assertIn("errorType: result.error_type", self.js)
        editor = (FRONTEND / "codemirror-setup.js").read_text(encoding="utf-8")
        self.assertIn("check_python_syntax", editor)
        self.assertIn("lintGutter()", editor)
        self.assertIn("setCompletions(items)", editor)

    def test_teaching_session_restores_assessment_and_pending_actions(self):
        self.assertIn("invoke('get_teaching_session'", self.js)
        self.assertIn("invoke('save_teaching_session'", self.js)
        self.assertIn("savedSession?.assessment", self.js)
        self.assertIn("pendingAction?.type === 'open_practice_panel'", self.js)

    def test_classroom_generates_persists_and_advances_a_real_lesson_plan(self):
        self.assertIn("invoke('generate_lesson_plan'", self.js)
        self.assertIn("invoke('save_lesson_plan'", self.js)
        self.assertIn("invoke('complete_lesson_plan'", self.js)
        self.assertIn("normalizeLessonPlan", self.js)
        self.assertIn("createFallbackLessonPlan", self.js)
        self.assertIn("updateLessonProgress", self.js)
        self.assertIn("lessonProgress", self.js)
        self.assertIn("studentStateUpdate: progressEvidence", self.js)
        self.assertIn("eventType,", self.js)
        self.assertIn("normalizeLessonSummary", self.js)
        self.assertIn("lastLessonSummary", self.js)
        self.assertIn("开始下一节", self.js)
        self.assertIn("session.lastLessonSummary?.next_lesson_focus", self.js)
        self.assertIn("skipOpeningWarmup: true", self.js)
        self.assertIn("if (event.currentTarget.dataset.action === 'next-lesson')", self.js)

    def test_java_programming_lab_compiles_runs_and_stays_task_bound(self):
        self.assertIn("id=\"programmingLab\"", self.js)
        self.assertIn("invoke('check_java_runtime')", self.js)
        self.assertIn("invoke('run_java_code'", self.js)
        self.assertIn("buildLabSubmission", self.js)
        self.assertIn("currentTask?.key !== submission.taskKey", self.js)
        self.assertIn("programming_lab_run", self.js)
        rust = (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        self.assertIn("async fn run_java_code", rust)
        self.assertIn("kill_on_drop(true)", rust)
        self.assertIn("JAVA_FORBIDDEN_PATTERNS", rust)
        self.assertIn("event_type === 'practice_submit'", (FRONTEND / "learning-scheduler.js").read_text(encoding="utf-8"))
        self.assertIn("buildLearnerProfile", self.js)
        self.assertIn("老师的持续观察", self.js)
        self.assertIn("hideStudentMessage: true", self.js)

    def test_teacher_persists_a_grounded_adaptive_intervention(self):
        self.assertIn("normalizeLearningDiagnosis", self.js)
        self.assertIn("updateLearningIntervention", self.js)
        self.assertIn("deriveInterventionTransition", self.js)
        self.assertIn("activeIntervention: interventionTransition.activeIntervention", self.js)
        self.assertIn("teacher_intervention_resolved", self.js)
        self.assertIn("history[0] = latestSystemPrompt", self.js)
        self.assertIn("interventionTransition.activeIntervention", self.js)
        self.assertIn("!state.teachingSessions[subjectId]?.activeIntervention", self.js)
        self.assertIn("errorType: 'unclassified_quiz_error'", self.js)
        self.assertNotIn("errorType: 'concept_gap'", self.js)

    def test_quiz_uses_a_resizable_docked_editor(self):
        self.assertIn("const quizPanel =", self.js)
        self.assertIn("quizPanel.open(action.quiz, subjectId)", self.js)
        self.assertIn("quizPanel.open(pendingAction.quiz, subjectId)", self.js)
        self.assertIn('role="separator"', self.js)
        self.assertIn("Ctrl+Enter", (ROOT / "openspec" / "changes" / "add-quiz-editor" / "specs" / "quiz-editor" / "spec.md").read_text(encoding="utf-8"))
        self.assertIn(".quiz-panel", self.css)
        self.assertIn(".question-code", self.css)
        self.assertIn("planQuizAttempt(this._quiz, result, this._attempts)", self.js)
        self.assertIn("attempt_count: this._attempts", self.js)
        self.assertIn("commitQuizEvidence?.({", self.js)
        self.assertIn("question: this._quiz.question", self.js)
        self.assertIn("老师正在根据本次表现继续课堂", self.js)
        self.assertIn("老师正在针对卡点补讲", self.js)
        self.assertNotIn("quiz-ask-teacher", self.js)
        self.assertNotIn("正确答案：${correctAnswer}", self.js)

    def test_teacher_automatically_takes_over_lesson_transitions(self):
        self.assertIn("planTeacherContinuation", self.js)
        self.assertIn("queueTeacherContinuation", self.js)
        self.assertIn("flushTeacherContinuation", self.js)
        self.assertIn("lastTeacherContinuationKey", self.js)
        self.assertIn("lastTeacherContinuationKey: null", self.js)
        self.assertIn("source: 'quiz'", self.js)
        self.assertIn("source: 'chat'", self.js)
        self.assertIn("internalCommand: true", self.js)

    def test_teacher_runs_due_retrieval_before_the_main_lesson(self):
        self.assertIn("planRetrievalWarmup", self.js)
        self.assertIn("updateRetrievalWarmup", self.js)
        self.assertIn("enforceStudentEvidenceSupport", self.js)
        self.assertIn("reviewWarmup", self.js)
        self.assertIn("openingWarmupContinuation", self.js)
        self.assertIn("continuationKind === 'review_warmup'", self.js)
        self.assertIn("const progressEvidence = isReviewResponse", self.js)
        self.assertIn("source: 'review'", self.js)
        self.assertIn("warmupCompleted: true", self.js)
        self.assertIn("lastTeacherContinuationKey: null", self.js)

    def test_teacher_messages_render_code_without_model_html(self):
        self.assertIn("function renderRichMessage", self.js)
        self.assertIn("document.createElement('pre')", self.js)
        self.assertIn("code.textContent = codeText", self.js)

    def test_incomplete_teacher_code_is_directly_editable(self):
        self.assertIn("isEditableCodeExercise(codeText)", self.js)
        self.assertIn("message-code-editor", self.js)
        self.assertIn("直接编辑代码练习", self.js)
        self.assertIn("event.key === 'Tab'", self.js)
        self.assertIn("editor.value.matchAll(/_{3,}/g)", self.js)
        self.assertIn("event.ctrlKey", self.js)
        self.assertIn("提交练习", self.js)
        self.assertIn("let submitCodeExerciseToTeacher = null", self.js)
        self.assertIn("submitCodeExerciseToTeacher = (draft, exerciseTarget) =>", self.js)
        self.assertIn("submitCodeExerciseToTeacher?.(draft, exercise)", self.js)
        self.assertIn("formatStudentMessageForDisplay(msg.content)", self.js)
        self.assertIn("formatStudentMessageForDisplay(text)", self.js)
        self.assertIn("getCodeExerciseSubmission(msg.content)", self.js)
        self.assertIn("exercise.classList.toggle('is-submitted', locked)", self.js)
        self.assertIn("const languageId = match[1].trim() || 'text'", self.js)
        self.assertIn("${languageId}\\n${answer}", self.js)
        self.assertNotIn("${match[1].trim() || 'text'}", self.js)
        self.assertNotIn("!answer || isEditableCodeExercise(answer)", self.js)

    def test_code_submission_and_teacher_review_stay_in_originating_exercise(self):
        self.assertIn("exercise.className = 'inline-code-exercise'", self.js)
        self.assertIn("getOrCreateInlineExerciseReview", self.js)
        self.assertIn("let pendingExerciseReview = null", self.js)
        self.assertIn("setInlineCodeExerciseState(exerciseReview, 'reviewed')", self.js)
        self.assertIn("void send(draft, { hideStudentMessage: true, exerciseTarget })", self.js)
        self.assertIn("reuseUserMessage: !internalCommand", self.js)
        self.assertIn('.inline-exercise-review', self.css)

    def test_classroom_exposes_rhythm_resume_and_controlled_nudges(self):
        self.assertIn('class="lesson-rhythm"', self.js)
        self.assertIn('id="resumeStrip"', self.js)
        self.assertIn('id="teacherNudge"', self.js)
        self.assertIn("reply === '稍后练习'", self.js)
        self.assertIn("deferredRecheck: { task, deferredAt: new Date().toISOString() }", self.js)
        self.assertIn("pendingStudentTask: session.deferredRecheck.task", self.js)
        self.assertIn("上次保存了一道迁移练习", self.js)
        self.assertIn("continuationKind === 'instructional_recheck'", self.js)
        self.assertIn("kind: 'instructional_recheck_retry'", self.js)
        self.assertIn("restore-missing-recheck", self.js)
        self.assertIn("const restoredContinuation = cadenceRecoveryContinuation", self.js)
        self.assertIn("suspendedStudentTask: respondingStudentTask", self.js)
        self.assertIn("刚才的练习已暂停", self.js)
        self.assertIn("老师正在讲解，可随时追问", self.js)
        self.assertIn("teacherBrief.lessonStep?.phase !== 'practice'", self.js)
        self.assertIn("const shouldDiscardChainedRecheck", self.js)
        self.assertIn("scheduleProactiveNudge(180000)", self.js)
        self.assertIn("warmclassroom.teacher.proactive", self.js)
        self.assertIn("internalCommand = false", self.js)
        self.assertIn("const recordStudentTurn = !internalCommand && !reuseUserMessage", self.js)
        self.assertIn("if (recordStudentTurn) history.push", self.js)
        self.assertIn("isInternalTeacherCommand(content)", self.js)
        self.assertIn("lessonStarted: true", self.js)
        self.assertIn("lastProactiveNudgeKey", self.js)
        self.assertIn("{ hideStudentMessage: true, internalCommand: true }", self.js)
        self.assertIn("不要等待学生先提问", self.js)
        self.assertIn("学生暂时没有继续", self.js)
        self.assertIn("assessTeacherTurnQuality", self.js)
        self.assertIn("verifiedStudentStateUpdate", self.js)
        self.assertIn("teacher_quality_warning", self.js)

    def test_teacher_voice_is_message_scoped_and_lifecycle_safe(self):
        voice_module = (FRONTEND / "teacher-voice.js").read_text(encoding="utf-8")
        self.assertIn("createBrowserTeacherVoice", self.js)
        self.assertIn("createTeacherVoiceButton", self.js)
        self.assertIn("bindTeacherVoiceControl", self.js)
        self.assertIn("data-voice-mode=\"manual\"", self.js)
        self.assertIn('id="teacherVoiceRate"', self.js)
        self.assertIn("autoSpeak: createdGreeting", self.js)
        self.assertIn("bindTeacherVoiceControl(botEl, message, { autoSpeak: true })", self.js)
        self.assertIn("shouldAutoSpeakTeacherMessage", self.js)
        self.assertIn("markStudentVoiceTurn", self.js)
        self.assertIn("releaseStudentVoiceTurn", self.js)
        self.assertIn("#assessInput", self.js)
        self.assertIn(".quiz-editor-input", self.js)
        self.assertIn(".practice-editor", self.js)
        self.assertIn("bindTeacherVoiceControl(b, b.textContent, { autoSpeak: true })", self.js)
        self.assertIn("document.hidden", self.js)
        self.assertIn("teacherVoice.stop()", self.js)
        self.assertIn("speechSynthesis", voice_module)
        self.assertIn("TEACHER_VOICE_MODES.AUTO", voice_module)
        self.assertIn("isTeacherVoiceAutoplayBlocked", voice_module)
        self.assertIn("这里有一段代码，请看屏幕", voice_module)
        self.assertIn(".teacher-voice-button", self.css)
        self.assertIn(".teacher-voice-rate", self.css)

    def test_teacher_preserves_the_pending_student_task_across_turns(self):
        self.assertIn("normalizeStudentTask", self.js)
        self.assertIn("pendingStudentTask", self.js)
        self.assertIn("respondingStudentTask", self.js)
        self.assertIn("studentTaskAllowsDiagnosisEvidence", self.js)
        self.assertIn("pendingStudentTask: respondingStudentTask", self.js)
        self.assertIn("respondingToTask", self.js)
        self.assertIn("pendingStudentTask: nextStudentTask", self.js)
        self.assertIn("continuationKind: 'checkpoint_reminder'", self.js)
        self.assertIn("提醒我原任务", self.js)
        self.assertIn("不提出第二个问题", self.js)
        self.assertNotIn("给我一个两分钟内能完成的小任务", self.js)

    def test_active_task_stays_adjacent_to_the_teacher_message(self):
        self.assertIn("messagesEl.classList.add('has-active-task')", self.js)
        self.assertIn("messagesEl.classList.remove('has-active-task')", self.js)
        self.assertIn("composerShellEl?.classList.add('has-active-task')", self.js)
        self.assertIn(".messages.has-active-task", self.css)
        self.assertIn(".composer-shell.has-active-task", self.css)
        self.assertIn("overflow: auto", self.css)

    def test_chat_history_is_reconciled_on_every_classroom_open(self):
        chat_init = re.search(
            r"async function initChat[\s\S]*?function renderExistingHistory",
            self.js,
        )
        self.assertIsNotNone(chat_init)
        self.assertIn("invoke('get_chat_history', { subjectId })", chat_init.group(0))
        self.assertIn("reconcileChatHistory", chat_init.group(0))
        self.assertIn("persistedMessages: persistedHistory", chat_init.group(0))
        self.assertIn("memoryHistory", chat_init.group(0))
        self.assertNotIn("if (!state.chatHistory[subjectId])", chat_init.group(0))

    def test_classroom_has_persistent_board_and_task_bound_answer_workspace(self):
        workspace_module = (FRONTEND / "classroom-workspace.js").read_text(encoding="utf-8")
        self.assertIn('id="classroomBoard"', self.js)
        self.assertIn('id="taskWorkspace"', self.js)
        self.assertIn('id="taskAnswer"', self.js)
        self.assertIn('id="taskSubmit"', self.js)
        self.assertIn('id="taskHint"', self.js)
        self.assertIn('id="taskAlternate"', self.js)
        self.assertIn("deriveClassroomTaskWorkspace", self.js)
        self.assertIn("isCurrentTaskSubmission", self.js)
        self.assertIn("applyTeachingBoardUpdate", self.js)
        self.assertIn("sourceTaskKey", self.js)
        self.assertIn("teachingBoard", self.js)
        self.assertIn("pendingAction", workspace_module)
        self.assertIn("taskWorkspaceEl.dataset.answerMode", self.js)
        self.assertIn("taskWorkspaceEl.dataset.editorType", self.js)
        self.assertIn('id="taskResizeHandle"', self.js)
        self.assertIn('id="taskCodeEditor"', self.js)
        self.assertIn("createTaskCodeEditor", self.js)
        self.assertNotIn("referenceAnswer", self.js[self.js.index('function renderClassroomWorkspace'):self.js.index('function renderClassroomWorkspace') + 5000])
        self.assertIn(".classroom-board", self.css)
        self.assertIn(".task-workspace", self.css)
        self.assertIn('.task-workspace[data-answer-mode="extended"]', self.css)
        self.assertIn('.task-workspace[data-editor-type="code"] #taskAnswer', self.css)
        self.assertIn("font-family: var(--font-mono)", self.css)
        self.assertIn("cursor: ns-resize", self.css)
        self.assertIn(".messages.has-active-task .teacher-move-footer", self.css)
        self.assertIn('.composer-shell.has-active-task > .composer', self.css)
        self.assertRegex(
            self.css,
            r'\.messages\.has-active-task\s*\{[^}]*max-height:\s*none;[^}]*flex:\s*0 1 auto;',
        )
        self.assertRegex(
            self.css,
            r'\.composer-shell\.has-active-task\s*\{[^}]*flex:\s*1 1 auto;',
        )
        self.assertIn('.composer-shell.has-active-task[data-task-editor="code"]', self.css)
        self.assertIn('.task-workspace[data-editor-type="code"] .task-answer-editor', self.css)
        self.assertIn('id="taskPanelToggle"', self.js)
        self.assertIn("setTaskPanelCollapsed", self.js)
        self.assertIn('.task-workspace[data-editor-type="code"].is-collapsed', self.css)
        self.assertIn("const minimum = 280", self.js)
        self.assertIn("taskView.quickReplies", self.js)
        self.assertIn("appendInlineCode(taskPromptEl, taskView.prompt)", self.js)
        self.assertRegex(self.css, r'#taskAnswer\s*\{[^}]*min-height:\s*84px;')
        self.assertIn('.composer-shell.has-active-task:not([data-task-editor="code"])', self.css)
        self.assertIn('min-height: min(240px, 46vh)', self.css)
        self.assertIn('.composer-shell.has-active-task:not([data-task-editor="code"]) .task-status', self.css)
        self.assertIn('margin-top: auto', self.css)
        self.assertIn('taskWorkspaceEl.scrollTop = 0', self.js)
        self.assertIn('padding-bottom: 0', self.css)
        self.assertIn('.task-status:empty { display: none; }', self.css)
        self.assertIn("resolvedStatus === '等待作答' ? '' : resolvedStatus", self.js)
        self.assertIn('.composer-shell.has-active-task:not([data-task-editor="code"]) #taskAnswer', self.css)
        self.assertIn('.composer-shell.has-active-task:not([data-task-editor="code"]) .task-answer-actions', self.css)
        self.assertIn('align-self: end', self.css)
        self.assertIn("data-ghost-hint", self.css)
        self.assertIn("renderTaskSubmissionArtifact", self.js)
        self.assertIn(".task-submission-artifact", self.css)
        self.assertIn("traceSimpleJavaAccumulator", self.js)
        self.assertIn('id="taskOriginal"', self.js)
        self.assertIn("pendingQuickReplies", self.js)
        self.assertIn("extractChoiceRepliesFromText", self.js)
        self.assertIn(".inline-quick-replies", self.css)
        self.assertRegex(
            self.css,
            r"\.teaching-visual\s*\{[^}]*width:\s*min\(100%,\s*720px\);[^}]*align-self:\s*center;",
        )
        self.assertNotRegex(
            self.css,
            r"@media\s*\(max-width:\s*1050px\)[\s\S]*?\.teaching-visual\s*\{\s*width:\s*100%;",
        )
        self.assertRegex(
            self.js,
            r"taskHintEl\?\.addEventListener[\s\S]*?hideStudentMessage: true,[\s\S]*?internalCommand: true",
        )
        self.assertRegex(
            self.js,
            r"taskAlternateEl\?\.addEventListener[\s\S]*?hideStudentMessage: true,[\s\S]*?internalCommand: true",
        )
        self.assertIn("reuseStudent", self.js)
        self.assertIn(".assessment-request-error", self.css)
        self.assertIn(".assess-phase .teacher-move-footer", self.css)
        self.assertIn("assessmentGenerating", self.js)
        self.assertIn("if (nextStage.readyForTest) await startTest()", self.js)
        self.assertIn("assessment-retry-generate", self.js)
        self.assertIn("assessment-generation-state", self.css)
        self.assertIn("previousRow?.classList.contains(roleClass)", self.js)
        self.assertIn("message-content message-segment", self.js)

    def test_teacher_observes_process_drafts_without_promoting_them_to_evidence(self):
        workspace_module = (FRONTEND / "classroom-workspace.js").read_text(encoding="utf-8")
        self.assertIn('id="taskObserverToggle"', self.js)
        self.assertIn('id="draftCoach"', self.js)
        self.assertIn("shouldObserveStudentDraft", self.js)
        self.assertIn("isDraftObservationSnapshotCurrent", self.js)
        self.assertIn("deriveDraftCoachingFeedback", self.js)
        self.assertIn("serializeTaskDraft", self.js)
        self.assertIn("restoreTaskDraft", self.js)
        self.assertIn("verify_student_answer", self.js)
        self.assertIn("allowDraftObservation", workspace_module)
        self.assertIn(".task-observer-switch", self.css)
        self.assertIn(".draft-coach", self.css)
        observer_start = self.js.index("async function observeCurrentDraft")
        observer_end = self.js.index("function renderClassroomWorkspace", observer_start)
        observer_slice = self.js[observer_start:observer_end]
        self.assertNotIn("save_chat_message", observer_slice)
        self.assertNotIn("add_knowledge_point", observer_slice)
        self.assertNotIn("save_mistake", observer_slice)
        self.assertNotIn("persistTeachingSession", observer_slice)

    def test_teacher_persists_and_exposes_longitudinal_teaching_memory(self):
        scheduler = (FRONTEND / "learning-scheduler.js").read_text(encoding="utf-8")
        teacher = (FRONTEND / "teacher-engine.js").read_text(encoding="utf-8")
        backend = (ROOT / "src-tauri" / "src" / "main.rs").read_text(encoding="utf-8")
        for symbol in (
            "deriveTeachingPreferenceSignal",
            "updateTeachingPreferences",
            "deriveTeachingStrategyOutcome",
        ):
            self.assertIn(symbol, scheduler)
            self.assertIn(symbol, self.js)
        self.assertIn("buildTeachingMemory", scheduler)
        self.assertIn("'teaching_preference'", self.js)
        self.assertIn("'teacher_strategy_outcome'", self.js)
        self.assertIn("teachingPreferences", self.js)
        self.assertIn("teachingStrategy", teacher)
        self.assertIn("学习节奏", self.js)
        self.assertIn("有效讲法", self.js)
        self.assertIn("需要换用", self.js)
        self.assertIn("longitudinal_profile.teachingMemory", backend)
        self.assertIn("避开连续困难的策略", backend)


if __name__ == "__main__":
    unittest.main()
