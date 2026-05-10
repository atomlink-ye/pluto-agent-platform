import type { ProtocolRequest } from '@pluto/v2-core/protocol-request';

type MutatingIntent = Extract<
  ProtocolRequest['intent'],
  'create_task' | 'change_task_state' | 'append_mailbox_message' | 'publish_artifact' | 'complete_run'
>;

type MutationRequest<K extends MutatingIntent = MutatingIntent> = Extract<ProtocolRequest, { intent: K }>;

export type AgenticMutation = {
  [K in MutatingIntent]: {
    kind: K;
    payload: MutationRequest<K>['payload'];
  };
}[MutatingIntent];
