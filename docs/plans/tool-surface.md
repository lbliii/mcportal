# Plan: the tool surface for the long run

Status: in progress (2026-10-01), revised after an adversarial review of a first plan that
merged tools to cut tokens. This plan optimizes for where hosts are going, not for one
token count.

## Where hosts are going

Claude Code already defers MCP tools behind tool search: a conversation pays for names,
and a tool's definition only when it's found. The Claude API offers the same. As that
spreads, the length of the tool list stops being the cost that decides things. What does:

1. **Being found and chosen.** Names and descriptions that make sense on their own, when a
   search surfaces one tool out of context.
2. **What each call costs.** Results (a docs page, the room, a profile) already dwarf the
   whole tool list, and they're paid every time.
3. **Being safe and legible.** Approval prompts and read-only / destructive hints work only
   when each tool is one clear action.

Hosts that load every tool up front still pay the list; that's managed by scoping, below.

## Decisions

1. **Specific, self-contained tools. No generic merges.** `search_clips`, `open_docs` and
   `read_doc_page` stay: search finds them, each stands alone, and the room app opens cards
   per tool and routes views by a tool's arguments (`src/ui/room/bridge.js`), which merged
   tools would break. The count stays moderate by deleting what shouldn't exist.
2. **Scope the list to the person.** A server lists only what it can do (done in 0.4.0).
   An account lists only the social tools it uses: until it has a handle or follows, mutes
   or blocks anyone, it sees the ways in (open a space, follow, claim a handle, report) and
   not the rest. Hosts cache the list per conversation, so tools that unlock mid-conversation
   arrive in the next one, and the unlocking result says so.
3. **Budget results like definitions.** Each heavy result has a budget: concise text for the
   model, everything else in `structuredContent` for the room app, and paging for long pages.
4. **Edit by patch.** `arrange_room` replaces `update_profile`: it names each change, and
   nothing it doesn't name can change. That turns "never drop a portal you weren't asked
   to" from a rule the model must remember into a guarantee. `get_profile` goes: the room
   and its ids come from `open_room`.
5. **The reader records reading; the model doesn't.** The room app records what you
   actually open and how far you get, and resumes there; `record_reading` and `get_reading`
   become app-only. `list_reading` ("what was I reading?") stays for the model.
6. **One definition per tool, one fixed benchmark.** Each tool's schema, result type,
   annotations and token ceiling live with its definition; docs, manifest and eval cases
   derive from it. The eval is a frozen benchmark, run several times, and changes are
   judged against its recorded baseline, never by rewriting it.

## Phases

**Now (no new behaviour):**
- Count what the model sees (name, description, input schema) instead of whole tool
  objects; `npm run footprint -- --exact` asks the Claude API's token counter.
- Freeze the eval, add the missing cases (argument checks, card reads, imports, a
  multi-turn removal), repeat runs, and record results to compare against. **The baseline
  must be run on 0.4.0, before 0.5.0 ships: it needs API credentials.**
- Shrink schema prose and give each tool a token ceiling.
- Scope social tools to accounts that use them.
- Budget the heaviest results: `read_doc_page` pages, the room's text summary.

**0.5.0 (breaking, one release, before the marketplace listing goes live):**
- `arrange_room` replaces `update_profile`, fully specified and tested; the room app's
  toolbar uses it. `get_profile` is removed.
- `clip` takes `content` text for every kind but exchanges, which keep structured `turns`.
- Skill, command, instructions, README, manifest, tests and changelog change together.

**Then (a feature):** the reader records opens, position and explicit completion, and
resumes where you left off; `record_reading` and `get_reading` become app-only.

**Later (with real usage):** modules an account turns on and off; pruning tools that real
usage shows don't earn their place.
