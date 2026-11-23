export type Route =
  | { readonly page: 'workflow' }
  | { readonly page: 'projects' }
  | { readonly page: 'project'; readonly projectId: string }
  | { readonly page: 'users' }
  | { readonly page: 'assignments' }
  | { readonly page: 'myWork' };

export const HOME: Route = { page: 'workflow' };

const SIMPLE: Readonly<Record<string, Route>> = {
  projects: { page: 'projects' },
  users: { page: 'users' },
  assignments: { page: 'assignments' },
  'my-work': { page: 'myWork' },
};

export function parseRoute(path: string): Route {
  const parts = path.split('/').filter(Boolean).map(safeDecode);
  const simple = parts.length === 1 && parts[0] ? SIMPLE[parts[0]] : undefined;
  if (simple) return simple;
  if (parts.length === 2 && parts[0] === 'projects' && parts[1]) return { page: 'project', projectId: parts[1] };
  return HOME;
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'workflow':
      return '/';
    case 'projects':
      return '/projects';
    case 'project':
      return `/projects/${encodeURIComponent(route.projectId)}`;
    case 'users':
      return '/users';
    case 'assignments':
      return '/assignments';
    case 'myWork':
      return '/my-work';
  }
}

export function parentRoute(route: Route): Route {
  return route.page === 'project' ? { page: 'projects' } : HOME;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routePath(a) === routePath(b);
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
