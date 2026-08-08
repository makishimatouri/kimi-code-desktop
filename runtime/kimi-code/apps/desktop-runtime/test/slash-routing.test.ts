import { describe, expect, it, vi } from 'vitest';

import type { EngineContext } from '../src/engine';
import type { RuntimeHandlerContext } from '../src/handler-context';
import {
  RUNTIME_PROTOCOL,
  type JsonObject,
  type JsonValue,
  type RuntimeRequestFrame,
} from '../src/protocol';
import type { RuntimeMethodHandler } from '../src/router';
import { clearActiveTurns, createTurnHandlers, getActiveTurn } from '../src/turn-router';

interface CollectedEvent {
  readonly sessionId: string;
  readonly event: string;
  readonly payload: JsonValue | undefined;
}

function makeFixture(skills: readonly JsonObject[] = []) {
  const prompt = vi.fn().mockResolvedValue({ turn_id: 41 });
  const activateSkill = vi.fn().mockResolvedValue({ turn_id: 73 });
  const compact = vi.fn().mockResolvedValue(true);
  const getMcpServers = vi.fn().mockResolvedValue([]);
  const setModel = vi.fn().mockResolvedValue(undefined);
  const listSkills = vi.fn().mockResolvedValue(skills);
  const agent = {
    prompt,
    activateSkill,
    compact,
    getMcpServers,
    setModel,
    getPlan: vi.fn().mockResolvedValue(null),
    enterPlan: vi.fn().mockResolvedValue(undefined),
  };
  const session = {
    agent: vi.fn(() => agent),
    skills: { list: listSkills },
  };
  const engine = {
    klient: { session: vi.fn(() => session) },
  } as unknown as EngineContext;
  const events: CollectedEvent[] = [];
  const ctx: RuntimeHandlerContext = {
    adapter: {
      engineContext: engine,
      trackLiveSession: vi.fn(),
      untrackLiveSession: vi.fn(),
    },
    emitSessionEvent: (sessionId, event, payload) => {
      events.push({ sessionId, event, payload });
      return Promise.resolve();
    },
    emitRuntimeEvent: () => Promise.resolve(),
  };
  const handlers = new Map<string, RuntimeMethodHandler>(createTurnHandlers(ctx));
  let requestNo = 0;
  const call = (params: JsonObject): Promise<JsonValue> => {
    const handler = handlers.get('turn.start');
    if (handler === undefined) throw new Error('turn.start handler missing');
    const frame: RuntimeRequestFrame = {
      protocol: RUNTIME_PROTOCOL,
      type: 'request',
      id: `slash-${++requestNo}`,
      method: 'turn.start',
      params,
    };
    return Promise.resolve(handler(frame)).then((result) => {
      if (typeof result === 'symbol') throw new Error('turn.start unexpectedly deferred');
      return result;
    });
  };

  return {
    engine,
    events,
    prompt,
    activateSkill,
    compact,
    getMcpServers,
    setModel,
    listSkills,
    call,
  };
}

describe('desktop runtime slash routing', () => {
  it('keeps ordinary text on agent.prompt', async () => {
    const fixture = makeFixture();
    try {
      await expect(
        fixture.call({
          sessionId: 's-normal',
          requestId: 'r-normal',
          input: 'hello',
          model: 'test/model',
        }),
      ).resolves.toEqual({ requestId: 'r-normal', turnId: 41 });
      expect(fixture.prompt).toHaveBeenCalledOnce();
      expect(fixture.activateSkill).not.toHaveBeenCalled();
      expect(fixture.events).toEqual([]);
      expect(getActiveTurn(fixture.engine, 's-normal')).toEqual({
        requestId: 'r-normal',
        turnId: 41,
      });
    } finally {
      clearActiveTurns(fixture.engine, 's-normal');
    }
  });

  it('runs /compact locally, emits visible content then terminal, and releases the turn', async () => {
    const fixture = makeFixture();
    await expect(
      fixture.call({
        sessionId: 's-compact',
        requestId: 'r-compact',
        input: '/compact keep the plan',
      }),
    ).resolves.toEqual({ requestId: 'r-compact', turnId: null });

    expect(fixture.compact).toHaveBeenCalledWith({ instruction: 'keep the plan' });
    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.activateSkill).not.toHaveBeenCalled();
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      {
        sessionId: 's-compact',
        event: 'content.delta',
        payload: {
          text: 'Context compaction started — it runs in the background and the compacted context applies once it finishes.',
          requestId: 'r-compact',
        },
      },
      {
        sessionId: 's-compact',
        event: 'turn.completed',
        payload: { requestId: 'r-compact' },
      },
    ]);
    expect(getActiveTurn(fixture.engine, 's-compact')).toBeUndefined();
  });

  it('renders /mcp from the agent snapshot without launching a prompt', async () => {
    const fixture = makeFixture();
    fixture.getMcpServers.mockResolvedValue([
      {
        name: 'local-tools',
        transport: 'stdio',
        status: 'connected',
        toolCount: 4,
      },
    ]);
    await fixture.call({ sessionId: 's-mcp', requestId: 'r-mcp', input: '/mcp' });

    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      {
        sessionId: 's-mcp',
        event: 'content.delta',
        payload: {
          text: 'MCP servers (1):\n- local-tools (stdio): connected, 4 tools',
          requestId: 'r-mcp',
        },
      },
      {
        sessionId: 's-mcp',
        event: 'turn.completed',
        payload: { requestId: 'r-mcp' },
      },
    ]);
    expect(getActiveTurn(fixture.engine, 's-mcp')).toBeUndefined();
  });

  it('activates an advertised skill as a real engine turn instead of raw prompt text', async () => {
    const fixture = makeFixture([
      {
        name: 'review',
        description: 'Review code',
        path: '/tmp/review/SKILL.md',
        source: 'user',
      },
    ]);
    try {
      await expect(
        fixture.call({
          sessionId: 's-skill',
          requestId: 'r-skill',
          input: '/skill:review src/app.ts',
          model: 'test/model',
        }),
      ).resolves.toEqual({ requestId: 'r-skill', turnId: 73 });

      expect(fixture.listSkills).toHaveBeenCalledOnce();
      expect(fixture.activateSkill).toHaveBeenCalledWith({
        name: 'review',
        args: 'src/app.ts',
      });
      expect(fixture.prompt).not.toHaveBeenCalled();
      expect(fixture.events).toEqual([]);
      expect(getActiveTurn(fixture.engine, 's-skill')).toEqual({
        requestId: 'r-skill',
        turnId: 73,
      });
    } finally {
      clearActiveTurns(fixture.engine, 's-skill');
    }
  });

  it('answers an unknown slash locally and completes without calling agent.prompt', async () => {
    const fixture = makeFixture();
    await fixture.call({ sessionId: 's-unknown', requestId: 'r-unknown', input: '/does-not-exist' });

    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.activateSkill).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      {
        sessionId: 's-unknown',
        event: 'content.delta',
        payload: {
          text: 'Unknown runtime command: /does-not-exist. Use the slash menu to see available commands.',
          requestId: 'r-unknown',
        },
      },
      {
        sessionId: 's-unknown',
        event: 'turn.completed',
        payload: { requestId: 'r-unknown' },
      },
    ]);
    expect(getActiveTurn(fixture.engine, 's-unknown')).toBeUndefined();
  });

  it('fails mixed slash/media input before any engine action', async () => {
    const fixture = makeFixture();
    await expect(
      fixture.call({
        sessionId: 's-mixed',
        requestId: 'r-mixed',
        input: [
          { type: 'text', text: '/mcp' },
          { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid_slash_input' });
    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.getMcpServers).not.toHaveBeenCalled();
    expect(getActiveTurn(fixture.engine, 's-mixed')).toBeUndefined();
  });
});
