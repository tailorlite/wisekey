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
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        envVars[key] = value;
    }
    return envVars;
}
function formatEnvValue(value: string): string {
    if (value === '') return '';
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}
// Validate service and key names to avoid path traversal and other abuses
const NAME_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED = ['load', 'rotate', 'export', 'set', 'get'];
function printUsage(): void {
    console.error('Usage: wisekey <serviceName> load -env [path]');
    console.error('       wisekey <serviceName> load <file.json>');
    console.error('       wisekey <serviceName> rotate [newKey]');
    console.error('       wisekey <serviceName> export <file>');
    console.error('       wisekey <serviceName> set <key> <value>');
    console.error('       wisekey <serviceName> set <key> --file <path>');
    console.error('       wisekey <serviceName> get <key>');
}
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        printUsage();
        process.exit(1);
    }
    const serviceName = args[0];
    if (!NAME_REGEX.test(serviceName)) {
        console.error(
            'Invalid service name. Allowed: A-Za-z0-9_.- up to 64 chars.',
        );
        process.exit(1);
    }
    if (RESERVED.includes(serviceName)) {
        console.error(
            `Error: "${serviceName}" is a reserved keyword and cannot be used as a service name.`,
        );
        process.exit(1);
    }
    if (args[1] === 'rotate') {
        if (args.length < 2 || args.length > 3) {
            console.error('Usage: wisekey <serviceName> rotate [newKey]');
            process.exit(1);
        }
    } else if (args[1] === 'export') {
        if (args.length !== 3 || !args[2]) {
            console.error(
                'Usage: wisekey <serviceName> export <env file name>',
            );
            process.exit(1);
        }
    } else if (args[1] === 'set') {
        if (!args[2] || args[3] === undefined) {
            console.error('Usage: wisekey <serviceName> set <key> <value>');
            console.error(
                '       wisekey <serviceName> set <key> --file <path>',
            );
            process.exit(1);
        }
        if (!NAME_REGEX.test(args[2])) {
            console.error(
                'Invalid key name. Allowed: A-Za-z0-9_.- up to 64 chars.',
            );
            process.exit(1);
        }
        if (args[3] === '--file' || args[3] === '-f') {
            if (args.length !== 5 || !args[4]) {
                console.error(
                    'Usage: wisekey <serviceName> set <key> --file <path>',
                );
                process.exit(1);
            }
        } else if (args.length !== 4) {
            console.error('Usage: wisekey <serviceName> set <key> <value>');
            console.error(
                '       wisekey <serviceName> set <key> --file <path>',
            );
            process.exit(1);
        }
    } else if (args[1] === 'get') {
        if (args.length !== 3 || !args[2]) {
            console.error('Usage: wisekey <serviceName> get <key>');
            process.exit(1);
        }
        if (!NAME_REGEX.test(args[2])) {
            console.error(
                'Invalid key name. Allowed: A-Za-z0-9_.- up to 64 chars.',
            );
            process.exit(1);
        }
    } else if (args[1] === 'load') {
        if (args.length < 3) {
            console.error('Usage: wisekey <serviceName> load -env [path]');
            console.error('       wisekey <serviceName> load <file.json>');
            process.exit(1);
        }
        if (args[2] !== '-env' && !args[2].endsWith('.json')) {
            console.error('Usage: wisekey <serviceName> load -env [path]');
            console.error('       wisekey <serviceName> load <file.json>');
            process.exit(1);
        }
    } else {
        printUsage();
        process.exit(1);
    }
    // Let WiseKey choose its default storage path; pass only the service name
    let wiseKey: WiseKey;
    try {
        wiseKey = await WiseKey.init(serviceName);
    } catch (error) {
        console.error(
            `Failed to initialize WiseKey: ${(error as Error).message}`,
        );
        process.exit(1);
    }
    try {
        if (args[1] === 'rotate') {
            const newKey = args[2];
            await wiseKey.rotate(newKey);
            if (newKey) {
                console.log(
                    `Successfully rotated key for service: ${serviceName} with provided master key.`,
                );
            } else {
                console.log(
                    `Successfully rotated key for service: ${serviceName} with a newly generated master key.`,
                );
            }
            return;
        }
        if (args[1] === 'set') {
            if (args[3] === '--file' || args[3] === '-f') {
                const filePath = path.resolve(args[4]);
                let stat: fs.Stats;
                try {
                    stat = fs.statSync(filePath);
                } catch {
                    console.error(`File not found: ${filePath}`);
                    process.exit(1);
                }
                if (!stat.isFile()) {
                    console.error(`Not a file: ${filePath}`);
                    process.exit(1);
                }
                const MAX_FILE_SIZE = 1024 * 1024;
                if (stat.size > MAX_FILE_SIZE) {
                    console.error(
                        `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE}): ${filePath}`,
                    );
                    process.exit(1);
                }
                const buf = fs.readFileSync(filePath);
                if (buf.includes(0)) {
                    console.error(`File is not valid utf-8 text: ${filePath}`);
                    process.exit(1);
                }
                let value: string;
                try {
                    value = new TextDecoder('utf-8', { fatal: true }).decode(
                        buf,
                    );
                } catch {
                    console.error(`File is not valid utf-8 text: ${filePath}`);
                    process.exit(1);
                }
                await wiseKey.set(args[2], value);
                console.log(
                    `Successfully set key "${args[2]}" in service: ${serviceName} from file ${filePath}`,
                );
                return;
            }
            await wiseKey.set(args[2], args[3]);
            console.log(
                `Successfully set key "${args[2]}" in service: ${serviceName}`,
            );
            return;
        }
        if (args[1] === 'get') {
            const value = await wiseKey.get(args[2]);
            if (value === null) {
                console.error(
                    `Key "${args[2]}" not found in service: ${serviceName}`,
                );
                process.exit(1);
            }
            console.log(value);
            return;
        }
        if (args[1] === 'export') {
            const outPath = path.resolve(args[2]);
            if (fs.existsSync(outPath)) {
                console.error(
                    `Refusing to overwrite existing file: ${outPath}`,
                );
                process.exit(1);
            }
            const all = await wiseKey.getAll();
            const keys = Object.keys(all).sort();
            if (outPath.toLowerCase().endsWith('.json')) {
                fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + '\n', {
                    mode: 0o600,
                });
            } else {
                const lines = keys.map((k) => `${k}=${formatEnvValue(all[k])}`);
                fs.writeFileSync(
                    outPath,
                    lines.length > 0 ? lines.join('\n') + '\n' : '',
                    {
                        mode: 0o600,
                    },
                );
            }
            try {
                fs.chmodSync(outPath, 0o600);
            } catch {
                /* ignore */
            }
            console.log(
                `Successfully exported ${keys.length} key(s) from service: ${serviceName} to ${outPath}`,
            );
            return;
        }
        if (args[1] === 'load' && args[2].toLowerCase().endsWith('.json')) {
            const jsonPath = path.resolve(args[2]);
            if (!fs.existsSync(jsonPath)) {
                console.error(`JSON file not found: ${jsonPath}`);
                process.exit(1);
            }
            let data: Record<string, string>;
            try {
                data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            } catch {
                console.error(`Invalid JSON in file: ${jsonPath}`);
                process.exit(1);
            }
            // Clear existing data to replace with new data
            const existingKeys = Object.keys(await wiseKey.getAll());
            for (const key of existingKeys) {
                await wiseKey.delete(key);
            }
            let successCount = 0;
            for (const [key, value] of Object.entries(data)) {
                if (typeof value === 'string') {
                    await wiseKey.set(key, value);
                    successCount++;
                } else {
                    console.warn(`Skipping non-string value for key: ${key}`);
                }
            }
            console.log(
                `Successfully replaced data with ${successCount} key(s) from ${jsonPath} into service: ${serviceName}`,
            );
            return;
        }
        const envPath = args[3]
            ? path.resolve(args[3])
            : path.join(process.cwd(), '.env');
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
        console.log(
            `Successfully loaded ${successCount} key(s) from ${envPath} into service: ${serviceName}`,
        );
    } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
    }
}
main().catch(console.error);
