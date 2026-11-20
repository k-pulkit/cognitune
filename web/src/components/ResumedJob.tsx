import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Job } from "@core/types";
import { useJobOn } from "@/lib/api";
import { ErrorNote, JobProgress } from "./ui";

/**
 * Progress for a job on this page's thing that was started earlier (you left and came back), so the
 * page still says it is running and for how long. When it ends: `onDone` if given, else every query
 * is refreshed so the page shows the result; a failure shows its error.
 */
export function ResumedJob({ pid, target, onDone, className }: { pid: string; target?: string; onDone?: (j: Job) => void; className?: string }) {
  const qc = useQueryClient();
  const [failed, setFailed] = useState<string | null>(null);
  const r = useJobOn(pid, target, (j) => {
    if (j.status === "failed") setFailed(j.error ?? "the job failed");
    else if (onDone) onDone(j);
    else void qc.invalidateQueries();
  });
  if (failed) return <div className={className}><ErrorNote error={failed} onClose={() => setFailed(null)} /></div>;
  if (!r) return null;
  return (
    <div className={className}>
      <div className="mb-1.5 text-[12.5px] text-muted">{r.job.label ?? "Still running"} · started before you came back</div>
      <JobProgress kind={r.job.kind} elapsed={r.elapsed} />
    </div>
  );
}
