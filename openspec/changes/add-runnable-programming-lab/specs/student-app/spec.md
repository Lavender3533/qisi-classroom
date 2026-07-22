## MODIFIED Requirements

### Requirement: Functional Practice Editor
The practice panel and programming lab SHALL provide desktop-grade code editing with language-aware highlighting, contextual assistance, diagnostics, controlled execution, validation, feedback, and learning-event persistence. Python exercises SHALL retain their existing run and validation flow; Java classroom experiments SHALL compile and run through the controlled local JDK runner only after explicit student action.

#### Scenario: Student requests completion
- **WHEN** the student types code in a lesson practice or programming lab
- **THEN** the editor SHALL suggest lesson-relevant syntax, variables, functions and snippets for the active language
- **AND** accepted suggestions SHALL not reveal the full solution before the final hint level

#### Scenario: Submitted inline code stays with its exercise
- **WHEN** the student submits code from an inline teacher exercise or task-bound programming lab
- **THEN** the originating editor SHALL lock the submitted snapshot and expose reviewing, reviewed, or retry status
- **AND** the student's submitted code and the teacher's review SHALL remain attached to that exercise without a duplicate student chat bubble
- **AND** reopening the lesson SHALL restore the same submitted exercise and attached review

#### Scenario: Wrong quiz answer receives layered intervention
- **WHEN** the student submits an incorrect in-lesson quiz answer for the first time
- **THEN** the editor SHALL provide a targeted hint without revealing the correct answer and SHALL allow one retry
- **AND** only after a second incorrect attempt SHALL it reveal the answer with an explanation and offer teacher help

#### Scenario: Java experiment runs locally
- **WHEN** the student explicitly runs a Java classroom experiment
- **THEN** the editor SHALL display the real compiler or JVM result in an attached console
- **AND** successful execution alone SHALL NOT be recorded as mastery evidence

