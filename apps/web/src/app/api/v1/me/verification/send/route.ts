import { AppError } from "@kash/core";
import { getContainer } from "@/server/container";
import { handle } from "@/server/handler";

/** At most 3 a hour per user. Always 204 (unless limited), so the endpoint reveals nothing. */
export const POST = handle(
  "resendVerification",
  async ({ actor, services, request }) => {
    const { config, auth, hourlyLimiter } = getContainer();
    const hit = hourlyLimiter.hit(`verify:${actor.userId}`, 3);
    if (!hit.ok) throw new AppError("rate_limited", "Too many requests");
    if (!config.REQUIRE_EMAIL_VERIFICATION) return;
    const { email, emailVerified } = await services.account.verification(actor);
    if (emailVerified) return;
    await auth.api
      .sendVerificationEmail({ body: { email }, headers: request.headers })
      .catch(() => undefined);
  },
);
