# Context Guardian v2 — Tech Spec

Status: draft
Revision: v2.1
Owner: local repo design doc
Target: `extensions/context-guardian/`
Language: Russian

## 1. Зачем переписывать

Текущий `context-guardian` решает реальную проблему: модель деградирует в длинной сессии, поэтому нужен ранний compaction и durable state вне обычного prompt history.

Но у текущей версии есть архитектурный дефект trust model:

1. модель сама пишет durable task state;
2. модель сама пишет compaction resume packet;
3. затем оба артефакта инжектятся обратно как `source of truth`;
4. если модель один раз неверно поняла objective, prematurely closed task или потеряла незавершённое обязательство, эта ошибка начинает жить как канонизированная память.

Итог: система не просто «помнит», а закрепляет self-authored interpretation. Для long-running задач это опаснее, чем временная потеря деталей.

## 2. Ключевая идея v2

Новая версия должна хранить не один mutable snapshot, а несколько слоёв состояния с разным уровнем доверия:

1. **Immutable User Contract** — что пользователь на самом деле попросил, какие ограничения и критерии успеха заданы.
2. **Durable Task Tracker / Commitments Ledger** — список подзадач и обязательств, который переживает compaction.
3. **Current Execution State** — на какой стадии находится работа сейчас и какой следующий шаг.
4. **Advisory Compaction Packet** — краткий resume packet после compaction, но не источник истины.

Главное правило: **модель не должна иметь возможность тихо переписать каноническое состояние задачи своим же summary**.

---

## 3. Цели

### 3.1 Functional goals

- Сохранить soft compaction threshold на **60%**.
- Поддерживать durable task tracker, который переживает compaction и handoff.
- Делить запрос пользователя на подзадачи и отслеживать их статус.
- Сделать drift видимым: если модель «решила», что задача закончена, это должно быть либо явно подтверждено evidence, либо отклонено моделью проектора.
- Сохранить branch-local semantics: состояние должно следовать за текущей веткой сессии.
- Позволить fresh handoff в новую сессию без потери open tasks.

### 3.2 Safety / correctness goals

- Objective не должен молча заменяться из model-authored summary.
- `done` нельзя ставить только по внутреннему ощущению модели.
- Открытые user commitments не должны исчезать после compaction.
- Система должна различать:
  - user ask
  - inferred subtask
  - progress note
  - evidence
  - completion candidate

### 3.3 Non-goals

- Это не global long-term memory про пользователя и не замена `MEMORY.md`.
- Это не knowledge base по всем прошлым задачам.
- Это не попытка полностью отменить встроенный pi compaction.
- Это не full PM system с произвольной иерархией проектов и эпиков.

---

## 4. Design principles

### 4.1 Trust order

При конфликте источников порядок доверия такой:

1. **Explicit current user message**
2. **Immutable User Contract**
3. **Verified evidence / tool-backed facts**
4. **Task tracker ledger**
5. **Execution state**
6. **Compaction advisory packet**
7. **Model free-form reasoning**

### 4.2 Append-only > mutable snapshot

Каноническое состояние должно определяться **через append-only events** и кодовый projector, а не через один JSON snapshot, который модель может полностью переписать.

### 4.3 Completion requires a gate

`done_candidate` и `done` — разные состояния.

Переход в `done` разрешён только если выполнено хотя бы одно условие:

- есть проверяемое evidence;
- или пользователь явно принял результат;
- или оператор вручную подтвердил закрытие.

### 4.4 Compaction summary is advisory

Compaction нужен для continuity, но не должен становиться каноническим task truth.

### 4.5 Contract changes are special

`objective`, `successCriteria`, `constraints` нельзя менять тем же механизмом, которым модель пишет progress notes.

### 4.6 Formal authority model

Каждый ledger event должен иметь не только `type`, но и формальные признаки доверия:

- `actor`: `user` | `assistant` | `system` | `manual`
- `authority`: `authoritative` | `proposed` | `advisory`
- `sourceMessageId` / `sourceEntryId`

Это нужно, чтобы projector принимал решения не по эвристике «похоже на важное», а по жёсткой политике доверия.

### 4.7 Acceptance is explicit by default

По умолчанию система не должна считать user acceptance эвристически из коротких реакций вроде `ок`, `спасибо`, `понятно`.

Нормальный default:

- acceptance либо записан явно;
- либо зафиксирован manual action;
- либо проходит через отдельный narrow whitelist, который можно включить осознанно.

### 4.8 Inferred work is budgeted

Модель не должна бесконтрольно плодить inferred subtasks.

Нужны ограничения:

- лимит новых inferred tasks за один turn;
- dedupe against existing open tasks;
- если это не самостоятельная deliverable unit, писать note/evidence, а не новую task.

---

## 5. High-level architecture

## 5.1 Layers

### Layer A — Immutable User Contract

Содержит:

- original objective
- active objective
- explicit asks
- success criteria
- constraints
- explicit non-goals / rejected directions

Это самый защищённый слой. Он меняется только:

- от явного user directive;
- или через manual operator command.

### Layer B — Durable Task Tracker

Содержит набор задач / подзадач / обязательств.

Это основной механизм continuity между compaction циклами.

### Layer C — Current Execution State

Содержит:

- stage
- active task ids
- nextAction
- waitingFor
- blocker
- lastMeaningfulProgress

Это слой «что происходит сейчас», но он не может сам закрыть контракт.

### Layer D — Compaction Advisory Packet

Содержит краткий свежий operational summary для ближайших 1–3 turns:

- latest user intent
- recent focus
- suggested next action
- recent blockers
- recent relevant files
- avoid repeating

Этот слой живёт ради continuity, но не имеет права переписывать A/B.

---

## 6. Data model

## 6.1 Canonical entities

### 6.1.1 User Contract

```ts
type UserContract = {
  version: 2;
  originalObjective: string;
  activeObjective: string;
  successCriteria: string[];
  constraints: string[];
  explicitAsks: ContractAsk[];
  contractChangeProposals: ContractChangeProposal[];
  rejectedDirections: string[];
  updatedAt: string;
  updatedFrom: "user" | "manual";
};

type ContractAsk = {
  id: string;
  text: string;
  sourceMessageId?: string;
  status: "open" | "satisfied" | "cancelled";
  createdAt: string;
  closedAt?: string;
};

type ContractChangeProposal = {
  id: string;
  kind: "objective" | "success_criteria" | "constraints";
  proposedValue: string | string[];
  reason: string;
  status: "open" | "accepted" | "rejected";
  proposedBy: "assistant" | "manual";
  sourceMessageId?: string;
  createdAt: string;
  resolvedAt?: string;
};
```

Notes:

- `originalObjective` never changes after bootstrap.
- `activeObjective` changes rarely and only via explicit directive.
- `explicitAsks` лучше хранить отдельно от `tasks`, потому что user asks — это higher-trust input.
- `contractChangeProposals` можно создавать автоматически, но они никогда не применяются в contract без user/manual path.

### 6.1.2 Task Tracker Item

```ts
type TaskItem = {
  id: string;
  title: string;
  kind: "user_requested" | "inferred" | "verification" | "followup";
  source: "user" | "assistant" | "manual";
  parentId?: string;
  dependsOn: string[];
  status: "todo" | "in_progress" | "blocked" | "awaiting_user" | "done_candidate" | "done" | "dropped";
  evidence: TaskEvidence[];
  notes: string[];
  relevantFiles: string[];
  createdAt: string;
  updatedAt: string;
};

type TaskEvidence = {
  id: string;
  kind: "test" | "tool_result" | "file" | "message" | "manual_note";
  ref: string;
  summary: string;
  level: "claimed" | "observed" | "verified";
  actor: "assistant" | "system" | "manual";
  sourceEntryId?: string;
  createdAt: string;
};
```

Notes:

- `done_candidate` может быть выставлен моделью.
- `done` — только через gate.
- evidence с `level=claimed` или `level=observed` само по себе не закрывает задачу; gate проходит только `verified` evidence или explicit acceptance.
- `source=user_requested` имеет больший приоритет, чем `inferred`.

### 6.1.3 Execution State

```ts
type ExecutionState = {
  version: 2;
  stage: "intake" | "planning" | "investigating" | "implementing" | "verifying" | "awaiting_user" | "handoff";
  activeTaskIds: string[];
  nextAction: string | null;
  waitingFor: "nothing" | "user" | "tool" | "external";
  blocker: string | null;
  lastMeaningfulProgress: string | null;
  updatedAt: string;
};
```

Notes:

- Это и есть поле «на какой стадии задача».
- Оно полезно, но не должно само по себе означать завершение задачи.

### 6.1.4 Compaction Advisory Packet

```ts
type CompactionAdvisory = {
  version: 2;
  latestUserIntent: string | null;
  recentFocus: string[];
  suggestedNextAction: string | null;
  blockers: string[];
  relevantFiles: string[];
  artifacts: Array<{ kind: "file" | "command" | "url" | "id" | "note"; value: string; note?: string }>;
  avoidRepeating: string[];
  unresolvedQuestions: string[];
  updatedAt: string;
};
```

Changes vs v1:

- здесь **нет authoritative `status=completed`**;
- advisory packet описывает recent operational continuity, а не канонический lifecycle задачи.

---

## 7. Event model

Каноническое состояние строится из custom entries.

## 7.1 Entry types

```ts
const ENTRY_TYPES = {
  contractUpsert: "cg2-contract-upsert",
  contractChangeProposed: "cg2-contract-change-proposed",
  taskCreated: "cg2-task-created",
  taskPatched: "cg2-task-patched",
  evidenceAdded: "cg2-evidence-added",
  taskStatusProposed: "cg2-task-status-proposed",
  taskStatusCommitted: "cg2-task-status-committed",
  taskArchived: "cg2-task-archived",
  executionUpdated: "cg2-execution-updated",
  advisoryStored: "cg2-compaction-advisory",
  acceptanceRecorded: "cg2-acceptance-recorded",
  projectionSnapshot: "cg2-projection-snapshot",
};
```

## 7.1.1 Event envelope

Каждое событие в ledger должно сохраняться в общем envelope:

```ts
type LedgerEventEnvelope<T> = {
  type: string;
  actor: "user" | "assistant" | "system" | "manual";
  authority: "authoritative" | "proposed" | "advisory";
  sourceMessageId?: string;
  sourceEntryId?: string;
  createdAt: string;
  payload: T;
};
```

Инварианты:

- `authoritative` events могут менять canonical state;
- `proposed` events могут только ждать принятия projector/manual path;
- `advisory` events никогда не меняют canonical contract/task closure напрямую.

## 7.2 Why events instead of raw state patching

События решают несколько проблем:

- видно, кто и когда закрыл задачу;
- можно запретить опасные переходы на уровне projector;
- можно восстанавливать state после compaction без доверия к старому summary;
- можно дифференцировать `proposed` и `committed` state.

---

## 8. Projection model

## 8.1 Canonical source of truth

Source of truth = **append-only ledger + deterministic projector**.

Ни один LLM-authored blob не считается truth напрямую.

## 8.2 Projected state

В runtime extension держит материализованную проекцию:

```ts
type ProjectedState = {
  contract: UserContract | null;
  tasks: Record<string, TaskItem>;
  execution: ExecutionState;
  openAskIds: string[];
  openTaskIds: string[];
  doneCandidateIds: string[];
  archivedTaskIds: string[];
  contractChangeProposals: ContractChangeProposal[];
  advisory: CompactionAdvisory | null;
};
```

## 8.3 Snapshot as cache, not truth

Можно периодически писать `projectionSnapshot`, но только как performance optimization.

Требование:

- snapshot должен быть полностью recomputable из ledger;
- при конфликте snapshot и events выигрывают events;
- model не должна уметь напрямую патчить snapshot.

## 8.4 Projector invariants

Projector обязан проверять и поддерживать следующие инварианты:

- `activeTaskIds` ссылаются только на существующие non-archived tasks в состояниях `todo|in_progress|blocked|awaiting_user|done_candidate`;
- task не может зависеть от несуществующей task без warning/debug marker;
- `done` task не остаётся blocker'ом для open task без explicit override event;
- пока есть `openAskIds` или `openTaskIds`/`doneCandidateIds`, root objective не считается завершённым;
- `execution.waitingFor = user` допустим только если есть хотя бы один open ask или task в `awaiting_user`;
- accepted `contractChangeProposed` должен материализоваться в `contractUpsert` в том же projection cycle.

---

## 9. State transition rules

## 9.1 Task status transitions

Допустимые переходы:

- `todo -> in_progress`
- `todo -> blocked`
- `in_progress -> blocked`
- `in_progress -> awaiting_user`
- `in_progress -> done_candidate`
- `blocked -> in_progress`
- `awaiting_user -> in_progress`
- `done_candidate -> in_progress`
- `done_candidate -> done`
- `todo|in_progress|blocked|awaiting_user -> dropped`

Запрещённые прямые переходы:

- `in_progress -> done`
- `todo -> done`
- `blocked -> done`

## 9.2 Evidence levels

Каждое evidence имеет один из уровней:

- `claimed` — модель утверждает, что что-то сделано, но external proof нет;
- `observed` — система видела сигнал (например, tool result, diff, stdout), но gate ещё не признал его достаточным;
- `verified` — evidence прошло rule-based или operator-approved threshold и может участвовать в completion gate.

## 9.3 Done gate

`done_candidate -> done` только если:

### Path A — evidence gate

- у задачи есть хотя бы одно `level=verified` evidence;
- и нет незакрытых child tasks, от которых она зависит.

### Path B — user acceptance gate

- записан `acceptanceRecorded` event;
- acceptance связан с этой задачей или с root objective.

### Path C — manual override

- explicit operator command.

### Root completion invariant

Даже если отдельная task помечена `done`, root objective не должен считаться закрытым, пока существует хотя бы одно из условий:

- есть `open` user asks;
- есть tasks в состояниях `todo|in_progress|blocked|awaiting_user|done_candidate`;
- есть unresolved contract change proposals со статусом `open`, которые влияют на active scope.

## 9.4 User acceptance policy

Политика по умолчанию:

- acceptance не выводится автоматически из коротких реакций `ок`, `спасибо`, `понял`, `ага`;
- acceptance должен быть либо explicit, либо manual;
- optional auto-accept whitelist можно добавить позже, но только как узкий конфигurable слой поверх default-safe режима.

## 9.5 Contract mutation rules

Разрешено:

- добавить explicit ask из user message;
- добавить constraint из user message;
- отметить ask как satisfied после done gate;
- manual update.

Не разрешено без special path:

- заменить objective из compaction packet;
- заменить objective из task tracker;
- заменить objective через обычный tool patch.

## 9.6 Contract change proposal flow

Модель может только предложить изменение contract через `contractChangeProposed`.

Projector и runtime обязаны соблюдать правила:

1. `contractChangeProposed` сохраняется в ledger как `proposed` event.
2. Proposal виден человеку и debug surface, но не меняет active contract.
3. Только explicit user directive или manual action могут превратить proposal в `contractUpsert`.
4. Rejected proposal остаётся в audit trail как `rejected`, но не влияет на contract.

---

## 10. Hooks and runtime behavior

## 10.1 `session_start`

Что делать:

- загрузить branch entries;
- восстановить projection из snapshot + tail events или полным replay;
- инициализировать advisory / execution state;
- если контракт отсутствует и есть первый user prompt — bootstrap contract.

## 10.2 `before_agent_start`

Инжектить не raw snapshots, а **Active Work Packet**:

```md
## Immutable User Contract
...

## Open User Asks
...

## Open Tasks
...

## Current Execution State
...

## Recent Advisory Context
...

Hard rules:
- Do not treat advisory summary as source of truth over contract/tracker.
- Do not mark work done while open user asks or open tasks remain.
- done_candidate is not done.
- If unsure whether a task is complete, keep it open and gather evidence.
```

## 10.3 `turn_end`

Сохранить threshold logic на **60%**.

Алгоритм:

1. `usage = ctx.getContextUsage()`
2. если `usage.percent >= 60` и нет recent compaction lock — trigger compaction
3. перед compaction гарантировать, что execution state и open tasks уже durably persisted

Important:

- 60% остаётся, потому что это product requirement: после этого качества модели уже недостаточно.
- Это не баг, а intentional early compaction policy.

## 10.4 `session_before_compact`

Генерировать **advisory packet**, а не canonical state.

Prompt requirements:

- summarizer должен видеть текущий session context;
- он должен знать latest user intent;
- он не должен объявлять objective closed без evidence;
- он не должен rewrite contract;
- он должен сосредоточиться на ближайших 1–3 turns.

Возвращаемый compaction result:

- `summary`: human-readable short resume
- `details`: `{ advisory, readFiles, modifiedFiles }`

## 10.5 `session_compact`

После compaction:

- перечитать advisory;
- обновить projected state;
- сбросить local threshold markers.

## 10.6 `session_tree`

Branch switch должен переключать весь projected state branch-locally.

---

## 11. Task tracker behavior

## 11.1 Root task bootstrap

При старте новой сессии создаётся root task:

- title = active objective
- kind = `user_requested`
- status = `in_progress`

## 11.2 Subtask creation

После planning phase модель должна создавать подзадачи.

Но tool API должен быть ограниченным, например:

- `create_task`
- `start_task`
- `block_task`
- `propose_done`
- `add_evidence`
- `set_next_action`
- `list_open_tasks`

Не должно быть raw `patch entire state`.

## 11.3 Inferred task budget and dedupe

Чтобы модель не заспамила tracker микрозадачами, вводятся ограничения:

- максимум `N` новых inferred tasks за один turn (рекомендуемый default: `3`);
- перед созданием новой inferred task обязателен dedupe against existing open tasks;
- если пункт не является самостоятельной deliverable unit, он записывается как `note` или `evidence`, а не как новая task;
- follow-up bug, найденный по ходу работы, должен становиться отдельной task только если он реально меняет план или completion path.

## 11.4 Open commitments ledger

Кроме tasks, система должна отдельно хранить user commitments:

- обещанные follow-ups;
- вопросы, на которые агент ещё не ответил;
- обещания что-то проверить / сделать.

Это можно реализовать как:

- либо отдельный `CommitmentItem`;
- либо как `TaskItem.kind = followup`.

Для v2 достаточно второго варианта.

## 11.5 Archival policy

Completed tasks не должны auto-delete'иться сразу.

Политика:

- сначала task уходит в `archived`, а не удаляется;
- archived tasks не попадают в normal prompt packet;
- archived tasks остаются доступны через tool/debug path;
- physical delete допускается только manual maintenance path, а не auto-clear.

## 11.6 What survives compaction

Обязаны переживать compaction:

- contract
- open asks
- open tasks
- done_candidate tasks
- blocked tasks
- execution state
- attached evidence refs

Не обязательно переживают полностью:

- archived tasks
- длинные historical notes
- избыточные artifact inventories

---

## 12. Tool and command design

## 12.1 Replace `task_state` with granular APIs

Вместо текущего raw mutable tool:

```ts
task_state(action=get|patch|clear)
```

нужно сделать более безопасный интерфейс.

### Proposed tool: `task_tracker`

```ts
type TaskTrackerToolParams =
  | { action: "list_open" }
  | { action: "list_archived"; limit?: number }
  | { action: "create_task"; title: string; kind?: TaskKind; parentId?: string; dependsOn?: string[] }
  | { action: "start_task"; taskId: string }
  | { action: "block_task"; taskId: string; reason: string }
  | { action: "await_user"; taskId: string; reason: string }
  | { action: "propose_done"; taskId: string; note?: string }
  | { action: "commit_done"; taskId: string; reason: "verified_evidence" | "user_acceptance" | "manual_override"; evidenceIds?: string[] }
  | { action: "add_evidence"; taskId: string; evidence: TaskEvidenceInput }
  | { action: "record_acceptance"; taskId?: string; note: string; sourceMessageId?: string }
  | { action: "propose_contract_change"; kind: "objective" | "success_criteria" | "constraints"; proposedValue: string | string[]; reason: string }
  | { action: "set_next_action"; nextAction: string; activeTaskIds?: string[] }
  | { action: "link_file"; taskId: string; path: string }
  | { action: "note"; taskId: string; text: string };
```

### Proposed command: `/contract`

Manual inspection/edit for contract only, включая review и accept/reject для `contractChangeProposals`.

### Proposed command: `/tasks`

Human-visible tracker inspection/edit.

### Proposed command: `/handoff`

Build new session from:

- immutable contract
- open tasks
- execution state
- selected recent advisory

not from one merged snapshot.

### Proposed debug / observability commands

- `/cg2-state` — показать текущий projected state
- `/cg2-ledger` — показать последние raw ledger events
- `/cg2-why-open <taskId>` — объяснить, почему задача всё ещё open
- `/cg2-why-done <taskId>` — показать, какой gate закрыл задачу

## 12.2 Why not raw patch

Raw patch позволяет модели silently do this:

- заменить objective;
- вычистить blocked items;
- пометить всё done;
- переписать history without audit trail.

Это именно то, от чего v2 должна уйти.

---

## 13. Prompt injection strategy

## 13.1 Prompt budget discipline

В prompt нельзя каждый раз пихать весь tracker целиком. Иначе система сама создаст новый compaction pressure.

В `before_agent_start` инжектится только:

- contract
- open asks
- open tasks
- tasks in `done_candidate`
- execution state
- short advisory context

Полный tracker доступен через tool/command.

### Selection priority for prompt inclusion

Если open state не помещается целиком, порядок приоритета такой:

1. open user asks
2. blocked tasks
3. in-progress tasks
4. awaiting-user tasks
5. done-candidate tasks
6. recent done tasks
7. archived tasks не попадают в prompt вообще

### Budget policy

Рекомендуемый default для Active Work Packet:

- contract section: всегда полностью, но коротко
- open asks: до 8
- open tasks: до 12
- done_candidate tasks: до 6
- recent done tasks: до 6
- advisory context: не более 5 bullets на секцию

Если budget exceeded:

- сначала режутся notes/details;
- затем long evidence summaries сворачиваются до refs;
- archived и old done content не инжектятся совсем.

## 13.2 Active Work Packet format

Пример:

```md
## Immutable User Contract
Original objective: ...
Active objective: ...
Success criteria:
- ...
Constraints:
- ...
Explicit asks still open:
- [A1] ...
- [A2] ...

## Open Tasks
- [T1][in_progress][user_requested] Investigate X
- [T2][blocked] Verify Y
- [T3][done_candidate] Explain result to user

## Current Execution State
Stage: verifying
Active tasks: T2, T3
Next action: run targeted test and summarize outcome
Waiting for: nothing
Blocker: none

## Recent Advisory Context
Recent focus:
- ...
Suggested next action:
- ...
Avoid repeating:
- ...

Hard rules:
- Open tasks outrank compaction advisory.
- done_candidate != done.
- Do not treat a question as closed without evidence or user acceptance.
```

---

## 14. Compaction design in v2

## 14.1 Keep 60%

Это explicitly preserved.

Rationale:

- качество модели начинает деградировать до hard limit;
- compaction нужен не как аварийный тормоз, а как профилактика context rot.

## 14.2 What compaction should summarize

Compaction summary должен быть узким:

- latest user intent
- recent active investigation
- recent blockers
- immediate next action
- touched files/artifacts
- avoid repeating

Не должен summarise as truth:

- full objective lifecycle
- canonical done status
- tracker closure
- rewritten contract

## 14.3 No fake user `continue`

v2 не должна отправлять synthetic user message `continue`.

Почему:

- fake user turn может исказить `latest user intent`;
- усиливает summary drift;
- мешает отличать реальный user instruction от control flow.

Если после compaction нужен автопродолжение, оно должно быть одним из двух способов:

1. использовать штатный pi auto-continue, если он не создаёт user-like truth conflict;
2. или использовать скрытый non-user control message, который projector и summarizer умеют игнорировать как authoritative intent.

---

## 15. Handoff model

## 15.1 When handoff is needed

Handoff нужен:

- при phase change;
- после серии compactions, когда continuity уже ухудшается;
- когда задача меняет режим (например, investigation -> implementation -> verification).

## 15.2 Handoff payload

Новая сессия должна стартовать из:

- immutable contract
- open asks
- open tasks
- execution state
- recent advisory packet

Не из одного merged mega-summary.

## 15.3 Handoff invariant

После handoff:

- open tasks должны остаться open;
- done_candidate не должен auto-promote в done;
- root objective должен остаться прежним, если пользователь его явно не менял.

---

## 16. Branch semantics

Все event entries branch-local.

Требования:

- `session_tree` recomputes projection for the active branch;
- different branches могут иметь разный task tracker state;
- merge policy между branch summaries и tracker не нужна: активная ветка всегда единственный source-of-truth для runtime.

---

## 17. Failure modes this design must prevent

### 17.1 Stale objective substitution

Плохой сценарий v1:

- модель неверно сжала objective;
- summary пережил compaction;
- merged checkpoint дал summary высокий авторитет;
- агент продолжил уже не ту задачу.

В v2:

- compaction advisory не может менять contract;
- objective не берётся из advisory.

### 17.2 Premature task closure

Плохой сценарий v1:

- summary сказал `completed`;
- durable state тоже постепенно переписался;
- открытый вопрос исчез.

В v2:

- нет глобального authoritative `completed` в compaction packet;
- open tasks остаются open, пока нет evidence/acceptance gate.

### 17.3 Silent erasure of subproblems

Плохой сценарий v1:

- агент заметил баг/подзадачу;
- потом она исчезла из snapshot.

В v2:

- подзадача живёт как отдельный task entry;
- исчезнуть она может только через явный state transition.

### 17.4 Self-reinforcing hallucinated progress

Плохой сценарий v1:

- модель написала optimistic summary;
- этот summary вернулся как truth;
- следующая итерация ещё больше поверила в него.

В v2:

- advisory отделён от canonical ledger;
- projector не позволяет advisory коммитить canonical transitions.

---

## 18. Implementation plan

## 18.1 Module split

Предлагаемая структура:

- `contract.ts` — schema + contract mutation logic
- `tasks.ts` — task item schema + transition rules
- `execution.ts` — current execution state
- `authority.ts` — trust model, actor/authority labels, completion gate helpers
- `events.ts` — entry types + encoding/decoding
- `projector.ts` — replay events -> projected state
- `prompt.ts` — active work packet rendering
- `compaction.ts` — advisory packet generation
- `migration.ts` — import and sanitize logic from v1
- `debug.ts` — observability helpers and explain-why commands
- `commands.ts` — `/contract`, `/tasks`, `/handoff`, `/cg2-*`
- `tools.ts` — `task_tracker`
- `index.ts` — wiring hooks

## 18.2 Observability surface

Минимальный debug surface обязателен, иначе такую систему сложно отлаживать в long sessions.

Нужны как минимум:

- `explainWhyTaskOpen(taskId)`
- `explainWhyTaskDone(taskId)`
- `renderProjectedState()`
- `renderRecentLedgerEvents(limit)`
- `renderContractProposals()`

Цель — всегда можно было быстро ответить на вопросы:

- почему это всё ещё open?
- кто закрыл задачу?
- какой evidence использовался?
- откуда взялось изменение contract?

## 18.3 Migration from v1

Migration path должен быть явно определён.

Что можно импортировать из v1:

- `originalObjective`
- `objective`
- `successCriteria`
- `constraints`
- `done`
- `inProgress`
- `blocked`
- `nextAction`
- `relevantFiles`
- `artifacts`
- `openQuestions`
- `facts`
- `assumptions`

Как импортировать:

- old `done` -> archived/done tasks без automatic trust escalation;
- old `inProgress` / `blocked` -> open tasks;
- old `nextAction` -> execution state;
- old compaction details -> только advisory layer.

Что нельзя импортировать как canonical truth:

- старый глобальный `status=completed`;
- любые old merged summaries, которые утверждают closure без evidence;
- self-authored contract rewrites без explicit user source.

## 18.4 Rollout strategy

### Phase 1 — shadow mode

- не удалять v1 сразу;
- писать новый ledger параллельно;
- не использовать его как source of truth;
- сравнивать projected open tasks vs old snapshot output.

### Phase 2 — read from v2, write to v2

- prompt injection уже из v2;
- old snapshot только для debugging.

### Phase 3 — remove v1 snapshot logic

- удалить raw `task_state patch` API;
- удалить merged `source of truth` checkpoint of old design.

---

## 19. Testing / acceptance criteria

## 19.1 Core correctness tests

1. **Objective preservation across compaction**
   - bootstrap objective from user
   - run compaction with misleading advisory
   - verify contract objective unchanged

2. **Open task survives compaction**
   - create task T1
   - compact
   - restart session
   - T1 still open

3. **No direct done without evidence**
   - task in `in_progress`
   - model proposes done
   - projector keeps `done_candidate`, not `done`

4. **User acceptance closes task**
   - task in `done_candidate`
   - acceptance event appended
   - projector promotes to `done`

5. **Blocked task cannot vanish**
   - task blocked
   - compaction advisory omits it
   - projector still returns blocked task

6. **Handoff preserves open work**
   - open tasks + execution state
   - create new session via `/handoff`
   - new session contains same open tasks

7. **Branch-local state**
   - create task in branch A
   - switch to branch B
   - branch B does not inherit task unless branch history contains it

## 19.2 Behavioral tests

1. User says: "нет, вопрос не закрыт" after model claims completion.
   - tracker must reopen or keep task open.

2. Model notices a new bug during implementation.
   - bug becomes new task, not just a sentence in summary.

3. Weak acknowledgement does not close work.
   - user replies `ок` / `спасибо` / `понял`;
   - system must not auto-record acceptance by default.

4. Contract proposal does not mutate contract automatically.
   - model proposes a narrower objective;
   - proposal appears in ledger/debug view;
   - active contract remains unchanged until explicit user/manual action.

5. Task explosion is capped.
   - model tries to create many tiny inferred tasks in one turn;
   - projector/tool layer accepts only the configured cap and dedupes the rest.

6. Long session with 3+ compactions.
   - root objective remains stable;
   - open tasks count stays consistent.

7. Archived completed work stays auditable.
   - completed tasks disappear from prompt packet;
   - but remain visible in debug/tool surface and are not silently deleted.

---

## 20. Recommended defaults

- `softCompactionThresholdPercent = 60`
- `minCompactionIntervalMs = 30_000`
- `maxPromptOpenTasks = 12`
- `maxPromptDoneCandidates = 6`
- `maxPromptRecentDone = 6`
- `projectionSnapshotEveryNEvents = 20`

---

## 21. What should be removed from v1

Ниже то, что в новой версии считается anti-pattern:

1. Raw mutable whole-state patch tool.
2. Merged checkpoint, который называет compaction packet + durable state единым `source of truth`.
3. Authoritative global `status=completed` внутри compaction packet.
4. Synthetic fake user `continue` after compaction.
5. Возможность модели менять contract тем же API, которым она пишет progress.

---

## 22. Minimal v2 success definition

Переписывание считается успешным, если после длинной сессии с несколькими compaction циклами система гарантирует:

- objective не подменился сам собой;
- незакрытые user asks всё ещё видны;
- open tasks всё ещё открыты;
- `done` выставляется только через gate;
- agent знает текущую стадию, но стадия не означает автоматического closure;
- handoff в новую сессию переносит contract + tracker + execution state без потери обязательств.

---

## 23. Short version

Если совсем коротко, v2 должна строиться так:

- **ранний compaction на 60% оставить**;
- **добавить durable task tracker / to-do list**;
- **сделать tracker append-only и branch-local**;
- **отделить immutable user contract от execution state**;
- **понизить compaction summary до advisory layer**;
- **запретить модели напрямую канонизировать собственные summaries**;
- **разрешать `done` только через evidence или user acceptance**.

Это и есть правильный redesign, если делать `context-guardian` с нуля как более надёжную long-session систему, а не как ещё один mutable snapshot рядом с compaction.
