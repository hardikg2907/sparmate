# Contributing to Sparmate

Thanks for helping. This guide is short on purpose.

## Set up

```sh
npm install
```

`npm install` also sets up the git hooks (see "Git hooks" below). You need Node.js 22.12 or newer, and `clang++` for the C++ runner tests. On Linux the runner tests also need `bubblewrap`.

## Scripts

| Script                 | What it does                                       |
| ---------------------- | -------------------------------------------------- |
| `npm test`             | Runs the unit tests.                               |
| `npm run typecheck`    | Checks types with `tsc`.                           |
| `npm run lint`         | Runs ESLint. Warnings are allowed, errors are not. |
| `npm run lint:fix`     | Runs ESLint and fixes what it can.                 |
| `npm run format`       | Formats the code with Prettier.                    |
| `npm run format:check` | Checks the formatting without changing files.      |
| `npm run build`        | Builds the web app.                                |
| `npm run dev`          | Starts the app with hot reload.                    |

A pull request must pass typecheck, lint, format check and tests. CI runs the same four scripts.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): subject
```

- The type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `build`, `ci` or `chore`.
- The scope is optional. Use the area you changed, for example `runner`, `web` or `engine`.
- The subject is lower case, in the imperative mood, and has no final full stop.
- The whole first line is at most 72 characters.
- Add a body when the reason for the change is not obvious. Explain why, not what.

Examples:

```text
feat(web): show the target level on the debrief
fix(runner): stop a program that keeps forking
docs: explain the study folder layout
test(engine): cover a resume after a model error
```

## Git hooks

[Husky](https://typicode.github.io/husky/) installs two hooks when you run `npm install`.

- `pre-commit` runs `lint-staged`. It fixes your staged files with ESLint and Prettier, so a commit never adds badly formatted code.
- `commit-msg` runs `commitlint` and rejects a message that does not follow the rules above.

The formatting commit is listed in `.git-blame-ignore-revs`. To hide it in `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Continuous integration

GitHub Actions runs on every push to `main` and on every pull request.

- The `check` job runs on Ubuntu and macOS. It runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm test`. On Ubuntu it first installs `clang` and `bubblewrap`, so the sandboxed C++ runner tests run there too.
- The `commitlint` job runs on pull requests only. It checks every commit message in the pull request.

Run the same scripts locally before you push.

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
