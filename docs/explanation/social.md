# Social

MCPortal is a reader first, with a light social layer for passing finds between people. This page explains Spaces and handles, shares and reblogs, follows and safety, and the room layouts that show it all, including the river. For the tools, see the [tool reference](../reference/tools.md).

## Publishing is native

Everything social happens inside MCPortal. A share is seen by signed-in people in their Following portal, their river or your Space. It isn't published to the open web as a feed or a public page.

That keeps the rules in one place. MCPortal decides who can see a post, honors blocks and removals everywhere the post appears, and never has to chase copies across the internet. It also keeps the stakes low: you're filing a find onto a shelf where your followers look, not broadcasting.

Everything is opt-in. A local install in ghost mode has no social layer at all. A hosted account is private until you claim a handle.

## Spaces and handles

A **Space** is your public page inside MCPortal. It holds a title, a bio, an accent color, "Sources I read" (up to 12 portals from your room that visitors can add with one click), and your posts as a grid. `open_space` shows anyone's Space, or yours, as a card in the chat.

A **Space link** is a Space's address, `/@handle`. The room's Space view copies yours, and `open_space` gives it to the agent. The room lives in the agent, not in a browser, so the link is a bridge page (`src/space-links.ts`) that shows only the handle until you sign in. If you already use MCPortal, it tells you what to ask your agent. If you're new, it lets you sign in with GitHub. Signing in there leaves a one-time note. The next time your agent opens your room, it offers to follow the link's owner, and the room shows a Follow button. If the link brought a new account, its owner's room says so once the newcomer has a handle. Both notes are relations (`intros`, `joins`) stored beside follows. Each is said once, and a block removes both.

**Listing** is opt-in, and it's separate from having a handle. A listed person can be suggested by `find_people`, which matches only what they made public: their featured sources (a rarer shared source counts for more than Hacker News), feeds from the same site, posts they shared with everyone, and words in their Space or posts. It never suggests the user, people they follow, mute or block (or who block them), suspended accounts or unlisted profiles. Matching (`src/people.ts`) is set overlap and word search with no model, and the agent introduces people in its own words from the reasons it's given. When you add a source someone listed features, or build a room from packs, `add_portal` and `build_room` mention them by handle. `open_space` says which of their sources are in your room too.

The **People portal** keeps the agent's suggestions in the room, the same way highlights do for stories. `find_people` gives the agent candidates and evidence. The agent picks a few, and `suggest_people` stores each with a one-line reason the agent wrote, based on what that person shares, never guesses about who they are. MCPortal accepts only handles `find_people` returned in the last hour, so the agent can't write about someone it wasn't handed. Each card has Follow, their Space (click the card) and **Not for me**, which is the app-only `pass_person`. A pass is remembered for 90 days, and `find_people` marks passed people and lists them last. Suggestions live in the room's own data (`profile.people`) and last 30 days. A suggestion drops out when the person unlists, blocks you or is suspended. The suggested person never sees what was written about them. `list_new_items` mentions an empty or three-week-old People portal, so a catch-up can offer a refresh.

A **handle** is how people find you. It's 2 to 30 letters, digits or underscores, unique regardless of case, and suggested from your GitHub login without being tied to it. Words like `admin` and `api` are reserved. A handle you give up is held for 30 days, so nobody can take it to pose as you.

## Shares

A **post** is anything in a Space. A **share** is a post about a saved link or a clip, with a note.

- **You approve the words.** The agent shares only when you ask, and asks you to approve any note it writes.
- **You pick the audience:** your followers (the default) or everyone signed in to MCPortal.
- **The server looks everything up.** A share names a saved item or clip by ID; the title, link and content come from your own store, never from the request. The content is copied at share time, so later edits to the clip don't change the post.
- **`unshare`** removes a post.

## Reblogs

A reblog passes someone's post through your Space to your followers, with an optional note, and the credit stays with them. You find things through people and pass them on. It's curation, not amplification.

Each rule below exists because the obvious alternative goes wrong at scale.

**Reference, never copy.** A reblog stores which post it reblogs and draws the original live. The original's author keeps control: deleting the post, blocking someone, or removing their post from one reblog reaches every reblog. A copy-based reblog can't offer that.

**Credit pools on the original.** Counts and "who reblogged" belong to the original. A reblog shows the original's count, never its own. Per-reblog counts fragment credit and turn every reblog into a scoreboard.

**One hop.** Reblogging a reblog reblogs the original and credits the person you found it through ("via @ben"). There's no chain to walk, and your river shows reblogs by people you follow, never a stranger's reblog of a reblog. Limiting reshare depth is the strongest known lever against content going bad at scale.

**Consent is the author's.** Each post says who may reblog it: anyone, people who follow the author, or nobody, with an account default. A reblog never reaches further than the original could:

| Original | Reblog allowed when |
|---|---|
| Shared with followers only | Never: it would reach people the author didn't choose |
| Reblogs set to nobody | Never |
| Reblogs set to followers | The reblogger follows the author |
| Reblogs set to anyone | Anyone signed in who can see it |
| Any | Neither has blocked the other, and an admin hasn't hidden it |

These checks run when you reblog and again every time a reblog is drawn.

**One tap, an optional note.** A required note produces one-word notes and less sharing, so the note is offered, never required.

**Read it first, gently.** If you haven't opened a story, the reblog menu's first line offers "Read it first?". It never blocks you.

**Tombstones.** If the original is deleted, hidden, its account is gone, or its author removed it from your reblog, your reblog stays as a tombstone: your note and the link, with a line saying the original was removed. The original's words and author are gone. Blocked either way with the original's author, the reblog is hidden entirely.

One reblog per person per post; `unshare` undoes it. You can't reblog your own post. The original's author sees everyone who reblogged it, since the credit is theirs.

## Follows, mutes, blocks and reports

| Action | Effect |
|---|---|
| **Follow** | Open to anyone with a handle. Their posts reach your Following portal and your river. Your first follow adds a Following portal. |
| **Mute** | Their posts, and reblogs of their posts, disappear from your Following portal and river. They aren't told. |
| **Block** | Neither of you sees the other's posts, and follows are removed both ways. |
| **Report** | A post or a person goes to the admins, who can hide a post, dismiss the report or suspend the account. |

Blocking and reporting shipped with sharing, not after it. A social feature without them isn't finished.

Visibility is decided in one function, `canSee` in `src/social.ts`, and every read across accounts goes through it. Other people's account IDs never leave the server. Their notes reach your agent fenced as untrusted text. See [security](security.md).

## Room layouts

The room has one **layout** that arranges its portals. Each layout is a renderer over the same data: the room's ordered columns of portals.

| Layout | What it is |
|---|---|
| **Columns** | A sideways lane of columns, each holding up to four portals |
| **Shelves** | One sideways row per portal; a picture row when most items have pictures |
| **River** | Every portal merged into one stream, newest and unseen first |
| **Front page** | The agent's lead story and picks, then each portal's top stories. A lab, off unless `MCPORTAL_LABS=frontpage` |

These principles hold across all of them:

1. **Layouts are additive.** Adding one never changes another. You switch back with one click or `arrange_room`, and nothing is migrated.
2. **The agent ranks; the room displays.** Picks and reasons come from your agent through `show_highlights`. Without them the room uses a plain fallback: unseen first, then each source's own order.
3. **Places don't move.** Portals keep their order in every layout. A refresh updates what's on screen in place.
4. **Inline, the chat owns vertical scrolling.** Nothing in the inline room scrolls on its own. More content is paged ("5 more") or one level down. Columns inline show five stories per portal with a More button and visible lane controls.
5. **Lists for reading, size for importance.** No masonry. Sizes come from a few fixed card forms, never from content height.
6. **Motion orients, never decorates.** Moving between levels uses View Transitions where the host supports them, and switches instantly under reduced motion.

**Three levels.** Room, portal, item. A portal's title opens it to fill the room; the reader opens over it and returns to it. Back or Escape steps out one level, and the room comes back exactly as you left it.

## The river

Columns, shelves and the front page show the room by portal. The river shows it as one stream, for when you want to wander rather than survey. It's also where reblogs feel most alive: your follows' posts arrive in the same stream as your sources.

**An order you can say in one sentence.** The agent's picks, then what's new, then what you've seen; each source in its own order, merged by time. There are no engagement scores and no blending of scores across sources, since Hacker News points, Reddit votes and a blog's nothing can't be compared honestly. Picks appear only when your agent has left an edition, as a labeled block, never mixed into the time order.

**The merge.** Each portal is a queue in its own order. The river repeatedly takes the head of whichever queue has the newest head. Each source keeps its own ranking while the stream reads newest first. A "You're caught up" divider separates new from seen, based on seen marks rather than a scroll position, because the host owns the scroll position inline.

**No source drowns another.** A run of more than three stories from one portal folds into "N more from r/programming", which opens in place. A fold counts as one unit when paging, and folded stories are marked seen only once they're on screen.

**One story per link.** The same URL from two portals appears once, with both named ("also on Hacker News"). When someone you follow shares a link already in your feeds, it's that feed's story, lifted to where they shared it, with "@ana shared" above it and their note in their voice. Several follows reblogging one post make one card, with at most two notes: the original's and one reblog's.

**Provenance on every card.** Without portal blocks, each story names its portal, and the name opens the portal level. Docs and pinned portals aren't posts, so they don't join the stream; the river names them at the end.

**Pages that end.** Ten units at a time inline, twenty in fullscreen, where the next page loads as you near the end, at most twice, then asks. The river ends with "You're caught up" or "That's everything your portals fetched." Nothing polls: returning to the page refreshes portals past their freshness, at most every five minutes, and new stories wait behind "N new since you started" instead of reshuffling what you're reading.

**Accessible by default.** The stream is a `role="feed"` of articles. After "10 more", focus moves to a separator reading "Stories 11 to 20". The keys j and k move between stories, o opens, s saves.

## The front page

The front page is a layout built for the chat column: the agent's lead and picks with their reasons, then each portal as a block with its first three stories (picks aren't repeated) and "5 more". Without highlights, a button asks your agent for some. It grows to its content and never scrolls on its own. It stays a lab while it's evaluated against the other layouts.
