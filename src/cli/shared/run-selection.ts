export function buildRunSelection(flags: {
  scenario: string;
  runProfile?: string;
  playbook?: string;
  task?: string;
  runtimeTask?: string;
}): { scenario: string; runProfile?: string; playbook?: string; runtimeTask?: string } {
  const runtimeTask = flags.runtimeTask ?? flags.task;

  return {
    scenario: flags.scenario,
    ...(flags.runProfile ? { runProfile: flags.runProfile } : {}),
    ...(flags.playbook ? { playbook: flags.playbook } : {}),
    ...(runtimeTask ? { runtimeTask } : {}),
  };
}
