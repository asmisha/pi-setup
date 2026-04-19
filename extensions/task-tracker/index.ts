import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { applyTaskTrackerInput } from "./src/actions.ts";
import { loadLedgerEvents, serializeEventData } from "./src/branch-store.ts";
import { buildBootstrapEvents, buildExplicitAskCaptureEvent } from "./src/bootstrap.ts";
import { isSubagentProcess, MAX_INFERRED_TASKS_PER_TURN } from "./src/config.ts";
import { explainTaskDone, explainTaskOpen, renderProjectedState, renderRecentLedgerEventsText } from "./src/debug.ts";
import { projectLedger } from "./src/projector.ts";
import { renderActiveWorkPacket } from "./src/prompt.ts";
import type { KnownLedgerEvent, ProjectedState, TaskTrackerAction } from "./src/types.ts";
import { ENTRY_TYPES } from "./src/types.ts";
import { extractUserPromptText, makeEventMeta, isLowSignalUserNudge } from "./src/utils.ts";
import { buildTodoWidgetSnapshot, renderTodoWidgetText, type TodoWidgetSnapshot } from "./src/widget.ts";
import { TASK_TRACKER_TOOL_PARAMS } from "./src/tool-schema.ts";

function createIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter += 1;
    return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
  };
}

function refreshProjectedState(branchEntries: SessionEntry[]): { events: KnownLedgerEvent[]; state: ProjectedState } {
  const events = loadLedgerEvents(branchEntries);
  return {
    events,
    state: projectLedger(events),
  };
}

function persistEvents(pi: ExtensionAPI, currentEvents: KnownLedgerEvent[], newEvents: KnownLedgerEvent[]) {
  for (const event of newEvents) {
    pi.appendEntry(event.type, serializeEventData(event));
  }
  const nextEvents = [...currentEvents, ...newEvents];
  return {
    events: nextEvents,
    state: projectLedger(nextEvents),
  };
}

function formatStageLabel(stage: ProjectedState["execution"]["stage"]): string {
  return stage.replace(/_/g, " ");
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}`;
}

function widgetModeColor(mode: TodoWidgetSnapshot["mode"]): "accent" | "warning" | "error" {
  if (mode === "blocked") return "error";
  if (mode === "planning" || mode === "waiting") return "warning";
  return "accent";
}

function renderSummaryBits(ctx: ExtensionContext, snapshot: TodoWidgetSnapshot): string[] {
  const theme = ctx.ui.theme;
  const bits: string[] = [];
  if (snapshot.counts.inProgress > 0) bits.push(theme.fg("accent", countLabel(snapshot.counts.inProgress, "active")));
  if (snapshot.counts.awaitingUser > 0) bits.push(theme.fg("warning", countLabel(snapshot.counts.awaitingUser, "waiting")));
  if (snapshot.counts.blocked > 0) bits.push(theme.fg("error", countLabel(snapshot.counts.blocked, "blocked")));
  if (snapshot.counts.open > 0) bits.push(theme.fg("text", countLabel(snapshot.counts.open, "open")));
  if (snapshot.counts.done > 0) bits.push(theme.fg("muted", countLabel(snapshot.counts.done, "done")));
  if (snapshot.counts.doneCandidate > 0) bits.push(theme.fg("warning", countLabel(snapshot.counts.doneCandidate, "ready")));
  return bits;
}

function renderThemedTodoWidgetLines(ctx: ExtensionContext, snapshot: TodoWidgetSnapshot | null): string[] {
  if (!snapshot) return [];

  const theme = ctx.ui.theme;
  const modeColor = widgetModeColor(snapshot.mode);
  const rawLines = renderTodoWidgetText(snapshot);
  if (rawLines.length === 0) return [];

  const summaryBits = renderSummaryBits(ctx, snapshot);
  const badge = theme.bg("selectedBg", theme.fg("accent", " Tasks "));
  const header = `${badge} ${theme.fg(modeColor, theme.bold(formatStageLabel(snapshot.stage)))}${summaryBits.length > 0 ? ` ${theme.fg("dim", "·")} ${summaryBits.join(` ${theme.fg("dim", "·")} `)}` : ""}`;

  return rawLines.map((line, index) => {
    if (index === 0) return header;
    if (line.startsWith("Hint: ")) {
      return `${theme.fg("warning", "✦")} ${theme.fg("muted", theme.italic(line.slice("Hint: ".length)))}`;
    }
    if (line.startsWith("Next: ")) {
      return `${theme.fg("dim", "└")}${theme.fg("accent", " next")} ${theme.fg("muted", line.slice("Next: ".length))}`;
    }
    if (line.startsWith("Ask: ")) {
      return `${theme.fg("dim", "└")}${theme.fg("warning", " ask ")} ${theme.fg("muted", line.slice("Ask: ".length))}`;
    }
    if (line.startsWith("+")) {
      return `${theme.fg("dim", "… ")}${theme.fg("dim", line)}`;
    }
    if (line.startsWith("→ ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("accent", "→")} ${theme.fg("accent", theme.bold(line.slice(2)))}`;
    }
    if (line.startsWith("⛔ ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("error", "⛔")} ${theme.fg("error", line.slice(2))}`;
    }
    if (line.startsWith("? ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("warning", "?")} ${theme.fg("warning", line.slice(2))}`;
    }
    if (line.startsWith("◇ ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("warning", "◇")} ${theme.fg("warning", line.slice(2))}`;
    }
    if (line.startsWith("✓ ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("muted", "✓")} ${theme.fg("muted", line.slice(2))}`;
    }
    if (line.startsWith("• ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("muted", "•")} ${line.slice(2)}`;
    }
    return line;
  });
}

export default function taskTrackerExtension(pi: ExtensionAPI) {
  const subagentProcess = isSubagentProcess();
  let currentEvents: KnownLedgerEvent[] = [];
  let currentState: ProjectedState = projectLedger([]);
  let createdInferredTasksThisTurn = 0;
  const nextId = createIdGenerator();

  const refreshBranch = (branchEntries: SessionEntry[]) => {
    const refreshed = refreshProjectedState(branchEntries);
    currentEvents = refreshed.events;
    currentState = refreshed.state;
  };

  const updateUi = (ctx: ExtensionContext) => {
    if (subagentProcess || !ctx.hasUI) return;
    const snapshot = buildTodoWidgetSnapshot(currentState);
    ctx.ui.setStatus("task-tracker-todo", undefined);
    const widgetLines = renderThemedTodoWidgetLines(ctx, snapshot);
    ctx.ui.setWidget("task-tracker-todo", widgetLines.length > 0 ? widgetLines : undefined);
  };

  const ensureBootstrapped = (prompt: string) => {
    if (currentState.contract || isLowSignalUserNudge(prompt)) return;
    const bootstrapped = buildBootstrapEvents({ objective: prompt, now: new Date().toISOString(), nextId });
    const persisted = persistEvents(pi, currentEvents, bootstrapped);
    currentEvents = persisted.events;
    currentState = persisted.state;
  };

  const captureExplicitAsk = (prompt: string) => {
    if (!currentState.contract || isLowSignalUserNudge(prompt)) return;
    const now = new Date().toISOString();
    const event = buildExplicitAskCaptureEvent({ currentContract: currentState.contract, prompt, now, nextId });
    if (!event) return;
    const persisted = persistEvents(pi, currentEvents, [event]);
    currentEvents = persisted.events;
    currentState = persisted.state;
  };

  const captureUserPrompt = (prompt: string) => {
    ensureBootstrapped(prompt);
    captureExplicitAsk(prompt);
  };

  pi.on("session_start", async (_event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    createdInferredTasksThisTurn = 0;
    updateUi(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    createdInferredTasksThisTurn = 0;
    updateUi(ctx);
  });

  pi.on("session_compact", async (_event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    if (subagentProcess) return;
    updateUi(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (subagentProcess) return;
    refreshBranch(ctx.sessionManager.getBranch());
    createdInferredTasksThisTurn = 0;
    captureUserPrompt(event.prompt);
    updateUi(ctx);

    return {
      systemPrompt: `${event.systemPrompt}\n\n## Task Tracker Active Work Packet\n${renderActiveWorkPacket(currentState)}`,
    };
  });

  pi.on("message_start", async (event, ctx) => {
    if (subagentProcess || event.message.role !== "user") return;
    refreshBranch(ctx.sessionManager.getBranch());
    const prompt = extractUserPromptText(event.message.content);
    if (!prompt) return;
    captureUserPrompt(prompt);
    updateUi(ctx);
  });

  if (subagentProcess) {
    return;
  }

  pi.registerTool({
    name: "task_tracker",
    label: "Task Tracker",
    description: "Safe task tracker extension. Uses granular event-sourced updates instead of patching whole state.",
    promptSnippet: "Track open tasks, evidence, acceptance, and next actions without rewriting the whole contract. Pass related updates as one actions[] call.",
    promptGuidelines: [
      "Use this to create or update granular task-tracker events.",
      "Pass task_tracker changes as actions[]. Even a single update should be a one-item actions array.",
      "Inside one actions[] call, create_task may set taskAlias and add_evidence may set evidenceAlias; later steps can reference them as $alias in taskId, parentId, dependsOn, activeTaskIds, and evidenceIds.",
      "Keep execution.activeTaskIds honest; multiple active sibling tasks are allowed when the work truly splits.",
      "Prefer propose_done + evidence + commit_done over directly declaring success.",
      "If commit_done fully answers an open ask, include askIdsToSatisfy so the ask does not linger open.",
      "Do not treat short acknowledgements as acceptance unless the user was explicit.",
    ],
    parameters: TASK_TRACKER_TOOL_PARAMS as any,
    async execute(_toolCallId: string, rawParams: TaskTrackerAction, _signal, _onUpdate, ctx: ExtensionContext) {
      const result = applyTaskTrackerInput(currentState, currentEvents, rawParams, {
        now: new Date().toISOString(),
        actor: "assistant",
        authority: "authoritative",
        maxInferredTasksPerTurn: MAX_INFERRED_TASKS_PER_TURN,
        createdInferredTasksThisTurn,
        nextId,
      });

      if (result.events.length > 0) {
        const persisted = persistEvents(pi, currentEvents, result.events);
        currentEvents = persisted.events;
        currentState = persisted.state;
      }
      createdInferredTasksThisTurn = result.createdInferredTasksThisTurn;
      updateUi(ctx);

      return {
        content: [{ type: "text", text: result.message }],
        details: {
          state: currentState,
          recentEvents: result.events.map((event) => ({ type: event.type, createdAt: event.createdAt })),
        },
      };
    },
  });

  pi.registerCommand("task-state", {
    description: "Show current projected task tracker state, including contract/proposal summary.",
    handler: async (_args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      ctx.ui.notify(renderProjectedState(currentState), "info");
    },
  });

  pi.registerCommand("task-clear", {
    description: "Clear the current task tracker state for this session",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const reason = args.trim();
      const event: KnownLedgerEvent = {
        type: ENTRY_TYPES.stateCleared,
        ...makeEventMeta("manual", "authoritative", new Date().toISOString()),
        payload: reason ? { reason } : {},
      };
      const persisted = persistEvents(pi, currentEvents, [event]);
      currentEvents = persisted.events;
      currentState = persisted.state;
      createdInferredTasksThisTurn = 0;
      updateUi(ctx);
      ctx.ui.notify(
        reason
          ? `Task tracker state cleared: ${reason}. The next non-trivial prompt will bootstrap a fresh contract and root task.`
          : "Task tracker state cleared. The next non-trivial prompt will bootstrap a fresh contract and root task.",
        "info",
      );
    },
  });

  pi.registerCommand("task-ledger", {
    description: "Show recent task tracker ledger events",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const limit = Number.parseInt(args.trim(), 10);
      ctx.ui.notify(renderRecentLedgerEventsText(currentEvents, Number.isFinite(limit) ? limit : 12), "info");
    },
  });

  pi.registerCommand("task-why-open", {
    description: "Explain why a task is still open",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const taskId = args.trim();
      if (!taskId) {
        ctx.ui.notify("Usage: /task-why-open <taskId>", "error");
        return;
      }
      ctx.ui.notify(explainTaskOpen(currentState, taskId), "info");
    },
  });

  pi.registerCommand("task-why-done", {
    description: "Explain how a task was closed",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const taskId = args.trim();
      if (!taskId) {
        ctx.ui.notify("Usage: /task-why-done <taskId>", "error");
        return;
      }
      ctx.ui.notify(explainTaskDone(currentState, taskId), "info");
    },
  });

  pi.registerCommand("handoff", {
    description: "Create a new session with the current task tracker ledger and an edited handoff prompt",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }
      refreshBranch(ctx.sessionManager.getBranch());
      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /handoff <goal>", "error");
        return;
      }

      const prompt = [
        "You are continuing work in a fresh Pi session.",
        `Goal: ${goal}`,
        "",
        renderActiveWorkPacket(currentState),
        "",
        "Work from the carried ledger state, not from memory or narrative guesswork.",
      ].join("\n");

      const currentSessionFile = ctx.sessionManager.getSessionFile();
      const result = await ctx.newSession({
        parentSession: currentSessionFile,
        setup: async (sessionManager) => {
          for (const event of currentEvents) {
            sessionManager.appendCustomEntry(event.type, serializeEventData(event));
          }
        },
      });
      if (result.cancelled) {
        ctx.ui.notify("New session cancelled.", "info");
        return;
      }

      ctx.ui.setEditorText(prompt);
      ctx.ui.notify("Task tracker handoff ready. Submit when ready.", "info");
    },
  });
}
