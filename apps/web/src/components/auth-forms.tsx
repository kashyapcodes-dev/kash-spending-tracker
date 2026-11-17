"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { InstanceConfig } from "@kash/contract";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorText, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-next";

function Shell({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
      <div className="text-sm text-muted-foreground">{footer}</div>
    </main>
  );
}

function useForm(run: (data: FormData) => Promise<string | undefined>) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const form = e.currentTarget;
    const msg = await run(new FormData(form));
    setBusy(false);
    if (msg) setError(msg);
  };
  return { error, busy, onSubmit, notice, setNotice };
}

export function SignInForm({ next }: { next?: string | undefined }) {
  const router = useRouter();
  const f = useForm(async d => {
    const { error } = await authClient.signIn.email({
      email: String(d.get("email")),
      password: String(d.get("password")),
    });
    if (error) return error.message ?? "Could not sign in";
    router.push(safeNext(next));
    router.refresh();
  });
  return (
    <Shell
      title="Sign in"
      footer={
        <>
          <Link
            href={
              next
                ? `/sign-up?next=${encodeURIComponent(next)}${next.startsWith("/invite/") ? `&invite=${encodeURIComponent(next.slice(8))}` : ""}`
                : "/sign-up"
            }
            className="underline"
          >
            Create an account
          </Link>{" "}
          ·{" "}
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </>
      }
    >
      <form onSubmit={f.onSubmit} className="flex flex-col gap-3">
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password">
          <Input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </Field>
        <ErrorText>{f.error}</ErrorText>
        <Button type="submit" disabled={f.busy}>
          Sign in
        </Button>
      </form>
    </Shell>
  );
}

function useInstanceConfig() {
  const [config, setConfig] = useState<InstanceConfig>();
  useEffect(() => {
    void api.instanceConfig().then(setConfig, () => undefined);
  }, []);
  return config;
}

export function SignUpForm({
  next,
  hasInvite = false,
}: {
  next?: string | undefined;
  hasInvite?: boolean;
}) {
  const router = useRouter();
  const instance = useInstanceConfig();
  const f = useForm(async d => {
    const { error } = await authClient.signUp.email({
      name: String(d.get("name")),
      email: String(d.get("email")),
      password: String(d.get("password")),
    });
    if (error) return error.message ?? "Could not sign up";
    router.push(safeNext(next));
    router.refresh();
  });
  // An invite can open a closed instance, so the server decides; the notice is for everyone else.
  if (instance && !instance.signupAllowed && !hasInvite) {
    return (
      <Shell
        title="Create your account"
        footer={
          <Link href="/sign-in" className="underline">
            Sign in instead
          </Link>
        }
      >
        <p role="status">Signups are closed on this instance.</p>
      </Shell>
    );
  }
  return (
    <Shell
      title="Create your account"
      footer={
        <Link
          href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
          className="underline"
        >
          I already have an account
        </Link>
      }
    >
      <form onSubmit={f.onSubmit} className="flex flex-col gap-3">
        <Field label="Name">
          <Input name="name" required autoComplete="name" />
        </Field>
        {hasInvite ? (
          <p role="note" className="text-sm text-muted-foreground">
            Use the email address the invite was sent to.
          </p>
        ) : null}
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password (8+ characters)">
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <ErrorText>{f.error}</ErrorText>
        <Button type="submit" disabled={f.busy}>
          Sign up
        </Button>
      </form>
    </Shell>
  );
}

export function ForgotPasswordForm() {
  const instance = useInstanceConfig();
  const f = useForm(async d => {
    const { error } = await authClient.requestPasswordReset({
      email: String(d.get("email")),
      redirectTo: safeNext("/reset-password"),
    });
    if (error) return error.message ?? "Could not send the link";
    f.setNotice(
      !instance || instance.emailConfigured
        ? "If that address has an account, a reset link was sent."
        : instance.resetLinksInLog
          ? "If that address has an account, a reset link was sent to the server log."
          : "This instance cannot send email, so reset links are not available. Ask the instance administrator to reset your password.",
    );
  });
  return (
    <Shell
      title="Reset your password"
      footer={
        <Link href="/sign-in" className="underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={f.onSubmit} className="flex flex-col gap-3">
        <Field label="Email">
          <Input name="email" type="email" required />
        </Field>
        {instance && !instance.emailConfigured ? (
          <p role="note" className="text-sm text-muted-foreground">
            Email is not configured on this instance.{" "}
            {instance.resetLinksInLog
              ? "The reset link is written to the server log; ask whoever runs this server."
              : "Reset links are not available; ask the instance administrator to reset your password."}
          </p>
        ) : null}
        <ErrorText>{f.error}</ErrorText>
        {f.notice ? (
          <p role="status" className="text-sm">
            {f.notice}
          </p>
        ) : null}
        <Button type="submit" disabled={f.busy}>
          Send reset link
        </Button>
      </form>
    </Shell>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const f = useForm(async d => {
    if (!token) return "This reset link is missing its token.";
    const { error } = await authClient.resetPassword({
      newPassword: String(d.get("password")),
      token,
    });
    if (error) return error.message ?? "Could not reset the password";
    router.push("/sign-in?reset=1");
  });
  if (params.get("error") || !token) {
    return (
      <Shell
        title="Reset your password"
        footer={
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        }
      >
        <ErrorText>This reset link is invalid or has expired.</ErrorText>
      </Shell>
    );
  }
  return (
    <Shell title="Choose a new password">
      <form onSubmit={f.onSubmit} className="flex flex-col gap-3">
        <Field label="New password (8+ characters)">
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <ErrorText>{f.error}</ErrorText>
        <Button type="submit" disabled={f.busy}>
          Set password
        </Button>
      </form>
    </Shell>
  );
}
