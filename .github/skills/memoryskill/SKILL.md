---
name: memoryskill
description: "Use when: creating a PR, branching, committing, code review, checking file integrity, GitHub workflow, draft pull request, branching strategy, push changes, merge to developer"
---

# memoryskill — GitHub Routine Workflow

## Branching Strategy

- Always branch off from `developer`.
- Branch naming: `feature/<short-description>` or `fix/<short-description>`.
- Merge back into `developer` only after functionality has been tested and is stable.
- Never merge directly into `main`; `main` receives only stable, reviewed code from `developer`.

## Committing

- Write short, focused commit messages that describe *what* changed, not *why*.
- Before committing, **always compare the current changes against the previous version**:
  - Run `git diff` (or `git diff --staged` for staged changes) to review the diff.
  - Confirm no unintended changes are included.
- Commit small, logical units of work — one concern per commit.

### Commit Message Format

Use this format for every commit:

```
[<branch>] <feature-description> (<stage>)
```

- `<branch>` — the current branch name (e.g., `feature/session-memory`, `fix/login-bug`)
- `<feature-description>` — short description of what changed (imperative, lowercase)
- `<stage>` — one of:
  - `test` — work in progress, not yet stable
  - `final` — tested, stable, ready to merge

**Examples:**
```
[feature/session-memory] add S3 upload handler (test)
[feature/session-memory] add S3 upload handler (final)
[fix/login-bug] resolve token expiry issue (final)
```

## Pull Requests

- Always open PRs as **Draft** first.
- Promote a draft PR to "Ready for review" only after local testing is complete.
- PR title format: `[type] Short description` (e.g., `[feature] Add session memory support`).
- Link related issues in the PR description with `Closes #<issue-number>` when applicable.
- Target branch for PRs: `developer`.

## Code Review

- Review for logic correctness, security issues, and adherence to project conventions.
- Leave inline comments for specific lines; leave a general summary comment at the top.
- Approve only when all concerns are addressed.

## File Integrity Warning

> ⚠️ **Integrity Check** — Before committing or reviewing any file, check for the following:
> - Syntax errors or broken imports.
> - Hardcoded secrets, credentials, or API keys.
> - Missing or mismatched closing brackets/braces/tags.
> - Incomplete TODO blocks that may break functionality.
> - Unresolved merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
>
> If any of the above are detected, **warn the user immediately** and do not proceed until resolved.
