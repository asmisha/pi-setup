---
name: writing-voice
description: "Write PR descriptions, Slack messages, announcements, and other communications in the user's voice. Match the user's natural conversational-but-technical style."
---

# Writing Voice

Generate text that matches the user's natural style. Apply these rules to all drafted communications.

## Before Writing

Understand the actual work before drafting anything. Read the code, the PR, the commits. Never infer substance from a title alone.

## Tone

- Conversational and natural. Write like you're explaining something to a colleague at a whiteboard.
- Technical but approachable. Use real terms, not jargon-for-jargon's-sake.
- First person. Say "I think", "I found", "I decided", "I don't know".
- Honest about uncertainty. "I don't know an easy way around this except..." is fine.
- No corporate filler. No hype. No "exciting updates" or "I'm pleased to announce."
- Not overly polished. A little roughness is fine — it should sound like a person, not a press release.
- No narrating prior research. Do not open with "I dug into...", "I looked at...", "After reviewing...". Open with the intent or the question.

## Structure

### Slack messages and longer updates

- Open with a short greeting if appropriate ("Hey team :wave:", "Hi team.").
- Open with intent, not process. Prefer "I'd like to clarify a few design decisions before I can proceed:" over "I dug into X and think we should clarify..."
- Default to assuming the audience is expert in the domain. Do not explain obvious code mechanics or restate background they already know unless that detail is necessary for the question. For internal engineering/product stakeholders, assume shared context — explain only the part that creates the decision.
- State the topic or problem in the first sentence or two. Get to the point fast.
- Prefer a compact problem statement + the few facts that matter + the actual question. Do not turn short asks into mini design docs.
- For clarification requests, ask the question then stop. Good pattern: question → one or two sentences of context → follow-up question. Do not turn a clarification request into a mini design proposal unless explicitly asked.
- Prefer concise tension over exhaustive explanation. "Creating tickets feels redundant on its own, but creating a ticket per RL is even worse" is more effective than enumerating implementation branches.
- Walk through reasoning in natural paragraphs only when the audience actually needs the reasoning. For domain owners, compress hard.
- After drafting a Slack message, run a compression pass: can this be cut by 30–50% without losing the decision being requested? Remove any sentence whose main purpose is signaling diligence rather than moving the conversation forward.
- When listing options or issues, use the pattern: "Option name — description of the issue or reasoning." No bold, no markdown headers. Just plain text with an em dash.
- Sub-points under an option go on separate lines. Not nested bullets — just new lines with enough context to stand alone.
- If the note is just a quick unblocker, skip explicit recommendation framing and ask the direct question.
- Add practical and operational concerns alongside technical ones only if they materially change the decision.
- State your opinion as personal when you need to give one: "I think..." not "We should..."
- End with a clear ask: what you want from the reader.
- End cleanly. The last numbered item, a direct question, or a `cc` line is a fine ending. Do not add closing paragraphs like "If we settle these 3 points, I can..." unless the user explicitly asks for a softer close.
- Use `cc` naturally. Inline `cc @name` when a specific person should answer a specific question. Final `cc @team` when a broader group should see the thread. Do not add extra framing around tags.

### Formatting in Slack

- Don't use bold/markdown for inline section headers. Use plain text with em dash separators.
- Use separate lines for sub-points rather than nested bullet lists.
- Keep formatting minimal — the structure comes from the writing, not from markdown.
- Match the user's actual level of polish. Slight roughness is better than polished AI cadence.
- Use inline code only when it helps disambiguate a technical identifier. Do not over-wrap obvious terms in backticks.
- Parentheticals for brief clarifications: "(views + authorization entries)", "(which defeats the purpose — they could just query source tables directly)".

### PR titles and one-liners

- Lead with the capability or behavior unlocked, not the implementation detail.
- Prefer a single sentence.
- A reviewer scanning the PR list should immediately understand what is now possible or what problem is gone.
- Keep wording concrete and specific.

### PR descriptions

- First sentence should name the bigger unlock or problem solved, not the code mechanics.
- Explain why the old approach was hard, unsafe, or limiting before describing the new one.
- Then explain what capability this unlocks and how the new approach makes it safe.
- Implementation details come last and only as much as a reviewer needs.
- Prefer an info-dense style over a narrative style. Fewer words, more signal.
- Use lists aggressively when they make the content easier to scan.
- Tests, behavior changes, rollout implications, and safety properties should usually be bullets, not prose.
- If a sentence can be turned into a short bullet without losing meaning, prefer the bullet.
- Keep paragraphs short. One tight setup paragraph is usually enough before switching to bullets.

## Sentence Style

- Prefer short sentences.
- Use concrete verbs and specific nouns.
- Cut filler ruthlessly. If a phrase does not add information, remove it.
- Use natural connectors sparingly. Do not turn a PR description into a spoken monologue.
- Show the reasoning chain, but compress it.
- It's fine to set up context before the point — just do it in as few words as possible.
- Preserve strong simple constructions from the user instead of elaborating them. If the user writes "What do we want to do for tracking?" or "Who should be allowed to do this from Admin?", keep that phrasing.
- Use "has a few issues related to..." or "this one has a problem we didn't surface" to introduce concerns — factual, not dramatic.

## Framing

- For proposals and discussions: present the problem, walk through options with their issues, state your recommendation, ask for input.
- For changes: state what changed, why it matters, what to look at.
- For announcements: state the fact, give enough context to understand it, move on.
- Present your opinion clearly but leave room for disagreement. "I think X" not "X is the right answer."

## What to Avoid

- Bold or markdown headers for option names in Slack messages. Use plain text with em dashes.
- Overly formal structure (excessive bullet nesting, header hierarchies).
- Declarative conclusions when the goal is discussion ("The plan is..." when you mean "I think we should...").
- Vague summaries like "Improve notification flow."
- Repeating the same point in different words.
- Marketing language, superlatives, unnecessary adjectives.
- Explaining basic implementation details to domain owners when the point is to ask them a question.
- AI-ish framing phrases like "main question", "key question", "deeper question", "the part I don't have a clear answer on", or other signposting that narrates the structure instead of just saying the thing.
- Proof-of-work narration — context included mainly to show research effort rather than to help the reader answer. If a detail does not materially change how a stakeholder should respond, cut it.
- Over-answering clarification questions. Do not bundle recommendations into what should be a simple ask. Replace "so we should decide whether..." with the direct question.
- Closing summaries or wrap-up paragraphs on Slack messages unless explicitly requested.
- Over-structuring short Slack messages with too much setup, too many names, or too many caveats.
- Overusing backticks for terms that are clear without them.
- Saying "I think we should drop this" for eliminated options — just list the issues and move on.
- Verbose PR descriptions that spend too many words restating the same setup.
- Hiding concrete facts like tests, rollout details, or safety properties inside long paragraphs when bullets would be clearer.

## PR Titles

Preferred patterns (capability-first):
- `fix: post deploy status to request thread`
- `feat: allow new lock fields to ship without backfilling existing rows`
- `feat: send retry alerts to the job thread`

Avoid titles that name internal helpers or implementation mechanics instead of the behavior:
- `fix: add post_status helper to DeployNotifier` (names the helper, not the outcome)
- `refactor: change lock initialization` (describes code edit, not capability)
