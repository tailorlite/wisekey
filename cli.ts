#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { WiseKey } from './src/WiseKey.js';

function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const envVars: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    let key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[key] = value;
  }
  return envVars;
}


// Validate service and key names to avoid path traversal and other abuses
const NAME_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: wisekey <serviceName> load -env [path]');
    console.error('       wisekey <serviceName> rotate [newKey]');
    process.exit(1);
  }

  const serviceName = args[0];

  if (!NAME_REGEX.test(serviceName)) {
    console.error('Invalid service name. Allowed: A-Za-z0-9_.- up to 64 chars.');
    process.exit(1);
  }

  if (serviceName === 'load') {
    console.error('Error: "load" is a reserved keyword and cannot be used as a service name.');
    process.exit(1);
  }

  if (serviceName === 'rotate') {
    console.error('Error: "rotate" is a reserved keyword and cannot be used as a service name.');
    process.exit(1);
  }

  if (args[1] === 'rotate') {
    if (args.length < 2 || args.length > 3) {
      console.error('Usage: wisekey <serviceName> rotate [newKey]');
      process.exit(1);
    }
  } else if (args.length < 3 || args[1] !== 'load' || args[2] !== '-env') {
    console.error('Usage: wisekey <serviceName> load -env [path]');
    console.error('       wisekey <serviceName> rotate [newKey]');
    process.exit(1);
  }

  // Let WiseKey choose its default storage path; pass only the service name
  let wiseKey: WiseKey;
  try {
    wiseKey = await WiseKey.init(serviceName);
  } catch (error: any) {
    console.error(`Failed to initialize WiseKey: ${error.message}`);
    process.exit(1);
  }

  try {
    if (args[1] === 'rotate') {
      const newKey = args[2];
      await wiseKey.rotate(newKey);
      if (newKey) {
        console.log(`Successfully rotated key for service: ${serviceName} with provided master key.`);
      } else {
        console.log(`Successfully rotated key for service: ${serviceName} with a newly generated master key.`);
      }
      return;
    }

    const envPath = args[3] ? path.resolve(args[3]) : path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.error(`.env file not found: ${envPath}`);
      process.exit(1);
    }

    const envVars = parseEnvFile(envPath);
    if (Object.keys(envVars).length === 0) {
      console.log('No key-value pairs found in .env file.');
      return;
    }

    let successCount = 0;
    for (const [key, value] of Object.entries(envVars)) {
      await wiseKey.set(key, value);
      successCount++;
    }

    console.log(`Successfully loaded ${successCount} key(s) from ${envPath} into service: ${serviceName}`);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
