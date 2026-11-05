import { useQuery } from "@tanstack/react-query";
import type { FileContent } from "@core/types";
import { get } from "@/lib/api";
import { useProject } from "@/lib/project";
import { CodeView } from "./CodeView";
import { Empty, ErrorNote, Spinner } from "./ui";

/** Right-hand code pane: a file from the project, or given text, at a line. */
export function CodePane({
  file, text, lang, line, marks, onLineClick, title, empty = "Code shows here", onClose,
}: {
  file?: string | null;
  /** Show this text instead of reading the file (e.g. a bug-hunt copy). */
  text?: string;
  lang?: string;
  line?: number | null;
  marks?: { from: number; to: number; cls: string }[];
  onLineClick?: (line: number) => void;
  title?: string;
  empty?: string;
  onClose?: () => void;
}) {
  const { project, rel } = useProject();
  const q = useQuery({
    queryKey: ["file", project.id, file],
    queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(file!)}`),
    enabled: !!file && text === undefined,
  });
  const body = text ?? q.data?.text;
  return (
    <div className="flex h-full flex-col bg-panel">
      {file ? (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2 font-mono text-[13px] text-muted">
            <span className="min-w-0 flex-1 truncate">{title ?? rel(file)}{line ? `:${line}` : ""}</span>
            {onClose && <button className="text-xs hover:text-ink" onClick={onClose}>close</button>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {q.isLoading && <div className="p-4"><Spinner /></div>}
            {q.error && <div className="p-3"><ErrorNote error={(q.error as Error).message} /></div>}
            {body !== undefined && <CodeView text={body} lang={lang ?? q.data?.lang ?? "text"} focusLine={line} marks={marks} onLineClick={onLineClick} />}
          </div>
        </>
      ) : (
        <Empty title={empty} />
      )}
    </div>
  );
}
