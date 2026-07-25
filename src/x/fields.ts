// Field selection — single source of truth. Don't hand-roll field strings at call sites.
// X plan §5.

export const POST_FIELDS = [
  'id',
  'text',
  'created_at',
  'author_id',
  'conversation_id',
  'in_reply_to_user_id',
  'referenced_tweets',
  'public_metrics',
  'entities',
  'lang',
  'attachments',
] as const;

// Add only on owned-user reads of posts ≤30 days old. After 30d, these silently null.
export const POST_FIELDS_OWNED_PRIVATE = [
  ...POST_FIELDS,
  'non_public_metrics',
  'organic_metrics',
] as const;

export const USER_FIELDS = [
  'id',
  'name',
  'username',
  'created_at',
  'description',
  'public_metrics',
  'verified',
  'verified_type',
  'subscription_type',
  'connection_status',
] as const;

// ⚠️ Expansions are a COST decision, not a convenience one (CA.2, invariant #5).
// An expansion hydrates whole extra objects into `includes.*`, and X bills every
// object it returns in the body — not just the ones in `data`. Worse, `itemCount`
// in client.ts only counts `data`/`meta.result_count`, so anything arriving in
// `includes` is billed AND invisible to `/cost/today` and the budget watchdog.
//
// This list used to be `author_id, referenced_tweets.id, in_reply_to_user_id,
// attachments.media_keys` on EVERY read. Nothing in this repo has ever read
// `includes.tweets` or `includes.media`, so on a ~90-reply day the
// `referenced_tweets.id` expansion alone dragged in ~90 parent tweets at the
// $0.005 other-post rate — unread, unledgered, and the largest single line in
// the console-vs-ledger gap.
//
// So: expand NOTHING by default. Add an expansion here only alongside the code
// that reads the `includes` it produces.
//
// This costs no functionality: `referenced_tweets` and `attachments` are tweet
// FIELDS (see POST_FIELDS) and still arrive on every tweet for free, so the
// has_media baseline (`tweet.attachments?.media_keys?.length`) is unaffected —
// only the fully-hydrated parent-tweet/media objects go away.
export const NO_EXPANSIONS = [] as const;

/** The one expansion with a reader: `getUserMentions` resolves each mention's
 *  author handle out of `includes.users`. Costs one user object per distinct
 *  author per page, which is the price of the handle. */
export const MENTION_EXPANSIONS = ['author_id'] as const;

export function defaultPostParams(opts?: {
  ownedPrivate?: boolean;
  /** Omit for no expansions. Pass only a list whose `includes` you actually read. */
  expansions?: readonly string[];
}): Record<string, string> {
  const tweetFields = opts?.ownedPrivate ? POST_FIELDS_OWNED_PRIVATE : POST_FIELDS;
  const expansions = opts?.expansions ?? NO_EXPANSIONS;
  return {
    'tweet.fields': tweetFields.join(','),
    // `user.fields` only shapes objects that an expansion put in `includes.users`.
    // With no expansion there are no such objects, so sending it would be noise.
    ...(expansions.length > 0
      ? { expansions: expansions.join(','), 'user.fields': USER_FIELDS.join(',') }
      : {}),
  };
}
