import { handle } from "@/server/handler";

export const POST = handle("signOutEverywhere", ({ actor, services }) =>
  services.account.signOutEverywhere(actor),
);
