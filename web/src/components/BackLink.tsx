import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useProject } from "@/lib/project";

export function BackLink({ to = "library", label = "Library" }: { to?: string; label?: string }) {
  const { project } = useProject();
  return (
    <Link to={`/p/${project.id}/${to}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}

/** Archive button handler: move the item away and go back to the library. */
export function useArchive(path: string) {
  const { project } = useProject();
  return async (nav: (to: string) => void) => {
    await fetch(`/api/projects/${project.id}/${path}`, { method: "DELETE" });
    nav(`/p/${project.id}/library`);
  };
}
