/**
 * The proctor consent version — ONE copy, for both apps.
 *
 * This was three hardcoded string literals in the platform and three more in
 * the interview app, and the review found what that costs: bumping the
 * interview app to 2.1 left the platform writing 2.0, so a candidate who
 * consented before an interview and then sat the English test would have been
 * silently downgraded and re-prompted forever.
 *
 * The version means "the candidate has seen the current disclosure". Both apps'
 * consent screens describe the SAME scope — continuous camera everywhere, and
 * continuous microphone during interviews — so a stamp written at either gate
 * honestly covers both. If one app's disclosure changes, this bumps and
 * everyone re-consents; that is the point of it being a version.
 *
 * 2.0 → 2.1: the Interview 2 proctor recording gained room audio. Before that
 * it was silent video while Interview 1's was not, so a second person in the
 * room reading answers aloud was inaudible to every check in the product.
 */
export const PROCTOR_CONSENT_VERSION = "2.1";
