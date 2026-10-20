import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
export const leads = sqliteTable('leads', {
  id: text('id').primaryKey(), handle: text('handle').notNull(), mode: text('mode').notNull(),
  purpose: text('purpose').notNull().default('prospect'),
  revenueStatus: text('revenue_status').notNull().default('unknown'),
  revenueEvidence: text('revenue_evidence').notNull().default(''),
  meetingFormat: text('meeting_format').notNull().default(''),
  meetingTime: text('meeting_time').notNull().default(''),
  conversationPhase: text('conversation_phase').notNull().default('contact'),
  followUpCount: integer('follow_up_count').notNull().default(0),
  followUpStatus: text('follow_up_status').notNull().default('not_scheduled'),
  followUpNextAt: text('follow_up_next_at').notNull().default(''),
  name: text('name').notNull(), bio: text('bio').notNull(), niche: text('niche').notNull(),
  funnel: text('funnel').notNull(), stage: text('stage').notNull(), channel: text('channel').notNull(),
  score: integer('score').notNull(), variant: text('variant').notNull(),
  monthlyRevenue: real('monthly_revenue'), city: text('city').notNull(),
  metaId: text('meta_id'), lastInboundAt: text('last_inbound_at'), nextAction: text('next_action').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});
export type Lead = typeof leads.$inferSelect;
