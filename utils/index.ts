import { Maybe } from "npm:@octokit/graphql-schema";

export function removeMaybe<T = unknown>(x: Maybe<T>[]): T[] {
  return x.filter((x) => x !== null) as T[];
}
