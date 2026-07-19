import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { isbot } from "isbot";
import { startCollabServer } from "~/collab/server";
import { startJobRunner } from "~/jobs/runner.server";
import { securityHeaders } from "~/lib/security-headers";

// Start Hocuspocus collab server on a second port (runs once due to module caching).
startCollabServer();
// Start the background job tick (cross-machine dedup via DB lease; see
// app/jobs/runner.server.ts).
startJobRunner();

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  entryContext: EntryContext,
) {
  return new Promise<Response>((resolve, reject) => {
    let didError = false;
    const userAgent = request.headers.get("user-agent");

    // Bots and SPA-mode renders wait for all content; browsers stream from the shell.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || entryContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={entryContext} url={request.url} />,
      {
        [readyOption]() {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          for (const [k, v] of Object.entries(securityHeaders())) {
            responseHeaders.set(k, v);
          }

          resolve(
            new Response(stream, {
              status: didError ? 500 : responseStatusCode,
              headers: responseHeaders,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          didError = true;
          console.error(error);
        },
      }
    );

    setTimeout(abort, streamTimeout + 1000);
  });
}
