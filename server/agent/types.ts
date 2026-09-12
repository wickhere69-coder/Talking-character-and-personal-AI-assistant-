// ── Agent Core Types ──

export type ToolPermissionLevel = 'READ_ONLY' | 'SAFE_WRITE' | 'DESTRUCTIVE' | 'SYSTEM';

export interface ToolParameterSchema {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermissionLevel;
  parameters: Record<string, ToolParameterSchema>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message: string;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  parameters: Record<string, any>;
  description: string;
  createdAt: number;
}

export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: AgentRole;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
    extraContent?: any;
  }>;
  toolCallId?: string;
  toolResult?: ToolResult;
}

export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  category: 'fact' | 'preference' | 'project' | 'note' | 'task';
  createdAt: number;
  updatedAt: number;
}

export interface TaskItem {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high';
  dueDate?: string;
  createdAt: number;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
}

export interface ReminderItem {
  id: string;
  title: string;
  remindAt: string;
  triggered: boolean;
  createdAt: number;
}

export interface AgentConfig {
  mode?: 'agent' | 'chat' | 'repeat';
  toolsEnabled?: boolean;
  modelProvider?: string;
  modelName?: string;
  temperature?: number;
  maxToolIterations?: number;
  memoryEnabled?: boolean;
  confirmDestructiveActions?: boolean;
}

export interface ProviderResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
    extraContent?: any;
  }>;
}

export type AgentExecutionStatus =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'planning'
  | 'executing_tool'
  | 'speaking'
  | 'completed'
  | 'error'
  | 'awaiting_confirmation';

export interface AgentChatResponse {
  response: string;
  status: AgentExecutionStatus;
  toolsExecuted?: Array<{
    name: string;
    parameters: Record<string, any>;
    result: ToolResult;
  }>;
  pendingConfirmation?: PendingConfirmation | null;
  modelUsed: string;
  memoriesRecalled?: string[];
}
