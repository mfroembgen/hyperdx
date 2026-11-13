import MongoStore from 'connect-mongo';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { SessionData, Store } from 'express-session';
import { z } from 'zod';

const generatedIds = new WeakMap<Request, string>();
type SessionRequest = { sessionID: string; sessionStore: Store };
type Login = NonNullable<SessionData['workosLogin']>;
const loginSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  expiresAt: z.number(),
  returnTo: z.string(),
});

export function generateSessionId(req: Request) {
  const id = randomBytes(24).toString('base64url');
  generatedIds.set(req, id);
  return id;
}

export const isNewSession = (req: Request) =>
  generatedIds.get(req) === req.sessionID;

const activeSession = (req: SessionRequest) => ({
  _id: req.sessionID,
  $or: [{ expires: { $exists: false } }, { expires: { $gt: new Date() } }],
});

async function readStoredSession(req: SessionRequest) {
  // api-app uses default JSON serialization and untransformed SIDs.
  if (!(req.sessionStore instanceof MongoStore))
    throw new Error('WorkOS requires the Mongo session store');
  const collection = await req.sessionStore.collectionP;
  const document = await collection.findOne(activeSession(req));
  if (!document) return undefined;
  if (typeof document.session !== 'string')
    throw new Error('Unsupported Mongo session serialization');
  const payload: unknown = JSON.parse(document.session);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid Mongo session payload');
  const persisted: Record<string, unknown> = { ...payload };
  return { collection, document, persisted };
}

async function writeStoredSession(
  req: SessionRequest,
  stored: NonNullable<Awaited<ReturnType<typeof readStoredSession>>>,
) {
  const result = await stored.collection.updateOne(
    { ...activeSession(req), session: stored.document.session },
    { $set: { session: JSON.stringify(stored.persisted) } },
    { upsert: false },
  );
  return result.matchedCount === 1;
}

/** Change only the seal, provided the session still contains the one we used. */
export async function replaceStoredWorkosSession(
  req: SessionRequest,
  expectedSeal: string,
  replacement: string | undefined,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await readStoredSession(req);
    if (!stored) return undefined;
    const canonical = stored.persisted.workosSession;
    if (typeof canonical !== 'string') return undefined;
    if (canonical !== expectedSeal) return canonical;
    if (replacement === undefined) delete stored.persisted.workosSession;
    else stored.persisted.workosSession = replacement;
    if (await writeStoredSession(req, stored)) return replacement;
  }
  throw new Error('Concurrent Mongo session updates');
}

export async function storeWorkosLogin(req: SessionRequest, login: Login) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await readStoredSession(req);
    if (!stored) return false;
    stored.persisted.workosLogin = login;
    if (await writeStoredSession(req, stored)) return true;
  }
  throw new Error('Concurrent Mongo session updates');
}

/** Only the request that removes the canonical attempt may exchange its code. */
export async function consumeWorkosLogin(req: SessionRequest, state: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await readStoredSession(req);
    if (!stored) return undefined;
    const login = loginSchema.safeParse(stored.persisted.workosLogin);
    if (!login.success || login.data.expiresAt <= Date.now()) return undefined;
    const expected = Buffer.from(login.data.state);
    const actual = Buffer.from(state);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return undefined;
    delete stored.persisted.workosLogin;
    if (await writeStoredSession(req, stored)) return login.data;
  }
  throw new Error('Concurrent Mongo session updates');
}

/** Claim a still-live old SID before replacing it with authenticated state. */
export async function claimWorkosSession(req: SessionRequest) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await readStoredSession(req);
    if (!stored) return false;
    const result = await stored.collection.deleteOne({
      ...activeSession(req),
      session: stored.document.session,
    });
    if (result.deletedCount === 1) return true;
  }
  throw new Error('Concurrent Mongo session updates');
}
