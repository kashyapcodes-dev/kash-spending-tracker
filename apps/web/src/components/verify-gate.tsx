"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { clearOfflineData } from "@/lib/pwa";

/** Shown instead of the app while the address is unverified (REQUIRE_EMAIL_VERIFICATION). */
export function VerifyGate({ email }: { email: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function resend() {
    setBusy(true);
    try {
      await api.resendVerification();
      setNotice(
        "If the address is still unverified, a new link is on its way.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not send the link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">Verify your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a link to <strong>{email}</strong>. Open it to continue. The
        link works for one hour.
      </p>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => void resend()} disabled={busy}>
          Resend the link
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await authClient.signOut();
            await clearOfflineData();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
