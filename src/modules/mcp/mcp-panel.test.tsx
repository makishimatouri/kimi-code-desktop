import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider } from "@/ui/confirm-dialog";
import { McpPanel } from "./mcp-panel";

const mocks = vi.hoisted(() => ({
  getMcpConfigFile: vi.fn(),
  updateMcpConfigFile: vi.fn(),
  notifyTextConfigSaved: vi.fn(),
}));

vi.mock("@/lib/settings-api", () => ({
  getMcpConfigFile: mocks.getMcpConfigFile,
  updateMcpConfigFile: mocks.updateMcpConfigFile,
}));

vi.mock("@/lib/config-update-toast", () => ({
  notifyTextConfigSaved: mocks.notifyTextConfigSaved,
}));

const SAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "linear": {
      "url": "https://mcp.linear.app/mcp",
      "enabled": false
    }
  }
}
`;

function renderPanel(props?: Partial<ComponentProps<typeof McpPanel>>) {
  const onDirtyChange = props?.onDirtyChange ?? vi.fn();
  render(
    <ConfirmDialogProvider>
      <McpPanel enabled onDirtyChange={onDirtyChange} {...props} />
    </ConfirmDialogProvider>,
  );
  return { onDirtyChange };
}

describe("McpPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMcpConfigFile.mockResolvedValue({
      content: SAMPLE,
      path: "/home/user/.kimi-code/mcp.json",
    });
    mocks.updateMcpConfigFile.mockResolvedValue({ success: true, error: null });
  });

  it("loads and renders server cards with transport badges", async () => {
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "filesystem" })).toBeTruthy();
    });
    expect(screen.getByRole("heading", { name: "linear" })).toBeTruthy();
    expect(screen.getByText("stdio")).toBeTruthy();
    expect(screen.getByText("HTTP")).toBeTruthy();
    expect(screen.getByText("npx -y @modelcontextprotocol/server-filesystem /tmp")).toBeTruthy();
    expect(screen.getByText("已启用")).toBeTruthy();
    expect(screen.getByText("已禁用")).toBeTruthy();
    expect(screen.getByText("/home/user/.kimi-code/mcp.json")).toBeTruthy();
  });

  it("toggles a server off and persists the full serialized config", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "filesystem" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("switch", { name: "启用 filesystem" }));

    await waitFor(() => {
      expect(mocks.updateMcpConfigFile).toHaveBeenCalledTimes(1);
    });
    const saved = JSON.parse(mocks.updateMcpConfigFile.mock.calls[0][0] as string);
    expect(saved.mcpServers.filesystem.enabled).toBe(false);
    // Untouched server keeps its exact shape.
    expect(saved.mcpServers.linear).toEqual({
      url: "https://mcp.linear.app/mcp",
      enabled: false,
    });
    await waitFor(() => {
      expect(mocks.notifyTextConfigSaved).toHaveBeenCalled();
    });
  });

  it("rolls back the toggle when saving fails", async () => {
    mocks.updateMcpConfigFile.mockRejectedValue(new Error("disk full"));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "filesystem" })).toBeTruthy();
    });

    const toggle = screen.getByRole("switch", {
      name: "启用 filesystem",
    }) as HTMLButtonElement;
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mocks.updateMcpConfigFile).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(toggle.getAttribute("data-state")).toBe("checked");
    });
  });

  it("deletes a server after confirmation", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "linear" })).toBeTruthy();
    });

    const card = screen.getByRole("heading", { name: "linear" }).closest("section") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.getByText(/确定删除 MCP Server「linear」/)).toBeTruthy();
    });
    const confirmDialog = screen
      .getByText(/确定删除 MCP Server「linear」/)
      .closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(mocks.updateMcpConfigFile).toHaveBeenCalledTimes(1);
    });
    const saved = JSON.parse(mocks.updateMcpConfigFile.mock.calls[0][0] as string);
    expect(Object.keys(saved.mcpServers)).toEqual(["filesystem"]);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "linear" })).toBeNull();
    });
  });

  it("adds a server through the dialog", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "filesystem" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "添加 Server" }));
    fireEvent.change(screen.getByPlaceholderText("例如 filesystem"), {
      target: { value: "github" },
    });
    fireEvent.change(screen.getByPlaceholderText("npx"), {
      target: { value: "uvx" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mocks.updateMcpConfigFile).toHaveBeenCalledTimes(1);
    });
    const saved = JSON.parse(mocks.updateMcpConfigFile.mock.calls[0][0] as string);
    expect(saved.mcpServers.github).toEqual({ command: "uvx" });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "github" })).toBeTruthy();
    });
  });

  it("shows a parse-error state and disables structured editing", async () => {
    mocks.getMcpConfigFile.mockResolvedValue({
      content: "{ not json",
      path: "/home/user/.kimi-code/mcp.json",
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText("mcp.json 解析失败")).toBeTruthy();
    });
    expect(screen.getByText(/JSON 格式错误/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "添加 Server" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the raw editor collapsed by default and reloads after a raw save", async () => {
    const { onDirtyChange } = renderPanel();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "filesystem" })).toBeTruthy();
    });
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByText("展开高级 mcp.json 编辑器（排障）"));
    const editor = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(editor.value).toBe(SAMPLE);

    const updated = SAMPLE.replace('"enabled": false', '"enabled": true');
    fireEvent.change(editor, { target: { value: updated } });
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 mcp.json" }));

    await waitFor(() => {
      expect(mocks.updateMcpConfigFile).toHaveBeenCalledWith(updated);
    });
    // The structured view reloads from the new on-disk truth.
    await waitFor(() => {
      expect(mocks.getMcpConfigFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows an empty state with guidance when no servers exist", async () => {
    mocks.getMcpConfigFile.mockResolvedValue({
      content: '{\n  "mcpServers": {}\n}\n',
      path: "/home/user/.kimi-code/mcp.json",
    });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/尚未配置 MCP Server/)).toBeTruthy();
    });
  });
});
