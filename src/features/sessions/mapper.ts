import type { SessionDto } from "./dto";
import type { Session } from "./types";

/**
 * Wire shapes in, entities out — the only file besides `repository.ts`
 * allowed to name a DTO.
 *
 * Almost nothing happens here, which is the correct amount: the server
 * already decided what a session is, what it is called and which of them is
 * current, because every one of those needs the `tokenHash` this side must
 * never see.
 */
export function toSession(dto: SessionDto): Session {
  return {
    id: dto.id,
    device: dto.device,
    ip: dto.ip,
    lastActiveAt: new Date(dto.lastActiveAt),
    expiresAt: new Date(dto.expiresAt),
    current: dto.current,
  };
}

/**
 * The caller's own session first, then the rest as the server ordered them.
 *
 * The server sorts by most recent activity, which is the right order for the
 * others. Pinning the current one to the top is a screen concern: it is the
 * row a reader looks for to *avoid*, and hunting for it down a list of
 * twenty identical "Chrome auf Windows" entries is how somebody revokes the
 * wrong one.
 */
export function toSessions(rows: SessionDto[]): Session[] {
  const mapped = rows.map(toSession);
  return [...mapped.filter((s) => s.current), ...mapped.filter((s) => !s.current)];
}
