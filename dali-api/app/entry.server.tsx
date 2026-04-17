import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { startCollabServer } from "~/collab/server";

// Start Hocuspocus collab server on a second port (runs once due to module caching).
startCollabServer();

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  entryContext: EntryContext,
) {
  return new Promise<Response>((resolve, reject) => {
    const { pipe } = renderToPipeableStream(
      <ServerRouter context={entryContext} url={request.url} />,
      {
        onShellReady() {
          const body = new PassThrough();
          const chunks: Buffer[] = [];

          body.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          body.on("end", () => {
            const html = `<!DOCTYPE html>${Buffer.concat(chunks).toString("utf-8")}`;
            responseHeaders.set("Content-Type", "text/html");
            resolve(
              new Response(html, {
                status: responseStatusCode,
                headers: responseHeaders,
              })
            );
          });
          body.on("error", reject);

          pipe(body);
        },
        onShellError: reject,
      }
    );
  });
}
