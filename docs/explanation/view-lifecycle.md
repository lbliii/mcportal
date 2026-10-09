# Reader navigation ownership

`room/navigation.js` owns the lifetime of room → Recall → reader/docs navigation. Views still own their DOM and local data, and `renderReader` / `setReaderControls` retain the existing content viewport and control shell.

A view starts an operation with `navigation.begin(owner)`. This flushes the outgoing reading tracker, retires the passage toolbar and selection, and returns a generation token. An asynchronous response may draw only while `navigation.owns(token)` remains true. Back, a different destination and host teardown retire the token, including outstanding errors and unavailable-handoff retries. Teardown also rejects later host notifications for that frame.

The boundary captures room scroll containers and focus once, and captures the current experience's scroll/focus when opening its reader. Back restores the same experience DOM, preserving Recall's query, filters and selected result. Returning to the room restores its original containers and focus. The navigation contract exposes the current experience read-only; other fragments no longer assign its return state or increment a reader's generation variable.

Recall additionally retains per-query generations for concurrent searches. Docs keeps its own page and search state, checking both that state and navigation ownership before drawing. Hash jumps within the same page preserve the reading tracker. The first slice covers Recall, articles, docs and handoff recovery. Social and other experience rendering remain incremental callers of the existing shell; this is not a replacement router.

Browser evidence covers the existing Back/Escape and focus paths, passage selection, reading resume/writes, errors, and delayed responses after Back or `ui/resource-teardown`. A delayed preference load also cannot overwrite a later user scroll or saved-position jump.
