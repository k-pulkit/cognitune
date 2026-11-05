import { useEffect, useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, Layers, PauseCircle, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { Card, Rating } from "@core/types";
import { get, patch, post } from "@/lib/api";
import { useProject } from "@/lib/project";
import { CardDialog } from "@/components/CardDialog";
import { CodePane } from "@/components/CodePane";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, Spinner, untilText } from "@/components/ui";

type DueCard = Card & { next: Record<Rating, string> };

const RATINGS: { r: Rating; label: string; key: string; cls: string }[] = [
  { r: "again", label: "Again", key: "1", cls: "border-bad/40 text-bad hover:bg-bad/10" },
  { r: "hard", label: "Hard", key: "2", cls: "border-warn/40 text-warn hover:bg-warn/10" },
  { r: "good", label: "Good", key: "3", cls: "border-good/40 text-good hover:bg-good/10" },
  { r: "easy", label: "Easy", key: "4", cls: "border-accent/40 text-accent hover:bg-accent/10" },
];

const KIND_LABEL: Record<Card["kind"], string> = { miss: "from a quiz miss", concept: "concept", own: "your card" };

/**
 * Spaced review: recall first (type it, or say it in your head), then reveal and rate how it
 * went. The rating sets when the card comes back (FSRS).
 */
export function ReviewPage() {
  const { project, rel } = useProject();
  const qc = useQueryClient();
  const due = useQuery({ queryKey: ["cards-due", project.id], queryFn: () => get<DueCard[]>(`/projects/${project.id}/cards/due`) });
  const all = useQuery({ queryKey: ["cards", project.id], queryFn: () => get<Card[]>(`/projects/${project.id}/cards`) });
  const [shown, setShown] = useState(false);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState(0);
  const [adding, setAdding] = useState(false);
  const [peek, setPeek] = useState(false);
  const card = due.data?.[0];

  useEffect(() => {
    setShown(false);
    setAnswer("");
    setPeek(false);
  }, [card?.id]);

  const rate = async (r: Rating) => {
    if (!card) return;
    await post(`/projects/${project.id}/cards/${card.id}/review`, { rating: r });
    setDone((d) => d + 1);
    await qc.invalidateQueries({ queryKey: ["cards-due", project.id] });
    qc.invalidateQueries({ queryKey: ["today", project.id] });
    qc.invalidateQueries({ queryKey: ["cards", project.id] });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input")) return;
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      }
      const r = RATINGS.find((x) => x.key === e.key);
      if (r && shown) rate(r.r);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (due.isLoading) return <div className="p-8"><Spinner /></div>;
  const total = all.data?.length ?? 0;
  const suspended = all.data?.filter((c) => c.suspended).length ?? 0;
  const nextDue = all.data?.filter((c) => !c.suspended).map((c) => c.fsrs.due).sort()[0];

  const doc = (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Review</h1>
          <Badge tone="accent">{due.data?.length ?? 0} due</Badge>
          {done > 0 && <Badge tone="good">{done} done</Badge>}
          <Button size="sm" variant="ghost" className="ml-auto" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>New card</Button>
        </div>
        <p className="text-sm text-muted">Recall before you reveal. Cards you know come back less often; cards you miss come back soon.</p>

        {!card ? (
          <Empty icon={<CheckCircle2 className="h-6 w-6" />} title={done ? "All done for now" : "Nothing due"}>
            {total
              ? <>You have {total} card{total === 1 ? "" : "s"}{suspended ? ` (${suspended} paused)` : ""}.{nextDue && ` The next one is due in ${untilText(nextDue)}.`}</>
              : <>Cards come from quiz misses (on their own), lens concepts and your own. Take a quiz or make a card to start.</>}
          </Empty>
        ) : (
          <div className="card mt-6 p-6">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Layers className="h-3.5 w-3.5" /> {KIND_LABEL[card.kind]}
              {card.file && (
                <button className="ml-1 font-mono hover:text-accent" onClick={() => setPeek((v) => !v)}>
                  {rel(card.file)}{card.line ? `:${card.line}` : ""}
                </button>
              )}
              <span className="ml-auto">{card.fsrs.reps ? `${card.fsrs.reps} reviews · ${card.fsrs.lapses} lapses` : "new"}</span>
            </div>
            <div className="mt-3 text-[17px] font-medium leading-snug">{card.front}</div>
            {!shown ? (
              <>
                <textarea
                  className="input mt-4 min-h-[88px]"
                  placeholder="Type your answer (optional), then reveal"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <Button variant="primary" className="mt-3" icon={<Eye className="h-4 w-4" />} onClick={() => setShown(true)}>
                  Reveal <span className="kbd ml-1">space</span>
                </Button>
              </>
            ) : (
              <>
                {answer.trim() && (
                  <div className="mt-4">
                    <div className="label">You wrote</div>
                    <div className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-sm">{answer}</div>
                  </div>
                )}
                <div className="mt-4">
                  <div className="label">Answer</div>
                  <div className="whitespace-pre-wrap rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-sm">{card.back}</div>
                </div>
                <div className="mt-5 grid grid-cols-4 gap-2">
                  {RATINGS.map((x) => (
                    <button key={x.r} onClick={() => rate(x.r)} className={clsx("rounded-lg border px-2 py-2 text-center transition", x.cls)}>
                      <div className="text-sm font-semibold">{x.label} <span className="kbd ml-0.5">{x.key}</span></div>
                      <div className="text-[11px] opacity-80">{untilText(card.next[x.r])}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
                    title="Stop showing this card"
                    onClick={async () => {
                      await patch(`/projects/${project.id}/cards/${card.id}`, { suspended: true });
                      qc.invalidateQueries();
                    }}
                  >
                    <PauseCircle className="h-3.5 w-3.5" /> Pause this card
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <p className="mt-6 text-center text-xs text-muted">
          All cards are in the <Link className="text-accent hover:underline" to={`/p/${project.id}/library?tab=cards`}>Library</Link>.
        </p>
      </div>
      {adding && <CardDialog initial={{ kind: "own" }} onClose={() => setAdding(false)} />}
    </div>
  );

  if (!peek || !card?.file) return doc;
  return (
    <Split id="review-code" side="right" initial={480} min={300} max={900} className="h-full" left={doc}
      right={<CodePane file={card.file} line={card.line} onClose={() => setPeek(false)} />} />
  );
}
