export const PUBLIC_IDENTIFIER_MAX_LENGTH = 128;

const publicIdentifierPattern = /^[A-Za-z0-9_-]+$/;
const loopbackHostnames = new Set(["127.0.0.1", "localhost"]);

function forbiddenRequest(): Response {
  return new Response(JSON.stringify({ error: "Forbidden request" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

function unsupportedMediaType(): Response {
  return new Response(JSON.stringify({ error: "Unsupported media type" }), {
    status: 415,
    headers: { "content-type": "application/json" },
  });
}

export function localhostRequestBoundary(request: Request): Response | null {
  try {
    const requestUrl = new URL(request.url);
    if (!loopbackHostnames.has(requestUrl.hostname)) {
      return forbiddenRequest();
    }

    const origin = request.headers.get("origin");
    if (origin !== null) {
      const originUrl = new URL(origin);
      if (
        !loopbackHostnames.has(originUrl.hostname)
        || originUrl.protocol !== requestUrl.protocol
        || originUrl.port !== requestUrl.port
      ) {
        return forbiddenRequest();
      }
    }
  } catch {
    return forbiddenRequest();
  }

  return null;
}

export function jsonContentTypeBoundary(request: Request): Response | null {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" ? null : unsupportedMediaType();
}

export function isPublicIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= PUBLIC_IDENTIFIER_MAX_LENGTH
    && publicIdentifierPattern.test(value);
}
