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
