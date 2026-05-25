import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SearchResult {
  key: string;
  snippet: SearchSnippetSegment[];
  score: number;
  size: number;
  last_modified: string;
}

interface SearchSnippetSegment {
  text: string;
  highlighted: boolean;
  start: number;
  end: number;
}

interface SearchResponse {
  query: string;
  count: number;
  limit: number;
  page: number;
  total_pages: number;
  results: SearchResult[];
}

interface ProfileInfo {
  name: string;
  description: string;
}

type SearchMode = "both" | "filename" | "content";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

const EXT_PRESETS: Record<string, string> = {
  code: "rs,py,go,java,kt,swift,c,h,cpp,hpp,cc,rb",
  web: "html,htm,css,scss,less,js,jsx,ts,tsx,vue,svelte",
  config: "json,yaml,yml,toml,ini,conf,cfg,env",
  docs: "md,txt,rst,markdown",
  data: "csv,tsv,json,jsonl,ndjson,xml,sql",
  shell: "sh,bash,zsh,fish,ps1",
};

function extToSet(ext: string): Set<string> {
  return new Set(
    ext
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function matchPreset(ext: string): string {
  if (!ext.trim()) return "";
  const current = extToSet(ext);
  for (const [key, value] of Object.entries(EXT_PRESETS)) {
    const preset = extToSet(value);
    if (current.size === preset.size && [...current].every((e) => preset.has(e))) return key;
  }
  return "custom";
}

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(total - 1, current + 1);
  if (windowStart > 2) pages.push("ellipsis");
  for (let i = windowStart; i <= windowEnd; i++) pages.push(i);
  if (windowEnd < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function ProfileList() {
  const [profiles, setProfiles] = useState<ProfileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profiles")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProfileInfo[]>;
      })
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">MiniSearch</h1>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>Error: {error}</AlertDescription>
        </Alert>
      )}

      {profiles === null && !error && <p className="text-muted-foreground">Loading profiles...</p>}

      {profiles && profiles.length === 0 && (
        <p className="text-muted-foreground">No profiles configured.</p>
      )}

      {profiles && profiles.length > 0 && (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <Link key={profile.name} to={`/p/${profile.name}`} className="block">
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent>
                  <h2 className="text-lg font-semibold">{profile.name}</h2>
                  {profile.description && (
                    <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchViewGuard() {
  const { profileName } = useParams<{ profileName: string }>();
  if (!profileName) return <Navigate to="/" replace />;
  return <SearchView profileName={profileName} />;
}

function SearchView({ profileName }: { profileName: string }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get("q") || "");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [page, setPage] = useState(() => {
    const p = Number.parseInt(searchParams.get("page") || "1", 10);
    return p >= 1 ? p : 1;
  });
  const [totalPages, setTotalPages] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SearchMode>(() => {
    const m = searchParams.get("mode");
    if (m === "filename" || m === "content") return m;
    return "both";
  });
  const [ext, setExt] = useState(() => searchParams.get("ext") || "");
  const [extPreset, setExtPreset] = useState(() => matchPreset(searchParams.get("ext") || ""));
  const currentSearchController = useRef<AbortController | null>(null);

  const doSearch = useCallback(
    (q: string, p: number, m: SearchMode, e: string) => {
      currentSearchController.current?.abort();
      const controller = new AbortController();
      currentSearchController.current = controller;

      setSearching(true);
      setError(null);

      const params = new URLSearchParams({ q });
      if (p > 1) params.set("page", String(p));
      if (m !== "both") params.set("mode", m);
      if (e.trim()) params.set("ext", e.trim());

      fetch(`/api/p/${profileName}/search?${params}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<SearchResponse>;
        })
        .then((data) => {
          if (currentSearchController.current !== controller) return;
          setResults(data.results);
          setTotalCount(data.count);
          setTotalPages(data.total_pages);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (currentSearchController.current === controller) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (currentSearchController.current === controller) {
            currentSearchController.current = null;
            setSearching(false);
          }
        });
    },
    [profileName],
  );

  const doSearchRef = useRef(doSearch);
  doSearchRef.current = doSearch;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q") || "";
    if (q) {
      const p = Number.parseInt(params.get("page") || "1", 10);
      const m = params.get("mode");
      const initialMode: SearchMode = m === "filename" || m === "content" ? m : "both";
      const e = params.get("ext") || "";
      doSearchRef.current(q, p >= 1 ? p : 1, initialMode, e);
    }

    return () => {
      currentSearchController.current?.abort();
      currentSearchController.current = null;
    };
  }, []);

  function searchAndUpdateUrl(q: string, p: number, m: SearchMode, e: string) {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (p > 1) params.set("page", String(p));
    if (m !== "both") params.set("mode", m);
    if (e.trim()) params.set("ext", e.trim());
    setSearchParams(params);
    doSearch(q, p, m, e);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setPage(1);
    searchAndUpdateUrl(q, 1, mode, ext);
  }

  function handlePageChange(newPage: number) {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
    searchAndUpdateUrl(query.trim(), newPage, mode, ext);
  }

  function handleClear() {
    currentSearchController.current?.abort();
    currentSearchController.current = null;
    setQuery("");
    setResults(null);
    setTotalCount(null);
    setPage(1);
    setTotalPages(0);
    setSearching(false);
    setError(null);
    setMode("both");
    setExt("");
    setExtPreset("");
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          &larr; Profiles
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{profileName}</h1>
      </div>

      <form className="flex gap-2 mb-6" onSubmit={handleSearch}>
        <Input
          className="flex-1"
          type="text"
          placeholder="Search file contents..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button type="submit" disabled={searching}>
          Search
        </Button>
        {results !== null && (
          <Button type="button" variant="outline" onClick={handleClear}>
            Clear
          </Button>
        )}
      </form>

      <div className="flex flex-wrap gap-4 mb-6 items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="ext-preset" className="text-sm text-muted-foreground whitespace-nowrap">
            Extensions:
          </label>
          <select
            id="ext-preset"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={extPreset}
            onChange={(e) => {
              const preset = e.target.value;
              setExtPreset(preset);
              if (preset === "custom") {
                setExt("");
              } else {
                setExt(EXT_PRESETS[preset] || "");
              }
            }}
          >
            <option value="">All types</option>
            <option value="code">Code (rs,py,go,java,...)</option>
            <option value="web">Web (html,css,js,ts,...)</option>
            <option value="config">Config (json,yaml,toml,...)</option>
            <option value="docs">Docs (md,txt,rst)</option>
            <option value="data">Data (csv,json,xml,sql,...)</option>
            <option value="shell">Shell (sh,bash,zsh,...)</option>
            <option value="custom">Custom...</option>
          </select>
          {extPreset === "custom" && (
            <Input
              className="w-48"
              type="text"
              placeholder="e.g. rs,py,js"
              value={ext}
              onChange={(e) => setExt(e.target.value)}
            />
          )}
        </div>
        <fieldset className="flex items-center gap-2 border-none p-0 m-0">
          <legend className="text-sm text-muted-foreground whitespace-nowrap float-left mr-2 p-0">
            Search in:
          </legend>
          <div className="flex gap-1">
            {(["both", "filename", "content"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(m)}
              >
                {m === "both" ? "All" : m === "filename" ? "Filename" : "Content"}
              </Button>
            ))}
          </div>
        </fieldset>
      </div>

      {searching && <p className="text-muted-foreground">Searching...</p>}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>Error: {error}</AlertDescription>
        </Alert>
      )}

      {results !== null && !searching && !error && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {totalCount !== null && totalPages > 1
              ? `Page ${page} of ${totalPages} (${totalCount} results)`
              : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
          </p>
          {results.map((result) => (
            <Card key={result.key}>
              <CardContent>
                <a
                  className="text-primary font-semibold hover:underline block mb-1"
                  href={`/api/p/${profileName}/presign?key=${encodeURIComponent(result.key)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {result.key}
                </a>
                <p className="text-sm text-muted-foreground mb-2">
                  {formatBytes(result.size)} &middot;{" "}
                  {new Date(result.last_modified).toLocaleString()}
                </p>
                <div className="text-sm leading-relaxed font-mono">
                  {result.snippet.map((segment) =>
                    segment.highlighted ? (
                      <mark
                        key={`${segment.start}-${segment.end}-highlight`}
                        className="bg-yellow-100 dark:bg-yellow-900/50 px-0.5 rounded-sm"
                      >
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={`${segment.start}-${segment.end}-text`}>{segment.text}</span>
                    ),
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-1 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => handlePageChange(1)}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                Previous
              </Button>
              {getPageNumbers(page, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <span
                    key={`ellipsis-${i === 1 ? "start" : "end"}`}
                    className="px-1 text-sm text-muted-foreground"
                  >
                    ...
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => handlePageChange(p)}
                  >
                    {p}
                  </Button>
                ),
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(totalPages)}
              >
                Last
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<ProfileList />} />
      <Route path="/p/:profileName" element={<SearchViewGuard />} />
    </Routes>
  );
}

export default App;
