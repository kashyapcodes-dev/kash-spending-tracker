"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { clearOfflineData } from "@/lib/pwa";

/** Settings -> Security: sign out everywhere. Tokens and their expiry are listed below it. */
export function SecurityView() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function everywhere() {
    setBusy(true);
    setError(undefined);
    try {
      await api.signOutEverywhere();
      await authClient.signOut().catch(() => undefined);
      await clearOfflineData();
      router.push("/sign-in");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not sign out everywhere",
      );
      setBusy(false);
    }
  }

  return (
    <section aria-label="Security" className="mt-8 flex flex-col gap-3">
      <h2 className="text-xl font-bold">Security</h2>
      <p className="text-sm text-muted-foreground">
        Ends every session on every device, including this one, and revokes all
        of your access tokens.
      </p>
      <div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void everywhere()}
        >
          Sign out everywhere
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
