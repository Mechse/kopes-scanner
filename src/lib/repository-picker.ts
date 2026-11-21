export type RepositoryChoice = {
  repository_id: string;
  name: string;
  private: number;
  connection_id: string;
  connection_label: string;
  owner_login: string;
  binding_id: string | null;
};

export type RepositoryPickerData = {
  repositories: RepositoryChoice[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type RepositoryAddition = { repository: string; connectionId: string | null };
export type RepositoryAdded = { id: string; queued: boolean };
export type RepositoryAddResult = RepositoryAddition & ({ added: RepositoryAdded; error?: never } | { added?: never; error: string });

/** Keep successful additions when another repository fails; retries only send the failures. */
export async function addRepositories(
  repositories: RepositoryAddition[],
  add: (repository: RepositoryAddition) => Promise<RepositoryAdded>,
  progress: (result: RepositoryAddResult, completed: number) => void,
) {
  const results: RepositoryAddResult[] = [];
  for (const repository of repositories) {
    let result: RepositoryAddResult;
    try { result = { ...repository, added: await add(repository) }; }
    catch (error) { result = { ...repository, error: error instanceof Error ? error.message : 'Could not add this repository. Try again.' }; }
    results.push(result);
    progress(result, results.length);
  }
  return results;
}
