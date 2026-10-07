/** One escaped renderer for the room and script-free public Spaces. */
const spaceFormat = (() => {
  /** @param {unknown} value */
  const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  /** @param {string | undefined} value */
  const url = (value) => { try { const u = new URL(value || ''); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const covers = new Map();
  let coverSequence = 0;
  /** @param {import('../space-design.ts').Cover | undefined} cover */
  function coverArt(cover) {
    const ink = Math.max(0, spaceInks.sets.findIndex((s) => s.name === cover?.ink));
    const motif = Math.max(0, spaceInks.motifs.indexOf(cover?.motif ?? 'arches'));
    const key = `${ink}:${motif}:${cover?.seed ?? 0}`;
    if (!covers.has(key)) { if (covers.size >= 300) covers.clear(); covers.set(key, portalArt.draw(motif * spaceInks.sets.length + ink, `cover:${cover?.seed ?? 0}`)); }
    const sequence = ++coverSequence;
    return String(covers.get(key)).replace(/pa(\d+)/g, (_all, id) => `sc${sequence}pa${id}`);
  }
  /** @param {import('../space-design.ts').Cover | undefined} cover */
  const avatar = (cover) => `<span class="space-avatar" aria-hidden="true">${coverArt(cover)}</span>`;
  /** @param {number} n */
  const roman = (n) => { let out = ''; for (const [v, text] of [[100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) { while (n >= Number(v)) { out += text; n -= Number(v); } } return out; };
  /** @param {import('../tools/results.ts').SpaceResult['space']} space @param {{ public?: boolean }} [options] */
  function render(space, options = {}) {
    const publicView = Boolean(options.public);
    const format = spaceInks.formats.includes(space.format || '') ? space.format : 'paperback';
    const set = spaceInks.sets.find((s) => s.name === space.cover?.ink) || spaceInks.sets[0];
    const [p, a, b, c, x] = set.colors;
    const signin = `/@${encodeURIComponent(space.handle)}/signin`;
    const title = space.spaceTitle || space.displayName || `@${space.handle}`;
    const person = (/** @type {import('../social.ts').Author} */ person) => publicView
      ? `<a class="handle" href="/@${h(person.handle)}">${avatar(person.cover)}@${h(person.handle)}</a>`
      : `<button type="button" class="handle" data-space-handle="${h(person.handle)}">${avatar(person.cover)}@${h(person.handle)}</button>`;
    const posts = space.posts;
    /** @param {import('../social.ts').SharedItem} post */
    function postHtml(post) {
      const original = post.original && 'author' in post.original ? post.original : undefined;
      const tombstone = Boolean(post.reblogOf && !original);
      const clip = tombstone ? undefined : original?.clip || post.clip;
      const href = tombstone ? '' : url(original?.url || post.url);
      const postTitle = tombstone ? 'A post for MCPortal members' : (original?.title || post.title);
      let text = '';
      if (clip?.data.kind === 'quote') text = `<blockquote>${h(clip.data.text.slice(0, publicView ? 400 : 1200))}</blockquote>`;
      else if (clip) {
        if (publicView) text = `<a href="${signin}">Sign in to see this clip</a>`;
        else if (clip.data.kind === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(clip.data.mime) && /^[A-Za-z0-9+/=]+$/.test(clip.data.data)) text = `<img class="space-clip-image" alt="${h(postTitle)}" loading="lazy" src="data:${h(clip.data.mime)};base64,${clip.data.data}">`;
        else if (clip.data.kind === 'note') text = clip.data.blocks.slice(0, 4).map((b) => `<p>${h(b.text)}</p>`).join('');
        else if (clip.data.kind === 'table') text = `<div class="space-table"><table><thead><tr>${clip.data.columns.slice(0, 4).map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${clip.data.rows.slice(0, 5).map((r) => `<tr>${r.slice(0, 4).map((c) => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        else if (clip.data.kind === 'exchange') text = clip.data.turns.slice(0, 2).map((t) => `<p><b>${h(t.speaker)}:</b> ${h(t.text.slice(0, 160))}</p>`).join('');
      }
      const heading = publicView
        ? (href ? `<a href="${h(href)}" rel="ugc nofollow noopener">${h(postTitle)}</a>` : `<a href="${signin}">${h(postTitle)}</a>`)
        : `<button type="button" class="space-post-open" data-space-post="${h(post.id)}">${h(postTitle)}</button>`;
      const pin = space.mine && !publicView ? `<button type="button" class="btn space-pin" data-space-pin="${h(post.id)}" aria-pressed="${post.id === space.pinnedShareId}">${post.id === space.pinnedShareId ? 'Unpin' : 'Pin'}</button>` : '';
      return `<article class="post" data-post-id="${h(post.id)}">${post.reblogOf ? `<p class="pr">Reblogged ${original ? person(original.author) : 'a post kept within MCPortal'}</p>` : ''}<h3 class="pt">${heading}</h3>${text}${original?.note ? `<p class="pn">${h(original.note)}</p>` : ''}${post.note ? `<p class="pn">${h(post.note)}</p>` : ''}<div class="pm">${h(post.createdAt.slice(0, 10))}${post.mine && post.audience === 'followers' ? ' · followers only' : ''}${post.hiddenAt ? ' · hidden by an admin' : ''}</div>${pin}${publicView ? `<a class="space-reblog" href="${signin}">Reblog through your agent</a>` : ''}</article>`;
    }
    const sources = space.sources.map((source, i) => `<div class="source"><div class="st"><b>${h(source.title)}</b><small>${h(source.source)}</small></div>${publicView ? `<a class="btn" href="${signin}">Add through your agent</a>` : space.mine ? '' : `<button class="btn" type="button" data-space-source="${i}">Add</button>`}</div>`).join('');
    const travelers = (space.travelers || []).map(person).join('');
    const stamps = (space.stamps || []).map((stamp) => `<span class="space-stamp" data-stamp="${h(stamp.name)}">${h(stamp.label)}</span>`).join('');
    const pinned = space.pinned;
    const regular = posts.filter((post) => post.id !== pinned?.id);
    const pinnedHtml = pinned ? `<section class="space-pinned"><h2>Now transmitting</h2>${postHtml(pinned)}</section>` : '';
    const lead = format === 'magazine' ? regular[0] : undefined;
    const postsHtml = `<section id="space-posts" class="space-posts">${pinnedHtml}${lead ? `<section class="space-cover-story"><h2>Cover story</h2>${postHtml(lead)}</section>` : ''}<h2>${format === 'magazine' ? 'In this issue' : 'Posts'}</h2><div class="posts">${regular.filter((post) => post !== lead).map(postHtml).join('') || (lead ? '' : '<p class="empty">Nothing shared that you can see yet.</p>')}</div></section>`;
    const aside = `<aside class="space-side"><section id="space-sources"><h2>Sources I read</h2><div class="sources">${sources || '<p class="space-muted">No featured sources yet.</p>'}</div></section><section id="space-travelers"><h2>Fellow travelers</h2><div class="space-travelers">${travelers || '<p class="space-muted">No fellow travelers featured yet.</p>'}</div></section>${stamps ? `<section class="space-stamps" aria-label="Stamps">${stamps}</section>` : ''}</aside>`;
    const follow = publicView ? `<a class="btn primary follow" href="${signin}">Follow through your agent</a>` : space.mine ? '' : `<button type="button" class="btn primary follow" data-space-follow aria-pressed="${space.following}">${space.following ? 'Following' : 'Follow'}</button>`;
    const actions = `<div class="row">${follow}${publicView ? `<a class="btn" href="/@${h(space.handle)}/feed">RSS feed</a>` : `<span>${space.followers} follower${space.followers === 1 ? '' : 's'}</span><span>· ${posts.length} posts</span>`}</div>`;
    const frequency = space.frequency?.length ? `<p class="space-frequency">Transmitting on: ${space.frequency.map(h).join(' · ')}</p>` : '';
    const identity = `<div class="who">@${h(space.handle)}${space.displayName ? ` · ${h(space.displayName)}` : ''}</div>${frequency}${space.bio ? `<p class="bio">${h(space.bio)}</p>` : ''}${actions}`;
    const mast = format === 'magazine' ? `<div class="space-masthead"><span class="space-volume">Vol. ${roman(space.volume || 1)} · No. ${posts.length || 1}</span><h1>${h(title)}</h1><span>An MCPortal magazine</span></div><div class="space-head">${identity}</div><div class="space-cover">${coverArt(space.cover)}</div>`
      : format === 'patch' ? `<div class="space-head space-call-sign">${avatar(space.cover)}<p class="space-muted">Call sign @${h(space.handle)}</p><h1>${h(title)}</h1>${identity}</div>`
      : `<div class="space-cover">${coverArt(space.cover)}</div><div class="space-head"><h1>${h(title)}</h1>${identity}</div>`;
    const tabs = format === 'patch' ? `<nav class="space-tabs" aria-label="Space sections"><a href="#space-posts">Posts</a><a href="#space-sources">Sources</a><a href="#space-travelers">Travelers</a></nav>` : '';
    return `<div class="space-sheet ${h(format)}" data-space-format="${h(format)}" style="--space-paper:${p};--space-ink:${c};--space-a:${a};--space-b:${b};--space-x:${x}">${mast}${tabs}<div class="space-columns">${postsHtml}${aside}</div><footer class="space-imprint">An MCPortal ${h(format)} · ${h(space.link || `mcportal.lol/@${space.handle}`)}</footer></div>`;
  }
  return { render, avatar, coverArt };
})();
