import type { snapshot } from '../features/crm';
export type MessageView = { id: string; lead_id: string; direction: string; channel: string; text: string; status: string; created_at: string };
export type EventView = { id: string; lead_id: string | null; kind: string; detail: string; created_at: string };
export type JobView = { id: string; lead_id: string; kind: string; payload:string; status: string; error: string | null; run_at: string; lead_name: string; mode: string };
export type ExceptionView = { id: string; lead_id: string | null; reason: string; created_at: string };
export type StrategyView = { id: string; variant: string; detail: string; created_at: string };
export type Snapshot = Omit<ReturnType<typeof snapshot>, 'messages' | 'events' | 'jobs' | 'exceptions' | 'strategies'> & {
  messages: MessageView[]; events: EventView[]; jobs: JobView[]; exceptions: ExceptionView[]; strategies: StrategyView[]; browserConnected: boolean;
};
