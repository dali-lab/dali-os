import { createReactBlockSpec } from "@blocknote/react";
import { TaskBlockView } from "../task/TaskBlockView";
import { useDocProjectId } from "../task/task-block-context";
import { taskConfig } from "./configs";

function TaskBlock({ taskId, projectId, label, editable }: { taskId: string; projectId: string; label: string; editable: boolean }) {
  const docProjectId = useDocProjectId();
  return <TaskBlockView taskId={taskId} projectId={projectId} label={label} editable={editable} docProjectId={docProjectId} />;
}

const createTaskBlock = createReactBlockSpec(taskConfig, {
  // Hands clicks to the chips instead of ProseMirror, which would select the
  // block and close their pickers. The side menu still moves and deletes it.
  meta: { selectable: false },
  render: (props) => (
    <TaskBlock
      taskId={props.block.props.taskId}
      projectId={props.block.props.projectId}
      label={props.block.props.label}
      editable={props.editor.isEditable}
    />
  ),
});

export const TaskSpec = createTaskBlock();
