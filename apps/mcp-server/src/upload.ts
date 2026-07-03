/**
 * Original-document byte storage (specs/01-initial-platform/SPEC.md §5.6, §8.3). The MCP tool
 * `create_document_upload` mints a one-time, short-lived token; the user PUTs
 * the file to /upload/{token}; the worker writes it to the R2 binding and
 * finalizes the `documents` row. No S3 credentials — just the bucket binding.
 *
 * The whole feature is optional: lab/test *data* import works with no upload.
 */
import { finalizeDocument, findDocumentBySha, getDocument } from "@corpus/core";
import { withUserDb } from "./db.js";
import type { UploadTicket } from "./types.js";

const TOKEN_TTL_SECONDS = 3600; // 1 hour to complete the upload
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB — lab PDFs/photos are small
const kvKey = (token: string) => `upload:${token}`;

/** Mint a single-use upload token and stash the ticket in KV. */
export async function issueUploadToken(env: Env, ticket: UploadTicket): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  await env.OAUTH_KV.put(kvKey(token), JSON.stringify(ticket), {
    expirationTtl: TOKEN_TTL_SECONDS,
  });
  return token;
}

export function uploadUrlFor(env: Env, token: string): string | null {
  const base = env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/upload/${token}` : null;
}

export const UPLOAD_TTL_SECONDS = TOKEN_TTL_SECONDS;

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Handle `PUT /upload/{token}`. Single-use; validates and stores the bytes. */
export async function handleUpload(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "PUT") {
    return new Response("Use PUT to upload", { status: 405 });
  }
  const raw = await env.OAUTH_KV.get(kvKey(token));
  if (!raw) {
    return new Response("Upload link is invalid or expired", { status: 404 });
  }
  const ticket = JSON.parse(raw) as UploadTicket;

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return new Response("Empty body", { status: 400 });
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return new Response(`File exceeds ${MAX_UPLOAD_BYTES} byte limit`, { status: 413 });
  }

  // Consume the token first so it can't be replayed even if a retry races.
  await env.OAUTH_KV.delete(kvKey(token));

  const sha256 = await sha256Hex(bytes);

  return withUserDb(env, ticket.userId, async (db) => {
    const ctx = { userId: ticket.userId, timezone: "UTC", unitPreference: "imperial" as const };

    // Byte-level dedup: if these exact bytes are already stored, reuse them and
    // drop the just-created placeholder rather than tripping the unique index.
    const duplicate = await findDocumentBySha(db, ctx, sha256);
    if (duplicate && duplicate.id !== ticket.documentId) {
      return Response.json(
        {
          status: "already_stored",
          documentId: duplicate.id,
          message: "These exact bytes were already stored; reusing the existing document.",
        },
        { status: 200 },
      );
    }

    const doc = await getDocument(db, ctx, ticket.documentId);
    if (!doc) return new Response("Document record not found", { status: 404 });

    await env.DOCS.put(ticket.r2Key, bytes, {
      httpMetadata: { contentType: ticket.contentType },
      sha256,
    });
    const finalized = await finalizeDocument(db, ctx, ticket.documentId, {
      sha256,
      sizeBytes: bytes.byteLength,
    });
    return Response.json(
      { status: "stored", documentId: finalized.id, sizeBytes: finalized.sizeBytes },
      { status: 201 },
    );
  });
}
