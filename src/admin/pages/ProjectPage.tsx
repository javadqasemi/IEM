import { ProjectDetailRoute } from "@/features/projects";
import { ProjectTasksTab } from "@/features/tasks";
import { ProjectMeetingsTab } from "@/features/meetings";

/**
 * The project view, with the other modules' tabs composed into it.
 *
 * **The only layer that may put two features together**, and the reason it is a
 * page in `admin/` rather than a widget: `features/projects` must not import
 * `features/tasks`, and `widgets/` may not import a feature at all —
 * `src/architecture.test.ts` enforces both arrows. The shell is above both, so
 * it is the one place the composition is legal.
 *
 * That constraint is not bureaucracy. It is what makes "das Projekt ist der
 * Container, nicht der Besitzer" (`docs/enterprise-architecture.md` §4.4.1) a
 * property of the build rather than a sentence in a document: the projects
 * feature cannot accumulate a piece of every other module, because it cannot
 * name one.
 *
 * **This map is the roadmap, in code.** Each of the eight embedded tabs gets a
 * line here as its module is built; until then the slug is absent and
 * `ProjectDetail` renders `ModulePlaceholder`. Adding Sitzungen was one import
 * and one line, exactly as the note here predicted — and nothing in
 * `features/projects` changed at all, which is the claim this arrangement was
 * making and had not yet been asked to keep.
 */
const EMBEDDED = {
  aufgaben: ProjectTasksTab,
  sitzungen: ProjectMeetingsTab,
};

export function ProjectPage({ projectId }: { projectId: string }) {
  return <ProjectDetailRoute projectId={projectId} embedded={EMBEDDED} />;
}
