export type MeetingUser = { userId: string } | null | undefined;
export type AccessResult =
  | { status: 200 }
  | { status: 401 | 403; error: string };

export function authorizeEntriesRead(
  user: MeetingUser,
  configuredIds?: string,
): AccessResult;
export function authorizeEntriesWrite(
  user: MeetingUser,
  payload: Record<string, unknown>,
  configuredIds?: string,
): AccessResult;
