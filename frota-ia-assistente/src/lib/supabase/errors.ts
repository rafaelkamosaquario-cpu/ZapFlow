/** Postgres unique_violation (ex.: idx_messages_external_message_id, constraint de user_channels). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "23505";
}
