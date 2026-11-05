import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import type { Card } from "@core/types";
import { post } from "@/lib/api";
import { useProject } from "@/lib/project";
import { Button, ErrorNote, Modal } from "./ui";

/** Make a review card by hand. Front is the question; back is the answer in your words. */
export function CardDialog({
  initial, onClose,
}: { initial: Partial<Card>; onClose: () => void }) {
  const { project, rel } = useProject();
  const qc = useQueryClient();
  const [front, setFront] = useState(initial.front ?? "");
  const [back, setBack] = useState(initial.back ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(`/projects/${project.id}/cards`, { ...initial, front, back });
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-accent" /> New review card</span>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!front.trim() || !back.trim()} onClick={save}>Save card</Button>
        </>
      }
    >
      {initial.file && <div className="mb-3 font-mono text-[12px] text-muted">{rel(initial.file)}{initial.line ? `:${initial.line}` : ""}</div>}
      <label className="label">Question (front)</label>
      <textarea className="input min-h-[72px]" value={front} onChange={(e) => setFront(e.target.value)} placeholder="What should you be able to recall?" autoFocus />
      <label className="label mt-3">Answer (back)</label>
      <textarea className="input min-h-[96px]" value={back} onChange={(e) => setBack(e.target.value)} placeholder="The answer, in your own words" />
      <p className="mt-2 text-xs text-muted">The card comes back on the Review page: soon at first, then less often as you remember it.</p>
      {err && <div className="mt-3"><ErrorNote error={err} /></div>}
    </Modal>
  );
}
