import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, FolderPlus, Layers, Square, X } from "lucide-react";
import type { FileContent, FileProgress, Note, TreeNode } from "@core/types";
import { get, patch } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { ActionPanel } from "@/components/ActionPanel";
import { CardDialog } from "@/components/CardDialog";
import { CodeView } from "@/components/CodeView";
import { FileTree } from "@/components/FileTree";
import { FolderPicker } from "@/components/FolderPicker";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, Spinner } from "@/components/ui";
import { Compass } from "lucide-react";

export function ExplorePage() {
  const { project, selected, setSelected, toggle, openFile, setOpenFile, focusLine, rel } = useProject();
  const qc = useQueryClient();
  const [addingCtx, setAddingCtx] = useState(false);
  const [carding, setCarding] = useState(false);
  const notes = useQuery({
    queryKey: ["notes", project.id, openFile],
    queryFn: () => get<Note[]>(`/projects/${project.id}/notes?file=${encodeURIComponent(openFile!)}`),
    enabled: !!openFile,
  });
  const noteMarks = useMemo(
    () => (notes.data ?? []).filter((n) => n.line).map((n) => ({ from: n.line!, to: n.line!, cls: "note" })),
    [notes.data],
  );
  const tree = useQuery({ queryKey: ["tree", project.id, project.contexts], queryFn: () => get<TreeNode[]>(`/projects/${project.id}/tree`) });
  const progress = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const file = useQuery({
    queryKey: ["file", project.id, openFile],
    queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(openFile!)}`),
    enabled: !!openFile,
  });
  const setContexts = useMutation({
    mutationFn: (contexts: string[]) => patch(`/projects/${project.id}`, { contexts }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const levels = useMemo(() => new Map((progress.data ?? []).map((p) => [p.path, p.level])), [progress.data]);
  // With nothing ticked, the open file is the context.
  const context = selected.length ? selected : openFile ? [openFile] : [];
  const ticked = openFile ? selected.includes(openFile) : false;

  const left = (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{project.name}</div>
          <div className="truncate font-mono text-[11px] text-muted" title={project.root}>{shortPath(project.root, 30)}</div>
        </div>
        <Button size="sm" variant="ghost" icon={<FolderPlus className="h-4 w-4" />} title="Add a context folder (docs, notes, a session folder)" onClick={() => setAddingCtx(true)} />
      </div>
      {project.contexts.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
          {project.contexts.map((c) => (
            <Badge key={c} tone="accent" className="max-w-full">
              <span className="truncate" title={c}>+ {c.split("/").pop()}</span>
              <button onClick={() => setContexts.mutate(project.contexts.filter((x) => x !== c))} aria-label="Remove context folder">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-accent/5 px-3 py-1.5 text-xs">
          <span className="font-medium text-accent">{selected.length} ticked</span>
          <button className="ml-auto text-muted hover:text-ink" onClick={() => setSelected([])}>clear</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {tree.isLoading && <div className="p-4"><Spinner /></div>}
        {tree.error && <div className="p-3"><ErrorNote error={(tree.error as Error).message} /></div>}
        {tree.data && (
          <FileTree
            roots={tree.data}
            selected={selected}
            onToggle={(paths, on) => (on ? setSelected([...selected, ...paths]) : setSelected(selected.filter((s) => !paths.includes(s))))}
            openFile={openFile}
            onOpen={(p) => setOpenFile(p)}
            levels={levels}
          />
        )}
      </div>
    </div>
  );

  const center = (
    <div className="flex h-full flex-col">
      {openFile ? (
        <>
          <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
            <div className="min-w-0 flex-1 truncate font-mono text-[13px]">{rel(openFile)}</div>
            {file.data && <Badge>{file.data.lang}</Badge>}
            {levels.get(openFile) && levels.get(openFile) !== "new" && (
              <Badge tone={levels.get(openFile) === "understood" ? "good" : levels.get(openFile) === "stale" ? "warn" : "muted"}>{levels.get(openFile)}</Badge>
            )}
            <Button size="sm" variant="ghost" icon={<Layers className="h-3.5 w-3.5" />} title="Make a review card about this file (click a line first to pin it)" onClick={() => setCarding(true)}>
              Card
            </Button>
            <Button size="sm" variant={ticked ? "primary" : "secondary"} icon={ticked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} onClick={() => toggle(openFile)}>
              {ticked ? "In context" : "Add to context"}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-panel">
            {file.isLoading && <div className="p-6"><Spinner /></div>}
            {file.error && <div className="p-4"><ErrorNote error={(file.error as Error).message} /></div>}
            {file.data && (
              <CodeView text={file.data.text} lang={file.data.lang} focusLine={focusLine} marks={noteMarks} onLineClick={(n) => setOpenFile(openFile, n)} />
            )}
            {file.data?.truncated && <div className="p-3 text-xs text-warn">File cut at 400 KB.</div>}
          </div>
        </>
      ) : (
        <Empty icon={<Compass className="h-6 w-6" />} title="Pick a file to read">
          Open a file on the left, or tick several to give the model more context. Then choose a lens, a quiz or a practice on the right.
        </Empty>
      )}
    </div>
  );

  return (
    <>
      <Split
        id="explore-tree"
      collapsible
        className="h-full"
        initial={290}
        left={left}
        right={<Split id="explore-panel" collapsible side="right" initial={360} min={300} max={560} left={center} right={<ActionPanel files={context} practiceFile={openFile} onSetFiles={setSelected} />} />}
      />
      {carding && openFile && <CardDialog initial={{ kind: "own", file: openFile, line: focusLine ?? undefined }} onClose={() => setCarding(false)} />}
      {addingCtx && (
        <FolderPicker
          title="Add a context folder"
          cta="Add as context"
          start={project.root.split("/").slice(0, -1).join("/")}
          onClose={() => setAddingCtx(false)}
          onPick={(p) => {
            setAddingCtx(false);
            setContexts.mutate([...project.contexts, p]);
          }}
        />
      )}
    </>
  );
}
