---
name: humor
description: Write short, roasty jokes for tech contexts like code reviews, debugging, incidents, and product discussions. Use loose comedic reference points for tone only, never direct imitation.
---

# Humor

Use this skill when the user wants a joke, roast, funny rewrite, or a quick comic line in a technical context.

Always generate jokes and funny rewrites through a subagent using `model: openai-codex/gpt-5.3-codex-spark`, then do a quick factual/tone pass before returning the final text.

## Goal

Write jokes that are:

- short
- roasty
- grounded in the actual situation
- sharper than friendly banter, but not mean enough to become weird
- shorter than a story bit or long analogy

Default to one-liners or tight two-liners.

## Core approach

- Start from the most embarrassing true thing in the situation.
- Compress hard.
- Prefer one clean punch over three decent ones.
- Roast the bug, the PR, the design, the process, the naming, or the fake complexity.
- Punch up at systems and decisions more than at people.

## Loose inspirations only

Use these as **abstract reference points**, not as styles to imitate:

- Rodney Dangerfield — compact self-own / no-respect structure
- Mitch Hedberg — absurd compression and sideways logic
- Norm Macdonald — dry understatement and anti-hype energy
- Conan O'Brien — smart, silly escalation
- Dave Attell — fast roast density
- Tig Notaro — calm deadpan
- early internet forum sarcasm — blunt and compact
- the best staff engineer in a bad retro — tired, precise, devastating

These are tone anchors only.
Do **not** imitate any specific living person, cadence, persona, or copyrighted bit.
Do **not** mention the references in the output unless the user explicitly asks.

## Best use cases

This skill works best for:

- code review notes
- flaky tests
- incident retros
- specs that say a lot and do very little
- “temporary” fixes
- dead code that somehow has better test coverage than production code
- AI features with no caller
- dashboards, metrics theater, and naming crimes

## Writing rules

- Keep it short. Usually 1–2 sentences.
- Roasty is better than whimsical.
- Specific is better than random.
- If an analogy helps, make it fast.
- If the joke starts explaining itself, cut it.
- If the joke could fit any repo, it is too generic.
- If the joke sounds cruel, make it dumber and lighter.

## Avoid

- long monologues
- fake stand-up setup/punch formatting
- references that overpower the actual joke
- meme sludge
- trying too hard to sound edgy
- punching down
- copying a real comedian's voice

## Output shapes

Choose the smallest useful format:

- 1 joke
- 3 short options
- a roast line
- a funny rewrite
- a few caption-style variants

## Quality bar

Good:

- feels true immediately
- lands in under 2 sentences
- sounds like something you'd drop in a PR or Slack thread
- has at least a little bite

Bad:

- needs setup
- generic tech humor
- too cute
- too polished
- longer than the bug deserves
