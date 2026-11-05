import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, X } from "lucide-react";
import type { TreeNode } from "@core/types";
import { get, patch } from "@/lib/api";
import { useProject } from "@/lib/project";
import { FileTree } from "./FileTree";
import { FolderPicker } from "./FolderPicker";
import { Button, ErrorNote, Spinner } from "./ui";

/**
 * Pick context files from every folder of the project (main folder and context folders),
 * and add a new context folder (for example a session or docs folder) on the spot.
 * Returns the full ticked list.
 */
export function ContextPicker({ current, onApply, onClose }: { current: string[]; onApply: (paths: string[]) => void; onClose: () => void }) {
  const { project } = useProject();
  const qc = useQueryClient();
  const [ticked, setTicked] = useState<string[]>(current);
  const [open, setOpen] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const tree = useQuery({ queryKey: ["tree", project.id, project.contexts], queryFn: () => get<TreeNode[]>(`/projects/${project.id}/tree`) });
  const addFolder = useMutation({
    mutationFn: (path: string) => patch(`/projects/${project.id}`, { contexts: [...project.contexts, path] }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex h-[80vh] w-full max-w-xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Add context</h2>
          <span className="text-xs text-muted">{ticked.length} ticked</span>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span className="flex-1">Tick files from the project or its context folders. The model reads them next to the change.</span>
          <Button size="sm" icon={<FolderPlus className="h-3.5 w-3.5" />} onClick={() => setAddingFolder(true)}>
            Add a folder
          </Button>
        </div>
        {addFolder.error && <div className="p-2"><ErrorNote error={(addFolder.error as Error).message} /></div>}
        <div className="min-h-0 flex-1">
          {tree.isLoading && <div className="p-4"><Spinner /></div>}
          {tree.data && (
            <FileTree
              roots={tree.data}
              selected={ticked}
              onToggle={(paths, on) => setTicked(on ? [...new Set([...ticked, ...paths])] : ticked.filter((t) => !paths.includes(t)))}
              openFile={open}
              onOpen={(p) => {
                setOpen(p);
                setTicked(ticked.includes(p) ? ticked.filter((t) => t !== p) : [...ticked, p]);
              }}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(ticked);
              onClose();
            }}
          >
            Use {ticked.length} file{ticked.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
      {addingFolder && (
        <div onClick={(e) => e.stopPropagation()}>
          <FolderPicker
            title="Add a context folder"
            cta="Add as context"
            start={project.root.split("/").slice(0, -1).join("/")}
            onClose={() => setAddingFolder(false)}
            onPick={(p) => {
              setAddingFolder(false);
              addFolder.mutate(p);
            }}
          />
        </div>
      )}
    </div>
  );
}
