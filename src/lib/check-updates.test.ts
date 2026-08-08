import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkAllUpdates,
  compareVersions,
  normalizeVersion,
  useDesktopUpdate,
} from "./check-updates";

vi.mock("@/lib/tauri-api", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.11" }));

describe("normalizeVersion", () => {
  it("parses desktop and CLI release tags", () => {
    expect(normalizeVersion("0.1.11")).toBe("0.1.11");
    expect(normalizeVersion("v0.1.11")).toBe("0.1.11");
    expect(normalizeVersion("@moonshot-ai/kimi-code@0.29.1")).toBe("0.29.1");
    expect(normalizeVersion("dev")).toBeNull();
    expect(normalizeVersion("—")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders dotted versions", () => {
    expect(compareVersions("0.1.11", "0.1.10")).toBeGreaterThan(0);
    expect(compareVersions("0.29.1", "0.29.1")).toBe(0);
    expect(compareVersions("0.28.0", "0.29.1")).toBeLessThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
});

// Ported from the removed modules/update/desktop-update test: same version
// comparison contract, now expressed through normalizeVersion + compareVersions.
describe("desktop update version gate", () => {
  const normalized = (raw: string) => normalizeVersion(raw) ?? "";

  it("detects a newer release tag", () => {
    expect(compareVersions(normalized("v1.2.0"), normalized("1.1.2"))).toBeGreaterThan(0);
    expect(compareVersions(normalized("2.0.0"), normalized("1.9.9"))).toBeGreaterThan(0);
  });

  it("does not report equal, older, or malformed versions", () => {
    expect(compareVersions(normalized("v1.1.2"), normalized("1.1.2"))).toBe(0);
    expect(compareVersions(normalized("1.1.1"), normalized("1.1.2"))).toBeLessThan(0);
    expect(compareVersions(normalized("1.0.9"), normalized("1.1.0"))).toBeLessThan(0);
    expect(normalizeVersion("latest")).toBeNull();
  });
});

describe("checkAllUpdates", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("kimi-code-desktop")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.1.12",
              html_url:
                "https://github.com/P-A-N-52/kimi-code-desktop/releases/tag/v0.1.12",
              prerelease: false,
              draft: false,
            }),
            { status: 200 },
          );
        }
        if (url.includes("MoonshotAI/kimi-code")) {
          return new Response(
            JSON.stringify({
              tag_name: "@moonshot-ai/kimi-code@0.30.0",
              html_url:
                "https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai/kimi-code%400.30.0",
              prerelease: false,
              draft: false,
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports updates for both desktop and CLI", async () => {
    const result = await checkAllUpdates({
      desktopVersion: "0.1.11",
      cliVersion: "0.29.1",
    });
    expect(result.desktop.status).toBe("update-available");
    expect(result.desktop.latest).toBe("0.1.12");
    expect(result.cli.status).toBe("update-available");
    expect(result.cli.latest).toBe("0.30.0");
  });

  it("reports up-to-date when versions match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("kimi-code-desktop")) {
          return new Response(
            JSON.stringify({
              tag_name: "v0.1.11",
              html_url: "https://example.com/desktop",
              prerelease: false,
              draft: false,
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            tag_name: "@moonshot-ai/kimi-code@0.29.1",
            html_url: "https://example.com/cli",
            prerelease: false,
            draft: false,
          }),
          { status: 200 },
        );
      }),
    );

    const result = await checkAllUpdates({
      desktopVersion: "0.1.11",
      cliVersion: "0.29.1",
    });
    expect(result.desktop.status).toBe("up-to-date");
    expect(result.cli.status).toBe("up-to-date");
  });
});

describe("useDesktopUpdate", () => {
  it("surfaces an update-available result as a non-null desktop update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.1.12",
            html_url: "https://github.com/P-A-N-52/kimi-code-desktop/releases/tag/v0.1.12",
            prerelease: false,
            draft: false,
          }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useDesktopUpdate());
    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });
    expect(result.current).toEqual({
      currentVersion: "0.1.11",
      latestVersion: "0.1.12",
      releaseUrl: "https://github.com/P-A-N-52/kimi-code-desktop/releases/tag/v0.1.12",
    });
  });

  it("stays null when the release is not newer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            tag_name: "v0.1.11",
            html_url: "https://example.com/desktop",
            prerelease: false,
            draft: false,
          }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useDesktopUpdate());
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
  });
});
