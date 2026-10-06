# Getting started

In this tutorial you install MCPortal in Claude Code, build your first room, read an article, save it, and clip a quote. It takes about ten minutes. You need Claude Code and Node.js 22.18 or newer (`node --version` tells you).

Other hosts work too; [Install](../how-to/install.md) covers them. The steps after installing are the same everywhere.

## 1. Install the plugin

In a Claude Code session, add the MCPortal marketplace and install the plugin:

```text
/plugin marketplace add lbliii/mcportal
/plugin install mcportal@mcportal
```

If `/portal` doesn't appear yet, restart Claude Code. MCPortal now runs on your computer. There's no account to create: you're in ghost mode, and everything stays in `~/.mcportal`.

## 2. Open your room

Type:

```text
/portal
```

You can also just ask: "open my room". Your agent calls `open_room`, and because you're new, the room opens on its welcome screen.

## 3. Pick starter packs

The welcome screen shows nine starter packs: Developer, Developer docs, AI, News, Video games, Art & design, Science, Music, and Film & TV. Each pack holds a few sources that are checked to load.

Click up to four that interest you, then click **Summon my portals!**. MCPortal builds your room, one portal per source, and opens it.

If your host shows text only, tell your agent instead: "build my room from the AI and Science packs".

## 4. Add a source by asking

Think of a blog, subreddit, YouTube channel or GitHub repo you follow. Ask for it:

```text
add Simon Willison's blog
```

Your agent calls `find_source`, which turns your words into sources that actually load and previews them. It shows you the candidates. Say which one you want, and it calls `add_portal`. The new portal joins the room; nothing else moves.

Now try a layout change:

```text
/portal put Simon Willison's blog on the left
```

Your agent changes only what you named and tells you what moved.

## 5. Read an article

Click any story title in a portal. The article opens in reader view: the text, without ads or page clutter. For video and GitHub items, MCPortal opens the original instead.

To get back to the room, click the back arrow at the top of the reader.

## 6. Save it

At the top of the reader, click the bookmark button. MCPortal saves the link and, because it's your first, adds a **Saved** portal to your room. Every story in the room has the same bookmark button.

You can also ask: "save this for later, note: read before Friday".

## 7. Clip a quote

Saving keeps a link. Clipping keeps the words.

In the reader, select a sentence you like. A small toolbar appears; click **Clip quote**. Your first clip adds a **Clips** portal to the room.

You can clip from the conversation too. Ask your agent a question, then say "clip that answer". Later, in any chat, ask "find my clips about databases" and your agent searches them.

## 8. Ask what's new

Come back tomorrow and ask:

```text
what's worth reading today?
```

Your agent looks at what you haven't seen, picks a few, and shows them as a highlights card with a one-line reason for each.

## 9. Sign in (optional)

Ghost mode keeps everything on this computer. To have the same room on every device, and to share and follow other readers, say:

```text
sign in to MCPortal
```

Your agent gives you a link. Open it on this computer and sign in with GitHub. Your room is copied into your hosted account; nothing is removed. MCPortal still runs on your computer, and your room, clips and shares now live in the account.

The hosted service may be invite-only. If sign-in says your account isn't allowed, ask for an invite on the service's support page.

## Where to go next

- [Install](../how-to/install.md): other hosts, updating, signing out and uninstalling.
- [Tool reference](../reference/tools.md): everything your agent can do with MCPortal.
- [Reading](../explanation/reading.md): how reader view, highlights and clips work.
- [Social](../explanation/social.md): Spaces, shares and follows.
