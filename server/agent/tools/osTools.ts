import os from 'os';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';
import { assertSafePublicHttpUrl, sanitizeErrorMessage } from '../../utils/sanitizer';

function resolveWorkspaceDir(rawPath?: string): string {
  const workspaceRoot = fs.realpathSync(process.cwd());
  const requested = (rawPath && rawPath.trim()) || '.';
  const candidate = path.resolve(workspaceRoot, requested);
  if (!fs.existsSync(candidate)) {
    throw new Error('Target directory does not exist.');
  }
  const realTarget = fs.realpathSync(candidate);
  const rel = path.relative(workspaceRoot, realTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Access denied: Path escapes project workspace.');
  }
  const firstSegment = rel.split(/[\\/]/)[0]?.toLowerCase();
  if (firstSegment && ['.git', '.venv', 'venv', 'data'].includes(firstSegment)) {
    throw new Error('Access denied: Protected system directory.');
  }
  if (!fs.statSync(realTarget).isDirectory()) {
    throw new Error('Target path is not a directory.');
  }
  return realTarget;
}

export function registerOsTools(registry: ToolRegistry): void {
  // 1. open_folder
  registry.registerTool(
    {
      name: 'open_folder',
      description: 'Open a local folder in Windows File Explorer.',
      permission: 'SAFE_WRITE',
      parameters: {
        folderPath: {
          type: 'string',
          description: 'The path of the folder to open. Defaults to current project root (".").',
          required: false,
          default: '.'
        }
      }
    },
    async (params): Promise<ToolResult> => {
      let folder: string;
      try {
        folder = resolveWorkspaceDir(params.folderPath);
      } catch (err: any) {
        return { success: false, error: sanitizeErrorMessage(err, 'Invalid folder path.'), message: sanitizeErrorMessage(err, 'Invalid folder path.') };
      }
      return new Promise((resolve) => {
        execFile('explorer.exe', [folder], { shell: false }, (err) => {
          // Explorer often exits with code 1 even on success in Windows, so we report success if no fatal error
          if (err && (err as any).code !== 1) {
            resolve({ success: false, error: sanitizeErrorMessage(err, 'Failed to open File Explorer.'), message: 'Failed to open File Explorer.' });
          } else {
            resolve({ success: true, message: `Opened folder: ${path.basename(folder)}` });
          }
        });
      });
    }
  );

  // 2. open_application
  registry.registerTool(
    {
      name: 'open_application',
      description: 'Open an approved desktop application such as Calculator, Notepad, or Paint.',
      permission: 'SAFE_WRITE',
      parameters: {
        appName: {
          type: 'string',
          description: 'Name of the application: "calc" (Calculator), "notepad" (Notepad), "mspaint" (Paint).',
          required: true
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const appKey = (params.appName || '').trim().toLowerCase();
      const whitelist: Record<string, { exe: string; args: string[] }> = {
        calc: { exe: 'calc.exe', args: [] },
        calculator: { exe: 'calc.exe', args: [] },
        notepad: { exe: 'notepad.exe', args: [] },
        mspaint: { exe: 'mspaint.exe', args: [] },
        paint: { exe: 'mspaint.exe', args: [] }
      };

      const entry = whitelist[appKey];
      if (!entry) {
        return {
          success: false,
          error: 'Application is not in the approved safe list. Supported: calculator, notepad, paint.',
          message: 'Application is not approved for direct execution.'
        };
      }

      return new Promise((resolve) => {
        execFile(entry.exe, entry.args, { shell: false }, (err) => {
          if (err) {
            resolve({ success: false, error: sanitizeErrorMessage(err, 'Could not launch application.'), message: 'Could not launch application.' });
          } else {
            resolve({ success: true, message: `Launched ${appKey} successfully.` });
          }
        });
      });
    }
  );

  // 3. launch_url
  registry.registerTool(
    {
      name: 'launch_url',
      description: 'Open a safe web URL in the default web browser.',
      permission: 'SAFE_WRITE',
      parameters: {
        url: {
          type: 'string',
          description: 'The URL to open (must start with http:// or https://).',
          required: true
        }
      }
    },
    async (params): Promise<ToolResult> => {
      let safeUrl: string;
      try {
        safeUrl = await assertSafePublicHttpUrl(params.url || '');
      } catch (err: any) {
        return {
          success: false,
          error: sanitizeErrorMessage(err, 'Only valid public http:// or https:// URLs can be opened.'),
          message: 'Invalid or restricted URL.'
        };
      }

      if (/[\s"'`$&|<>^%\\\0\r\n;]/.test(safeUrl)) {
        return { success: false, error: 'URL contains prohibited characters.', message: 'Invalid URL.' };
      }

      return new Promise((resolve) => {
        execFile('rundll32.exe', ['url.dll,FileProtocolHandler', safeUrl], { shell: false }, (err) => {
          if (err) {
            resolve({ success: false, error: sanitizeErrorMessage(err, 'Failed to launch URL in browser.'), message: 'Failed to launch URL in browser.' });
          } else {
            resolve({ success: true, message: `Opened URL in your default browser: ${safeUrl}` });
          }
        });
      });
    }
  );

  // 4. get_system_info
  registry.registerTool(
    {
      name: 'get_system_info',
      description: 'Retrieve general host operating system and hardware specifications.',
      permission: 'READ_ONLY',
      parameters: {}
    },
    async (): Promise<ToolResult> => {
      const info = {
        platform: os.platform(),
        osType: os.type(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: `${os.cpus().length} core(s) (${os.cpus()[0]?.model || 'Generic'})`,
        totalMemoryGB: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
        freeMemoryGB: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB',
        systemUptimeHours: (os.uptime() / 3600).toFixed(1) + ' hours'
      };

      const summary = `System: ${info.platform} (${info.release}) on ${info.hostname}. CPU: ${info.cpus}. RAM: ${info.freeMemoryGB} free of ${info.totalMemoryGB}.`;
      return {
        success: true,
        data: info,
        message: summary
      };
    }
  );

  // 5. check_resources
  registry.registerTool(
    {
      name: 'check_resources',
      description: 'Check real-time memory and CPU resource utilization on this computer.',
      permission: 'READ_ONLY',
      parameters: {}
    },
    async (): Promise<ToolResult> => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);

      const data = {
        memoryUsedPercent: `${memPercent}%`,
        usedMemoryGB: (usedMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
        freeMemoryGB: (freeMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
        totalMemoryGB: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
        cpuCores: os.cpus().length,
        nodeProcessMemoryMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(1) + ' MB'
      };

      return {
        success: true,
        data,
        message: `Memory usage is at ${memPercent}% (${data.freeMemoryGB} free of ${data.totalMemoryGB}). Process memory is ${data.nodeProcessMemoryMB}.`
      };
    }
  );
}
