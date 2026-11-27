import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FolderTree, Inbox, Library, ListChecks, Merge, Pencil, Sparkles, Wand2, X } from "lucide-react";
import type { Lens, Shelf } from "@core/types";
import { api, del, get, patch, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { Combobox } from "@/components/Combobox";
import { Button, ErrorNote, JobProgress, Modal, Segmented } from "@/components/ui";

const UNSHELVED = "";

/** Per-viewer conveniences (view and folded groups); storage can be blocked, so every access is guarded. */
function remembered<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** The deepest folder all of a lens's files share ("src/core"), or "" when they share none. */
function areaOf(files: string[], rel: (p: string) => string): string {
  const dirs = files.map((f) => rel(f).split("/").slice(0, -1));
  if (!dirs.length) return "";
  const first = dirs[0];
  let n = 0;
  while (n < first.length && dirs.every((d) => d[n] === first[n])) n++;
  return first.slice(0, n).join("/");
}

export function useShelves(pid: string) {
  return useQuery({ queryKey: ["shelves", pid], queryFn: () => get<Shelf[]>(`/projects/${pid}/shelves`) });
}

/**
 * The Lenses tab, grouped: by topic shelves (the agent names them; Organize places only unshelved lenses), or by
 * the code area the lens covers (free, from its files). Each shelf can be quizzed, reworked, merged or renamed.
 */
export function LensShelves({ lenses, render }: { lenses: Lens[]; render: (l: Lens) => ReactNode }) {
  const { project, rel } = useProject();
  const qc = useQueryClient();
  const nav = useNavigate();
  const base = `/projects/${project.id}`;
  const shelves = useShelves(project.id);
  const organize = useJob();
  const quiz = useJob();
  const viewKey = `cognitune.shelfView.${project.id}`;
  const foldKey = `cognitune.shelfFold.${project.id}`;
  const [view, setView] = useState<"shelves" | "area">(() => remembered(viewKey, "shelves"));
  const [folded, setFolded] = useState<string[]>(() => remembered(foldKey, []));
  const [renaming, setRenaming] = useState<Shelf | null>(null);
  const [merging, setMerging] = useState<Shelf | null>(null);
  const [busyShelf, setBusyShelf] = useState<string | null>(null);

  const list = shelves.data ?? [];
  const ids = useMemo(() => new Set(list.map((s) => s.id)), [list]);
  const unshelvedCount = lenses.filter((l) => !l.shelf || !ids.has(l.shelf)).length;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["shelves", project.id] });
    void qc.invalidateQueries({ queryKey: ["lenses", project.id] });
  };

  const groups = useMemo(() => {
    if (view === "area") {
      const by = new Map<string, Lens[]>();
      for (const l of lenses) {
        const a = areaOf(l.files, rel);
        by.set(a, [...(by.get(a) ?? []), l]);
      }
      return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([a, ls]) => ({
        key: `area:${a}`, name: a || "Across the project", about: a ? "" : "Lenses whose files sit in different top-level folders.", lenses: ls, shelf: undefined as Shelf | undefined,
      }));
    }
    const out = [] as { key: string; name: string; about: string; lenses: Lens[]; shelf?: Shelf }[];
    const loose = lenses.filter((l) => !l.shelf || !ids.has(l.shelf));
    if (loose.length) out.push({ key: UNSHELVED, name: "Unshelved", about: "New lenses land here. Organize puts them on shelves.", lenses: loose });
    for (const s of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      const on = lenses.filter((l) => l.shelf === s.id);
      if (on.length) out.push({ key: s.id, name: s.name, about: s.about, lenses: on, shelf: s });
    }
    return out;
  }, [view, lenses, list, ids, rel]);

  const toggle = (key: string) => {
    const next = folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key];
    setFolded(next);
    remember(foldKey, next);
  };
  const runOrganize = (path: string, shelfId?: string) => {
    setBusyShelf(shelfId ?? null);
    void organize.run(path, {}, () => {
      setBusyShelf(null);
      refresh();
    });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            remember(viewKey, v);
          }}
          options={[{ value: "shelves", label: "Shelves" }, { value: "area", label: "By code area" }]}
        />
        {view === "shelves" && (
          <>
            <Button size="sm" variant={unshelvedCount ? "primary" : "secondary"} icon={<Sparkles className="h-3.5 w-3.5" />}
              disabled={organize.busy || !unshelvedCount} onClick={() => runOrganize(`${base}/shelves/organize`)}
              title="The agent puts each unshelved lens on a shelf by topic. Lenses already on a shelf are not moved.">
              Organize{unshelvedCount ? ` ${unshelvedCount} unshelved` : ""}
            </Button>
            <span className="text-[12.5px] text-muted">
              {unshelvedCount ? "Shelved lenses stay where they are." : list.length ? "Everything is on a shelf." : ""}
            </span>
          </>
        )}
      </div>
      {organize.busy && organize.job && !busyShelf && <div className="mb-4"><JobProgress kind="shelve" elapsed={organize.elapsed} /></div>}
      {organize.error && <div className="mb-4"><ErrorNote error={organize.error} onClose={organize.clearError} /></div>}
      {quiz.error && <div className="mb-4"><ErrorNote error={quiz.error} onClose={quiz.clearError} /></div>}

      <div className="space-y-6">
        {groups.map((g) => {
          const open = !folded.includes(g.key);
          const s = g.shelf;
          return (
            <section key={g.key}>
              <div className="group flex items-center gap-2 border-b border-line pb-1.5">
                <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => toggle(g.key)}>
                  <ChevronRight className={clsx("h-4 w-4 shrink-0 text-muted transition", open && "rotate-90")} />
                  {view === "area" ? <FolderTree className="h-4 w-4 shrink-0 text-muted" /> : g.key === UNSHELVED ? <Inbox className="h-4 w-4 shrink-0 text-warn" /> : <Library className="h-4 w-4 shrink-0 text-accent" />}
                  <span className={clsx("truncate font-semibold", view === "area" && "font-mono text-[14px]")}>{g.name}</span>
                  <span className="shrink-0 text-[13px] text-muted">{g.lenses.length}</span>
                </button>
                {g.about && <span className="hidden min-w-0 truncate text-[13px] text-muted md:inline">· {g.about}</span>}
                {s && (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
                    <IconBtn title="Quiz me on this shelf: one mixed quiz across its lenses" disabled={quiz.busy}
                      onClick={() => quiz.run(`${base}/quizzes`, { shelfId: s.id }, (j) => nav(`/p/${project.id}/quiz/${j.resultId}`))}>
                      <ListChecks className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="Rework this shelf: its lenses (except the ones you placed) go back to Unshelved and are sorted again"
                      disabled={organize.busy} onClick={() => runOrganize(`${base}/shelves/${s.id}/rework`, s.id)}>
                      <Wand2 className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="Merge this shelf into another" disabled={list.length < 2} onClick={() => setMerging(s)}><Merge className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Rename" onClick={() => setRenaming(s)}><Pencil className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Remove the shelf: its lenses go back to Unshelved"
                      onClick={async () => {
                        await del(`${base}/shelves/${s.id}`);
                        refresh();
                      }}>
                      <X className="h-3.5 w-3.5" />
                    </IconBtn>
                  </span>
                )}
              </div>
              {(busyShelf === s?.id && organize.busy && organize.job) && <div className="mt-3"><JobProgress kind="shelve" elapsed={organize.elapsed} /></div>}
              {open && <div className="mt-3 grid gap-3 md:grid-cols-2">{g.lenses.map((l) => render(l))}</div>}
            </section>
          );
        })}
      </div>
      {quiz.busy && quiz.job && <div className="mt-4"><JobProgress kind="quiz" elapsed={quiz.elapsed} /></div>}

      {renaming && <RenameShelf shelf={renaming} onClose={() => setRenaming(null)} onSaved={refresh} />}
      {merging && (
        <MergeShelf shelf={merging} others={list.filter((x) => x.id !== merging.id)} onClose={() => setMerging(null)}
          onMerged={refresh} />
      )}
    </div>
  );
}

function IconBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink disabled:opacity-40" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function RenameShelf({ shelf, onClose, onSaved }: { shelf: Shelf; onClose: () => void; onSaved: () => void }) {
  const { project } = useProject();
  const [name, setName] = useState(shelf.name);
  const [about, setAbout] = useState(shelf.about);
  const save = async () => {
    await patch(`/projects/${project.id}/shelves/${shelf.id}`, { name, about });
    onSaved();
    onClose();
  };
  return (
    <Modal title="Rename shelf" onClose={onClose}
      footer={<><Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={!name.trim()} onClick={save}>Save</Button></>}>
      <div className="label">Name</div>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} />
      <div className="label mt-3">What belongs here</div>
      <input className="input" value={about} onChange={(e) => setAbout(e.target.value)} />
      <p className="mt-2 text-[12.5px] text-muted">The agent reads this line when it places new lenses, so a clear one keeps shelves consistent.</p>
    </Modal>
  );
}

function MergeShelf({ shelf, others, onClose, onMerged }: { shelf: Shelf; others: Shelf[]; onClose: () => void; onMerged: () => void }) {
  const { project } = useProject();
  const [into, setInto] = useState(others[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const merge = async () => {
    try {
      await api(`/projects/${project.id}/shelves/${into}/merge`, { method: "POST", json: { from: [shelf.id] } });
      onMerged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal title={`Merge “${shelf.name}”`} onClose={onClose}
      footer={<><Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" icon={<Merge className="h-3.5 w-3.5" />} disabled={!into} onClick={merge}>Merge</Button></>}>
      <p className="text-[14px]">Move its lenses onto another shelf, and remove “{shelf.name}”.</p>
      <div className="label mt-3">Into</div>
      <Combobox value={into} onChange={setInto} options={others.map((o) => ({ value: o.id, label: o.name, hint: o.about }))} />
      {error && <div className="mt-3"><ErrorNote error={error} /></div>}
    </Modal>
  );
}

/**
 * On a lens page: which shelf it sits on, and a way to change it, by hand (pinned) or by asking the agent with a
 * steer that weighs more than the content.
 */
export function ShelfControl({ lens, onChanged }: { lens: Lens; onChanged: () => void }) {
  const { project } = useProject();
  const qc = useQueryClient();
  const shelves = useShelves(project.id);
  const job = useJob();
  const [open, setOpen] = useState(false);
  const [steer, setSteer] = useState("");
  const list = shelves.data ?? [];
  const current = list.find((s) => s.id === lens.shelf);
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["shelves", project.id] });
    onChanged();
  };
  const move = async (shelf: string | null) => {
    await api(`/projects/${project.id}/lenses/${lens.id}/shelf`, { method: "PUT", json: { shelf } });
    done();
    setOpen(false);
  };
  return (
    <span className="relative inline-flex">
      <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-ink"
        title={current ? `On the shelf "${current.name}"${lens.shelfPinned ? " (placed by you)" : ""}. Click to change.` : "Not on a shelf yet. Click to choose one."}
        onClick={() => setOpen(!open)}>
        {current ? <Library className="h-3.5 w-3.5 text-accent" /> : <Inbox className="h-3.5 w-3.5" />}
        {current ? current.name : "Unshelved"}
      </button>
      {open && (
        <Modal title="Shelf for this lens" onClose={() => setOpen(false)}>
          <div className="label">Put it on a shelf yourself</div>
          <Combobox value={lens.shelf ?? ""} onChange={(v) => void move(v || null)} placeholder="Pick a shelf"
            options={[{ value: "", label: "Unshelved", hint: "Organize may place it later" }, ...list.map((s) => ({ value: s.id, label: s.name, hint: s.about }))]} />
          <div className="label mt-5">Or ask the agent</div>
          <textarea className="input min-h-[64px] resize-y text-[14px]" value={steer} onChange={(e) => setSteer(e.target.value)}
            placeholder="Optional: what is this lens really about, or where should it go? e.g. This is about failure handling, not the queue. Your steer weighs more than the content." />
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="primary" className="shrink-0" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={job.busy}
              onClick={() => job.run(`/projects/${project.id}/lenses/${lens.id}/reshelve`, { steer: steer.trim() || undefined }, () => {
                done();
                setSteer("");
                setOpen(false);
              })}>
              Find its shelf
            </Button>
            <span className="text-[12.5px] text-muted">It may pick an existing shelf or make a new one. Either way it stays there until you move it.</span>
          </div>
          {job.busy && job.job && <div className="mt-3"><JobProgress kind="shelve" elapsed={job.elapsed} /></div>}
          {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
        </Modal>
      )}
    </span>
  );
}
