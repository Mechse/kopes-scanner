export type FavouriteScope = 'project' | 'resource';
export type Favourite = { scope: FavouriteScope; key: string };
export const favouriteId = ({ scope, key }: Favourite) => JSON.stringify([scope, key]);
