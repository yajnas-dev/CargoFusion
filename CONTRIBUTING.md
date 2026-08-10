# Contributing

This repo is built in phases per [`docs/PROTOTYPE_IMPLEMENTATION_PLAN.md`](./docs/PROTOTYPE_IMPLEMENTATION_PLAN.md). Please read that before starting work, so changes land in the right phase/module boundary.

## Branching

- `main` is protected — no direct pushes. All changes land via pull request.
- Branch names: `phase-<n>-<short-description>` for roadmap work (e.g. `phase-3-data-generator`), or `fix/<short-description>` / `chore/<short-description>` for everything else.
- Keep branches scoped to one phase or one fix — small, reviewable PRs over large ones.

## Commits

- Write commit messages that explain *why*, not just *what* (the diff already shows what).
- Don't bundle unrelated changes into one commit.

## Pull Requests

- Open a PR against `main`, reference the phase/section of the implementation plan it addresses.
- Before requesting review: tests pass, typecheck/lint pass (`npm run test`, `npm run typecheck`, `npm run lint` once scaffolded in Phase 1).
- At least one approving review required before merge (configure this as a branch protection rule on GitHub: Settings → Branches → `main` → require PR + 1 approval).
- Squash-merge preferred, to keep `main` history readable.

## Code Boundaries

The architecture (see the implementation plan's "Prototype vs. Report" table) keeps strict module boundaries — respect them when adding code:

- `adapters/tos/` — only place that touches the simulated TOS. Never bypass `TOSAdapter`.
- `adapters/sensors/` — only place that touches simulated sensor/IoT data. Never bypass `SensorProvider`.
- `optimization/` — deterministic algorithms only (A*, scoring, forecasting). No LLM calls here.
- `agents/` — Claude orchestration, disambiguation, explanation only. No numeric computation here — call into `optimization/` instead.
- `twin/` — digital twin state and validation.

## Local Setup

Each contributor works from their own clone/fork and their own `.env.local` (never commit secrets — see `.gitignore`). Environment variable requirements will be documented in `.env.example` once Phase 1 scaffolding lands.

## Conflicts on Windows

`.gitattributes` normalizes line endings (`eol=lf`) so collaborators on Windows/Mac/Linux don't generate cross-platform diff noise. Don't override this per-file without discussion.
