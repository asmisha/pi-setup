import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { buildSessionContext, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { applyTaskTrackerAction } from "./src/actions.ts";
import { loadLedgerEvents, serializeEventData, extractAdvisoryFromCompactionDetails } from "./src/branch-store.ts";
import { buildBootstrapEvents, buildExplicitAskCaptureContract } from "./src/bootstrap.ts";
import { buildCompactionPrompt, COMPACTION_SYSTEM_PROMPT, normalizeAdvisory, parseJsonObject, renderAdvisorySummary } from "./src/compaction.ts";
import { ENV_ENABLE_FLAG, isExtensionEnabled, MAX_INFERRED_TASKS_PER_TURN, MIN_COMPACTION_INTERVAL_MS, SOFT_COMPACTION_THRESHOLD_PERCENT, SUMMARY_MAX_TOKENS } from "./src/config.ts";
import { explainTaskDone, explainTaskOpen, renderProjectedState, renderRecentLedgerEventsText } from "./src/debug.ts";
import { latestContractProposals, projectLedger } from "./src/projector.ts";
import { renderActiveWorkPacket } from "./src/prompt.ts";
import type { CompactionAdvisory, KnownLedgerEvent, ProjectedState, TaskTrackerAction } from "./src/types.ts";
import { ENTRY_TYPES } from "./src/types.ts";
import { makeEventMeta, isLowSignalUserNudge } from "./src/utils.ts";
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

function latestLedgerAdvisory(events: KnownLedgerEvent[]): CompactionAdvisory | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === ENTRY_TYPES.advisoryStored) {
      return event.payload.advisory;
    }
  }
  return null;
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

function latestUserIntentFromState(state: ProjectedState): string | null {
  const latestAsk = state.contract?.explicitAsks.filter((ask) => ask.status === "open").at(-1)?.text;
  return latestAsk ?? state.contract?.activeObjective ?? null;
}

function extractFilePaths(fileOps: unknown): string[] {
  if (!Array.isArray(fileOps)) return [];
  const paths = fileOps
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const path = record.path ?? record.file ?? record.filePath;
      return typeof path === "string" ? path.trim() : null;
    })
    .filter((item): item is string => Boolean(item));
  return [...new Set(paths)];
}

function formatStageLabel(stage: ProjectedState["execution"]["stage"]): string {
  return stage.replace(/_/g, " ");
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}`;
}

function askCountLabel(count: number): string {
  return `${count} ${count === 1 ? "ask" : "asks"}`;
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
  if (snapshot.counts.doneCandidate > 0) bits.push(theme.fg("warning", countLabel(snapshot.counts.doneCandidate, "ready")));
  if (snapshot.counts.openAsks > 0) bits.push(theme.fg("warning", askCountLabel(snapshot.counts.openAsks)));
  return bits;
}

function renderThemedTodoWidgetLines(ctx: ExtensionContext, snapshot: TodoWidgetSnapshot | null): string[] {
  if (!snapshot) return [];

  const theme = ctx.ui.theme;
  const modeColor = widgetModeColor(snapshot.mode);
  const rawLines = renderTodoWidgetText(snapshot);
  if (rawLines.length === 0) return [];

  const summaryBits = renderSummaryBits(ctx, snapshot);
  const badge = theme.bg("selectedBg", theme.fg("accent", " CG2 "));
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
    if (line.startsWith("• ")) {
      return `${theme.fg("dim", "│")} ${theme.fg("muted", "•")} ${line.slice(2)}`;
    }
    return line;
  });
}

export default function contextGuardianV2(pi: ExtensionAPI) {
  if (!isExtensionEnabled()) {
    return;
  }

  let currentEvents: KnownLedgerEvent[] = [];
  let currentState: ProjectedState = projectLedger([]);
  let previousContextPercent: number | null = null;
  let compactionInFlight = false;
  let lastCompactionAt = 0;
  let createdInferredTasksThisTurn = 0;
  const nextId = createIdGenerator();

  const refreshBranch = (branchEntries: SessionEntry[]) => {
    const refreshed = refreshProjectedState(branchEntries);
    currentEvents = refreshed.events;
    currentState = refreshed.state;
  };

  const updateUi = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const snapshot = buildTodoWidgetSnapshot(currentState);
    ctx.ui.setStatus("cg2-todo", undefined);
    const widgetLines = renderThemedTodoWidgetLines(ctx, snapshot);
    ctx.ui.setWidget("cg2-todo", widgetLines.length > 0 ? widgetLines : undefined);
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
    const nextContract = buildExplicitAskCaptureContract(currentState.contract, prompt, new Date().toISOString(), nextId("ask"));
    if (!nextContract) return;
    const event: KnownLedgerEvent = {
      type: ENTRY_TYPES.contractUpsert,
      ...makeEventMeta("user", "authoritative", new Date().toISOString()),
      payload: { contract: nextContract },
    };
    const persisted = persistEvents(pi, currentEvents, [event]);
    currentEvents = persisted.events;
    currentState = persisted.state;
  };

  pi.on("session_start", async (_event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    previousContextPercent = null;
    compactionInFlight = false;
    createdInferredTasksThisTurn = 0;
    updateUi(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    previousContextPercent = null;
    createdInferredTasksThisTurn = 0;
    updateUi(ctx);
  });

  pi.on("session_compact", async (event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    previousContextPercent = null;
    compactionInFlight = false;
    lastCompactionAt = Date.now();

    const advisory = extractAdvisoryFromCompactionDetails(event.compactionEntry.details, new Date().toISOString());
    const existing = latestLedgerAdvisory(currentEvents);
    if (advisory && existing?.updatedAt !== advisory.updatedAt) {
      const advisoryEvent: KnownLedgerEvent = {
        type: ENTRY_TYPES.advisoryStored,
        ...makeEventMeta("system", "advisory", advisory.updatedAt),
        payload: { advisory },
      };
      const persisted = persistEvents(pi, currentEvents, [advisoryEvent]);
      currentEvents = persisted.events;
      currentState = persisted.state;
    }

    updateUi(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    refreshBranch(ctx.sessionManager.getBranch());
    createdInferredTasksThisTurn = 0;
    ensureBootstrapped(event.prompt);
    captureExplicitAsk(event.prompt);
    updateUi(ctx);

    return {
      systemPrompt: `${event.systemPrompt}\n\n## Context Guardian v2 Active Work Packet\n${renderActiveWorkPacket(currentState)}`,
    };
  });

  pi.on("turn_end", async (event, ctx) => {
    const usage = ctx.getContextUsage();
    const currentPercent = usage?.percent ?? null;
    if (currentPercent === null) {
      previousContextPercent = null;
      return;
    }

    const crossedThreshold = previousContextPercent === null
      ? currentPercent >= SOFT_COMPACTION_THRESHOLD_PERCENT
      : previousContextPercent < SOFT_COMPACTION_THRESHOLD_PERCENT && currentPercent >= SOFT_COMPACTION_THRESHOLD_PERCENT;
    previousContextPercent = currentPercent;
    if (!crossedThreshold) return;
    if (compactionInFlight) return;
    if (Date.now() - lastCompactionAt < MIN_COMPACTION_INTERVAL_MS) return;

    const shouldAutoResume = Array.isArray(event.toolResults) && event.toolResults.length > 0;

    compactionInFlight = true;
    ctx.compact({
      customInstructions: "Generate an advisory packet for Context Guardian v2. Keep contract/task truth separate from advisory.",
      onComplete: () => {
        compactionInFlight = false;
        lastCompactionAt = Date.now();
        previousContextPercent = null;
        if (shouldAutoResume) {
          pi.sendUserMessage("continue");
        }
      },
      onError: () => {
        compactionInFlight = false;
        previousContextPercent = null;
      },
    });
  });

  pi.on("session_before_compact", async (event, ctx) => {
    refreshBranch(event.branchEntries);
    if (!ctx.model) return;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return;

    const messages = buildSessionContext(event.branchEntries).messages;
    const serializedConversation = serializeConversation(convertToLlm(messages));
    const prompt = buildCompactionPrompt({
      projectedState: currentState,
      serializedConversation,
      latestUserIntent: latestUserIntentFromState(currentState),
      customInstructions: event.customInstructions,
      isSplitTurn: event.preparation.isSplitTurn,
    });

    try {
      const response = await complete(
        ctx.model,
        {
          systemPrompt: COMPACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: SUMMARY_MAX_TOKENS,
          signal: event.signal,
        },
      );
      const responseText = response.content
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .trim();
      if (!responseText) return;

      const parsed = parseJsonObject(responseText);
      const advisory = normalizeAdvisory(parsed, new Date().toISOString());
      if (!advisory) return;

      const touchedFiles = extractFilePaths(event.preparation.fileOps);
      advisory.relevantFiles = [...new Set([...advisory.relevantFiles, ...touchedFiles])];

      return {
        compaction: {
          summary: renderAdvisorySummary(advisory),
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details: {
            advisory,
            readFiles: touchedFiles,
            modifiedFiles: touchedFiles,
          },
        },
      };
    } catch {
      return;
    }
  });

  pi.registerTool({
    name: "task_tracker",
    label: "Task Tracker",
    description: "Safe task tracker for Context Guardian v2. Uses granular event-sourced updates instead of patching whole state.",
    promptSnippet: "Track open tasks, evidence, acceptance, and next actions without rewriting the whole contract.",
    promptGuidelines: [
      "Use this to create or update granular task-tracker events.",
      "Prefer propose_done + evidence + commit_done over directly declaring success.",
      "If commit_done fully answers an open ask, include askIdsToSatisfy so the ask does not linger open.",
      "Do not treat short acknowledgements as acceptance unless the user was explicit.",
    ],
    parameters: TASK_TRACKER_TOOL_PARAMS as any,
    async execute(_toolCallId: string, rawParams: TaskTrackerAction, _signal, _onUpdate, ctx: ExtensionContext) {
      const result = applyTaskTrackerAction(currentState, rawParams, {
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

  pi.registerCommand("cg2-state", {
    description: `Show current projected Context Guardian v2 state (requires ${ENV_ENABLE_FLAG}=1).`,
    handler: async (_args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      ctx.ui.notify(renderProjectedState(currentState), "info");
    },
  });

  pi.registerCommand("cg2-ledger", {
    description: "Show recent Context Guardian v2 ledger events",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const limit = Number.parseInt(args.trim(), 10);
      ctx.ui.notify(renderRecentLedgerEventsText(currentEvents, Number.isFinite(limit) ? limit : 12), "info");
    },
  });

  pi.registerCommand("cg2-why-open", {
    description: "Explain why a task is still open",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const taskId = args.trim();
      if (!taskId) {
        ctx.ui.notify("Usage: /cg2-why-open <taskId>", "error");
        return;
      }
      ctx.ui.notify(explainTaskOpen(currentState, taskId), "info");
    },
  });

  pi.registerCommand("cg2-why-done", {
    description: "Explain how a task was closed",
    handler: async (args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const taskId = args.trim();
      if (!taskId) {
        ctx.ui.notify("Usage: /cg2-why-done <taskId>", "error");
        return;
      }
      ctx.ui.notify(explainTaskDone(currentState, taskId), "info");
    },
  });

  pi.registerCommand("cg2-contract", {
    description: "Show contract and contract change proposals",
    handler: async (_args, ctx) => {
      refreshBranch(ctx.sessionManager.getBranch());
      const contract = currentState.contract;
      const proposals = latestContractProposals(currentState);
      ctx.ui.notify([
        `Active objective: ${contract?.activeObjective ?? "none"}`,
        `Original objective: ${contract?.originalObjective ?? "none"}`,
        `Open asks: ${contract?.explicitAsks.filter((ask) => ask.status === "open").map((ask) => ask.id).join(", ") || "none"}`,
        `Contract proposals: ${proposals.length > 0 ? proposals.map((item) => `${item.id}[${item.status}]`).join(", ") : "none"}`,
      ].join("\n"), "info");
    },
  });

  pi.registerCommand("cg2-handoff", {
    description: "Create a new session with the current CG2 ledger and an edited handoff prompt",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("cg2-handoff requires interactive mode", "error");
        return;
      }
      refreshBranch(ctx.sessionManager.getBranch());
      const goal = args.trim();
      if (!goal) {
        ctx.ui.notify("Usage: /cg2-handoff <goal>", "error");
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
      ctx.ui.notify("CG2 handoff ready. Submit when ready.", "info");
    },
  });
}
