# Notes for coding agents

Sparmate is a TypeScript app (Fastify server, React and Vite web app). Read `CONTRIBUTING.md` for the details. This file lists the rules that are broken most often.

## Setup

- The package manager is npm. Use the Node version in `.nvmrc` (Node 22).
- Install with `npm ci` in your own worktree.

## Parallel work

- One task is one git worktree and one branch. Never share a checkout. Never switch branches in a checkout that someone else uses.
- Make a worktree with `git worktree add ../sparmate-<topic> -b <type>/<topic> main`, then run `npm ci`.
- The main checkout stays on `main` and only receives merges. Never commit to `main`.
- Every change lands through a pull request, squash-merged. After a merge, rebase your branch on `main`.
- A worktree has no `.env`. For a manual run, set `STUDY_ROOT` and `DATA_DIR` to scratch folders.

## Before you open a pull request

- Run `npm run verify`. It runs typecheck, lint, format check, tests, `vite build`, the fake-agent end-to-end round and the layout and scroll check (needs Google Chrome). Paste the result in the pull request body while CI is not running.
- Run `npx tsx scripts/privacy-scan.ts` before you push.

## Commits

- Use Conventional Commits: `type(scope): subject`. The first line is at most 72 characters. Husky and commitlint reject anything else.
- Do not skip the git hooks.

## Ports and models

- Never use port 4747 for tests. Someone may be using the app. The end-to-end scripts pick a free port from 4750 to 4799 when `PORT` is unset.
- Never run a script that calls a real model unless the person asks. These are `scripts/e2e/real-round.mjs`, `scripts/e2e/ws-real-smoke.mjs`, `scripts/real-custom-prep.mjs` and `scripts/tts/real_check.mjs`.
- For model-free work, set `SPARMATE_FAKE_AGENT=1`.

## Code and privacy

- This repo is public. Put nothing personal in it: no names, email addresses, employer names, home-folder paths or private repo names.
- A comment explains why, not what. Do not mention tasks, plans or agents in code or comments.
