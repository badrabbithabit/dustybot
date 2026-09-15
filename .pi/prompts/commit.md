---
description: Write a commit message for staged changes
---
Write a git commit message for the staged changes (read `git diff --staged` first).
Dusty Bot: dependency-free ES-module game on GitHub Pages. Repo style: one line,
no body, no emoji/references. Plain summary or "Fix ..." for bug fixes;
parenthetical for the mechanism when ambiguous. Version commits are just
"v1.x.y" — for a release, confirm `npm run bump` was run (updates version.json,
js/version.js, and index.html ?v= tags) so Pages cache-busting + the reload
banner pick it up. Mixed concerns → propose splitting, don't force one message.
