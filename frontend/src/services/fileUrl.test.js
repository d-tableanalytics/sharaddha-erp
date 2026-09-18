/**
 * Storage URLs must be openable from the browser.
 *
 * The bug: the local storage driver returns a RELATIVE url
 * (`/api/v1/hrms/files/local?…`), the browser resolved it against the SPA's
 * origin rather than the API's, and React Router answered with its own
 * "Unexpected Application Error! 404 Not Found" page. Every file in the product
 * was affected on that driver — O2D documents, payslips, offer letters,
 * résumés, receipts, certificates and lesson content.
 *
 * `API_ORIGIN` is read from the environment when the module first loads, so
 * each case re-imports it under a different `VITE_API_URL`.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * The project's own `.env` sets `VITE_API_URL`, so "unset" has to be stubbed
 * explicitly — clearing the stubs would only restore that value.
 */
const load = async (apiUrl) => {
  vi.resetModules();
  vi.stubEnv("VITE_API_URL", apiUrl);
  return import("./fileUrl");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const LOCAL = "/api/v1/hrms/files/local?key=o2d/po.pdf&expires=123&sig=abc";

describe("resolving a storage URL", () => {
  it("🔴 sends a relative URL to the API origin, not to the SPA", async () => {
    const { fileUrl } = await load("http://localhost:5001");

    expect(fileUrl(LOCAL)).toBe(`http://localhost:5001${LOCAL}`);
  });

  it("leaves it relative when the API is served from the same origin", async () => {
    // `VITE_API_URL=""` is "configured, as same-origin" — behind a proxy that
    // serves the SPA and the API together, relative is the correct answer.
    const { fileUrl } = await load("");

    expect(fileUrl(LOCAL)).toBe(LOCAL);
  });

  it("uses the dev fallback origin when nothing is configured", async () => {
    const { fileUrl } = await load(undefined);

    expect(fileUrl(LOCAL)).toBe(`http://localhost:5000${LOCAL}`);
  });

  /**
   * 🔴 An S3 presigned URL's signature covers the host. Prefixing an origin
   * onto it would produce a URL that is both wrong and unverifiable.
   */
  it("never touches a URL that is already absolute", async () => {
    const { fileUrl } = await load("http://localhost:5001");

    const s3 =
      "https://bucket.s3.ap-south-1.amazonaws.com/o2d/po.pdf?X-Amz-Signature=deadbeef";
    expect(fileUrl(s3)).toBe(s3);
    expect(fileUrl("//cdn.example.com/x.pdf")).toBe("//cdn.example.com/x.pdf");
    expect(fileUrl("blob:http://localhost/9f8a")).toBe("blob:http://localhost/9f8a");
  });

  it("joins a path that arrives without its leading slash", async () => {
    const { fileUrl } = await load("http://localhost:5001");

    expect(fileUrl("api/v1/files/x.pdf")).toBe("http://localhost:5001/api/v1/files/x.pdf");
  });

  it("passes an empty value straight through rather than inventing a URL", async () => {
    const { fileUrl } = await load("http://localhost:5001");

    expect(fileUrl(null)).toBe(null);
    expect(fileUrl(undefined)).toBe(undefined);
    expect(fileUrl("")).toBe("");
  });

  it("opens in a new tab with no handle back to this window", async () => {
    const { openFile } = await load("http://localhost:5001");
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openFile(LOCAL);

    expect(open).toHaveBeenCalledWith(
      `http://localhost:5001${LOCAL}`,
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * 🔴 THE REAL REGRESSION RISK IS A NEW SCREEN, NOT AN OLD ONE.
 *
 * Ten call sites had this bug at once, because each was written the same
 * plausible way: fetch `{ url }`, hand it to `window.open`. Fixing those ten
 * does nothing to stop the eleventh.
 *
 * So the rule is enforced over the source tree rather than trusted to review: a
 * storage URL fetched from the API must go through `openFile`/`fileUrl`, which
 * resolves it against the API origin. A literal, in-page URL is fine — this
 * looks only for the variables those endpoints actually return.
 */
describe("no screen may open a fetched storage URL directly", () => {
  it("has no unresolved window.open of an API-issued url", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          // `window.open(url…)` / `(link.url…)` / `(res.url…)` — the shapes the
          // storage endpoints hand back.
          if (/window\.open\(\s*(?:[A-Za-z_$][\w$]*\.)?url\b/.test(src)) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.resolve("src"));

    expect(offenders, `use openFile() in: ${offenders.join(", ")}`).toEqual([]);
  });
});
