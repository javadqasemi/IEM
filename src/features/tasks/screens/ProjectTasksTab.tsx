import { useState } from "react";
import { useAuth } from "@/core/auth";
import type { Task } from "@/entities/task";
import { Button } from "@/shared/ui/primitives";
import { useToast } from "@/shared/ui/feedback";
import { TaskBoard } from "./TaskBoard";
import { TaskCreateDialog } from "./TaskCreateDialog";
import { TaskDrawer } from "./TaskDrawer";

/**
 * One project's board, embedded in the project detail's *Aufgaben* tab.
 *
 * **The first of the eight embedded tabs to become real**, replacing its
 * `ModulePlaceholder` — and the seam is the one `docs/enterprise-architecture.md`
 * §4.4.1 describes: a project is a *container*, and the tab is this module
 * rendering its own screen scoped by `projectId`. `features/projects` imports
 * nothing from here; the route table composes the two.
 *
 * That direction is what keeps the modules separable. The alternative — Projects
 * owning a tasks tab — would put a second, smaller task board inside the
 * projects feature, and by the eighth tab the projects feature would contain
 * eight partial copies of eight other modules.
 *
 * **No page header and no filters.** The tab sits inside the project's own
 * shell, which already says which project this is; a second heading would be
 * the same navigation twice. The project *is* the filter.
 */
export function ProjectTasksTab({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {can("task.create") ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            Neue Aufgabe
          </Button>
        </div>
      ) : null}

      <TaskBoard
        query={{ projectId }}
        onOpen={(task: Task) => setOpen(task.id)}
        onCreate={() => setCreating(true)}
      />

      <TaskDrawer id={open} onClose={() => setOpen(null)} />

      {creating ? (
        <TaskCreateDialog
          // Fixed, not picked: the tab already answers which project this is,
          // and asking again is the sort of form people click through without
          // reading — and then file the task against the wrong project.
          projectId={projectId}
          onClose={() => setCreating(false)}
          onCreated={(task) => {
            setCreating(false);
            toast.success("Aufgabe angelegt");
            setOpen(task.id);
          }}
        />
      ) : null}
    </div>
  );
}
