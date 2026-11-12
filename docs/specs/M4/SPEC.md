# M4: Sharing and PWA

- **Status:** Not started. Complete, but expect revision once M1 to M3 have landed.
- **Depends on:** M1, M2
- **ADRs:** [0001](../../adr/0001-foundational-decisions.md)

## Goal

Two things that make Kash a household tool. First, an owner can invite a partner or family member to a budget as editor or viewer and manage who has access. Second, the app installs on a phone, is comfortable to use there, shows recent data without a connection, and makes adding an expense a few taps.

## Scope

**Sharing**

1. Invite by email with a chosen role. The invite is a single-use link with an expiry.
2. Accepting an invite, for an existing user or as part of signing up.
3. Member management: list members, change a role, remove a member, leave a budget, transfer ownership.
4. Works without SMTP: the owner can copy the invite link and send it themselves.

**PWA**

5. Web app manifest, icons, installability on Android and iOS.
6. Service worker: precached app shell, cached read data, offline indicator.
7. Mobile-responsive layouts for every existing screen.
8. Quick-add expense flow.

## Non-scope

- Native apps (a future milestone using the API client).
- Offline writes and sync conflict resolution. Offline is read-only; write controls are disabled with an explanation.
- Push notifications.
- Per-category or per-transaction permissions. Roles apply to a whole budget.
- Public or anonymous share links.

## Data model changes

```
budget_invites
  id           uuid pk
  budget_id    uuid not null references budgets(id) on delete cascade
  email        text not null               -- lower-cased
  role         enum('editor','viewer') not null   -- ownership is transferred, never invited
  token_hash   text not null unique        -- SHA-256 of the token; the token itself is never stored
  invited_by   text not null references user(id) on delete cascade
  expires_at   timestamptz not null        -- 7 days after creation
  accepted_at  timestamptz null
  accepted_by  text null references user(id)
  revoked_at   timestamptz null
  created_at   timestamptz not null default now()
  unique (budget_id, email) where accepted_at is null and revoked_at is null
```

Rules:

- The token is 32 random bytes, shown once in the link `APP_URL/invite/{token}`.
- An invite is usable when it is not accepted, not revoked and not expired.
- Acceptance requires a signed-in user. If `email` on the invite and the user's email differ, acceptance is refused; the invite is for that address. (Self-hosters sharing a link by hand should invite the address the person will sign up with.)
- Accepting when already a member is a no-op that marks the invite accepted and does not change the existing role.
- An invite lets its recipient sign up even when `SIGNUP_MODE=closed`.
- The last owner cannot leave, be removed or be demoted. Ownership transfer makes the target an owner and, optionally, demotes the caller to editor, in one transaction.
- Removing a member deletes only their membership. Transactions they created remain; `created_by` is kept.

## API endpoints

| Method | Path | Purpose | Authz |
|---|---|---|---|
| GET | `/api/v1/budgets/{budgetId}/members` | List members: user id, name, email, role, joined date | Member |
| PATCH | `/api/v1/budgets/{budgetId}/members/{userId}` | Change a member's role `{ role }` | Owner. Cannot demote the last owner (`409`). |
| DELETE | `/api/v1/budgets/{budgetId}/members/{userId}` | Remove a member, or leave when `userId` is the caller | Owner to remove someone else; any member to remove themselves. The last owner cannot leave (`409`). |
| POST | `/api/v1/budgets/{budgetId}/members/{userId}/transfer-ownership` | Make the member an owner; `{ demoteSelf: boolean }` | Owner. Target must already be a member. |
| GET | `/api/v1/budgets/{budgetId}/invites` | List pending invites (no tokens) | Owner |
| POST | `/api/v1/budgets/{budgetId}/invites` | Create `{ email, role }`. Returns the invite and, once only, `inviteUrl`. Sends the email when SMTP is configured. `409` if that address is already a member or has a pending invite. | Owner |
| DELETE | `/api/v1/budgets/{budgetId}/invites/{inviteId}` | Revoke | Owner; the invite must belong to the budget |
| POST | `/api/v1/budgets/{budgetId}/invites/{inviteId}/resend` | Issue a new token and expiry and send again; returns the new `inviteUrl` | Owner; the invite must belong to the budget |
| GET | `/api/v1/invites/{token}` | Preview an invite before accepting: budget name, inviter name, role, the invited email masked (`k***@example.com`), and whether it is still usable | Public, by possession of the token. Returns nothing else about the budget. Rate limited. Unknown, expired, revoked and accepted tokens all return the same `404`. |
| POST | `/api/v1/invites/{token}/accept` | Accept as the signed-in user | Authenticated; the caller's email must equal the invite's email (`403` otherwise); the token must be usable (`404` otherwise) |

All invite and member endpoints are rate limited per user and per IP. Invite creation is capped at 20 pending invites per budget.

## UI

**Sharing**

- Budget settings → Members: member list with role badges; role selector and remove button for owners; "Leave budget" for everyone else; "Transfer ownership" with confirmation.
- Invite form: email and role. After creating, show the link with a copy button and a note on whether an email was sent.
- Pending invites list with resend and revoke.
- `/invite/{token}` page: shows who invited you to what and as which role. Signed out: offers sign in or sign up with the email prefilled and locked, then returns to the invite. Signed in with a different email: explains the mismatch.
- The budget switcher shows shared budgets with the role.
- Viewers see no write controls anywhere. Editors see no member management.

**PWA and mobile**

- Manifest: name "Kash", short name, theme and background colours, `display: standalone`, icons at the required sizes including a maskable icon, and an iOS touch icon and status-bar meta tags.
- Service worker:
  - Precache the app shell and static assets with revisioning; a new version activates on the next launch and the app shows "Update available, reload".
  - `GET /api/v1/...` responses for budgets, categories, transaction lists and reports are cached stale-while-revalidate, keyed per user. The cache is cleared on sign-out.
  - No caching of `/api/auth/*`, of non-GET requests, or of responses with errors.
  - Offline: an indicator in the header, cached data shown with "as of" time, write controls disabled.
  - Choose between a maintained service-worker library and a hand-written worker at implementation time, and record the choice in an ADR.
- Layouts: every screen is usable at 360 px wide with no horizontal page scroll. Tables become stacked cards or scroll inside their own container. Navigation becomes a bottom bar on small screens. Touch targets are at least 44 px.
- Quick add: a floating action button on small screens (and a keyboard shortcut on desktop) opens a sheet with amount (numeric keypad), name, category (most used first) and date (today by default). Save and "Save and add another". The form remembers the last category used. Target: a known expense saved in four interactions.
- The manifest declares a shortcut to quick add, so a long-press on the home-screen icon offers "Add expense".

## Acceptance tests

### Authz matrix

The M1 matrix (`M1-AZ-1` to `M1-AZ-7`) extends to every endpoint above with a `{budgetId}`. In addition:

- `M4-AZ-1` An editor or viewer cannot list, create, revoke or resend invites (`403`).
- `M4-AZ-2` An owner of budget A cannot revoke or resend an invite of budget B through budget A's path (`404`).
- `M4-AZ-3` An editor cannot change roles or remove another member (`403`); can remove themselves.
- `M4-AZ-4` Accepting with a signed-in user whose email differs from the invite's → `403`; no membership is created.
- `M4-AZ-5` The invite preview for an unknown, expired, revoked or already accepted token returns an identical `404` body.
- `M4-AZ-6` With real members now present, re-run the M1 role checks using actual invited users: a viewer can read every M1 read endpoint and is refused on every write; an editor can write transactions and categories and is refused on budget rename and delete.

### API behaviour (Vitest)

- `M4-API-1` Create invite → preview → accept → the user appears in the member list with the invited role; the invite is marked accepted and cannot be used again.
- `M4-API-2` Expired invite cannot be accepted; resend makes it usable with a new token and the old token stops working.
- `M4-API-3` Revoked invite cannot be accepted.
- `M4-API-4` Duplicate pending invite or inviting an existing member → `409`.
- `M4-API-5` The database stores only the token hash (assert the raw token appears nowhere in the row).
- `M4-API-6` Last owner cannot be demoted, removed or leave; after transfer with `demoteSelf`, the former owner is an editor and the budget has exactly one owner.
- `M4-API-7` Removing a member keeps their transactions.
- `M4-API-8` With `SIGNUP_MODE=closed`, signing up through a valid invite succeeds and signing up without one is refused.
- `M4-API-9` With SMTP configured (test mailer), an invite email is sent containing the link; without SMTP, none is sent and the response still carries `inviteUrl`.
- `M4-API-10` Rate limit: the 21st pending invite for a budget is refused.

### End to end (Playwright)

- `M4-E-1` Owner invites an address as editor → second browser context signs up through the link → sees the shared budget → adds an expense → the owner sees it.
- `M4-E-2` Owner changes that member to viewer → the member's write controls disappear and a direct API write is refused.
- `M4-E-3` Owner removes the member → the budget disappears from the member's switcher and its URL shows not found.
- `M4-E-4` Mobile viewport (360 × 740): each main screen has no horizontal scroll (assert `scrollWidth <= clientWidth`), and the bottom navigation works.
- `M4-E-5` Quick add on a mobile viewport: open, enter amount and name, pick a category, save → the expense is on the dashboard. Count interactions and assert four or fewer for a repeat category.
- `M4-E-6` Offline: load the dashboard, go offline, reload → the dashboard renders from cache with the offline indicator and write controls disabled; go online → it refreshes.
- `M4-E-7` Sign out, then go offline and open the app → no budget data is shown (the cache was cleared).
- `M4-E-8` Installability: the manifest is served and valid, the service worker registers, and an automated PWA audit of the installability criteria passes in CI.

## Demo end state

The owner invites their partner from the laptop. The partner opens the link on a phone, signs up, installs Kash to the home screen, and adds an expense from the shop in a few taps. It shows up on the owner's dashboard. On a train with no signal, last month's spending is still readable.

## Devlog prompt

Film and write: a real second person using the invite on their own phone, unprompted, and where they got stuck. Show the viewer role being enforced by the API, not just by hidden buttons. Show the offline demo in airplane mode. Cover the service-worker decision and the bugs it caused (stale shells, cached data after sign-out), and how the agent handled a problem that only shows up on a real device.

## Locked decisions covered

Tenancy (sharing by invite, owner / editor / viewer), Mobile (PWA first, offline-tolerant read views).
