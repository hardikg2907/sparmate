# Contributing to Sparmate

Thanks for helping. This guide is short on purpose.

## Run the checks

```sh
npm install
npm test            # unit tests
npm run typecheck
```

A pull request should keep both green.

## Work without a model

Set `SPARMATE_FAKE_AGENT=1` and the app replaces every model call with a scripted fake interviewer, judge and coach. Use it for interface and engine work.

```sh
SPARMATE_FAKE_AGENT=1 npm start
```

The end-to-end scripts in `scripts/e2e/` that run in fake mode need no model, for example `ws-fake-round.mjs` and `ws-fake-pause.mjs`. Use a port other than `4747` so you do not clash with a running app. `scripts/e2e/real-round.mjs` calls a real model, so run it only when you need it.

## Add a problem brief

1. Copy a brief from `content/problems/hld/` or `content/problems/lld/` and edit it. The file name must match the `id` in its frontmatter.
2. Add the matching bullet to `study-kit/TRACKER.md`, under the section the `tracker` entry names.
3. Run `npx tsx scripts/check-problems.ts`. It must print `ok` for your file.

The README section "Problems" lists what a brief holds.

## Comments

Comments explain why, not what. Add one only for a non-obvious intent, a constraint, an ordering or security concern, or the reason for a decision. If the code already says it, leave the comment out. Keep a comment to one tight line when you can. Update or delete a comment that your change makes wrong.

Do not put task names, review notes or other process traces in code or comments.

## Privacy

Do not commit personal data: no email addresses, no employer names, no home-folder paths. Run `npx tsx scripts/privacy-scan.ts` before you open a pull request.
