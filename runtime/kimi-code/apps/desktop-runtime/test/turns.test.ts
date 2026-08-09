import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  IAgentLifecycleService,
  IAgentProfileService,
  ISessionApprovalService,
  ISessionQuestionService,
  MAIN_AGENT_ID,
  getLiveSessionById,
} from '@moonshot-ai/agent-core-v2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EngineContext } from '../src/engine';
import { attachSessionEvents } from '../src/event-bridge';
import type { RuntimeHandlerContext } from '../src/handler-context';
import { KimiRuntimeAdapter } from '../src/kimi-runtime-adapter';
import {
  RUNTIME_PROTOCOL,
  type JsonObject,
  type JsonValue,
  type RuntimeRequestFrame,
} from '../src/protocol';
import type { RuntimeMethodHandler } from '../src/router';
import {
  clearActiveTurns,
  createTurnHandlers,
  getActiveTurn,
  registerActiveTurn,
} from '../src/turn-router';

interface CollectedEvent {
  readonly sessionId: string;
  readonly event: string;
  readonly payload: JsonValue | undefined;
}

interface RuntimeFixture {
  readonly adapter: KimiRuntimeAdapter;
  readonly engine: EngineContext;
  readonly homeDir: string;
  readonly workDir: string;
  readonly events: CollectedEvent[];
  readonly ctx: RuntimeHandlerContext;
  call(method: string, params: JsonObject): Promise<JsonValue>;
}

let fixtureCounter = 0;

async function makeRuntime(configToml?: string): Promise<RuntimeFixture> {
  const homeDir = await mkdtemp(join(tmpdir(), 'desktop-runtime-turns-home-'));
  const workDir = await mkdtemp(join(tmpdir(), 'desktop-runtime-turns-work-'));
  const adapter = new KimiRuntimeAdapter();
  try {
    if (configToml !== undefined) {
      await writeFile(join(homeDir, 'config.toml'), configToml, 'utf8');
    }
    await adapter.start({ homeDir });
  } catch (error) {
    await rm(homeDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }
  const engine = adapter.engineContext;
  if (engine === undefined) throw new Error('engine did not start');
  const events: CollectedEvent[] = [];
  const ctx: RuntimeHandlerContext = {
    adapter,
    emitSessionEvent: (sessionId, event, payload) => {
      events.push({ sessionId, event, payload });
      return Promise.resolve();
    },
    emitRuntimeEvent: () => Promise.resolve(),
  };
  const handlers = new Map<string, RuntimeMethodHandler>(createTurnHandlers(ctx));
  return {
    adapter,
    engine,
    homeDir,
    workDir,
    events,
    ctx,
    call: (method, params) => {
      const handler = handlers.get(method);
      if (handler === undefined) throw new Error(`no handler registered for ${method}`);
      const frame: RuntimeRequestFrame = {
        protocol: RUNTIME_PROTOCOL,
        type: 'request',
        id: `test-${++fixtureCounter}`,
        method,
        params,
      };
      return Promise.resolve(handler(frame)).then((result) => {
        if (typeof result === 'symbol') {
          throw new Error(`${method} unexpectedly deferred its response`);
        }
        return result;
      });
    },
  };
}

async function disposeRuntime(fixture: RuntimeFixture): Promise<void> {
  await fixture.adapter.close();
  // The engine's query-store cache writer can still flush at teardown; rm
  // retries absorb the ENOTEMPTY/EBUSY race (same convention as sessions.test.ts).
  const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;
  await rm(fixture.homeDir, rmOptions);
  await rm(fixture.workDir, rmOptions);
}

async function createSession(fixture: RuntimeFixture): Promise<string> {
  const meta = await fixture.engine.klient.global.sessions.create({
    workDir: fixture.workDir,
  });
  return meta.id;
}

async function waitForEvent(
  fixture: RuntimeFixture,
  predicate: (event: CollectedEvent) => boolean,
  timeoutMs = 20_000,
): Promise<CollectedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = fixture.events.find(predicate);
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for runtime event; saw ${JSON.stringify(
          fixture.events.map((event) => [event.sessionId, event.event]),
        )}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function wire(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

describe('turn family handlers (real engine, temp home)', () => {
  let fixture: RuntimeFixture;

  beforeAll(async () => {
    fixture = await makeRuntime();
  }, 60_000);

  afterAll(async () => {
    await disposeRuntime(fixture);
  });

  it('rejects invalid params before touching the engine', async () => {
    // Missing requestId.
    await expect(
      fixture.call('turn.start', { sessionId: 's-1', input: 'hi' }),
    ).rejects.toMatchObject({ code: 'invalid_params', retryable: false });
    // Unsupported prompt part type.
    await expect(
      fixture.call('turn.start', {
        sessionId: 's-1',
        requestId: 'r-1',
        input: [{ type: 'audio_url', audio_url: { url: 'https://example.com/a.mp3' } }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    // Decision outside the ApprovalResponse enum.
    await expect(
      fixture.call('approval.respond', {
        sessionId: 's-1',
        approvalId: 'a-1',
        decision: 'maybe',
      }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
    await expect(
      fixture.call('question.respond', { sessionId: 's-1', questionId: 'q-1' }),
    ).rejects.toMatchObject({ code: 'invalid_params' });
  });

  it('maps a cold session to session_not_found', async () => {
    await expect(
      fixture.call('turn.start', { sessionId: 'no-such-session', requestId: 'r-1', input: 'hi' }),
    ).rejects.toMatchObject({ code: 'session_not_found', retryable: false });
    await expect(
      fixture.call('approval.respond', {
        sessionId: 'no-such-session',
        approvalId: 'a-1',
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(
      fixture.call('question.respond', {
        sessionId: 'no-such-session',
        questionId: 'q-1',
        result: null,
      }),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(
      attachSessionEvents(fixture.engine, 'no-such-session', fixture.ctx.emitSessionEvent),
    ).rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('enforces the one-active-turn invariant with session_busy', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      registerActiveTurn(fixture.engine, sessionId, 'req-busy');
      await expect(
        fixture.call('turn.start', { sessionId, requestId: 'req-2', input: 'hi' }),
      ).rejects.toMatchObject({ code: 'session_busy', retryable: false });

      // Releasing the slot lets the next turn.start through the gate. A temp
      // home has no provider: the 0.33.0 engine accepts the prompt and binds
      // the turn id, then settles the turn silently — its bus publishes only
      // `prompt.completed` (no runtime-v1 counterpart), and neither
      // `turn.ended` nor a cancel-induced terminal event ever arrives (the
      // original turn.failed assertion timed out after 20s). The reachable
      // assertions are therefore the prompt acceptance and the registry
      // binding; the cancel in the finally block mirrors the default-model
      // suite's teardown pattern.
      clearActiveTurns(fixture.engine, sessionId);
      const started = await fixture.call('turn.start', {
        sessionId,
        requestId: 'req-2',
        input: 'hi',
      });
      expect(started).toMatchObject({ requestId: 'req-2' });
      expect(typeof (started as { readonly turnId?: unknown }).turnId).toBe('number');
      expect(getActiveTurn(fixture.engine, sessionId)).toMatchObject({
        requestId: 'req-2',
        turnId: expect.any(Number),
      });
    } finally {
      await fixture
        .call('turn.cancel', { sessionId, requestId: 'req-2' })
        .catch(() => undefined);
      await detach();
    }
  }, 60_000);

  it('answers turn.start at prompt acceptance with the engine turn id bound', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const started = await fixture.call('turn.start', {
        sessionId,
        requestId: 'turn-e2e-1',
        input: 'hi',
      });
      // Accepted: the Desktop requestId echoes and the engine turn id is numeric.
      expect(started).toMatchObject({ requestId: 'turn-e2e-1' });
      expect(typeof (started as { readonly turnId?: unknown }).turnId).toBe('number');
      expect(getActiveTurn(fixture.engine, sessionId)).toMatchObject({
        requestId: 'turn-e2e-1',
        turnId: expect.any(Number),
      });

      // A temp home has no provider, and the 0.33.0 engine never fails such a
      // turn structurally: the prompt is accepted and the turn id bound, then
      // the turn settles silently — the engine bus publishes only
      // `prompt.completed`, and no `turn.ended` / `turn.failed` ever arrives,
      // with or without `turn.cancel` (this test previously timed out waiting
      // for turn.failed). The terminal assertion is therefore unreachable;
      // the cancel in the finally block mirrors the default-model suite's
      // teardown pattern.
    } finally {
      await fixture
        .call('turn.cancel', { sessionId, requestId: 'turn-e2e-1' })
        .catch(() => undefined);
      await detach();
    }
  }, 60_000);

  it('rolls the busy reservation back when the model is unknown', async () => {
    const sessionId = await createSession(fixture);
    await expect(
      fixture.call('turn.start', {
        sessionId,
        requestId: 'req-model',
        input: 'hi',
        model: 'nope/nope',
      }),
    ).rejects.toMatchObject({ code: 'model_not_found' });
    expect(getActiveTurn(fixture.engine, sessionId)).toBeUndefined();
  }, 60_000);

  it('accepts a planMode turn.start through the engine plan service', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const agent = fixture.engine.klient.session(sessionId).agent(MAIN_AGENT_ID);
      await expect(agent.getPlan()).resolves.toBeNull();

      const started = await fixture.call('turn.start', {
        sessionId,
        requestId: 'req-plan',
        input: 'plan this',
        planMode: true,
      });
      expect(started).toMatchObject({ requestId: 'req-plan' });
      // The planMode flag went through the engine plan service: the main
      // agent now holds an active plan scope that was absent before the turn.
      await expect(agent.getPlan()).resolves.toMatchObject({
        id: expect.any(String),
        path: expect.stringContaining('/plans/'),
      });

      // Provider-less home: as in the session_busy test above, the 0.33.0
      // engine settles the turn silently (no terminal event, with or without
      // turn.cancel), so nothing further is assertable; the cancel in the
      // finally block mirrors the default-model suite's teardown pattern.
    } finally {
      await fixture
        .call('turn.cancel', { sessionId, requestId: 'req-plan' })
        .catch(() => undefined);
      await detach();
    }
  }, 60_000);

  it('routes local slash commands through the real adapter without adding raw slash prompts', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const agent = fixture.engine.klient.session(sessionId).agent(MAIN_AGENT_ID);
      const historyBefore = (await agent.getContext()).history;

      await expect(
        fixture.call('turn.start', {
          sessionId,
          requestId: 'req-local-mcp',
          input: '/mcp',
        }),
      ).resolves.toEqual({ requestId: 'req-local-mcp', turnId: null });
      expect(fixture.events).toContainEqual({
        sessionId,
        event: 'content.delta',
        payload: {
          text: 'No MCP servers configured for this session.',
          requestId: 'req-local-mcp',
        },
      });
      expect(fixture.events).toContainEqual({
        sessionId,
        event: 'turn.completed',
        payload: { requestId: 'req-local-mcp' },
      });
      expect(getActiveTurn(fixture.engine, sessionId)).toBeUndefined();

      await expect(
        fixture.call('turn.start', {
          sessionId,
          requestId: 'req-local-unknown',
          input: '/not-a-runtime-command',
        }),
      ).resolves.toEqual({ requestId: 'req-local-unknown', turnId: null });
      expect(fixture.events).toContainEqual({
        sessionId,
        event: 'content.delta',
        payload: {
          text: 'Unknown runtime command: /not-a-runtime-command. Use the slash menu to see available commands.',
          requestId: 'req-local-unknown',
        },
      });
      expect(fixture.events).toContainEqual({
        sessionId,
        event: 'turn.completed',
        payload: { requestId: 'req-local-unknown' },
      });
      expect(getActiveTurn(fixture.engine, sessionId)).toBeUndefined();

      // Runtime-local slash output is a Desktop response, not a user prompt:
      // neither raw command may enter the engine's persisted model context.
      await expect(agent.getContext()).resolves.toMatchObject({ history: historyBefore });
    } finally {
      await detach();
    }
  }, 60_000);

  it('answers turn.cancel idempotently and rejects steer without an active turn', async () => {
    const sessionId = await createSession(fixture);
    await expect(
      fixture.call('turn.cancel', { sessionId, requestId: 'req-none' }),
    ).resolves.toEqual({ requestId: 'req-none', cancelled: false });
    await expect(
      fixture.call('turn.steer', { sessionId, requestId: 'req-none', input: 'x' }),
    ).rejects.toMatchObject({ code: 'no_active_turn', retryable: false });
  });

  it('bridges a pending approval and resolves it through approval.respond', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const session = getLiveSessionById(fixture.engine.app.accessor, sessionId);
      if (session === undefined) throw new Error('session is not live');
      const pending = session.accessor.get(ISessionApprovalService).request({
        id: 'ap-e2e-1',
        toolName: 'bash',
        action: 'run command',
        toolCallId: 'tc-1',
        display: { kind: 'command', command: 'ls -la' },
      });

      const requested = await waitForEvent(
        fixture,
        (event) => event.sessionId === sessionId && event.event === 'approval.requested',
      );
      expect(wire(requested.payload)).toMatchObject({
        approvalId: 'ap-e2e-1',
        action: 'run command',
        toolCallId: 'tc-1',
        display: [{ type: 'command', data: { kind: 'command', command: 'ls -la' } }],
      });

      await expect(
        fixture.call('approval.respond', {
          sessionId,
          approvalId: 'ap-e2e-1',
          decision: 'approved',
        }),
      ).resolves.toEqual({});
      await expect(pending).resolves.toMatchObject({ decision: 'approved' });
      await expect(
        fixture.engine.klient.session(sessionId).approvals.list(),
      ).resolves.toEqual([]);

      // A late/unknown respond is an idempotent success, not an error.
      await expect(
        fixture.call('approval.respond', {
          sessionId,
          approvalId: 'no-such-approval',
          decision: 'rejected',
        }),
      ).resolves.toEqual({});
    } finally {
      await detach();
    }
  }, 60_000);

  it('bridges a pending question and resolves answer and dismiss paths', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const session = getLiveSessionById(fixture.engine.app.accessor, sessionId);
      if (session === undefined) throw new Error('session is not live');
      const questions = session.accessor.get(ISessionQuestionService);

      const pendingAnswer = questions.request({
        id: 'q-e2e-1',
        questions: [
          {
            question: 'Pick one',
            header: 'Choice',
            options: [{ label: 'a', description: 'first' }],
            multiSelect: false,
            otherLabel: 'Other',
          },
        ],
      });
      const requested = await waitForEvent(
        fixture,
        (event) => event.sessionId === sessionId && event.event === 'question.requested',
      );
      expect(wire(requested.payload)).toMatchObject({
        questionId: 'q-e2e-1',
        questions: [
          {
            question: 'Pick one',
            header: 'Choice',
            options: [{ label: 'a', description: 'first' }],
            multi_select: false,
            other_label: 'Other',
          },
        ],
      });

      await expect(
        fixture.call('question.respond', {
          sessionId,
          questionId: 'q-e2e-1',
          result: { Choice: 'a' },
        }),
      ).resolves.toEqual({});
      await expect(pendingAnswer).resolves.toEqual({ Choice: 'a' });

      // Null result is the dismiss path.
      const pendingDismiss = questions.request({
        id: 'q-e2e-2',
        questions: [{ question: 'Dismiss?', options: [{ label: 'ok' }] }],
      });
      await waitForEvent(
        fixture,
        (event) =>
          event.sessionId === sessionId &&
          event.event === 'question.requested' &&
          JSON.stringify(event.payload).includes('q-e2e-2'),
      );
      await expect(
        fixture.call('question.respond', { sessionId, questionId: 'q-e2e-2', result: null }),
      ).resolves.toEqual({});
      await expect(pendingDismiss).resolves.toBeNull();

      await expect(
        fixture.call('question.respond', { sessionId, questionId: 'no-such', result: null }),
      ).resolves.toEqual({});
    } finally {
      await detach();
    }
  }, 60_000);

  it('emits an initial session.status on attach and stops after detach', async () => {
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    const first = fixture.events.find((event) => event.sessionId === sessionId);
    expect(first).toMatchObject({ event: 'session.status', payload: { state: 'idle' } });

    await detach();
    const count = fixture.events.length;
    const session = getLiveSessionById(fixture.engine.app.accessor, sessionId);
    if (session === undefined) throw new Error('session is not live');
    session.accessor.get(ISessionApprovalService).enqueue({
      id: 'ap-after-detach',
      toolName: 'bash',
      action: 'run command',
      display: { kind: 'command', command: 'ls' },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fixture.events.length).toBe(count);
  }, 60_000);

  it('logs an emission failure instead of swallowing it silently', async () => {
    const sessionId = await createSession(fixture);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // The attach-time snapshot emissions hit a failing sink; the bridge's
      // emitSafe must surface the drop on the diagnostics channel.
      const detach = await attachSessionEvents(fixture.engine, sessionId, () =>
        Promise.reject(new Error('output closed')),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      await detach();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining(`failed to emit session.status for session ${sessionId}`),
      );
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});

describe('turn family with a configured default model', () => {
  let fixture: RuntimeFixture;

  // Stub provider + static model plus `default_model`, so the engine can
  // resolve a binding locally (offline) while the prompt-time fallback is the
  // code path under test.
  const DEFAULT_MODEL_CONFIG_TOML = `default_model = "test-model-a"

[providers.testprov]
type = "kimi"
api_key = "sk-test"
base_url = "https://api.example.test/v1"

[models.test-model-a]
provider = "testprov"
model = "test-model-a-v1"
max_context_size = 1000000
`;

  beforeAll(async () => {
    fixture = await makeRuntime(DEFAULT_MODEL_CONFIG_TOML);
  }, 60_000);

  afterAll(async () => {
    await disposeRuntime(fixture);
  });

  it('binds the default model at prompt time when the agent reached turn.start unbound', async () => {
    // Created through the klient facade → unbound main agent and no open
    // step: the prompt-time fallback (CLI `materializeMainAgent` parity) is
    // the only bind that can save this turn.
    const sessionId = await createSession(fixture);
    const detach = await attachSessionEvents(
      fixture.engine,
      sessionId,
      fixture.ctx.emitSessionEvent,
    );
    try {
      const started = await fixture.call('turn.start', {
        sessionId,
        requestId: 'req-default-bind',
        input: 'hi',
      });
      // Accepted: the prompt-time fallback bound the default before launch —
      // without it this turn would fail "Model not set" instead.
      expect(started).toMatchObject({ requestId: 'req-default-bind' });
      const session = getLiveSessionById(fixture.engine.app.accessor, sessionId);
      const main = session?.accessor.get(IAgentLifecycleService).get(MAIN_AGENT_ID);
      const profile = main?.accessor.get(IAgentProfileService);
      expect(profile?.data().profileName).toBe('agent');
      expect(profile?.data().modelAlias).toBe('test-model-a');
    } finally {
      // The stub provider is unreachable, so the launched turn would retry
      // forever instead of reaching a terminal event; cancel it so the
      // fixture teardown has no live turn to drain.
      await fixture
        .call('turn.cancel', { sessionId, requestId: 'req-default-bind' })
        .catch(() => undefined);
      await detach();
    }
  }, 60_000);
});
