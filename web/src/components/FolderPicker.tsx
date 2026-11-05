import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Folder, GitBranch, X } from "lucide-react";
import { get } from "@/lib/api";
import { Button, ErrorNote, Spinner } from "./ui";

interface Listing {
  path: string;
  parent: string | null;
  dirs: string[];
  isGit: boolean;
}

/** Server-side folder browser (a browser page cannot read real paths itself). */
export function FolderPicker({
  title, start, onPick, onClose, cta = "Open this folder",
}: { title: string; start?: string; onPick: (path: string) => void; onClose: () => void; cta?: string }) {
  const [path, setPath] = useState(start ?? "");
  const [typed, setTyped] = useState(start ?? "");
  const q = useQuery({
    queryKey: ["browse", path],
    queryFn: () => get<Listing>(`/browse?path=${encodeURIComponent(path)}`),
  });
  const here = q.data?.path ?? path;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="flex gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPath(typed);
          }}
        >
          <input className="input font-mono text-xs" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="/path/to/folder" />
          <Button type="submit">Go</Button>
        </form>
        <div className="min-h-[240px] flex-1 overflow-auto p-2">
          {q.isLoading && <div className="p-4"><Spinner /></div>}
          {q.error && <div className="p-2"><ErrorNote error={(q.error as Error).message} /></div>}
          {q.data && (
            <>
              {q.data.parent && (
                <button className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted hover:bg-raised" onClick={() => { setPath(q.data!.parent!); setTyped(q.data!.parent!); }}>
                  <ArrowUp className="h-4 w-4" /> ..
                </button>
              )}
              {q.data.dirs.map((d) => {
                const p = `${q.data!.path.replace(/\/$/, "")}/${d}`;
                return (
                  <button key={d} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-raised" onDoubleClick={() => onPick(p)} onClick={() => { setPath(p); setTyped(p); }}>
                    <Folder className="h-4 w-4 text-accent/80" /> {d}
                  </button>
                );
              })}
              {!q.data.dirs.length && <div className="px-3 py-6 text-center text-sm text-muted">No sub-folders.</div>}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={here}>
            {q.data?.isGit && <GitBranch className="mr-1 inline h-3.5 w-3.5 text-good" />}
            {here}
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!q.data} onClick={() => onPick(here)}>{cta}</Button>
        </div>
      </div>
    </div>
  );
}
