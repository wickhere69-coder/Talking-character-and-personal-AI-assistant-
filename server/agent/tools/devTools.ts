import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

export function registerDevTools(registry: ToolRegistry): void {
  // 1. search_code
  registry.registerTool(
    {
      name: 'search_code',
      description: 'Search for text or symbols across source code files in the project.',
      permission: 'READ_ONLY',
      parameters: {
        query: { type: 'string', description: 'Search term or symbol', required: true },
        directory: { type: 'string', description: 'Directory to search (default: "src")', required: false, default: 'src' }
      }
    },
    async (params): Promise<ToolResult> => {
      const query = params.query || '';
      const startDir = path.resolve(process.cwd(), params.directory || 'src');
      if (!fs.existsSync(startDir)) return { success: false, error: 'Directory not found', message: 'Target directory not found.' };

      const matches: Array<{ file: string; line: number; text: string }> = [];

      function searchDir(dir: string) {
        if (matches.length >= 25) return;
        try {
          const files = fs.readdirSync(dir, { withFileTypes: true });
          for (const f of files) {
            if (matches.length >= 25) break;
            if (f.name.startsWith('.') || f.name === 'node_modules' || f.name === 'dist') continue;
            const full = path.join(dir, f.name);
            if (f.isDirectory()) {
              searchDir(full);
            } else if (/\.(ts|tsx|js|jsx|json|css|html|md)$/i.test(f.name)) {
              try {
                const lines = fs.readFileSync(full, 'utf8').split('\n');
                lines.forEach((line, idx) => {
                  if (line.includes(query) && matches.length < 25) {
                    matches.push({
                      file: path.relative(process.cwd(), full),
                      line: idx + 1,
                      text: line.trim()
                    });
                  }
                });
              } catch {}
            }
          }
        } catch {}
      }

      searchDir(startDir);

      if (matches.length === 0) {
        return { success: true, message: `No occurrences of "${query}" found in ${params.directory || 'src'}.` };
      }

      const formatted = matches.map((m) => `${m.file}:${m.line} -> ${m.text}`).join('\n');
      return {
        success: true,
        data: formatted,
        message: `Found ${matches.length} occurrence(s) of "${query}":`
      };
    }
  );

  // 2. explain_code
  registry.registerTool(
    {
      name: 'explain_code',
      description: 'Read and summarize the exports, classes, and functions of a code file.',
      permission: 'READ_ONLY',
      parameters: {
        filePath: { type: 'string', description: 'Path to source code file', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const target = path.resolve(process.cwd(), params.filePath);
      if (!fs.existsSync(target)) return { success: false, error: 'File not found', message: 'Source file does not exist.' };

      try {
        const content = fs.readFileSync(target, 'utf8');
        const lines = content.split('\n');

        const imports = lines.filter((l) => l.trim().startsWith('import ')).slice(0, 8);
        const exports = lines.filter((l) => /export\s+(default\s+)?(function|class|interface|type|const|let)/.test(l));

        return {
          success: true,
          data: {
            totalLines: lines.length,
            exports,
            importsSummary: imports.length
          },
          message: `${path.basename(target)} has ${lines.length} lines. Key exports:\n${exports.join('\n') || 'None detected'}`
        };
      } catch (err: any) {
        return { success: false, error: err.message, message: 'Could not inspect code.' };
      }
    }
  );

  // 3. run_command
  registry.registerTool(
    {
      name: 'run_command',
      description: 'Execute a non-destructive terminal command within the project workspace.',
      permission: 'SYSTEM',
      parameters: {
        command: { type: 'string', description: 'Terminal command to run (e.g. "git status", "node -v", "dir")', required: true }
      }
    },
    async (params): Promise<ToolResult> => {
      const rawCmd = (params.command || '').trim();

      // Destructive command blocklist
      const dangerousPatterns = [
        /rmdir\s+\/s/i,
        /del\s+\/f/i,
        /format\s+[a-z]:/i,
        /diskpart/i,
        /shutdown/i,
        /reg\s+delete/i,
        /powershell\s+.*remove-item.*-recurse/i
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(rawCmd)) {
          return {
            success: false,
            error: `Security violation: Command "${rawCmd}" matches blocked destructive patterns.`,
            message: 'Command blocked by security sandbox.'
          };
        }
      }

      return new Promise((resolve) => {
        exec(rawCmd, { cwd: process.cwd(), timeout: 15000 }, (err, stdout, stderr) => {
          const out = (stdout || stderr || '').trim();
          const truncated = out.length > 800 ? out.substring(0, 800) + '... (truncated)' : out;

          if (err && !out) {
            resolve({
              success: false,
              error: err.message,
              message: `Command failed with code ${err.code}: ${err.message}`
            });
          } else {
            resolve({
              success: true,
              data: truncated,
              message: truncated ? `Command output:\n${truncated}` : 'Command completed successfully.'
            });
          }
        });
      });
    }
  );
}
