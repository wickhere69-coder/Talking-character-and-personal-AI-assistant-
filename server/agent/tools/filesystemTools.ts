import fs from 'fs';
import path from 'path';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';
import { sanitizeErrorMessage } from '../../utils/sanitizer';

const BLOCKED_SENSITIVE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.git',
  '.gitignore',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'data',
  '__pycache__',
  '.claude',
  '.vscode',
  'id_rsa',
  'id_ed25519',
  'authorized_keys'
]);

const SENSITIVE_EXTS = new Set(['.db', '.sqlite', '.sqlite3', '.key', '.pem', '.cert', '.p12', '.pfx', '.env']);
const PROTECTED_WRITE_FILES = new Set(['package.json', 'package-lock.json', 'vite.config.ts', 'vite.config.js', 'tsconfig.json', 'index.html', 'requirements.txt']);
const PROTECTED_WRITE_DIRS = new Set(['python_backend', 'server', 'src', '.git', '.vscode', '.claude', 'data', 'dist', 'node_modules', '.venv', 'venv']);
const PROTECTED_WRITE_EXTS = new Set(['.py', '.ts', '.tsx', '.js', '.jsx', '.bat', '.sh', '.ps1', '.exe', '.dll', '.cmd']);
const MAX_READ_BYTES = 1_048_576;

function isSkippedEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith('.') || BLOCKED_SENSITIVE_NAMES.has(lower)) return true;
  return SENSITIVE_EXTS.has(path.extname(lower));
}

function resolveRealAncestor(targetPath: string): string {
  let cursor = targetPath;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const realBase = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.join(realBase, path.relative(cursor, targetPath));
}

function resolveSafePath(userPath: string, forWrite = false): string {
  const root = fs.realpathSync(path.resolve(process.cwd()));
  const clean = (userPath || '.').replace(/[\0\r\n]/g, '').trim() || '.';

  const resolved = path.isAbsolute(clean)
    ? path.resolve(clean)
    : path.resolve(root, clean);

  const realTarget = resolveRealAncestor(resolved);
  const rel = path.relative(root, realTarget);

  // Strict boundary check preventing sibling-prefix bypasses (e.g. app-evil/) and symlink escapes
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Access denied: Path is outside the authorized project workspace.');
  }

  const segments = rel ? rel.split(path.sep).filter(Boolean) : [];
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (BLOCKED_SENSITIVE_NAMES.has(lower) || lower.startsWith('.env')) {
      throw new Error('Access denied: Access to environment variables and sensitive directories is restricted.');
    }
  }

  const base = path.basename(realTarget).toLowerCase();
  const ext = path.extname(base);
  if (SENSITIVE_EXTS.has(ext) || base.startsWith('.env')) {
    throw new Error('Access denied: Access to environment variables and secret credentials is restricted.');
  }

  if (forWrite) {
    if (PROTECTED_WRITE_FILES.has(base) || PROTECTED_WRITE_EXTS.has(ext)) {
      throw new Error('Access denied: Modifying critical configuration or executable files is restricted.');
    }
    if (segments.length > 0 && PROTECTED_WRITE_DIRS.has(segments[0].toLowerCase())) {
      throw new Error('Access denied: Modifying source or runtime directories is restricted.');
    }
  }

  return realTarget;
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
      try {
        const targetDir = resolveSafePath(params.directory || '.', false);
        if (!fs.existsSync(targetDir)) {
          return { success: false, error: 'Directory not found.', message: 'Directory does not exist.' };
        }

        const results: Array<{ name: string; type: 'file' | 'directory'; sizeBytes?: number }> = [];

        function scan(dir: string, depth = 0) {
          if (results.length >= 60 || depth > 3) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= 60) break;
            if (isSkippedEntry(entry.name)) continue;

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
        const msg = sanitizeErrorMessage(err, 'Could not list files.');
        return { success: false, error: msg, message: msg };
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
      try {
        const query = (params.query || '').toLowerCase();
        const targetDir = resolveSafePath(params.directory || '.', false);
        const matches: string[] = [];

        function findMatching(dir: string) {
          if (matches.length >= 40) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (matches.length >= 40) break;
              if (isSkippedEntry(entry.name)) continue;

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
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to search files.');
        return { success: false, error: msg, message: msg };
      }
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
      try {
        const target = resolveSafePath(params.filePath, false);
        if (!fs.existsSync(target)) {
          return { success: false, error: 'File does not exist.', message: 'File does not exist.' };
        }
        const stat = fs.statSync(target);
        if (!stat.isFile()) {
          return { success: false, error: 'Target path is not a file.', message: 'Target is not a file.' };
        }
        if (stat.size > MAX_READ_BYTES) {
          return { success: false, error: 'File exceeds maximum readable size (1 MB).', message: 'File too large to read.' };
        }

        const content = fs.readFileSync(target, 'utf8');
        const lines = content.split('\n');
        const max = Math.min(Math.max(1, Number(params.maxLines) || 80), 500);
        const truncated = lines.slice(0, max).join('\n');
        const note = lines.length > max ? `\n... (truncated ${lines.length - max} more lines)` : '';

        return {
          success: true,
          data: truncated + note,
          message: `Read ${Math.min(lines.length, max)} lines from ${path.basename(target)}.`
        };
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to read file.');
        return { success: false, error: msg, message: msg };
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
      try {
        const target = resolveSafePath(params.filePath, true);
        const dir = path.dirname(target);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target, params.content || '', 'utf8');
        return {
          success: true,
          data: { path: path.relative(process.cwd(), target), bytes: (params.content || '').length },
          message: `Successfully created file ${path.basename(target)}.`
        };
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to create file.');
        return { success: false, error: msg, message: msg };
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
      try {
        const target = resolveSafePath(params.filePath, true);
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
        const msg = sanitizeErrorMessage(err, 'Failed to write file.');
        return { success: false, error: msg, message: msg };
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
      try {
        const src = resolveSafePath(params.source, false);
        const dst = resolveSafePath(params.destination, true);
        if (!fs.existsSync(src)) return { success: false, error: 'Source file does not exist.', message: 'Source not found.' };

        const dstDir = path.dirname(dst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(src, dst);
        return { success: true, message: `Copied ${path.basename(src)} to ${path.basename(dst)}.` };
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to copy file.');
        return { success: false, error: msg, message: msg };
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
      try {
        const src = resolveSafePath(params.source, true);
        const dst = resolveSafePath(params.destination, true);
        if (!fs.existsSync(src)) return { success: false, error: 'Source file does not exist.', message: 'Source not found.' };

        const dstDir = path.dirname(dst);
        if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
        fs.renameSync(src, dst);
        return { success: true, message: `Moved ${path.basename(src)} to ${path.basename(dst)}.` };
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to move file.');
        return { success: false, error: msg, message: msg };
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
      try {
        const target = resolveSafePath(params.filePath, true);
        if (!fs.existsSync(target)) {
          return { success: false, error: 'File does not exist.', message: 'Target file not found.' };
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

        fs.unlinkSync(target);
        return {
          success: true,
          message: `Successfully deleted file ${path.basename(target)}.`
        };
      } catch (err: any) {
        const msg = sanitizeErrorMessage(err, 'Failed to delete file.');
        return { success: false, error: msg, message: msg };
      }
    }
  );
}
