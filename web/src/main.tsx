import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Empty, Button } from "./components/ui";
import { ProjectProvider } from "./lib/project";
import { ProjectsPage } from "./pages/Projects";
import { ExplorePage } from "./pages/Explore";
import { ChangesPage } from "./pages/Changes";
import { LibraryPage } from "./pages/Library";
import { LensPage } from "./pages/Lens";
import { QuizPage } from "./pages/Quiz";
import { ProgressPage } from "./pages/Progress";
import { SettingsPage } from "./pages/Settings";
import { TodayPage } from "./pages/Today";
import { ReviewPage } from "./pages/Review";
import { TeachPage } from "./pages/Teach";
import { TutorPage } from "./pages/Tutor";
import { WalkPage } from "./pages/Walk";
import { HuntPage } from "./pages/Hunt";
import { PathPage, PathsPage } from "./pages/Paths";

// The map pulls in d3-force; load it only when opened.
const MapPage = lazy(() => import("./pages/Map").then((m) => ({ default: m.MapPage })));

// The editor (CodeMirror + languages) is big; load it only on the practice page.
const PracticePage = lazy(() => import("./pages/Practice").then((m) => ({ default: m.PracticePage })));

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function NotFound() {
  return (
    <Empty title="Project not found" action={<Button onClick={() => (location.href = "/")}>Back to projects</Button>}>
      It may have been removed from the list. Open its folder again.
    </Empty>
  );
}

function ProjectRoute() {
  const { pid = "" } = useParams();
  return (
    <ProjectProvider key={pid} pid={pid} fallback={<NotFound />}>
      <Outlet />
    </ProjectProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <ProjectsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      {
        path: "/p/:pid",
        element: <ProjectRoute />,
        children: [
          { index: true, element: <Navigate to="today" replace /> },
          { path: "today", element: <TodayPage /> },
          { path: "explore", element: <ExplorePage /> },
          { path: "review", element: <ReviewPage /> },
          { path: "map", element: <Suspense fallback={null}><MapPage /></Suspense> },
          { path: "paths", element: <PathsPage /> },
          { path: "paths/:id", element: <PathPage /> },
          { path: "teach/:id", element: <TeachPage /> },
          { path: "tutor/:id", element: <TutorPage /> },
          { path: "walk/:id", element: <WalkPage /> },
          { path: "hunt/:id", element: <HuntPage /> },
          { path: "changes", element: <ChangesPage /> },
          { path: "library", element: <LibraryPage /> },
          { path: "progress", element: <ProgressPage /> },
          { path: "lens/:id", element: <LensPage /> },
          { path: "quiz/:id", element: <QuizPage /> },
          { path: "practice/:id", element: <Suspense fallback={null}><PracticePage /></Suspense> },
        ],
      },
      { path: "*", element: <Empty title="Page not found" /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
