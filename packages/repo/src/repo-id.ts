import { Schema } from 'effect'

/**
 * A RepoId uniquely identifies a repository across different providers.
 * At runtime, it's a three-item array: [providerId, userId, repoName]
 *
 * Currently supports: 'github'
 * Future providers may include: 'gitlab', 'bitbucket', etc.
 *
 * Example: ['github', 'zacharytamas', 'silo']
 */
export const RepoProviderIdSchema = Schema.Literal('github')
export type RepoProviderId = Schema.Schema.Type<typeof RepoProviderIdSchema>

/**
 * Schema for validating RepoId values
 */
export const RepoIdSchema = Schema.Tuple(
  RepoProviderIdSchema,
  Schema.String,
  Schema.String,
).annotations({
  identifier: 'RepoId',
  title: 'Repository Identifier',
  description: 'A unique identifier for a repository: [provider, user, repo]',
})

export type RepoId = Schema.Schema.Type<typeof RepoIdSchema>

/**
 * Create a RepoId from its components
 */
export const make = (
  providerId: RepoId[0],
  userId: RepoId[1],
  repoName: RepoId[2],
): RepoId => [providerId, userId, repoName]

/**
 * Parse and validate a value as RepoId
 */
export const parse = Schema.decodeUnknownSync(RepoIdSchema)

/**
 * Check if a value is a valid RepoId
 */
export const isRepoId = Schema.is(RepoIdSchema)
