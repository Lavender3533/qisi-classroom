## ADDED Requirements

### Requirement: Persistent Runtime Model Configuration
The application SHALL persist its own model gateway URL, credential, and task model routes and SHALL optionally import the active local Hermes custom provider on first setup.

#### Scenario: Import configured Hermes provider
- **WHEN** the application has no saved model configuration and the student chooses or permits Hermes import
- **THEN** it SHALL load the active custom provider URL, credential and model without displaying the credential
- **AND** SHALL save the imported configuration in the application database

#### Scenario: No valid configuration
- **WHEN** no valid URL or credential exists
- **THEN** the status bar SHALL display 未配置 instead of 离线
- **AND** teaching requests SHALL direct the student to settings rather than use a dummy credential

### Requirement: Explainable Connection Health
The application SHALL report structured health states including unconfigured, checking, online, authentication error, endpoint error, and transport error.

#### Scenario: Configured gateway is reachable
- **WHEN** the configured models endpoint returns a successful response
- **THEN** the status SHALL become online and show the active chat model

### Requirement: Unified Desktop Commands
Every visible top-level menu item SHALL open a usable menu whose actions share the same command registry used by the command palette and keyboard shortcuts.

#### Scenario: Click top menu
- **WHEN** the student clicks 文件、视图、学习 or 帮助
- **THEN** a keyboard-accessible menu SHALL open with working commands
- **AND** no visible menu item SHALL be a dead control

### Requirement: Continuous Teaching Session
The application SHALL persist and restore the current course, lesson state, step, messages, quiz answers, practice attempts, and pending next action.

#### Scenario: Resume after restart
- **WHEN** the application restarts during an unfinished lesson
- **THEN** it SHALL reopen the lesson at the last committed step without repeating completed work

#### Scenario: Assessed subject has no active lesson plan
- **WHEN** a student opens an assessed subject without a current lesson plan
- **THEN** the application SHALL generate and persist one focused short lesson with observable success criteria
- **AND** SHALL fall back to a valid local explain-practice-check-summary plan if model generation fails

#### Scenario: Lesson step advances from evidence
- **WHEN** the teacher completes an explanation or the student provides sufficient positive practice evidence
- **THEN** the application SHALL keep the explanation step active until the student completes its observable check
- **AND** SHALL commit the next lesson step only after verified independent evidence
- **AND** SHALL enter remediation instead of advancing after repeated difficulty

#### Scenario: Prompted correction is distinguished from independent mastery
- **WHEN** the student corrects an answer after receiving a hint or seeing a worked method
- **THEN** the application SHALL record the correction as prompted evidence
- **AND** SHALL require a new independent check before advancing a mastery-dependent lesson step

### Requirement: Adaptive Teacher Orchestration
The application SHALL act as an active one-to-one teacher by deriving a lesson goal, teaching phase, focus, and next action from the student's assessment status, mastery, recent attempts, and current lesson.

#### Scenario: Student has not completed assessment
- **WHEN** the student opens a subject without a completed assessment
- **THEN** the teacher SHALL enter the diagnostic phase and ask a question that reveals prior knowledge and reasoning

#### Scenario: Student recently answered incorrectly
- **WHEN** recent quiz or practice evidence shows an incorrect attempt
- **THEN** the teacher SHALL identify the weakest relevant knowledge point
- **AND** SHALL lower the instructional step before asking the student to retry

#### Scenario: Student opens an active lesson
- **WHEN** the student enters a classroom with available learning evidence
- **THEN** the workbench SHALL display the teacher's current phase, lesson goal, and next teaching action

#### Scenario: Teacher actively starts and resumes instruction
- **WHEN** an assessed subject has an active lesson that has not started
- **THEN** the teacher SHALL initiate the current lesson step without waiting for the student to speak first
- **AND** after inactivity the teacher MAY give one non-judgmental, easier next action at most once per lesson step

#### Scenario: Internal orchestration is not student speech
- **WHEN** the application asks the teacher to start, continue, summarize, assess, or re-engage
- **THEN** that orchestration command SHALL be sent only as temporary system context
- **AND** SHALL NOT render, persist, or count as a student message or learning-evidence turn

#### Scenario: Teacher updates mastery from an answer
- **WHEN** the model returns a knowledge point update with sufficient confidence and concrete evidence from the student's answer
- **THEN** the application SHALL limit the single-turn mastery change to 0.15
- **AND** SHALL persist the evidence and before/after mastery as a learning event

#### Scenario: Teacher judgment lacks evidence
- **WHEN** a model-generated mastery update has low confidence or no concrete evidence
- **THEN** the application SHALL reject the update without changing the student's learning profile

#### Scenario: Lesson concludes with evidence
- **WHEN** the teacher completes a lesson summary
- **THEN** the application SHALL persist only mastered and weak-point claims backed by concrete lesson evidence
- **AND** SHALL record one review task and one next-lesson focus

#### Scenario: Next lesson uses longitudinal evidence
- **WHEN** the next lesson is planned
- **THEN** the teacher SHALL consider prior strengths, weak points, repeated error patterns, hint dependence, due reviews, and the previous lesson summary
- **AND** SHALL NOT treat a student's question or self-reported understanding as mastery evidence

#### Scenario: Review priority reflects repeated difficulty
- **WHEN** a knowledge point has repeated mistakes or recent failed attempts
- **THEN** its review priority SHALL increase without changing mastery solely because of scheduling

### Requirement: Functional Practice Editor
The practice panel SHALL provide a desktop-grade code editor with contextual completion, diagnostics, hints, execution, validation, feedback, and learning-event persistence.

#### Scenario: Student requests completion
- **WHEN** the student types Python in a lesson practice
- **THEN** the editor SHALL suggest lesson-relevant syntax, variables, functions and snippets
- **AND** accepted suggestions SHALL not reveal the full solution before the final hint level

#### Scenario: Submitted inline code stays with its exercise
- **WHEN** the student submits code from an inline teacher exercise
- **THEN** the originating editor SHALL lock in place and expose reviewing, reviewed, or retry status
- **AND** the student's submitted code and the teacher's review SHALL remain in that exercise without a duplicate student chat bubble
- **AND** reopening the lesson SHALL restore the same submitted exercise and attached review

#### Scenario: Wrong quiz answer receives layered intervention
- **WHEN** the student submits an incorrect in-lesson quiz answer for the first time
- **THEN** the editor SHALL provide a targeted hint without revealing the correct answer and SHALL allow one retry
- **AND** only after a second incorrect attempt SHALL it reveal the answer with an explanation and offer teacher help

### Requirement: Functional Settings and Learning Modules
Every visible setting and module entry SHALL either perform its documented function or present an explicit unavailable state; placeholders MUST NOT masquerade as working controls.

#### Scenario: Save a setting
- **WHEN** the student changes a supported setting and selects 保存
- **THEN** the change SHALL persist and take effect immediately
- **AND** the UI SHALL show a clear success or validation error

#### Scenario: Capability is not yet available
- **WHEN** a visible module has no implemented backend behavior
- **THEN** the UI SHALL identify it as unavailable instead of rendering interactive dead controls
