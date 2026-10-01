/** Where the user is with an opportunity. No workflow: any status can follow any other. */
export const OPPORTUNITY_STATUSES = ["open", "reviewing", "negotiating", "validated", "rejected", "closed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
