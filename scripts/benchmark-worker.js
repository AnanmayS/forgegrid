import { executeTask } from "../server/task-definitions.js";

process.on("message", async (message) => {
  if (message?.type !== "run-task") return;
  const started = performance.now();
  try {
    const output = await executeTask(
      message.task,
      message.dependencyArtifacts,
      { workScale: message.workScale }
    );
    process.send?.({
      type: "task-completed",
      taskName: message.task.name,
      durationMs: performance.now() - started,
      output
    });
  } catch (error) {
    process.send?.({
      type: "task-failed",
      taskName: message.task?.name,
      message: error.message
    });
  }
});

process.send?.({ type: "ready" });
