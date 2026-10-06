# Plan: finding people

**Status:** proposed 2026-10-06. Nothing built. Builds on the social layer (`src/social.ts`), public profiles (`src/public-profiles.ts`), reblogging ([reblog.md](reblog.md)) and the river ([river.md](river.md)). It's the "optional discovery through people's Spaces" item in [delivery-roadmap.md](delivery-roadmap.md), stage 4.

## Where we are

Following works, but only if you already know someone's handle. Every way in (`relationship`, the Follow button on a Space, `social.follow`) takes a handle, and nothing in the product shows you one you didn't already have:

- Handles in the share reader ("@ana shared", "reblogged @x", "via @y"), in river context rows and in the Following portal are plain text. The only clickable handles are the reblogger list on your own post.
- A Space has no address. You can't hand someone a link to yours.
- There's no directory, search or suggestion.
- A post shared with **everyone on MCPortal** only reaches your followers' Following portal, because the feed is built from people you follow. Today "everyone" means "followers, plus anyone who already knows your handle."

## The idea: the agent is the matchmaker

Every social network tries to solve "who should I follow?" with a ranking model over a huge graph. We have neither, and we don't need them. We have something better: the agent already knows what the user cares about, from the conversation and its own memory. MCPortal knows who publicly features, shares and reads which sources. Neither can make a good introduction alone.

The rally ([watches.md](watches.md)) applied to people:

1. **Agent → MCPortal.** The user mentions they've been deep in Rust compilers this week. The agent asks MCPortal who on MCPortal is into that, passing topics, sites and feeds, not the conversation.
2. **MCPortal → agent.** MCPortal matches deterministically against what people chose to make public (featured sources, bios, posts shared with everyone) and returns a few people, each with **reasons**: "features 3 feeds you follow", "shared 4 posts from rustc-dev-guide".
3. **Agent → user.** The agent judges and introduces, choosing one or two and saying why in the user's terms, with a sample post. It doesn't hand over a list.
4. **User → MCPortal.** One follow. Their shares start arriving in the river, mixed in with the user's own sources.
5. **A better next rally.** What the user follows, reblogs and mutes sharpens what the agent offers next time. That's the agent's memory, not a profile MCPortal builds.

MCPortal still never calls a model. Matching is set overlap and text search. The judgment is the agent's.

## Principles

1. **Every handle is a door.** Anywhere a person appears, one tap opens their Space with Follow on it. This costs nothing and does most of the work in a small community.
2. **Being findable is opt-in.** Claiming a handle makes a Space. Being **listed** (showing up in search, suggestions and the Lobby) is a separate, explicit choice. Being unlisted still lets people who have your handle or link find you.
3. **Suggestions come with reasons, or not at all.** Every suggestion says why, using things the suggested person chose to make public. No "people you may know" black box. (Roadmap release criterion: "Recommendations have understandable reasons.")
4. **The follow graph stays private.** We never reveal who follows whom, so there's no "followed by people you follow." Signals come only from a person's own public choices.
5. **Introductions, not feeds of strangers.** The agent offers people when asked, or at natural moments (building a room, adding a source). It never pushes suggestions on its own. The room gets one quiet surface (the Lobby), and only if the user adds it.
6. **Native, not the open web.** Space links work for people signed in to MCPortal. No SEO pages, and no public profile visible to logged-out visitors.
7. **Two new model tools.** Discovery is `find_people` and `suggest_people`, the same candidates-then-picks pair as `list_new_items` and `show_highlights`, plus fields on tools we already have (see [tool-surface.md](tool-surface.md)).

## The surfaces

From cheapest to richest. Each one stands on its own.

### 1. Every handle is a door (room UI)

- Every `@handle` in the room opens that Space (`loadSpace`), with a back button to where you were: share reader bylines, notes, `via`, river context rows ("@ana shared"), Following items and reblog chains.
- The share reader gets a **Follow @ana** button next to Reblog when you don't follow the author. Seeing a good post is the moment you want to follow.
- `get_share`, `list_new_items` and `open_space` results already name handles. Server instructions tell the agent it can offer to follow ("Want @ana's posts in your Following portal?") when the user reacts well to something someone shared.

### 2. Space links and invites

- Every Space gets an address: `https://<host>/@ana`. It's `noindex`, and it's the only public URL a person has.
- **Signed in:** the link opens your room straight onto @ana's Space as a card, with Follow.
- **Not signed in:** a small page says "@ana is on MCPortal, your liminal webspace", with Sign in with GitHub. After sign-in (and onboarding, for a new account), the room opens on @ana's Space. Nothing else about the person shows before sign-in, matching the privacy page.
- **This is the invite.** With open sign-up, "invite a friend" just means sharing your Space link. A new account that arrives through it gets offered a follow of the inviter, and the inviter sees "@ben joined through your link" next time they open their Space. Both are offered, never automatic.
- The toolbar's Your space menu gets **Copy link to your space**.

### 3. Listing and `find_people`

**Listing.** `set_public_profile` gains `listed: boolean`. The handle-claim flow asks plainly: "List me so people with similar sources can find me." Existing profiles start unlisted.

**The index.** For listed profiles, MCPortal keeps:
- **Featured sources by key.** It normalizes each featured source to a key (feed URL, `github:owner/repo`, `hn:front`), the same normalization `add_portal` dedupes with. This is the strongest signal: the person chose to recommend it.
- **Domains and titles** of their posts shared with everyone (not followers-only).
- **Text:** handle, display name, Space title and bio.

The index is built from data we already store. Postgres needs one table (`profile_source_keys`) plus a text index; the local store computes it in memory.

**`find_people` (new model tool, scoped to `socialEntry`).** Arguments, any combination:
- `about`: topics or words, which the agent distills from the conversation.
- `sources`: URLs or feeds the user cares about. Each one resolves to a key the way `find_source` does.
- `like`: a handle, to find people with overlapping featured sources.
- No arguments: matches against **the user's own room**, comparing their portals' keys to everyone's featured keys.

It returns at most 12 candidates, ranked by overlap: shared featured sources weigh most, then shared post domains, then text. Each candidate comes with:
- `reasons[]`: human-readable and built from public data only.
- **Evidence for the agent:** bio, featured source titles, and the titles and notes of their 5 most recent posts shared with everyone, fenced as third-party text.
- Their follower count.
- Whether the user passed on them before (see the People portal below).

It excludes the user, people they already follow, muted and blocked (both ways), suspended accounts and unlisted profiles. It's rate-limited per account, and there's no way to page through the whole directory.

On its own, `find_people` is for "who's into X?" and answers in conversation. The People portal is for keeping suggestions around.

### 3b. The People portal: your agent's suggestions, kept in the room

A portal (a new house source kind, `people`) where your agent's suggestions of who to follow live between chats. Each item is a person card:

> **@ana** · *Cat Physics Quarterly*
> Posts mostly about cats, and especially cat behavior research. Shares a lot from the same two science blogs you read.
> [Follow] [Open Space] [Not for me]

> **@ben**
> Plays World of Warcraft: raid guides, patch notes, and long notes about the lore. Features Wowhead and the WoW subreddit.
> [Follow] [Open Space] [Not for me]

**How it fills: the same pattern as highlights** ([attention.md](attention.md) §4):

1. The agent calls `find_people` and gets candidates, with evidence.
2. It judges them with what it knows about the user, and picks a few, best first.
3. It calls **`suggest_people`** (new model tool) with each pick's handle and a one-line **why** of up to 200 characters, in its own words. MCPortal stores the picks in the People portal and renders them as a card in the chat too.

The agent writes the summary and MCPortal writes nothing. That keeps principle 1 of the attention plan: MCPortal never calls a model.

**When it fills.** The agent can't act on its own, so the portal fills when:
- the user asks ("who should I follow?", "find me people into synths"),
- it's onboarding, after `build_room`, which is the moment follows matter most,
- or the agent offers during a catch-up. `list_new_items` mentions "your People portal is 3 weeks old" so the agent can offer to refresh it.

An empty People portal says "Ask your agent who you might like to follow."

**Rules for the why-line.** These go in the tool description, as eval cases, and are checked where we can:
- **Only from the evidence.** The why must come from what `find_people` returned: their posts, featured sources and bio. It never comes from the user's private conversation ("you mentioned your divorce") or guesses about the person. `suggest_people` only accepts handles from a `find_people` result in the last hour, the way `show_highlights` only accepts refs, so the agent can't write about someone MCPortal didn't hand it.
- **About what they share, not who they are.** "Posts about cats", not "loves cats because she's lonely". The why names the person by handle, and never guesses gender, age or anything else the person didn't state.
- **Private to the viewer.** The suggested person never sees what an agent wrote about them, and the why-line isn't stored anywhere they could reach.

**Actions on a card:**
- **Follow** follows them, and the card turns into "Following ✓". Their posts start arriving in the river.
- **Open Space** opens their Space, where Follow also lives.
- **Not for me** removes the card. MCPortal remembers the pass for 90 days, and `find_people` marks passed candidates, so the next round learns from it. This is the rally's return shot.
- Suggestions expire after 30 days, or as soon as the person unlists, blocks you or is suspended.

**What it isn't:** the People portal never fills itself, never comes from a ranking MCPortal ran, and never shows a suggestion without a reason.

**Passive hit-backs (no new tools):**
- **`add_portal`:** "@ana and 2 others on MCPortal feature this feed." The result tells the agent, and the agent may mention it.
- **`build_room`:** after starter packs, the result lists up to 3 listed people who feature those packs' sources. This is the agent's cue for an introduction in onboarding, when follows matter most.
- **`open_space`:** "You both feature: Simon Willison, rustc-dev-guide."

### 4. The Lobby

A new house source kind, `lobby`: posts shared with **everyone on MCPortal** by listed people, newest first, minus muted and blocked. It gives the "everyone" audience its meaning: everyone who looks in the Lobby.

- **Opt-in in two places.** The author picks "everyone" per post and is listed. The reader adds a Lobby portal; it's never in a room by default and never in starter packs.
- **Reblogs stay one hop** ([reblog.md](reblog.md) principle 3). The Lobby shows original posts and reblogs whose author is listed, never a reblog of a reblog.
- **Per-author cap:** at most 3 posts per person per day, so one prolific person can't fill it.
- In the river, a Lobby item from someone you don't follow reads "@ana · not followed", and the handle is a door.

**"Also shared by" in the river.** When a story from your own sources was shared with everyone by a listed person you don't follow, its context row says "also shared by @ana". It means someone else found the same thing worth passing on, which is the best possible reason to look at a person. It's limited to one name per story, from public posts only.

### 5. Bridges (later)

- **GitHub.** Everyone signs in with GitHub. With the user's go-ahead, MCPortal reads their public GitHub following list (public API, no new scope) and finds listed people among those accounts who also turned on **Findable by my GitHub account**. Both sides opt in. This is the cold-start answer for a developer-heavy audience. Phase 5, after the basics show what people use.
- **Curators in starter packs.** A pack can name a listed person whose Space it came from ("Pack curated by @ana"). This seeds the network around the founder and early curators.
- **Federation.** Handles go through one resolver (`Social.resolve`) today. Keep it that way so `@ana@other.instance` can slot in later ([open-source.md](open-source.md)).

## Tools

| Change | Kind | Scope |
|---|---|---|
| `find_people` | new model tool: candidates with reasons and evidence | `socialEntry` |
| `suggest_people` | new model tool: the agent's picks with a why-line, kept in the People portal and shown as a card | `socialEntry` |
| `people` | new house source kind (the People portal) | hosted |
| `set_public_profile` `listed`, `githubFindable` | new fields | as today |
| `add_portal`, `build_room`, `open_space` | short "also features" lines in results | social accounts |
| `lobby` | new source kind for `add_portal` | hosted |
| `open_space` | `handle` from a Space link | as today |

Both tool descriptions get a token ceiling and frozen eval cases ([evals/](../../evals)): offers only when asked or at the listed moments, passes topics rather than conversation text, and treats returned bios and posts as third-party text.

## Safety

- **Abuse of discovery:** only listed people appear anywhere, blocks hide both ways in every surface, and `report` works from the people card. Admin suspension removes a profile from the index immediately.
- **Enumeration:** results are capped and there's no paging or empty-query dump of all users (the no-argument form matches against the user's room). Requests are rate-limited.
- **Untrusted text:** bios, Space titles and post notes reach the agent fenced as third-party text, like every other result.
- **Privacy page:** add a "Listed and findable" row (what's indexed, who sees it, how to turn it off). Unlisting removes a profile from the index at once.

## Phases

| Phase | What | Size |
|---|---|---|
| 1 | Every handle a door; Follow in the share reader; agent instructions to offer follows | S, room UI only |
| 2 | Space links `/@handle`, the sign-in passthrough, inviter follow offer, Copy link | S–M |
| 3 | `listed`, the featured-source index, `find_people`, hit-backs in `add_portal`/`build_room`/`open_space` | M |
| 3b | The People portal: `suggest_people`, person cards, Not for me, the onboarding cue | M |
| 4 | The Lobby source kind; "also shared by" in the river | M |
| 5 | GitHub bridge; curated packs | M, after usage data |

Phases 1 and 2 are worth shipping even if nothing else is: in an invite-driven community, links and clickable names are how people find each other.

## How we'll know it works

- **Share of active social accounts that follow someone other than the person who invited them.**
- **Time from sign-up to first follow.**
- **Follows by surface.** Record which surface a follow came from (`space`, `share`, `link`, `find_people`, `lobby`, `hit_back`) as a count in housekeeping stats, never per person.
- **Unfollow or mute within 7 days of a `find_people` follow.** This checks suggestion quality.
- **People portal: Follow versus Not for me.** This checks whether the agent's why-lines persuade, or just describe.

## Open questions

1. **Listing default at handle claim.** The plan asks with the box unchecked. A pre-checked box grows the directory faster in a small beta, at some cost to the "private unless you choose" stance.
2. **Should you see who follows you?** Today you see a count only. Seeing your own followers (never anyone else's) enables follow-back, the biggest discovery loop on every social network, without revealing the graph to third parties. It means changing the privacy page and existing users' expectations.
3. **The name "Lobby."** It fits rooms and portals. Alternatives: Commons, Square, Concourse.
4. **Lobby moderation at scale.** The per-author cap and blocks are enough for the beta. A public stream may later need admin hiding at the Lobby level only.
