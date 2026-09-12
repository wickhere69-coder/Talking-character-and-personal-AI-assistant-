import { ToolDefinition, PendingConfirmation, ToolResult } from '../types';
import { ToolRegistry } from '../tools/ToolRegistry';

export class PermissionManager {
  private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  requiresConfirmation(toolDef: ToolDefinition): boolean {
    return toolDef.permission === 'DESTRUCTIVE';
  }

  createPendingConfirmation(
    toolName: string,
    parameters: Record<string, any>
  ): PendingConfirmation {
    const id = `conf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const desc = `Permission required to execute destructive action: ${toolName}(${JSON.stringify(parameters)})`;
    const pending: PendingConfirmation = {
      id,
      toolName,
      parameters,
      description: desc,
      createdAt: Date.now()
    };
    this.pendingConfirmations.set(id, pending);
    return pending;
  }

  getPendingConfirmation(id: string): PendingConfirmation | undefined {
    return this.pendingConfirmations.get(id);
  }

  async resolveConfirmation(
    id: string,
    approved: boolean
  ): Promise<{ approved: boolean; toolResult?: ToolResult; message: string }> {
    const item = this.pendingConfirmations.get(id);
    if (!item) {
      return {
        approved: false,
        message: 'Confirmation request not found or expired.'
      };
    }

    this.pendingConfirmations.delete(id);

    if (!approved) {
      return {
        approved: false,
        message: `Action cancelled by user: ${item.toolName}.`
      };
    }

    // Execute approved action
    const result = await this.toolRegistry.execute(item.toolName, item.parameters);
    return {
      approved: true,
      toolResult: result,
      message: result.message
    };
  }
}
