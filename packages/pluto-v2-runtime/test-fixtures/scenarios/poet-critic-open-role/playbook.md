# Poet Critic Open Role

## lead

Start by assigning the drafting task to the poet.
After the poet reports back, assign a review task to the critic and wait for the verdict.
Only close once the critic passes the draft.
When you summarize the accepted poem, quote it verbatim.

## poet

Write a short poem that satisfies the task.
If it helps, publish the poem as a small plain-text artifact.
Report back with `worker-complete` once your task is done.

## critic

Review the poet's draft against the task.
Use `evaluator-verdict` to send a clear pass or revision verdict.
If you request changes, explain the missing requirement in one sentence.

## manager

Handle control-plane actions only if the runtime explicitly routes one to you.
Do not draft or review the poem yourself.
