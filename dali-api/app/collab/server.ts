import { Server } from "@hocuspocus/server";
import { Redis as HocuspocusRedis } from "@hocuspocus/extension-redis";
import IORedis from "ioredis";
import { verifyCollabToken } from "./auth";
import { loadDocument, maybeSnapshot, storeDocument } from "./persistence";
import { isPresenceRoom } from "./roomName";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { notifyCollabDocMentions } from "./mentions.server";
import { reconcilePageLinks } from "./page-links.server";

const WS_MAX_PAYLOAD_BYTES = 1_048_576; // 1 MB
const WS_MAX_CONNECTIONS = 100;
const WS_MAX_CONNECTIONS_PER_USER = 20;

let server: Server | null = null;
let connectionCount = 0;
const userConnectionCounts = new Map<string, number>();

// userIds that have edited each doc since the last snapshot was written.
// Drained in onStoreDocument / onDisconnect so version rows record only the
// authors who contributed to that snapshot's window.
const pendingAuthors = new Map<string, Set<string>>();

function recordAuthor(documentName: string, userId: string | undefined) {
  if (!userId) return;
  let set = pendingAuthors.get(documentName);
  if (!set) {
    set = new Set();
    pendingAuthors.set(documentName, set);
  }
  set.add(userId);
}

function drainAuthors(documentName: string): string[] {
  const set = pendingAuthors.get(documentName);
  if (!set) return [];
  pendingAuthors.delete(documentName);
  return Array.from(set);
}

export function startCollabServer() {
  if (server) return server;

  const port = parseInt(process.env.COLLAB_PORT ?? "3002", 10);

  const extensions: any[] = [];
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    // Pass an ioredis instance built from the URL so deployment configs can
    // ship a single REDIS_URL secret instead of host/port/password fields.
    const redisClient = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    extensions.push(new HocuspocusRedis({ redis: redisClient }));
    console.log("[collab:server] redis fan-out enabled");
  } else {
    console.warn(
      "[collab:server] REDIS_URL not set — collab will not sync across machines",
    );
  }

  server = new Server({
    port,
    // Debounce writes — Hocuspocus buffers onChange calls and flushes
    // to onStoreDocument every `debounce` ms.
    debounce: 2000,
    extensions,

    async onConnect() {
      // No-op: connection counting is deferred to onAuthenticate so that
      // unauthenticated connections cannot exhaust the pool.
    },

    async onAuthenticate({
      token,
      documentName,
      connectionConfig,
    }: {
      token: string;
      documentName: string;
      connectionConfig: { readOnly: boolean };
    }) {
      if (!token) throw new Error("No authentication token provided");
      const user = await verifyCollabToken(token);

      // Presence rooms are accessible to any authenticated user — they carry
      // no document content, only ephemeral awareness state.
      if (!isPresenceRoom(documentName)) {
        const auth = await authorizeCollabDoc(user.sub, documentName);
        if (!auth.allowed) {
          throw new Error(
            `User ${user.sub} not authorized for document ${documentName}`,
          );
        }
        // readOnly is set by authorizeCollabDoc for viewer-only connections
        // (e.g. partners on doc:* pages, non-instructor lab members on
        // EducationOffering pages). The server drops their writes while still
        // delivering the document for reading.
        if (auth.readOnly) {
          connectionConfig.readOnly = true;
        }
      }

      // Only count authenticated+authorized sessions toward the limit.
      // No TOCTOU risk: no await between check and increment, so
      // single-threaded JS guarantees atomicity.
      const userCount = userConnectionCounts.get(user.sub) ?? 0;
      if (userCount >= WS_MAX_CONNECTIONS_PER_USER) {
        throw new Error("Too many connections for this user");
      }
      if (connectionCount >= WS_MAX_CONNECTIONS) {
        throw new Error("Too many connections");
      }
      userConnectionCounts.set(user.sub, userCount + 1);
      connectionCount++;

      console.log(
        `[collab:server] auth ok for user=${user.sub} doc=${documentName} (connections: ${connectionCount})`,
      );
      return { user };
    },

    async onLoadDocument({ document, documentName }: { document: any; documentName: string }) {
      console.log(`[collab:server] onLoadDocument doc=${documentName}`);
      await loadDocument(documentName, document);
      return document;
    },

    async onChange({ documentName, context }: { documentName: string; context: any }) {
      const userId = context?.user?.sub;
      console.log(`[collab:server] onChange doc=${documentName} by=${userId ?? "?"}`);
      recordAuthor(documentName, userId);
    },

    async onStoreDocument({ documentName, document }: { documentName: string; document: any }) {
      console.log(`[collab:server] onStoreDocument doc=${documentName}`);
      const stored = await storeDocument(documentName, document);
      if (!stored) return;
      const authors = drainAuthors(documentName);
      // Notify anyone newly @-mentioned in the body (best-effort, deduped).
      void notifyCollabDocMentions(documentName, document, authors).catch((err) =>
        console.error(`[collab:server] mention notify failed doc=${documentName}`, err),
      );
      // Reconcile the backlink index for page mentions (best-effort).
      void reconcilePageLinks(documentName, document).catch((err) =>
        console.error(`[collab:server] page-link reconcile failed doc=${documentName}`, err),
      );
      try {
        const wrote = await maybeSnapshot(documentName, stored, authors);
        if (!wrote) for (const a of authors) recordAuthor(documentName, a);
      } catch (err) {
        console.error(`[collab:server] snapshot failed doc=${documentName}`, err);
        for (const a of authors) recordAuthor(documentName, a);
      }
    },

    async onDisconnect({ documentName, document, context }: { documentName: string; document: any; context: any }) {
      connectionCount = Math.max(0, connectionCount - 1);
      const userId = context?.user?.sub;
      if (userId) {
        const prev = userConnectionCounts.get(userId) ?? 0;
        if (prev <= 1) userConnectionCounts.delete(userId);
        else userConnectionCounts.set(userId, prev - 1);
      }
      console.log(`[collab:server] onDisconnect doc=${documentName} (connections: ${connectionCount})`);
      const stored = await storeDocument(documentName, document);
      if (!stored) return;
      const authors = drainAuthors(documentName);
      void notifyCollabDocMentions(documentName, document, authors).catch((err) =>
        console.error(`[collab:server] mention notify failed doc=${documentName}`, err),
      );
      void reconcilePageLinks(documentName, document).catch((err) =>
        console.error(`[collab:server] page-link reconcile failed doc=${documentName}`, err),
      );
      try {
        const wrote = await maybeSnapshot(documentName, stored, authors);
        if (!wrote) for (const a of authors) recordAuthor(documentName, a);
      } catch (err) {
        console.error(`[collab:server] snapshot failed doc=${documentName}`, err);
        for (const a of authors) recordAuthor(documentName, a);
      }
    },
  }, { maxPayload: WS_MAX_PAYLOAD_BYTES });

  server.listen().catch((err: any) => {
    if (err?.code === "EADDRINUSE") {
      console.log(`[collab] Port ${port} already in use — collab server likely running from a previous load`);
    } else {
      console.error(`[collab] Failed to start Hocuspocus server:`, err);
    }
  });

  return server;
}

export function getCollabServer() {
  return server;
}
