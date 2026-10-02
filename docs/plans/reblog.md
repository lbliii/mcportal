# Plan: reblogging

Status: proposed, 2026-10-02. Builds on the social layer (`src/social.ts`: shares,
follows, mute, block, report) and the river ([river.md](river.md), phases 1–3), and is
the M2 social feature [local-hosted-hybrid.md](local-hosted-hybrid.md) opens to local
installs. Research: [River and reblog design research](../../reports/River%20and%20reblog%20design%20research.md).

## Goal

A reblog passes someone's post through your Space to your followers, with an optional
note, and the credit stays with them. It's the Tumblr move that makes a small community
feel alive: you find things through people, and you pass them on. In MCPortal it's
curation, not amplification: you're filing a find onto your shelf where your followers
look, under the name of the person you found it through.

Vocabulary: a **reblog** is a post. It points at another post (the **original**) and may
add a note. A share is still a post about a link or clip; reblogging a share makes a
reblog. "Reblog" is the verb in the room and in tools.

## Principles

1. **Reference, never copy.** A reblog stores which post it reblogs and draws the
   original live. The original's author keeps control: their later removal, a block, or
   "remove my post from this reblog" reaches every reblog. (Tumblr copies, and can't
   offer that.)
2. **Credit pools on the original.** Counts and "who reblogged" belong to the original;
   a reblog shows the original's count, never its own. Tumblr reversed per-reblog notes
   within 30 hours after 100,000 complaints in March 2026.
3. **One hop.** Reblogging a reblog reblogs the original, crediting the person you saw it
   through (`via`). Your river shows reblogs by people you follow, never a stranger's
   reblog of a reblog. Reshare depth is the strongest lever there is against things going
   bad at scale (Facebook's own research: depth 2+ was ~4× as likely to be misinformation).
4. **Consent is the author's.** Each post says who may reblog it: anyone, people who follow
   the author, or nobody, with an account default. A reblog never reaches further than the
   original was allowed to: followers-only posts can't be reblogged.
5. **One tap, an optional note.** Forcing a note cut Twitter's sharing ~20% and filled it
   with one-word notes. The note is offered, never required.
6. **The server looks everything up.** As `share` does today, a reblog names a post by id;
   the title, link and content come from the store, never from the request.

## The model

`Share` (src/social.ts) gains optional fields; no existing share changes.

```ts
interface Share {
  // ...as today
  /** A reblog: the original post and, when it reached you through someone's reblog, theirs. */
  reblogOf?: { root: string; via?: string };
  /** Who may reblog this post (originals only). Absent: the author's default, then 'anyone'. */
  reblogs?: 'anyone' | 'followers' | 'nobody';
  /** Set on a reblog when the original's author removed their post from it. */
  detachedAt?: string;
}
```

- A reblog has `kind`, `title` and `url` copied from the original as a **snapshot**, for
  search, the store's indexes and the tombstone. It never copies a clip's content or the
  original's note: those are drawn live.
- `root` is always an original (reblogging a reblog resolves to its root), so there's no
  chain to walk. `via` is the reblog you reblogged from, if any, and is shown as "via
  @ben".
- One reblog per person per original: reblogging again is refused (`conflict`), with the
  existing one's id, so undo has one thing to remove.
- Reblogs count toward the 1000-post limit, like shares.

**Who can reblog** (checked in `Social.reblog` and again whenever a reblog is drawn):

| Original | Reblog allowed when |
|---|---|
| `audience: 'followers'` | never (it would reach people the author didn't choose) |
| `reblogs: 'nobody'` | never |
| `reblogs: 'followers'` | the reblogger follows the author |
| `reblogs: 'anyone'` | anyone signed in who can see it |
| any | not blocked either way; not hidden by an admin |

A reblog's audience is the reblogger's choice, `followers` or `mcportal`. The original is
`mcportal` (or it couldn't be reblogged), so neither choice reaches further than the
original.

**Drawing a reblog for a viewer:** the viewer must be able to see the reblog (today's
`canSee`) *and* the original. Blocked either way with the original's author: the reblog
is hidden entirely. Original deleted, hidden by an admin, its account gone or private,
or `detachedAt` set: a **tombstone**. The reblogger's note stays, with the link (title
and URL are the web's, not the author's words), but the original's note, clip and author
are gone: "The original post was removed." / "Removed by its author from this reblog."

**Muting** someone hides their posts in your Following portal, and now also reblogs of
their posts.

## Storage

- Document store (`social-store.ts`): the new fields live in each share; the queries
  below filter in memory.
- Postgres (`db/social.ts`): shares are `jsonb`, so the fields need no migration, but
  counting and finding reblogs needs a column. Schema version 8 adds `root_id text` to
  `mcportal_shares` (filled from `data->'reblogOf'->>'root'` on write), an index on
  `(root_id, created_at DESC)` and a unique index on `(account_id, root_id)`.
- New store operations: `reblogsOf(rootIds, { limit, before })`,
  `countReblogs(rootIds): Map<id, number>`, `reblogBy(accountId, rootIds)` (yours, to mark
  the button), `setDetached(reblogId, at | null)`. `forget(accountId)` already deletes the
  account's posts; their originals' reblogs become tombstones by the drawing rule.
- The store contract test (`test/store-contract.test.ts`) covers both stores.

## Social rules

New on `Social` (and the `SocialService` a linked local MCPortal implements over
`src/api/methods.ts`):

- `reblog(author, { id, note?, audience? })`: resolves `id` to its root (and `via`),
  checks the table above, snapshots title, kind and URL, and adds the post.
- `shareSettings(author, id, { reblogs?, detach? })`: the original's author changes who
  may reblog a post (any time; existing reblogs stay) or removes it from one reblog
  (`detach: reblogId`, which must point at their post).
- `present()` gains, for each post: `original` (the root as the viewer may see it, or a
  tombstone reason), `via` (handle), `reblogs` (the root's pooled count), `myReblog`
  (the viewer's reblog id, if any) and `canReblog`.
- `reblogsOf(viewer, id)`: who reblogged a post, by handle, only those the viewer may
  see; full list for the post's author.

Notifications don't exist in MCPortal yet and aren't part of this plan. The author sees
who reblogged a post on the post in their Space and through `get_share`. An activity view
("Ana reblogged your post") is the first follow-up once people use this.

## Tools

The social tools are scoped to accounts that use them (tool-surface.md); these changes
stay inside that set, and each gets a token ceiling and eval cases.

- **`share` gains `reblogOf`** (a post id from the Following portal, a Space or
  `get_share`) and **`reblogs`** (who may reblog what you post). Description adds one
  clause: "or reblog someone's post (reblogOf: its id); only when they ask, and ask
  before reblogging something they haven't opened." The server enforces the consent
  rules; the tool refuses with the reason ("@ana's post is followers-only").
- **`unshare`** removes a reblog like any post (that's undo).
- **`get_share`** returns the original, via, pooled count, and for your own post who
  reblogged it.
- **`share_settings`** (new, write): who may reblog a post you made, or remove it from
  someone's reblog. Separate from `share` because it's the author acting on their own
  post, and approval prompts should say so.
- **`set_public_profile` gains `reblogs`**: the default for new posts.
- **Following portal items** carry the share fields the room needs (`share.root`,
  `share.via`, `share.reblogs`, `share.myReblog`, `share.canReblog`) in
  `structuredContent`; the model's text summary gains nothing beyond "reblogged @ana's
  post" in the item line.

## The room

**The button.** The reblog icon (`reblog` in scripts/brand.ts: the repost loop drawn as
a doorway; its moon appears while reblogged) replaces the share button on story cards,
Following rows and posts in a Space. It's a menu button (`aria-haspopup="menu"`), not a
toggle, with state and count in its name: "Reblog (12 reblogs)", "Undo reblog (12
reblogs)". A visible "Reblog" label where the row has room (fullscreen, cards 600px and
wider).

- **The menu:** "Reblog" (posts at once to your default audience), "Reblog with a note"
  (the composer, with the original quoted above it), "Undo reblog" when you have. Escape
  and outside clicks close it; focus returns to the button.
- **Read it first:** if you haven't opened the story (`get_reading` has nothing for its
  URL), the menu's first line offers "You haven't read this yet. Read it first?",
  opening the reader. It never blocks. (Twitter's prompt raised article opens 40%.)
- **On a story with no post behind it** (a feed's story, not a follow's), reblogging
  shares the link: save, then post, exactly as phase 3's share does, now in one step from
  the same menu. On a story a follow shared, it reblogs their post, crediting them.
- **Reblogs off:** a post that can't be reblogged shows the icon struck through
  (`reblog-off`), disabled, named "Reblogs are off for this post".
- **Feedback:** the pressed moon, the `--mp-action-reblogged` colour (a new ink-green
  token, apart from the link and primary teal), a toast "Sent through the portal!
  Reblogged to your followers.", and an ink-stamp landing slightly off register on the
  icon, skipped under reduced motion and on undo. Failures say why in the pulp voice and
  plainly ("Ana keeps this one to herself: reblogs are off").

**In the river.** A reblog by someone you follow is the original's story, lifted to
where the reblog put it, as phase 3 does for shares:

- Context row: "@ben reblogged @ana", "@ben and @cy reblogged @ana", "Reblogged by @ben,
  @cy and 2 more". Several follows reblogging one post are one card.
- The trail is at most two notes: the original's (by @ana) and the reblog's (by @ben),
  each in its author's voice. Never deeper: one level of quoting (Tumblr's 2015 lesson).
- The count is the original's: "12 reblogs".
- A tombstoned original shows the reblogger's note and the link, with the removal line.

**In the Following portal** (columns, shelves, front page): a row reads "@ben reblogged
@ana" in its meta, and opens the share card like any post.

**In a Space.** Your reblogs appear among your posts with "reblogged from @ana" (and "via
@ben"). On your own posts: the count, who reblogged (a short list that opens their
Spaces), "Who can reblog" (Anyone, Followers, Nobody), and on each reblog "Remove my
post from this reblog", which asks once and can't be undone by the reblogger.

## Safety

- Blocks are checked when reblogging and when drawing, both ways, against the reblogger
  and the original's author.
- Reports: reporting a reblog reports the reblogger's note; the card also offers
  reporting the original. Hiding an original (admin) tombstones its reblogs.
- Rate: reblogs share the post limit (1000) and the existing write budget; no separate
  limit until abuse says otherwise.
- Changing attribution rules later (counts, credit lines) gets announced in the changelog
  before it ships.

## Phases

### 1. Rules and storage

`Share` fields, `Social.reblog`, `shareSettings`, the drawing rule and tombstones,
pooled counts, `reblogsOf`; the document store, Postgres schema 8 and the store contract
test; the API methods for linked local installs. Tests in `social.test.ts`: every row of
the consent table, reblogging a reblog resolves to the root with `via`, one reblog per
original, blocks and mutes hide, delete/hide/detach/forget make tombstones, counts pool.

### 2. Tools

`share` with `reblogOf` and `reblogs`; `unshare` for reblogs; `get_share` with the
original and who reblogged; `share_settings`; `set_public_profile` default; Following
items' share fields. Token ceilings, footprint, eval cases ("reblog Ana's post about X",
"stop people reblogging my last post", a refusal for a followers-only post, asking first
for an unread one).

### 3. The room

The reblog button, menu, nudge, `reblog-off` icon, `--mp-action-reblogged` token,
toast and stamp; the river's context rows, trail, grouping and tombstones; Following rows;
Space posts with counts, who reblogged, the settings and "Remove my post". Browser tests
in the injected-social style of river phase 3, plus a hosted end-to-end test with two
accounts (share, follow, reblog, undo, detach). Design preview: a reblog, a two-note
trail, a tombstone and a reblogs-off post.

### 4. Lab, then everyone

Behind `MCPORTAL_LABS=reblog` on the hosted server and for linked installs, with the
river. Use it for two weeks with a handful of accounts, then turn it on, with a changelog
entry saying how credit works.

## Open questions

- **Activity.** People will want to know who reblogged them. A quiet activity list in
  your Space first, or nothing until asked?
- **Reblog counts in public.** Show counts to everyone, or only to the author (calmer,
  less of a scoreboard)? The plan shows them; this is the one to revisit after the lab.
- **Default audience for a reblog.** The reblogger's last choice, or always followers?
- **Feed stories.** "Reblog" on a story no one has posted makes a new post. Is that
  clear enough, or should the menu say "Post to your Space" there?
- **The original changes.** Posts can't be edited today. If editing arrives, reblogs show
  the current original, with "edited".
