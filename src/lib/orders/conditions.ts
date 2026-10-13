/**
 * The conditions of the order service, as a supplier reads and accepts them
 * once. A pilot draft: they say what the platform does and does not do, in
 * plain words — they were not reviewed by a lawyer, and say so. Before real
 * use they are to be reviewed, and a new text is a new version
 * (ORDER_TERMS_VERSION): companies that accepted an older one are asked again.
 */
import type { Msg } from "../i18n";

export const ORDER_CONDITIONS: Msg[] = [
  "Procurement Intelligence passes order requests from your customers to you, and your answers back to them. It is not a party to the sale: the goods, the price, the delivery and the payment are between you and your customer.",
  "Your articles can receive order requests only from the customers you allow, and only at the conditions an authorised person of your company confirmed. You can change them, pause orders or stop them at any time; orders already confirmed are not touched.",
  "A request is not an order. It becomes a confirmed order when you accept it as it was written, or when your customer accepts the changes you proposed. The platform records who confirmed what, and when, and keeps the confirmed conditions unchanged.",
  "What a confirmation means in law between you and your customer depends on the agreements between the two companies and on the law that applies to them: the platform records the confirmation, it does not replace your contracts.",
  "The prices and conditions you state for a customer are shown to that customer only. They are never published and never shown to other customers or to other suppliers.",
  "No payment passes through the platform, and the order service is free during the pilot.",
  "These conditions are a pilot draft: they have not been reviewed by a lawyer yet, and will be before the service is offered beyond the pilot.",
];
