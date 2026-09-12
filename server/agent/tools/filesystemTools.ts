import fs from 'fs';
import path from 'path';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

function resolveSafePath(userPath: string): string {
  if (!userPath || userPath === '.' || userPath === './') {
    return process.cwd();
  }
  if (path.isAbsolute(userPath)) {
    return path.normalize(userPath);
  }
  return path.normalize(path.join(process.cwd(), userPath));
}

export function registerFilesystemTools(registry: ToolRegistry): void {
  // 1. list_files
  registry.registerTool(
    {
      name: 'list_files',
      description: 'List files and subdirectories in a directory with file sizes and types.',
      permission: 'READ_ONLY',
      parameters: {
        directory: {
          type: 'string',
          description: 'The directory path to list. Defaults to current project root (".").',
          required: false,
          default: '.'
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (capped at 50 items).',
          required: false,
          default: false
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const targetDir = resolveSafePath(params.directory || '.');
      if (!fs.existsSync(targetDir)) {
        return { success: false, error: `Directory "${params.directory}" not found.`, message: 'Directory does not exist.' };
      }

      try {
        const results: Array<{ name: string; type: 'file' | 'directory'; sizeBytes?: number }> = [];

        function scan(dir: string, depth = 0) {
          if (results.length >= 60 || depth > 3) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= 60) break;
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              results.push({ name: path.relative(targetDir, full) || entry.name, type: 'directory' });
              if (params.recursive) scan(full, depth + 1);
            } else {
              const stat = fs.statSync(full);
              results.push({
                name: path.relative(targetDir, full) || entry.name,
                type: 'file',
                sizeBytes: stat.size
              });
            }
          }
        }

        scan(targetDir);

        const summary = results.map((r) => `• ${r.type === 'directory' ? '[DIR]' : '[FILE]'} ${r.name} ${r.sizeBytes ? `(${Math.round(r.sizeBytes / 1024)} KB)` : ''}`).join('\n');
        return {
          success: true,
          data: summary,
          message: `Found ${results.length} items in ${path.basename(targetDir)}:`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Could not list files.' };
      }
    }
  );

  // 2. search_files
  registry.registerTool(
    {
      name: 'search_files',
      description: 'Search for files matching a name query or pattern within a directory.',
      permission: 'READ_ONLY',
      parameters: {
        query: {
          type: 'string',
          description: 'Search term or substring in file name.',
          required: true
        },
        directory: {
          type: 'string',
          description: 'Directory to search within (defaults to project root).',
          required: false,
          default: '.'
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const query = (params.query || '').toLowerCase();
      const targetDir = resolveSafePath(params.directory || '.');
      const matches: string[] = [];

      function findMatching(dir: string) {
        if (matches.length >= 40) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (matches.length >= 40) break;
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;

            const full = path.join(dir, entry.name);
            if (entry.name.toLowerCase().includes(query)) {
              matches.push(path.relative(process.cwd(), full));
            }
            if (entry.isDirectory()) {
              findMatching(full);
            }
          }
        } catch {}
      }

      findMatching(targetDir);

      if (matches.length === 0) {
        return {
          success: true,
          data: `No files matching "${query}" found.`,
          message: `No files found matching "${query}".`
        };
      }

      return {
        success: true,
        data: matches.join('\n'),
        message: `Found ${matches.length} matching file(s) for "${query}":`
      };
    }
  );

  // 3. read_file
  registry.registerTool(
    {
      name: 'read_file',
      description: 'Read the text content of a local file.',
      permission: 'READ_ONLY',
      parameters: {
        filePath: {
          type: 'string',
          description: 'Path of the file to read.',
          required: true
        },
        maxLines: {
          type: 'number',
          description: 'Maximum lines to read (default 80).',
          required: false,
          default: 80
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const target = resolveSafePath(params.filePath);
      if (!fs.existsSync(target)) {
        return { success: false, error: `File not found: ${params.filePath}`, message: 'File does not exist.' };
      }

      try {
        const content = fs.readFileSync(target, 'utf8');
        const lines = content.split('\n');
        const max = params.maxLines || 80;
        const truncated = lines.slice(0, max).join('\n');
        const note = lines.length > max ? `\n... (truncated ${lines.length - max} more lines)` : '';

        return {
          success: true,
          data: truncated + note,
          message: `Read ${Math.min(lines.length, max)} lines from ${path.basename(target)}.`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to read file.' };
      }
    }
  );

  // 4. create_file
  registry.registerTool(
    {
      name: 'create_file',
      description: 'Create a new file with specified content.',
      permission: 'SAFE_WRITE',
      parameters: {
        filePath: {
          type: 'string',
          description: 'Path where file should be created.',
          required: true
        },
        content: {
          type: 'string',
          description: 'Text content of the file.',
          required: false,
          default: ''
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const target = resolveSafePath(params.filePath);
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target, params.content || '', 'utf8');
        return {
          success: true,
          data: { path: target, bytes: (params.content || '').length },
          message: `Successfully created file ${path.basename(target)}.`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to create file.' };
      }
    }
  );

  // 5. write_file
  registry.registerTool(
    {
      name: 'write_file',
      description: 'Overwrite or append text into an existing or new file.',
      permission: 'SAFE_WRITE',
      parameters: {
        filePath: {
          type: 'string',
          description: 'Path of the file to write.',
          required: true
        },
        content: {
          type: 'string',
          description: 'Text to write.',
          required: true
        },
        append: {
          type: 'boolean',
          description: 'Whether to append instead of overwrite.',
          required: false,
          default: false
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const target = resolveSafePath(params.filePath);
      try {
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (params.append) {
          fs.appendFileSync(target, params.content, 'utf8');
        } else {
          fs.writeFileSync(target, params.content, 'utf8');
        }

        return {
          success: true,
          message: `Successfully updated ${path.basename(target)}.`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to write file.' };
      }
    }
  );

  // 6. copy_file
  registry.registerTool(
    {
      name: 'copy_file',
      description: 'Copy a file to another location.',
      permission: 'SAFE_WRITE',
      parameters: {
        source: { type: 'string', description: 'Source file path', required: true },
        destination: { type: 'string', description: 'Destination file path', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const src = resolveSafePath(params.source);
      const dst = resolveSafePath(params.destination);
      if (!fs.existsSync(src)) return { success: false, error: 'Source file does not exist', message: 'Source not found.' };

      try {
        const dstDir = path.dirname(dst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(src, dst);
        return { success: true, message: `Copied ${path.basename(src)} to ${path.basename(dst)}.` };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to copy file.' };
      }
    }
  );

  // 7. move_file
  registry.registerTool(
    {
      name: 'move_file',
      description: 'Move or rename a file or directory.',
      permission: 'SAFE_WRITE',
      parameters: {
        source: { type: 'string', description: 'Source file or directory', required: true },
        destination: { type: 'string', description: 'Destination path', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const src = resolveSafePath(params.source);
      const dst = resolveSafePath(params.destination);
      if (!fs.existsSync(src)) return { success: false, error: 'Source file does not exist', message: 'Source not found.' };

      try {
        const dstDir = path.dirname(dst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(src, dst);
        return { success: true, message: `Moved ${path.basename(src)} to ${path.basename(dst)}.` };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to move file.' };
      }
    }
  );

  // 8. delete_file (DESTRUCTIVE - will require user confirmation)
  registry.registerTool(
    {
      name: 'delete_file',
      description: 'Permanently delete a file. (Destructive action requiring confirmation)',
      permission: 'DESTRUCTIVE',
      parameters: {
        filePath: { type: 'string', description: 'Path of the file to delete', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const target = resolveSafePath(params.filePath);
      if (!fs.existsSync(target)) {
        return { success: false, error: 'File does not exist', message: 'Target file not found.' };
      }

      // Safety check: protect project configuration files from accidental deletion
      const fileName = path.basename(target).toLowerCase();
      if (['package.json', 'vite.config.ts', 'tsconfig.json', '.env', 'index.html'].includes(fileName)) {
        return {
          success: false,
          error: `Safety boundary: Protected critical project file ${fileName} cannot be deleted.`,
          message: `Cannot delete critical file ${fileName}.`
        };
      }

      try {
        fs.unlinkSync(target);
        return {
          success: true,
          message: `Successfully deleted file ${path.basename(target)}.`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Failed to delete file.' };
      }
    }
  );
}
