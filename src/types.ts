/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Single source of truth for the built-in model dropdown (App.tsx quick
// switcher + AdminPanel.tsx settings) - verify against
// https://ai.google.dev/gemini-api/docs/models before adding/removing.
export const FREE_TIER_MODELS: string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
  'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
  'gemma-4-31b-it', 'gemma-4-26b-a4b-it'
];

export interface Skill {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  source: string;
  imported_at: string;
}

export interface TicketAttachment {
  file_id?: number;
  file_name: string;
  file_size?: number;
  mime_type: string;
  url: string;
  from_role?: 'CLIENT' | 'STAFF';
}

export interface Ticket {
  id: string;
  subject: string;
  description: string;
  user_id: string;
  user_name: string;
  status: string;
  priority: string;
  created_at: string;
  channel: string;
  attachments?: TicketAttachment[];
}

export interface Suggestion {
  id: string;
  text: string;
  model: string;
  confidence: number;
  created_at: string;
}

export interface EscalationInfo {
  used: boolean;
  required: boolean;
  notePushed?: boolean;
  noteError?: string;
  noteContent?: string;
  pendingConfirmation?: boolean;
}

export interface ClassificationInfo {
  fields: Record<string, string>;
  readable: Record<string, string>;
  reasoning?: string;
  pushed?: boolean;
  pushError?: string;
  pendingConfirmation?: boolean;
}

export interface ConversationHistoryMessage {
  id: string;
  timestamp: string;
  role: 'user' | 'assistant';
  staffEmail?: string;
  userQuery?: string;
  replyText: string;
  suggestions?: Suggestion[];
  escalation?: EscalationInfo;
  classification?: ClassificationInfo;
  imagesAnalyzed?: number;
  imageFiles?: string[];
  imagesCached?: number;
  cachedImageFiles?: string[];
}

export interface AnalyticsRecord {
  id: string;
  action: 'suggestion_generated' | 'suggestion_applied' | 'suggestion_rejected' | 'api_call' | 'chat_request';
  metadata: any;
  timestamp: string;
}

export interface KnowledgeBaseItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
}

export interface CustomModelConfig {
  id: string;
  name: string;
  base_url: string;
  model_id: string;
  api_key: string;
}

export interface AppSettings {
  llm_endpoint: string;
  model_name: string;
  custom_models?: string;
  api_key: string;
  api_key_pool?: string;
  system_prompt: string;
  temperature: number;
  top_p: number;
  max_tokens: number;
  skills: string;
  mcp_servers: string;
  context_files: string;
  skill_import_url: string;
  skill_repo_url: string;
  bookstack_url: string;
  bookstack_token_id: string;
  bookstack_token_secret: string;
  omnidesk_api_key: string;
  omnidesk_email: string;
  omnidesk_domain: string;
  enable_context: boolean;
  notification_channels: {
    telegram: { enabled: boolean; chat_id: string };
    gotify: { enabled: boolean; url: string };
  };
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  quick_actions?: string;
}

export interface User {
  id: string;
  name: string;
  role: 'admin' | 'agent' | 'viewer';
  email: string;
}
