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

export const MEDIA_FIELDS = [
  'media_key',
  'type',
  'url',
  'preview_image_url',
  'alt_text',
  'duration_ms',
  'height',
  'width',
] as const;

export const EXPANSIONS = [
  'author_id',
  'referenced_tweets.id',
  'in_reply_to_user_id',
  'attachments.media_keys',
] as const;

export function defaultPostParams(opts?: { ownedPrivate?: boolean }): Record<string, string> {
  const tweetFields = opts?.ownedPrivate ? POST_FIELDS_OWNED_PRIVATE : POST_FIELDS;
  return {
    'tweet.fields': tweetFields.join(','),
    'user.fields': USER_FIELDS.join(','),
    'media.fields': MEDIA_FIELDS.join(','),
    expansions: EXPANSIONS.join(','),
  };
}
