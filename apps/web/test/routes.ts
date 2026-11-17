import type { EndpointId } from "@kash/contract";
import * as health from "@/app/api/v1/health/route";
import * as config from "@/app/api/v1/config/route";
import * as me from "@/app/api/v1/me/route";
import * as budgets from "@/app/api/v1/budgets/route";
import * as budget from "@/app/api/v1/budgets/[budgetId]/route";
import * as categories from "@/app/api/v1/budgets/[budgetId]/categories/route";
import * as category from "@/app/api/v1/budgets/[budgetId]/categories/[categoryId]/route";
import * as transactions from "@/app/api/v1/budgets/[budgetId]/transactions/route";
import * as transaction from "@/app/api/v1/budgets/[budgetId]/transactions/[transactionId]/route";
import * as summary from "@/app/api/v1/budgets/[budgetId]/reports/summary/route";
import * as compare from "@/app/api/v1/budgets/[budgetId]/reports/compare/route";
import * as members from "@/app/api/v1/budgets/[budgetId]/members/route";
import * as member from "@/app/api/v1/budgets/[budgetId]/members/[userId]/route";
import * as transfer from "@/app/api/v1/budgets/[budgetId]/members/[userId]/transfer-ownership/route";
import * as invites from "@/app/api/v1/budgets/[budgetId]/invites/route";
import * as invite from "@/app/api/v1/budgets/[budgetId]/invites/[inviteId]/route";
import * as resend from "@/app/api/v1/budgets/[budgetId]/invites/[inviteId]/resend/route";
import * as invitePreview from "@/app/api/v1/invites/[token]/route";
import * as inviteAccept from "@/app/api/v1/invites/[token]/accept/route";
import * as widgetTypes from "@/app/api/v1/widget-types/route";
import * as dashTemplates from "@/app/api/v1/dashboard-templates/route";
import * as widgetQuery from "@/app/api/v1/budgets/[budgetId]/widgets/query/route";
import * as widgetValidate from "@/app/api/v1/budgets/[budgetId]/widgets/validate/route";
import * as dashboards from "@/app/api/v1/budgets/[budgetId]/dashboards/route";
import * as dashboard from "@/app/api/v1/budgets/[budgetId]/dashboards/[dashboardId]/route";
import * as targets from "@/app/api/v1/budgets/[budgetId]/category-targets/route";
import * as target from "@/app/api/v1/budgets/[budgetId]/category-targets/[categoryId]/route";
import * as preview from "@/app/api/v1/budgets/[budgetId]/imports/csv/preview/route";

import * as presets from "@/app/api/v1/budgets/[budgetId]/import-presets/route";
import * as preset from "@/app/api/v1/budgets/[budgetId]/import-presets/[presetId]/route";
import * as analyze from "@/app/api/v1/budgets/[budgetId]/imports/csv/analyze/route";
import * as stage from "@/app/api/v1/budgets/[budgetId]/imports/csv/stage/route";
import * as staged from "@/app/api/v1/budgets/[budgetId]/staged-transactions/route";
import * as stagedOne from "@/app/api/v1/budgets/[budgetId]/staged-transactions/[stagedId]/route";
import * as accept from "@/app/api/v1/budgets/[budgetId]/staged-transactions/accept/route";
import * as dismiss from "@/app/api/v1/budgets/[budgetId]/staged-transactions/dismiss/route";
import * as batches from "@/app/api/v1/budgets/[budgetId]/import-batches/route";
import * as batch from "@/app/api/v1/budgets/[budgetId]/import-batches/[batchId]/route";

import * as bankProviders from "@/app/api/v1/bank-sync/providers/route";
import * as plaidWebhook from "@/app/api/v1/webhooks/plaid/route";
import * as connections from "@/app/api/v1/budgets/[budgetId]/bank-connections/route";
import * as connection from "@/app/api/v1/budgets/[budgetId]/bank-connections/[connectionId]/route";
import * as connSync from "@/app/api/v1/budgets/[budgetId]/bank-connections/[connectionId]/sync/route";
import * as connReauth from "@/app/api/v1/budgets/[budgetId]/bank-connections/[connectionId]/reauth/start/route";
import * as linkStart from "@/app/api/v1/budgets/[budgetId]/bank-connections/link/start/route";
import * as linkComplete from "@/app/api/v1/budgets/[budgetId]/bank-connections/link/complete/route";

import * as aiStatus from "@/app/api/v1/ai/status/route";
import * as conversations from "@/app/api/v1/budgets/[budgetId]/ai/conversations/route";
import * as conversation from "@/app/api/v1/budgets/[budgetId]/ai/conversations/[conversationId]/route";
import * as messages from "@/app/api/v1/budgets/[budgetId]/ai/conversations/[conversationId]/messages/route";
import * as proposals from "@/app/api/v1/budgets/[budgetId]/proposals/route";
import * as proposal from "@/app/api/v1/budgets/[budgetId]/proposals/[proposalId]/route";
import * as approve from "@/app/api/v1/budgets/[budgetId]/proposals/[proposalId]/approve/route";
import * as reject from "@/app/api/v1/budgets/[budgetId]/proposals/[proposalId]/reject/route";
import * as audit from "@/app/api/v1/budgets/[budgetId]/agent-audit/route";
import * as tokens from "@/app/api/v1/me/tokens/route";
import * as token from "@/app/api/v1/me/tokens/[tokenId]/route";
import * as signOutEverywhere from "@/app/api/v1/me/sessions/revoke/route";
import * as resendVerification from "@/app/api/v1/me/verification/send/route";

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

/** Route handler for each contract endpoint. A missing entry is a type error. */
export const routeHandlers: Record<EndpointId, Handler> = {
  health: health.GET as Handler,
  instanceConfig: config.GET as Handler,
  me: me.GET,
  listBudgets: budgets.GET,
  createBudget: budgets.POST,
  getBudget: budget.GET,
  updateBudget: budget.PATCH,
  deleteBudget: budget.DELETE,
  listCategories: categories.GET,
  createCategory: categories.POST,
  updateCategory: category.PATCH,
  deleteCategory: category.DELETE,
  listTransactions: transactions.GET,
  createTransactions: transactions.POST,
  getTransaction: transaction.GET,
  updateTransaction: transaction.PATCH,
  deleteTransaction: transaction.DELETE,
  reportSummary: summary.GET,
  reportCompare: compare.GET,
  importCsvPreview: preview.POST,
  bankProviders: bankProviders.GET as Handler,
  plaidWebhook: plaidWebhook.POST as unknown as Handler,
  aiStatus: aiStatus.GET as Handler,
  listConversations: conversations.GET,
  createConversation: conversations.POST,
  getConversation: conversation.GET,
  deleteConversation: conversation.DELETE,
  sendMessage: messages.POST,
  listProposals: proposals.GET,
  createProposal: proposals.POST,
  getProposal: proposal.GET,
  approveProposal: approve.POST,
  rejectProposal: reject.POST,
  listAgentAudit: audit.GET,
  listTokens: tokens.GET,
  createToken: tokens.POST,
  deleteToken: token.DELETE,
  signOutEverywhere: signOutEverywhere.POST,
  resendVerification: resendVerification.POST,
  listBankConnections: connections.GET,
  startBankLink: linkStart.POST,
  completeBankLink: linkComplete.POST,
  updateBankConnection: connection.PATCH,
  syncBankConnection: connSync.POST,
  startBankReauth: connReauth.POST,
  deleteBankConnection: connection.DELETE,
  listImportPresets: presets.GET,
  createImportPreset: presets.POST,
  updateImportPreset: preset.PATCH,
  deleteImportPreset: preset.DELETE,
  analyzeCsv: analyze.POST,
  stageCsv: stage.POST,
  listStaged: staged.GET,
  updateStaged: stagedOne.PATCH,
  acceptStaged: accept.POST,
  dismissStaged: dismiss.POST,
  listImportBatches: batches.GET,
  discardImportBatch: batch.DELETE,
  widgetTypes: widgetTypes.GET as Handler,
  listDashboardTemplates: dashTemplates.GET as Handler,
  queryWidgets: widgetQuery.POST,
  validateWidget: widgetValidate.POST,
  listDashboards: dashboards.GET,
  createDashboard: dashboards.POST,
  getDashboard: dashboard.GET,
  replaceDashboard: dashboard.PUT,
  deleteDashboard: dashboard.DELETE,
  listCategoryTargets: targets.GET,
  setCategoryTarget: target.PUT,
  deleteCategoryTarget: target.DELETE,
  listMembers: members.GET,
  updateMember: member.PATCH,
  removeMember: member.DELETE,
  transferOwnership: transfer.POST,
  listInvites: invites.GET,
  createInvite: invites.POST,
  revokeInvite: invite.DELETE,
  resendInvite: resend.POST,
  previewInvite: invitePreview.GET,
  acceptInvite: inviteAccept.POST,
};
