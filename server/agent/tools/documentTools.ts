import fs from 'fs';
import path from 'path';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

export function registerDocumentTools(registry: ToolRegistry): void {
  registry.registerTool(
    {
      name: 'read_document',
      description: 'Read and parse text documents (TXT, Markdown, JSON, CSV, logs, or source files).',
      permission: 'READ_ONLY',
      parameters: {
        filePath: { type: 'string', description: 'Path to the document file', required: true },
        maxLines: { type: 'number', description: 'Max lines to read (default 100)', required: false, default: 100 }
      }
    },
    async (params): Promise<ToolResult> => {
      const fullPath = path.isAbsolute(params.filePath)
        ? params.filePath
        : path.resolve(process.cwd(), params.filePath);

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Document not found: ${params.filePath}`, message: 'Document does not exist.' };
      }

      try {
        const ext = path.extname(fullPath).toLowerCase();
        const raw = fs.readFileSync(fullPath, 'utf8');
        const lines = raw.split('\n');
        const max = params.maxLines || 100;
        const slice = lines.slice(0, max).join('\n');

        if (ext === '.json') {
          try {
            const parsed = JSON.parse(raw);
            const keys = Object.keys(parsed);
            return {
              success: true,
              data: slice,
              message: `Read JSON document ${path.basename(fullPath)} (${keys.length} top-level keys). Content preview:\n${slice.substring(0, 300)}...`
            };
          } catch {}
        }

        return {
          success: true,
          data: slice,
          message: `Read ${Math.min(lines.length, max)} lines from ${path.basename(fullPath)}:\n${slice.substring(0, 350)}...`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to read document.' };
      }
    }
  );
}
