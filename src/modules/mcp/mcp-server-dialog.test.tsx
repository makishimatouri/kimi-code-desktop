import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { McpServerEntry } from "./mcp-config";
import { McpServerDialog } from "./mcp-server-dialog";

function renderDialog({
  editing = null,
  existingNames = [],
  onSubmit = vi.fn<(entry: McpServerEntry) => Promise<void>>().mockResolvedValue(undefined),
  onOpenChange = vi.fn(),
}: {
  editing?: McpServerEntry | null;
  existingNames?: string[];
  onSubmit?: Mock<(entry: McpServerEntry) => Promise<void>>;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  render(
    <McpServerDialog
      open
      onOpenChange={onOpenChange}
      existingNames={existingNames}
      editing={editing}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

const STDIO_ENTRY: McpServerEntry = {
  name: "filesystem",
  transport: "stdio",
  enabled: true,
  summary: "npx -y pkg",
  raw: {
    command: "npx",
    args: ["-y", "pkg"],
    env: { API_KEY: "x" },
    startupTimeoutMs: 60000,
  },
};

describe("McpServerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates stdio command before submitting", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "s1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/需要填写启动命令/)).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects duplicate names when adding", async () => {
    const { onSubmit } = renderDialog({ existingNames: ["filesystem"] });
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "filesystem" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "uvx" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/同名 server/)).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates the URL for HTTP servers", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "remote" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HTTP" }));
    fireEvent.change(screen.getByPlaceholderText("https://mcp.example.com/mcp"), {
      target: { value: "not a url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/URL 格式不正确/)).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects malformed KEY=VALUE lines", async () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "s1" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "uvx" } });
    fireEvent.change(screen.getByPlaceholderText("API_KEY=..."), {
      target: { value: "NO_EQUALS_SIGN" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText(/「NO_EQUALS_SIGN」格式不正确/)).toBeTruthy();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a stdio server built from the form and closes", async () => {
    const { onSubmit, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "fs" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "npx" } });
    fireEvent.change(screen.getByPlaceholderText(/server-filesystem/), {
      target: { value: "-y\npkg" },
    });
    fireEvent.change(screen.getByPlaceholderText("API_KEY=..."), {
      target: { value: "A=1\nB=two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const entry = onSubmit.mock.calls[0][0];
    expect(entry.name).toBe("fs");
    expect(entry.transport).toBe("stdio");
    expect(entry.raw).toEqual({
      command: "npx",
      args: ["-y", "pkg"],
      env: { A: "1", B: "two" },
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("prefills the form when editing and preserves unknown keys", async () => {
    const { onSubmit } = renderDialog({ editing: STDIO_ENTRY });

    const nameInput = screen.getByPlaceholderText("例如 filesystem") as HTMLInputElement;
    expect(nameInput.value).toBe("filesystem");
    expect(nameInput.disabled).toBe(true);
    expect((screen.getByPlaceholderText("npx") as HTMLInputElement).value).toBe("npx");
    expect(screen.getByDisplayValue("API_KEY=x")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0].raw).toEqual(STDIO_ENTRY.raw);
  });

  it("drops transport-specific keys when switching transport while editing", async () => {
    const { onSubmit } = renderDialog({ editing: STDIO_ENTRY });

    fireEvent.click(screen.getByRole("button", { name: "HTTP" }));
    fireEvent.change(screen.getByPlaceholderText("https://mcp.example.com/mcp"), {
      target: { value: "https://mcp.example.com/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0][0].raw).toEqual({
      url: "https://mcp.example.com/mcp",
      startupTimeoutMs: 60000,
    });
  });

  it("keeps the dialog open and shows the error when submit fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("native write failed"));
    const { onOpenChange } = renderDialog({ onSubmit });
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "fs" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "npx" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("native write failed")).toBeTruthy();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
