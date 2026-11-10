import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import type { DiffFile, DiffSpec, GitRepo } from "@core/types";
import { get } from "@/lib/api";
import { useProject } from "@/lib/project";
import { ActionPanel } from "@/components/ActionPanel";
import { Combobox, type ComboOption } from "@/components/Combobox";
import { DiffView } from "@/components/DiffView";
import { FileTree } from "@/components/FileTree";
import { treeFromPaths } from "@/lib/tree";
import { Split } from "@/components/Split";
import { Empty, ErrorNote, Segmented, Spinner } from "@/components/ui";

interface Refs {
  branches: string[];
  commits: { sha: string; subject: string; when: string }[];
  current: string;
}

const STATUS_TONE: Record<DiffFile["status"], string> = {
  added: "text-good",
  deleted: "text-bad",
  modified: "text-warn",
  renamed: "text-accent",
};

/** A change between two refs (or the working tree): read the diff, then lens or quiz the change itself. */
export function ChangesPage() {
  const { project, rel } = useProject();
  const repos = useQuery({ queryKey: ["repos", project.id, project.contexts], queryFn: () => get<GitRepo[]>(`/projects/${project.id}/repos`) });
  const repoKey = `learnforge.repo.${project.id}`;
  const [spec, setSpec] = useState<DiffSpec>(() => {
    let repo: string | undefined;
    try {
      repo = sessionStorage.getItem(repoKey) || undefined;
    } catch {
      /* ignore */
    }
    return { repo, base: "HEAD", head: "" };
  });
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Files outside the diff added as context (docs, a session folder...). */
  const [extra, setExtra] = useState<string[]>([]);
  const [mode, setMode] = useState<"split" | "unified">("split");

  // Use the remembered repo if it is still in the list, else the first one.
  const list = repos.data ?? [];
  const repo = list.find((r) => r.path === spec.repo) ?? list[0];
  useEffect(() => {
    if (repo && repo.path !== spec.repo) setSpec((s) => ({ ...s, repo: repo.path }));
  }, [repo, spec.repo]);
  const pickRepo = (path: string) => {
    try {
      sessionStorage.setItem(repoKey, path);
    } catch {
      /* ignore */
    }
    // Refs differ per repo, so start again from HEAD vs the working tree.
    setSpec({ repo: path, base: "HEAD", head: "" });
  };

  const ready = !!repo && spec.repo === repo.path;
  const q = (extra: string) => `/projects/${project.id}/${extra}${extra.includes("?") ? "&" : "?"}repo=${encodeURIComponent(spec.repo ?? "")}`;
  const refs = useQuery({ queryKey: ["refs", project.id, spec.repo], queryFn: () => get<Refs>(q("refs")), enabled: ready });
  const diff = useQuery({
    queryKey: ["diff", project.id, spec],
    queryFn: () => get<DiffFile[]>(q(`diff?base=${encodeURIComponent(spec.base)}&head=${encodeURIComponent(spec.head)}`)),
    enabled: ready,
  });

  const files = diff.data ?? [];
  useEffect(() => {
    setPicked(new Set(files.map((f) => f.path)));
    setActive((a) => (a && files.some((f) => f.path === a) ? a : files[0]?.path ?? null));
  }, [diff.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFile = useMemo(() => files.find((f) => f.path === active), [files, active]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const tree = useMemo(() => (spec.repo ? treeFromPaths(spec.repo, files.map((f) => f.path)) : []), [spec.repo, files]);

  if (repos.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!list.length) {
    return (
      <Empty icon={<GitCompare className="h-6 w-6" />} title="No git repositories found">
        Changes needs git history. No repo was found in this folder or its sub-folders (4 levels down). Explore, lenses and quizzes work without it.
      </Empty>
    );
  }

  const refOptions: ComboOption[] = [
    { value: "HEAD", label: "HEAD", hint: refs.data?.current, group: "Current" },
    ...(refs.data?.branches ?? []).map((b) => ({ value: b, label: b, group: "Branches" })),
    ...(refs.data?.commits ?? []).map((c) => ({ value: c.sha, label: `${c.sha} ${c.subject}`, hint: c.when, group: "Recent commits" })),
  ];

  const left = (
    <div className="flex h-full flex-col bg-side">
      <div className="space-y-2 border-b border-line p-3">
        {list.length > 1 && (
          <div>
            <div className="label">Repository ({list.length})</div>
            <Combobox
              value={repo?.path ?? ""}
              onChange={pickRepo}
              options={list.map((r) => ({ value: r.path, label: r.name, hint: r.branch }))}
            />
          </div>
        )}
        <div>
          <div className="label">From</div>
          <Combobox value={spec.base} onChange={(v) => setSpec({ ...spec, base: v })} options={refOptions} />
        </div>
        <div>
          <div className="label">To</div>
          <Combobox
            value={spec.head}
            onChange={(v) => setSpec({ ...spec, head: v })}
            options={[{ value: "", label: "Working tree (uncommitted)", group: "Current" }, ...refOptions]}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
        <span>{files.length} files</span>
        <span className="text-good">+{files.reduce((s, f) => s + f.additions, 0)}</span>
        <span className="text-bad">-{files.reduce((s, f) => s + f.deletions, 0)}</span>
        <button className="ml-auto hover:text-ink" onClick={() => setPicked(picked.size === files.length ? new Set() : new Set(files.map((f) => f.path)))}>
          {picked.size === files.length ? "none" : "all"}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {diff.isLoading && <div className="p-3"><Spinner /></div>}
        {diff.error && <div className="p-2"><ErrorNote error={(diff.error as Error).message} /></div>}
        {files.length > 0 && (
          <FileTree
            key={`${spec.repo}|${spec.base}|${spec.head}`}
            roots={tree}
            openAll
            selected={[...picked]}
            onToggle={(paths, on) => {
              const n = new Set(picked);
              for (const p of paths) if (on) n.add(p); else n.delete(p);
              setPicked(n);
            }}
            openFile={active}
            onOpen={setActive}
            meta={(path) => {
              const f = byPath.get(path);
              if (!f) return null;
              return (
                <>
                  <span className="font-mono text-[11.5px] text-good">+{f.additions}</span>
                  <span className="font-mono text-[11.5px] text-bad">-{f.deletions}</span>
                  <span className={clsx("w-3 text-center font-mono text-[12px] font-bold uppercase", STATUS_TONE[f.status])} title={f.status}>{f.status[0]}</span>
                </>
              );
            }}
          />
        )}
        {!diff.isLoading && !files.length && <div className="px-3 py-8 text-center text-sm text-muted">No changes between these two.</div>}
      </div>
    </div>
  );

  const center = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <div className="min-w-0 flex-1 truncate font-mono text-[14px]">{activeFile ? rel(activeFile.path) : ""}</div>
        <Segmented value={mode} onChange={setMode} options={[{ value: "split", label: "Split" }, { value: "unified", label: "Unified" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-panel">
        {activeFile ? <DiffView patch={activeFile.patch} mode={mode} /> : <Empty title="Pick a file" />}
      </div>
    </div>
  );

  return (
    <Split
      id="changes-list"
      collapsible
      initial={300}
      className="h-full"
      left={left}
      right={<Split id="changes-panel" collapsible side="right" initial={360} min={300} max={560} left={center} right={<ActionPanel
            files={[...picked, ...extra]}
            diff={spec}
            onRemove={(f) => {
              setPicked(new Set([...picked].filter((x) => x !== f)));
              setExtra(extra.filter((x) => x !== f));
            }}
            onSetFiles={(paths) => {
              const inDiff = new Set(files.map((d) => d.path));
              setPicked(new Set(paths.filter((p) => inDiff.has(p))));
              setExtra(paths.filter((p) => !inDiff.has(p)));
            }} practiceFile={activeFile?.status !== "deleted" ? activeFile?.path : null} />} />}
    />
  );
}
