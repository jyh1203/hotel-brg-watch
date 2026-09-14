import fs from "node:fs/promises";
import path from "node:path";

const sensitiveQuery = /^(?:token|auth|authorization|cookie|session|sid|key|code|state|credential|password)$/i;

export function sanitizeDiagnosticUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)marriott\.com$/i.test(url.hostname)) {
      // Third-party telemetry frequently embeds identifiers in semicolon path
      // parameters, not only in the query string. Keep only the origin so a
      // diagnostic can identify the destination without persisting visitor data.
      return `${url.origin}/[redacted]`;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveQuery.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return String(value).replace(/([?&](?:token|auth|authorization|cookie|session|sid|key|code|state|credential|password)=)[^&#]*/gi, "$1[redacted]");
  }
}

export function isMarriottRateRequestUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)marriott\.com$/i.test(url.hostname)
      && /rate|availability|reservation/i.test(`${url.pathname}${url.search}`);
  } catch {
    return false;
  }
}

export function sanitizePageHtml(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>[redacted]</script>")
    // Form values are not needed for DOM diagnosis and can contain account,
    // date, CSRF, or session state regardless of the input type/attribute order.
    .replace(/(<input\b[^>]*\bvalue=["'])[^"']*(["'])/gi, "$1[redacted]$2")
    .replace(/(\b(?:data-)?(?:token|authorization|cookie|session|password)[\w-]*=["'])[^"']*(["'])/gi, "$1[redacted]$2")
    .replace(/(["'](?:token|authorization|cookie|session|password)["']\s*:\s*["'])[^"']*(["'])/gi, "$1[redacted]$2");
}

export function safeNetworkEntry(value) {
  return {
    method: String(value.method ?? "GET"),
    resourceType: String(value.resourceType ?? "other"),
    status: Number(value.status ?? 0),
    url: sanitizeDiagnosticUrl(value.url ?? "")
  };
}

export function createMarriottRecorder(context, artifactDir) {
  const consoleEvents = [];
  const networkEvents = [];
  const attachedPages = new WeakSet();

  const attach = (page) => {
    if (attachedPages.has(page)) return;
    attachedPages.add(page);
    page.on("console", (message) => {
      consoleEvents.push({ type: message.type(), text: message.text().slice(0, 1000) });
    });
    page.on("pageerror", (error) => {
      consoleEvents.push({ type: "pageerror", text: error.message.slice(0, 1000) });
    });
    page.on("response", (response) => {
      const request = response.request();
      if (!["fetch", "xhr", "document"].includes(request.resourceType())) return;
      networkEvents.push(safeNetworkEntry({
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        url: sanitizeDiagnosticUrl(response.url())
      }));
    });
  };

  context.on("page", attach);
  for (const page of context.pages()) attach(page);

  return {
    attach,
    async start() {
      // DOM snapshots and sources can contain authenticated page state and raw
      // request metadata. The standalone screenshot/page/network files below
      // are explicitly sanitized, so keep the Playwright trace action-only.
      await context.tracing.start({ screenshots: false, snapshots: false, sources: false }).catch(() => {});
    },
    async saveFailure(page, diagnostics) {
      await fs.mkdir(artifactDir, { recursive: true });
      await page?.screenshot({ path: path.join(artifactDir, "screenshot.png"), fullPage: true }).catch(() => {});
      const html = await page?.content().catch(() => "") ?? "";
      await Promise.all([
        fs.writeFile(path.join(artifactDir, "page.html"), `${sanitizePageHtml(html)}\n`),
        fs.writeFile(path.join(artifactDir, "console.json"), `${JSON.stringify(consoleEvents, null, 2)}\n`),
        fs.writeFile(path.join(artifactDir, "network.json"), `${JSON.stringify(networkEvents, null, 2)}\n`),
        fs.writeFile(path.join(artifactDir, "diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`)
      ]);
      await context.tracing.stop({ path: path.join(artifactDir, "trace.zip") }).catch(() => {});
    },
    async discardTrace() {
      await context.tracing.stop().catch(() => {});
    },
    networkEvents
  };
}
