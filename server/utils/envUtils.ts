import fs from 'fs';
import path from 'path';

export function persistEnvVar(name: string, value: string): void {
  // Validate env var name (must be valid uppercase identifier)
  if (!/^[A-Z0-9_]+$/.test(name)) {
    throw new Error(`Invalid environment variable name: "${name}"`);
  }

  // Security barrier: never expose server secrets under VITE_ prefix
  if (name.startsWith('VITE_') && (name.includes('KEY') || name.includes('SECRET') || value.startsWith('sb_secret') || value.startsWith('sk-'))) {
    console.warn(`[SECURITY PREVENTED]: Blocked attempt to write sensitive secret to client-exposed ${name}`);
    return;
  }

  const safeValue = value.replace(/[\r\n]/g, '');
  const escapedValue = safeValue.replace(/\$/g, '$$$$');
  const envPath = path.resolve(process.cwd(), '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const regex = new RegExp(`^${name}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${name}=${escapedValue}`);
  } else {
    content += `\n${name}=${safeValue}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf8');
}
