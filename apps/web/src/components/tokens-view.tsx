"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, ErrorText, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useLoad } from "@/components/use-budget";

/** Personal access tokens for AI clients (M7). The token is shown once. */
export function TokensView() {
  const tokens = useLoad(() => api.listTokens(), []);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_propose">("read");
  const [created, setCreated] = useState<string>();
  const [expiry, setExpiry] = useState<"30" | "90" | "365" | "never">("90");
  const [confirmNever, setConfirmNever] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setError(undefined);
    // A token that never expires needs a second, deliberate click.
    if (expiry === "never" && !confirmNever) {
      setConfirmNever(true);
      return;
    }
    setConfirmNever(false);
    try {
      const expiresAt =
        expiry === "never"
          ? null
          : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
      const t = await api.createToken({
        body: { name: name.trim(), scope, expiresAt },
      });
      setCreated(t.token);
      setName("");
      tokens.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the token");
    }
  }
  async function revoke(id: string) {
    await api.deleteToken({ params: { tokenId: id } });
    tokens.reload();
  }

  return (
    <section aria-label="Access tokens" className="mt-8 flex flex-col gap-3">
      <h2 className="text-xl font-bold">Access tokens</h2>
      <p className="text-sm text-muted-foreground">
        Let an AI client (through the Kash MCP server) read your budgets. A
        token can never approve a proposal; you do that here. Run the server
        with <code>KASH_URL</code> and <code>KASH_TOKEN</code> set (see the
        self-hosting guide).
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={e => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Token name">
          <Input
            aria-label="Token name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </Field>
        <Field label="Access">
          <Select
            aria-label="Token access"
            value={scope}
            onChange={e => setScope(e.target.value as "read" | "read_propose")}
          >
            <option value="read">Read only</option>
            <option value="read_propose">Read and propose changes</option>
          </Select>
        </Field>
        <Field label="Expires">
          <Select
            aria-label="Token expiry"
            value={expiry}
            onChange={e => {
              setExpiry(e.target.value as typeof expiry);
              setConfirmNever(false);
            }}
          >
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In one year</option>
            <option value="never">Never</option>
          </Select>
        </Field>
        <Button type="submit" disabled={!name.trim()}>
          {confirmNever
            ? "Yes, create a token that never expires"
            : "Create token"}
        </Button>
      </form>
      {confirmNever ? (
        <p role="alert" className="text-sm text-destructive">
          A token that never expires stays valid until you revoke it. If it
          leaks, anyone holding it can read your budgets.
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {created ? (
        <Card data-testid="new-token" className="flex flex-col gap-2">
          <p className="text-sm">
            Copy this token now. It will not be shown again.
          </p>
          <code className="break-all rounded bg-muted p-2 text-sm">
            {created}
          </code>
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCreated(undefined)}
            >
              Done
            </Button>
          </div>
        </Card>
      ) : null}
      <ul className="flex flex-col gap-2">
        {tokens.data?.items.map(t => (
          <li
            key={t.id}
            data-testid="token-row"
            className="flex items-center gap-3 text-sm"
          >
            <span className="font-medium">{t.name}</span>
            <code>{t.prefix}…</code>
            <span className="text-muted-foreground">{t.scope}</span>
            {t.expiresAt ? (
              <span className="text-muted-foreground">
                expires {new Date(t.expiresAt).toLocaleDateString()}
              </span>
            ) : (
              <span role="note" className="text-destructive">
                never expires
              </span>
            )}
            <span className="text-muted-foreground">
              {t.lastUsedAt
                ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                : "never used"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => void revoke(t.id)}
            >
              Revoke {t.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
