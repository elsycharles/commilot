import { z } from 'zod';

/**
 * A single logical unit of change: a type, a scope, a description and the
 * files that belong together in one commit.
 */
export interface CommitGroup {
  type: string;
  scope: string;
  description: string;
  /** Files assigned to this group. Empty for generate mode until resolved. */
  files: string[];
}

/** An ordered list of commit groups produced by the split command. */
export type CommitPlan = CommitGroup[];

/** Result of a successfully executed commit. */
export interface CommitResult {
  sha: string;
  message: string;
  files: string[];
}

/** Raw AI response schema for generate mode. */
export const commitGroupResponseSchema = z.object({
  type: z.string().min(1),
  scope: z.string().default(''),
  description: z.string().min(1),
  files: z.array(z.string()).optional(),
});

/** Raw AI response schema for split mode. */
export const commitPlanResponseSchema = z.array(
  commitGroupResponseSchema.extend({
    files: z.array(z.string()).min(1),
  }),
);

export type CommitGroupResponse = z.infer<typeof commitGroupResponseSchema>;
export type CommitPlanResponse = z.infer<typeof commitPlanResponseSchema>;
