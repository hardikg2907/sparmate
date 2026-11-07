import { describe, expect, it } from "vitest";
import { baseOptions, StderrTail } from "./claude-driver";
import type { RoleName, RoleSetup, RoomTool } from "./driver";
import { memoryLogger } from "./log";

describe("claude driver role tool isolation", () => {
  const dummyTool: RoomTool = {
    name: "dummy_tool",
    description: "a dummy tool",
    shape: {},
    run: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };

  const dummyOpts = {
    cwd: "/tmp",
    log: memoryLogger(),
    clientApp: "test/1.0",
  };

  const standardRoles: RoleName[] = ["interviewer", "guide", "tester", "judge", "coach", "scribe", "checker"];

  it("assigns empty builtin tools and configures MCP server for standard roles", () => {
    for (const role of standardRoles) {
      const setup: RoleSetup = {
        role,
        model: "claude-sonnet-5-5",
        effort: "low",
        fake: {},
        systemPrompt: async () => "You are an assistant.",
        tools: [dummyTool],
      };

      const options = baseOptions(setup, dummyOpts, "You are an assistant.", new AbortController(), new StderrTail(dummyOpts.log, role));
      expect(options.tools).toEqual([]);
      expect(options.allowedTools).toEqual(["mcp__room__dummy_tool"]);
      expect(options.mcpServers).toBeDefined();
      expect(Object.keys(options.mcpServers || {})).toContain("room");
      expect(options.hooks).toBeUndefined();
    }
  });

  it("assigns only WebSearch and WebFetch without MCP servers to brief-writer and brief-checker", () => {
    for (const role of ["brief-writer", "brief-checker"] as RoleName[]) {
      const setup: RoleSetup = {
        role,
        model: "claude-sonnet-5-5",
        effort: "low",
        fake: {},
        systemPrompt: async () => "You are a researcher.",
        tools: [dummyTool],
      };

      const options = baseOptions(setup, dummyOpts, "You are a researcher.", new AbortController(), new StderrTail(dummyOpts.log, role));
      expect(options.tools).toEqual(["WebSearch", "WebFetch"]);
      expect(options.allowedTools).toEqual(["WebSearch", "WebFetch"]);
      expect(options.mcpServers).toEqual({});
      expect(options.hooks).toBeDefined();
      expect(options.hooks?.PreToolUse).toBeDefined();
    }
  });
});
