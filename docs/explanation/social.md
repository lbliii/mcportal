# Social

MCPortal is a reader first, with a light social layer for passing finds between people. This page explains Spaces and handles, shares and reblogs, follows and safety, and the room layouts that show it all, including the river. For the tools, see the [tool reference](../reference/tools.md).

## Read anywhere, publish through your agent

Publishing happens through your agent. People signed in to MCPortal read shares in Following, the river and Spaces; anyone with a public Space's link can read its page and RSS feed on the web. Followers-only posts stay within followers. Ghost mode has no social layer, and an account has no Space until its owner claims a handle.

A newly claimed Space is **public by default**. Uncheck “Public Space” when claiming the handle, in the print shop, or use `set_public_profile` with `public: false` to keep it within signed-in MCPortal. Listing for discovery is a separate choice, unchecked by default. Copies, screenshots and feed caches made while public cannot be recalled.

## Spaces and handles

A **Space** is your own MCPortal publication. Choose **paperback**, with a cover band and a side column; **magazine**, with a masthead and cover story; or **patch**, with a round mission patch and section tabs. Visitors see your format. Switching formats keeps every field and post. The room's card and script-free web page use the same renderer, with container queries for narrow cards and ink colors for light, dark and forced-colors modes.

The **print shop** on your own Space saves named plates: eight ink sets, five motifs, a format and Re-roll. A random cover seed is stored when you claim your handle; renaming it keeps your cover. Re-roll changes only the composition. Your patch avatar appears where you are the subject, including People, Lobby, Following, river context rows and Space-link introductions.

**Now transmitting** pins one of your own posts; unsharing it unpins it. **Transmitting on** holds up to four topics of 24 characters each. Your agent saves bio and topic wording only after you approve it. **Fellow travelers** are up to six listed people you chose, in your order. They are never drawn from your follows; unlisting, suspension or a block removes them from view. Featured sources are still copies of up to twelve RSS, Hacker News or GitHub portals from your room, never access to the room itself.

**Stamps** mark facts, with no rankings: Charter traveler for accounts made before October 7, 2026; Brought 1, 3 or 10 aboard; Signal keeper for posting in ten different weeks; and a volume for years since the Space was created. Owners can hide each stamp. The brought-aboard aggregate survives the one-time join notes and stores no newcomer identities.

A **Space link** is `/@handle`. The room copies yours and `open_space` gives it to your agent. Public pages show cover, identity, topics, pinned post, sources, listed travelers, stamps and posts for everyone. Link posts include an outward link and note; quotes are limited to 400 characters, and other clips show a title and sign-in link. A reblog whose original is private, removed or hidden shows only a members-only placeholder and the reblogger's own commentary. Public pages omit follower and reblog counts. Follow, Add and Reblog lead through `/@handle/signin` to your agent; there is no web composer.

Each public Space has an RSS 2.0 feed at `/@handle/feed`, containing the latest fifty visible posts with the same clip and reblog rules. Private Spaces return 404 for feeds and show only their handle and cover preview on the web. Every Space page and feed sends `noindex, nofollow`; some crawlers ignore it. The forty link-preview PNGs are prerendered from the cover engine. Pages are cached for a minute, rechecked for current visibility on every request, and rate-limited to 120 requests per IP per minute. No page tracking is added.

Signing in through a Space link leaves a one-time note: your room offers a Follow of the link's owner, and their room names a newcomer once the newcomer has a handle. The `intros` and `joins` relations live beside follows, are said once, and disappear on a block.

**Listing** is opt-in, and it's separate from having a handle. A listed person can be suggested by `find_people`, which matches only what they made public: their featured sources (a rarer shared source counts for more than Hacker News), feeds from the same site, posts they shared with everyone, and words in their Space or posts. It never suggests the user, people they follow, mute or block (or who block them), suspended accounts or unlisted profiles. Matching (`src/people.ts`) is set overlap and word search with no model, and the agent introduces people in its own words from the reasons it's given. When you add a source someone listed features, or build a room from packs, `add_portal` and `build_room` mention them by handle. `open_space` says which of their sources are in your room too.

The **People portal** keeps the agent's suggestions in the room, the same way highlights do for stories. `find_people` gives the agent candidates and evidence. The agent picks a few, and `suggest_people` stores each with a one-line reason the agent wrote, based on what that person shares, never guesses about who they are. MCPortal accepts only handles `find_people` returned in the last hour, so the agent can't write about someone it wasn't handed. Each card has Follow, their Space (click the card) and **Not for me**, which is the app-only `pass_person`. A pass is remembered for 90 days, and `find_people` marks passed people and lists them last. Suggestions live in the room's own data (`profile.people`) and last 30 days. A suggestion drops out when the person unlists, blocks you or is suspended. The suggested person never sees what was written about them. `list_new_items` mentions an empty or three-week-old People portal, so a catch-up can offer a refresh.

The **Lobby** is a portal you add yourself (`add_portal` with `source: lobby`). It's never in a room by default or in a starter pack. It shows posts shared with everyone by listed people, newest first, at most 3 per person per day, minus anyone you mute or block (or who blocks you), so listing and the "everyone" audience are both opt-ins. A post from someone you don't follow is marked "not followed", and its handle opens their Space. In the river, a Lobby post joins the feed's story like a follow's share does. **"Also shared by"**: when a story from your own sources was shared with everyone by a listed person you don't follow, and nobody you follow shared it, its context row names them, one name per story (`open_room`'s `alsoShared`). An admin hiding a post takes it out of both.

A **handle** is how people find you. It's 2 to 30 letters, digits or underscores, unique regardless of case, and suggested from your GitHub login without being tied to it. Words like `admin` and `api` are reserved. A handle you give up is held for 30 days, so nobody can take it to pose as you.

## Shares

A **post** is anything in a Space. A **share** is a post about a saved link or a clip, with a note.

- **You approve the words.** The agent shares only when you ask, and asks you to approve any note it writes.
- **You pick the audience:** your followers (the default) or everyone who can see your Space.
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
