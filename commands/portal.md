---
description: Open your MCPortal room, or change it ("/portal put GitHub on the left")
argument-hint: "[optional request, e.g. 'add Simon Willison's blog on the right']"
---

Use the MCPortal tools and the `portal` skill.

If there is no request below, call `open_room` and give a short summary of what stands out across the portals.

If there is a request, handle it following the skill's routing and layout rules (change only what the user asked for), then call `open_room` to show the result.

Request: $ARGUMENTS
