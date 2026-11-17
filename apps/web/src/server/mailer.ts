import { appendFileSync } from "node:fs";
import nodemailer from "nodemailer";
import type { Config, InviteEmail } from "@kash/core";

/**
 * Password-reset delivery. With SMTP configured the link is emailed; without it the link is
 * dropped unless KASH_LOG_RESET_LINKS=true (the forgot-password page says so). `KASH_MAIL_FILE` additionally
 * records it as a JSON line for end-to-end tests.
 */
export async function deliverResetLink(
  config: Config,
  email: string,
  url: string,
): Promise<void> {
  if (config.KASH_MAIL_FILE)
    appendFileSync(
      config.KASH_MAIL_FILE,
      `${JSON.stringify({ to: email, kind: "reset", url })}\n`,
    );
  if (!config.SMTP_HOST) {
    // Opt-in, self-host only: a reset link in a log is a credential in a log.
    if (config.KASH_LOG_RESET_LINKS)
      console.info(
        `[kash] No SMTP configured. Password reset link for ${email}: ${url}`,
      );
    return;
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: "Reset your Kash password",
    text: `Open this link to choose a new password:\n\n${url}\n\nIf you did not ask for this, ignore this email.`,
  });
}

/** Invite delivery: SMTP when configured, otherwise the link goes to the log (the owner copies it). */
export async function deliverInvite(
  config: Config,
  mail: InviteEmail,
): Promise<void> {
  if (config.KASH_MAIL_FILE)
    appendFileSync(
      config.KASH_MAIL_FILE,
      `${JSON.stringify({ to: mail.to, kind: "invite", url: mail.url })}\n`,
    );
  // No SMTP: nothing is sent and the link is not logged. The owner copies it from the UI.
  if (!config.SMTP_HOST) return;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: mail.to,
    subject: `${mail.inviterName} invited you to "${mail.budgetName}" on Kash`,
    text: `${mail.inviterName} invited you to the budget "${mail.budgetName}" on Kash as ${mail.role}.\n\nOpen this link to accept (valid for 7 days, single use):\n\n${mail.url}\n\nSign up or sign in with this email address (${mail.to}). If you did not expect this, ignore this email.`,
  });
}

/** Verification email (REQUIRE_EMAIL_VERIFICATION): SMTP, or the test mail file. Never logged. */
export async function deliverVerification(
  config: Config,
  email: string,
  url: string,
): Promise<void> {
  if (config.KASH_MAIL_FILE)
    appendFileSync(
      config.KASH_MAIL_FILE,
      `${JSON.stringify({ to: email, kind: "verify", url })}\n`,
    );
  if (!config.SMTP_HOST) return;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT ?? 587,
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: "Verify your Kash email address",
    text: `Open this link to verify your address:\n\n${url}\n\nIt expires in one hour. If you did not sign up, ignore this email.`,
  });
}
