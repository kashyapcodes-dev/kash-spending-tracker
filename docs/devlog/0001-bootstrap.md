# Devlog 0001: Bootstrapping the repo with specs

- **Date:** 2026-11-11
- **Milestone:** M0 (documentation part)
- **Agent and model:** Claude Code, Claude Fable 5.2
- **Episode:** not yet published

## Goal of the session

Turn the roadmap agreed in an earlier planning session into a new repository containing the agent instructions, the decision records and a spec for every milestone, with no application code.

## Prompts

The session started in the original (private) app's repository, in plan mode, with a roadmap document from the earlier planning session as input.

1. > Use this plan and execute the inital steps of setting up a new repo with relevant specs generated - (path to the roadmap document)

2. The agent asked four questions before planning. The answers:
   - Where should the repo be created? → a sibling folder named `kash-spending-tracker`.
   - How far should this pass go beyond specs? → docs and specs only; no tooling scaffold.
   - Which specs now? → all of M0 to M8.
   - How should the GitHub remote be handled? → the owner supplied the remote URL and said they would need to authenticate.

3. The owner approved the resulting plan without changes.

## What happened

1. Read the roadmap and the saved project notes.
2. Read the original app's API routes, auth actions, zod schemas and dashboard component, so the specs describe what the old code really does rather than what the roadmap summarised.
3. Checked the remote before creating anything locally. It already existed with one commit, so the agent cloned it instead of running `git init`.
4. Replaced the licence file, wrote `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, the ADR and devlog templates.
5. Wrote ADR-0001 (the locked decisions) and ADR-0002 to ADR-0005 (the four questions the roadmap left for the spec agent).
6. Wrote the specs M0 to M8 and the specs index with the decision-to-milestone matrix.
7. Ran scripted checks on the documents (see Verification).

## Decisions

Made by the owner before this session and recorded in [ADR-0001](../adr/0001-foundational-decisions.md).

Made by the agent in this session, as the roadmap instructed ("resolve via ADR, do not ask the owner"). These have not been reviewed by a human yet:

- [ADR-0002](../adr/0002-transactions-table.md): one `transactions` table with a type; money as integer cents; calendar dates; UUID keys.
- [ADR-0003](../adr/0003-widget-query-dsl.md): a closed JSON query shape, with the budget injected by the server.
- [ADR-0004](../adr/0004-background-jobs.md): pg-boss, in-process by default.
- [ADR-0005](../adr/0005-encryption-at-rest.md): AES-256-GCM with a key from the environment.

Smaller choices the agent made inside the specs that the roadmap did not dictate, worth a second look:

- Non-members get `404` and members with too low a role get `403`.
- The current budget is in the URL (`/b/{budgetId}/...`).
- Connecting a bank is owner-only; reviewing synced transactions is editor.
- Dashboards are per user, not shared between members.
- Proposals can never be approved with an access token, only from a browser session.
- Limits in hosted mode return `402`.
- A `tools/` folder and a `packages/config` package were added to the target layout.

## Agent mistakes and corrections

- **The plan assumed an empty remote.** The approved plan said `git init` and replace nothing. The remote already had an initial commit containing an **Apache-2.0** licence file. The agent noticed only because it listed the remote's refs before creating the folder, then cloned instead. The licence file was replaced with AGPL-3.0, following the locked decision. This overwrote a choice made on GitHub when the repository was created, so it is flagged for the owner to confirm.
- **The agent nearly "corrected" the roadmap wrongly.** The roadmap said the old middleware guarded only the dashboard. The agent read `middleware.ts`, saw a matcher covering every path, and drafted a note in this devlog saying the roadmap was wrong. It had not opened the helper the middleware calls. On checking, the helper redirects only for paths starting with `/dashboard`, so the roadmap was right and the draft note was removed. The M1 spec was unaffected because it states the required behaviour (every app page needs a session).
- **A bug found while reading, not porting.** The old dashboard divides spending by a non-inclusive day count, which is zero for a one-day range. The compare report uses an inclusive count. The spec standardises on inclusive and adds a test.
- **Wording slips caught on re-read** and fixed before commit: an ambiguous money-parsing test case ("rejected or rounded"), a garbled sentence in the widget ADR, and a nonsensical start-up condition in M8.
- **Not verified:** library behaviour. The specs describe Better Auth (custom password verification for bcrypt import), pg-boss, Plaid and SimpleFIN from the agent's general knowledge, without checking current documentation. Each place says to check the docs at implementation time. Treat those passages as intent, not as API reference.

## Verification

- Every spec contains the required section headings (scripted).
- Every endpoint table has an authz column and no empty authz cell (scripted).
- Every relative link in the Markdown files resolves (scripted).
- Every row of the ADR-0001 decision table appears in the matrix in `docs/specs/README.md` (scripted).
- No personal data, secrets or Supabase project identifiers from the original repository appear here (searched).
- Not verified: that the specs are right. No code has been written against them. The first real test is M0.

## Next

- Owner: read ADR-0002 to ADR-0005 and the list of smaller choices above; confirm the licence replacement.
- Next session: implement M0's tooling scope from [the M0 spec](../specs/M0/SPEC.md).
