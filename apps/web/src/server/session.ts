import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isAppError, type Actor } from "@kash/core";
import { getContainer } from "./container";

/** The signed-in actor for a server component, or a redirect to sign in. */
export async function requireActor(): Promise<Actor> {
  const session = await getContainer().auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect("/sign-in");
  // REQUIRE_EMAIL_VERIFICATION: an unverified account sees only the gate page.
  if (getContainer().requireVerification && !session.user.emailVerified)
    redirect("/verify-email");
  return { userId: session.user.id };
}

/** Load a budget the actor belongs to. Non-members and unknown ids both get the not-found page. */
export async function requireBudget(actor: Actor, budgetId: string) {
  try {
    return await getContainer().services.budgets.get(actor, budgetId);
  } catch (e) {
    if (isAppError(e) && e.code === "not_found") notFound();
    throw e;
  }
}
