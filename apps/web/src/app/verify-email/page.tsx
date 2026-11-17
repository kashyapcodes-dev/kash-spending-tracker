import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getContainer } from "@/server/container";
import { VerifyGate } from "@/components/verify-gate";

export const dynamic = "force-dynamic";

/** Full-page gate for an unverified account. Nothing else loads until the address is verified. */
export default async function Page() {
  const { auth, config } = getContainer();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!config.REQUIRE_EMAIL_VERIFICATION || session.user.emailVerified)
    redirect("/app");
  return <VerifyGate email={session.user.email} />;
}
