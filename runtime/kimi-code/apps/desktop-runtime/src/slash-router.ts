/**
 * Desktop-owned slash routing for `turn.start`.
 *
 * Runtime slash input must never fall through to the model as raw `/...`
 * text. The router recognizes the two runtime-local builtins the Desktop
 * advertises (`/compact`, `/mcp`), resolves the live session skill catalog,
 * and returns a local unknown-command notice for everything else. The caller
 * owns runtime-v1 turn correlation and event emission.
 */

import {
  isUserActivatableSkillType,
  type SkillSummary,
} from '@moonshot-ai/agent-core-v2';

import { RuntimeRequestError } from './protocol';
import type { TurnStartParams } from './protocol-schemas';

export interface RuntimeMcpServerSnapshot {
  readonly name: string;
  readonly transport: string;
  readonly status: string;
  readonly toolCount: number;
  readonly error?: string;
}

/** Engine operations selected by the slash router. Structural for focused tests. */
export interface RuntimeSlashActions<TLaunch> {
  listSkills(): Promise<readonly SkillSummary[]>;
  launchPrompt(): Promise<TLaunch>;
  launchSkill(name: string, args?: string): Promise<TLaunch>;
  compact(instruction?: string): Promise<boolean>;
  getMcpServers(): Promise<readonly RuntimeMcpServerSnapshot[]>;
}

export type RuntimeTurnRouteResult<TLaunch> =
  | { readonly kind: 'launch'; readonly launched: TLaunch }
  | { readonly kind: 'local'; readonly text: string };

interface ParsedSlashCommand {
  readonly name: string;
  readonly args: string;
}

const RUNTIME_BUILTIN_NAMES = new Set(['compact', 'mcp']);

/**
 * Route one complete runtime turn input. Ordinary input launches the normal
 * prompt. Every leading slash is consumed here: builtin, skill, or a local
 * unknown notice. It therefore cannot reach `launchPrompt` accidentally.
 */
export async function routeRuntimeTurnInput<TLaunch>(
  input: TurnStartParams['input'],
  actions: RuntimeSlashActions<TLaunch>,
): Promise<RuntimeTurnRouteResult<TLaunch>> {
  const slash = leadingSlashCommand(input);
  if (slash === null) {
    return { kind: 'launch', launched: await actions.launchPrompt() };
  }

  if (slash.name === 'compact') {
    try {
      const started = await actions.compact(slash.args.length === 0 ? undefined : slash.args);
      return {
        kind: 'local',
        text: started
          ? 'Context compaction started — it runs in the background and the compacted context applies once it finishes.'
          : 'A context compaction is already running.',
      };
    } catch (error) {
      return { kind: 'local', text: `/compact failed: ${errorMessage(error)}` };
    }
  }

  if (slash.name === 'mcp') {
    try {
      return { kind: 'local', text: mcpStatusText(await actions.getMcpServers()) };
    } catch (error) {
      return { kind: 'local', text: `/mcp failed: ${errorMessage(error)}` };
    }
  }

  let skills: readonly SkillSummary[];
  try {
    skills = await actions.listSkills();
  } catch (error) {
    return {
      kind: 'local',
      text: `Unable to resolve runtime slash command /${slash.name}: ${errorMessage(error)}`,
    };
  }
  const skillName = resolveSkillCommand(skills, slash.name);
  if (skillName !== undefined) {
    return {
      kind: 'launch',
      launched: await actions.launchSkill(
        skillName,
        slash.args.length === 0 ? undefined : slash.args,
      ),
    };
  }

  const displayedName = slash.name.length === 0 ? '/' : `/${slash.name}`;
  return {
    kind: 'local',
    text: `Unknown runtime command: ${displayedName}. Use the slash menu to see available commands.`,
  };
}

/**
 * Return a parsed leading command, or null for ordinary input. A slash mixed
 * with media/additional parts is rejected instead of silently discarding the
 * extra input or leaking the slash text to the model.
 */
function leadingSlashCommand(input: TurnStartParams['input']): ParsedSlashCommand | null {
  let text: string;
  if (typeof input === 'string') {
    text = input.trim();
  } else {
    const first = input[0];
    if (first?.type !== 'text' || first.text === undefined) return null;
    text = first.text.trim();
    if (!text.startsWith('/')) return null;
    if (input.length !== 1) {
      throw new RuntimeRequestError(
        'invalid_slash_input',
        'Runtime slash commands must be sent as one text input without media or additional parts.',
        false,
      );
    }
  }
  if (!text.startsWith('/')) return null;

  const body = text.slice(1).trim();
  if (body.length === 0) return { name: '', args: '' };
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  const args = separator === -1 ? '' : body.slice(separator + 1).trim();
  return { name, args };
}

/** Mirror the command names published by event-bridge's skill palette. */
function resolveSkillCommand(
  skills: readonly SkillSummary[],
  commandName: string,
): string | undefined {
  const commandMap = new Map<string, string>();
  for (const skill of skills) {
    if (!isUserActivatableSkillType(skill.type)) continue;
    const name =
      skill.source === 'builtin' || skill.isSubSkill === true
        ? skill.name
        : `skill:${skill.name}`;
    // Runtime-local builtins always win a name collision.
    if (RUNTIME_BUILTIN_NAMES.has(name)) continue;
    commandMap.set(name, skill.name);
  }
  return commandMap.get(commandName) ?? commandMap.get(`skill:${commandName}`);
}

function mcpStatusText(servers: readonly RuntimeMcpServerSnapshot[]): string {
  if (servers.length === 0) return 'No MCP servers configured for this session.';
  const lines = servers.map((server) => {
    const line = `- ${server.name} (${server.transport}): ${server.status}, ${server.toolCount} tools`;
    return server.error !== undefined && server.error !== '' ? `${line} — ${server.error}` : line;
  });
  return [`MCP servers (${servers.length}):`, ...lines].join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
