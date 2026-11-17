import { ConnectionsView } from "@/components/connections-view";
import { AuditView } from "@/components/audit-view";
import { SecurityView } from "@/components/security-view";
import { TokensView } from "@/components/tokens-view";
import { MembersView } from "@/components/members-view";
import { requireActor } from "@/server/session";

export default async function Page({
  params,
}: {
  params: Promise<{ budgetId: string }>;
}) {
  const actor = await requireActor();
  const { budgetId } = await params;
  return (
    <>
      <MembersView budgetId={budgetId} userId={actor.userId} />
      <ConnectionsView budgetId={budgetId} />
      <SecurityView />
      <TokensView />
      <AuditView budgetId={budgetId} />
    </>
  );
}
