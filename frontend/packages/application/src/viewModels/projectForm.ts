export const PROJECT_NAME_MAX = 100;
export const PROJECT_DESCRIPTION_MAX = 2000;

export interface ProjectFormIssues {
  readonly name?: 'required' | 'tooLong';
  readonly description?: 'tooLong';
}

const length = (value: string) => Array.from(value.trim()).length;

export function projectFormIssues(name: string, description: string): ProjectFormIssues {
  const nameLength = length(name);
  return {
    ...(nameLength === 0
      ? { name: 'required' as const }
      : nameLength > PROJECT_NAME_MAX
        ? { name: 'tooLong' as const }
        : {}),
    ...(length(description) > PROJECT_DESCRIPTION_MAX ? { description: 'tooLong' as const } : {}),
  };
}

export const hasIssues = (issues: ProjectFormIssues) => Object.keys(issues).length > 0;
