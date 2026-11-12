# Kash: Spending Tracker

A self-hostable, open-source budgeting app: track expenses and income, share a budget with your household, import from your bank, and ask an AI agent about your money.

Kash is being built in public for [kashyap.codes](https://kashyap.codes). The premise of the series is that AI agents do all of the development work against written specs, and every prompt, decision and agent mistake is recorded in this repo.

## Status

**Pre-M0.** This repo currently contains the specs, the architecture decision records and the devlog. There is no application code yet. The first implementation milestone is [M0](docs/specs/M0/SPEC.md).

## What it will be

- **Self-hosted first.** `docker compose up` gives you the app and a Postgres database on your own hardware. No third-party service is required.
- **One backend for everything.** A versioned REST API (`/api/v1`) with an OpenAPI description serves the web app, the installable PWA, the AI agent and an MCP server.
- **Shared budgets.** A user can own several budgets and invite a partner or family member as editor or viewer.
- **Bank sync, read-only.** Plaid and SimpleFIN adapters with your own keys, plus CSV import with a column-mapping wizard. Imported transactions wait in a review queue.
- **AI agent.** Pluggable provider (Claude by default, also OpenAI and Ollama). It can answer questions, propose changes that you approve, and build dashboard widgets from a declarative spec.
- **Custom dashboards.** A widget registry and per-user layouts.

## Roadmap

Each milestone has one spec and one episode.

| Milestone | Outcome | Spec |
|---|---|---|
| M0 | Monorepo, tooling, CI, agent instructions | [SPEC](docs/specs/M0/SPEC.md) |
| M1 | Core app on Postgres, Drizzle and Better Auth | [SPEC](docs/specs/M1/SPEC.md) |
| M2 | Self-host packaging with Docker | [SPEC](docs/specs/M2/SPEC.md) |
| M3 | Migration from the original Supabase app and cutover | [SPEC](docs/specs/M3/SPEC.md) |
| M4 | Budget sharing and PWA | [SPEC](docs/specs/M4/SPEC.md) |
| M5 | CSV import wizard and bank sync | [SPEC](docs/specs/M5/SPEC.md) |
| M6 | Widgets and dashboards | [SPEC](docs/specs/M6/SPEC.md) |
| M7 | AI agent and MCP server | [SPEC](docs/specs/M7/SPEC.md) |
| M8 | Hosted mode (before billing) | [SPEC](docs/specs/M8/SPEC.md) |

## Documentation

- [Specs](docs/specs/README.md): format, milestone list and how decisions map to milestones
- [Architecture decision records](docs/adr/)
- [Devlog](docs/devlog/)
- [Agent instructions](CLAUDE.md)

## Licence

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version of Kash as a network service, you must make your modified source available to its users.
