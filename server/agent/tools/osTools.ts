import os from 'os';
import { exec } from 'child_process';
import { ToolRegistry } from './ToolRegistry';
import { ToolResult } from '../types';

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
      const folder = params.folderPath && params.folderPath !== '.' ? params.folderPath : process.cwd();
      return new Promise((resolve) => {
        exec(`explorer.exe "${folder}"`, (err) => {
          // Explorer often exits with code 1 even on success in Windows, so we report success if no fatal error
          if (err && err.code !== 1) {
            resolve({ success: false, error: err.message, message: 'Failed to open File Explorer.' });
          } else {
            resolve({ success: true, message: `Opened folder: ${folder}` });
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
          description: 'Name of the application: "calc" (Calculator), "notepad" (Notepad), "mspaint" (Paint), "code" (VS Code).',
          required: true
        }
      }
    },
    async (params): Promise<ToolResult> => {
      const appKey = (params.appName || '').toLowerCase();
      const whitelist: Record<string, string> = {
        calc: 'calc.exe',
        calculator: 'calc.exe',
        notepad: 'notepad.exe',
        mspaint: 'mspaint.exe',
        paint: 'mspaint.exe',
        code: 'code .'
      };

      const cmd = whitelist[appKey];
      if (!cmd) {
        return {
          success: false,
          error: `Safety boundary: Application "${params.appName}" is not in the approved safe list. Supported: calculator, notepad, paint.`,
          message: `Application "${params.appName}" is not approved for direct execution.`
        };
      }

      return new Promise((resolve) => {
        exec(`start ${cmd}`, (err) => {
          if (err) {
            resolve({ success: false, error: err.message, message: `Could not launch ${params.appName}.` });
          } else {
            resolve({ success: true, message: `Launched ${params.appName} successfully.` });
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
      const url = params.url || '';
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          success: false,
          error: 'Only valid http:// or https:// URLs can be opened.',
          message: 'Invalid URL scheme.'
        };
      }

      return new Promise((resolve) => {
        exec(`start "" "${url}"`, (err) => {
          if (err) {
            resolve({ success: false, error: err.message, message: 'Failed to launch URL in browser.' });
          } else {
            resolve({ success: true, message: `Opened URL in your default browser: ${url}` });
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
