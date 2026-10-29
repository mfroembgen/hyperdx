import MongoStore from 'connect-mongo';
import type { Store } from 'express-session';

/** Change only the seal, provided the session still contains the one we used. */
export async function replaceStoredWorkosSession(
  req: { sessionID: string; sessionStore: Store },
  expectedSeal: string,
  replacement: string | undefined,
): Promise<string | undefined> {
  // api-app uses MongoStore's default JSON serialization and untransformed SIDs.
  if (!(req.sessionStore instanceof MongoStore))
    throw new Error('WorkOS refresh requires the Mongo session store');
  const collection = await req.sessionStore.collectionP;
  for (let attempt = 0; attempt < 3; attempt++) {
    const document = await collection.findOne({
      _id: req.sessionID,
      $or: [{ expires: { $exists: false } }, { expires: { $gt: new Date() } }],
    });
    if (!document) return undefined;
    if (typeof document.session !== 'string')
      throw new Error('Unsupported Mongo session serialization');
    const payload: unknown = JSON.parse(document.session);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('Invalid Mongo session payload');
    const persisted: Record<string, unknown> = { ...payload };
    if (typeof persisted.workosSession !== 'string') return undefined;
    if (persisted.workosSession !== expectedSeal)
      return persisted.workosSession;
    if (replacement === undefined) delete persisted.workosSession;
    else persisted.workosSession = replacement;
    const result = await collection.updateOne(
      {
        _id: req.sessionID,
        session: document.session,
        $or: [
          { expires: { $exists: false } },
          { expires: { $gt: new Date() } },
        ],
      },
      { $set: { session: JSON.stringify(persisted) } },
      { upsert: false },
    );
    if (result.matchedCount === 1) return replacement;
  }
  throw new Error('Concurrent Mongo session updates');
}
