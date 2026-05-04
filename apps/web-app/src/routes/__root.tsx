import { useEffect, useRef } from "react";
import {
  createRootRoute,
  Link,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useScrollStore } from "@/stores/scrollStore";
import { useAuthStore } from "@/stores/authStore";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ColorPicker } from "@/components/ui/color-picker";
import { cn } from "@/lib/utils";
import { CloudIcon, GithubIcon, LogOutIcon, UserIcon } from "lucide-react";
import { version } from "../../package.json";

export const Route = createRootRoute({
  component: RootLayout,
});

function UserMenu() {
  const auth = useAuth();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated || !user) {
    return (
      <Link
        to="/login"
        search={{ returnUrl: "/" }}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
          "text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        )}
      >
        <UserIcon className="h-4 w-4" />
        Sign In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {user.profile?.name || user.profile?.email || "User"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => auth.signoutRedirect()}
        className="gap-2"
      >
        <LogOutIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Sign Out</span>
      </Button>
    </div>
  );
}

// Routes that don't require authentication (login flow itself)
const PUBLIC_ROUTES = new Set(["/login", "/callback"]);

function RootLayout() {
  const location = useLocation();
  const savePosition = useScrollStore((s) => s.savePosition);
  const getPosition = useScrollStore((s) => s.getPosition);
  const prevPathRef = useRef(location.pathname);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  // Save scroll position before route change, restore on new route
  useEffect(() => {
    const prevPath = prevPathRef.current;
    const currentPath = location.pathname;

    if (prevPath !== currentPath) {
      // Save scroll position of previous route
      savePosition(prevPath, window.scrollY);

      // Restore scroll position for current route (after render)
      requestAnimationFrame(() => {
        const savedPosition = getPosition(currentPath);
        window.scrollTo(0, savedPosition);
      });

      prevPathRef.current = currentPath;
    }
  }, [location.pathname, savePosition, getPosition]);

  // Auth gate: redirect unauthenticated users to /login (except for the
  // login flow itself). Wait for the Auth0 SDK to finish loading first
  // so we don't bounce briefly during silent token refresh.
  const isPublicRoute = PUBLIC_ROUTES.has(location.pathname);
  if (!isLoading && !isAuthenticated && !isPublicRoute) {
    return (
      <Navigate
        to="/login"
        search={{ returnUrl: location.pathname }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
        <nav className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground transition-colors hover:text-primary"
            >
              <CloudIcon className="h-6 w-6 text-primary" />
              <span>RecoverySky</span>
              <span className="text-xs font-normal text-muted-foreground">
                v{version}
              </span>
            </Link>
            <a
              href="https://github.com/recoverysky-org/recoverysky-app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="View source on GitHub"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
          </div>

          {/* Right side - theme controls and user menu */}
          <div className="flex items-center gap-2">
            <ColorPicker />
            <ThemeToggle />
            <div className="ml-2 h-6 w-px bg-border" />
            <UserMenu />
          </div>
        </nav>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
