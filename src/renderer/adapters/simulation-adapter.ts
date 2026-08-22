import type { AdapterEvent } from '../../shared/adapter-events';

const connectionId = 'desky-simulation';

function eventContext(turnId?: string) {
  return {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    connectionId,
    sessionId: 'simulation-session',
    turnId,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export class SimulationAdapter {
  async *connect(): AsyncGenerator<AdapterEvent> {
    await delay(250);
    yield {
      ...eventContext(),
      type: 'connection.ready',
      payload: { runtimeName: 'Simulation' },
    };
  }

  async *run(prompt: string): AsyncGenerator<AdapterEvent> {
    const turnId = crypto.randomUUID();

    yield {
      ...eventContext(turnId),
      type: 'user.input.accepted',
      payload: { summary: prompt.slice(0, 80) },
    };
    await delay(450);
    yield {
      ...eventContext(turnId),
      type: 'agent.thinking',
      payload: { status: 'Planning the next safe step' },
    };
    await delay(700);
    yield {
      ...eventContext(turnId),
      type: 'tool.started',
      payload: { toolName: 'Workspace', safeSummary: 'Inspecting the project' },
    };
    await delay(900);
    yield {
      ...eventContext(turnId),
      type: 'tool.completed',
      payload: { toolName: 'Workspace', safeSummary: 'Project inspection complete' },
    };
    await delay(450);

    for (const text of ['I found the path forward. ', 'The companion loop is working.']) {
      yield {
        ...eventContext(turnId),
        type: 'assistant.delta',
        payload: { text },
      };
      await delay(350);
    }

    yield {
      ...eventContext(turnId),
      type: 'turn.completed',
      payload: { summary: 'Simulation completed' },
    };
  }
}
