/**
 * zsh-style short path: when a path is longer than `max`, every folder becomes its first
 * letter and the file name stays whole.
 *   services/billing-api/packages/my_app/pyproject.toml -> s/b/p/m/pyproject.toml
 * A leading dot is kept with the next letter (".github" -> ".g"), so hidden folders stay
 * recognisable. Show the full path in a tooltip next to it.
 */
export function shortPath(path: string, max = 36): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  const file = parts.pop() ?? "";
  const dirs = parts.map((d) => (d === "" ? "" : d.startsWith(".") ? d.slice(0, 2) : d[0]));
  return [...dirs, file].join("/");
}
