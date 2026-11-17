import type { Database } from "@kash/db";
import { budgetService } from "./budgets";
import { categoryService } from "./categories";
import { importService } from "./imports";
import { stagingService } from "./staging";
import { connectionService, noBank, type BankDeps } from "./connections";
import { inviteService, defaultInviteDeps, type InviteDeps } from "./invites";
import { memberService } from "./members";
import { widgetService } from "./widgets";
import { dashboardService } from "./dashboards";
import { targetService } from "./targets";
import { reportService } from "./reports";
import { transactionService } from "./transactions";
import { proposalService } from "../agent/proposals";
import { tokenService } from "../agent/tokens";
import { accountService } from "./account";
import { auditService } from "../agent/audit";

export { insertBudgetWithOwner } from "./budgets";
export { noBank, secretAad, type BankDeps } from "./connections";
export {
  stageRows,
  type StageInput,
  type StageItem,
  type StageResult,
} from "./staging";
export { widgetTypeInfo } from "./widgets";
export {
  hasUsableInvite,
  hashToken,
  maskEmail,
  INVITE_TTL_MS,
  MAX_PENDING_INVITES,
  type InviteDeps,
  type InviteEmail,
} from "./invites";

/** All domain services, bound to one database. Every function takes `(actor, budgetId, ...)`. */
export function createServices(
  db: Database,
  deps: Partial<InviteDeps> = {},
  bank: BankDeps = noBank,
) {
  return {
    budgets: budgetService(db),
    categories: categoryService(db),
    transactions: transactionService(db),
    reports: reportService(db),
    imports: importService(db),
    staging: stagingService(db),
    connections: connectionService(db, bank),
    members: memberService(db),
    widgets: widgetService(db),
    dashboards: dashboardService(db),
    targets: targetService(db),
    proposals: proposalService(db),
    tokens: tokenService(db),
    account: accountService(db),
    audit: auditService(db),
    invites: inviteService(db, { ...defaultInviteDeps, ...deps }),
  };
}
export type Services = ReturnType<typeof createServices>;
