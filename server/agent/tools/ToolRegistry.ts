import { ToolDefinition, ToolResult, ToolPermissionLevel } from '../types';

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (parameters: Record<string, any>) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, ToolHandler> = new Map();

  registerTool(definition: ToolDefinition, execute: (parameters: Record<string, any>) => Promise<ToolResult>): void {
    this.tools.set(definition.name, { definition, execute });
  }

  getTool(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getDefinitionsByPermission(permission: ToolPermissionLevel): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.definition.permission === permission)
      .map((t) => t.definition);
  }

  async execute(name: string, parameters: Record<string, any>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" is not registered in the system.`,
        message: `Unknown tool: ${name}`
      };
    }

    try {
      return await tool.execute(parameters);
    } catch (error: any) {
      console.error(`Error executing tool "${name}":`, error);
      return {
        success: false,
        error: error?.message || 'Tool execution encountered an unexpected error.',
        message: `Failed to execute ${name}: ${error?.message || 'Unknown error'}`
      };
    }
  }
}
