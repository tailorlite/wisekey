declare module 'promappjs' {
  export interface AppOptions {
    name: string;
    version: string;
  }

  export interface Command {
    description(desc: string): this;
    action(fn: (...args: any[]) => Promise<void> | void): this;
    option(flags: string, description: string): this;
  }

  export interface Storage {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
  }

  export interface App {
    command(nameAndArgs: string): Command;
    before(fn: (command: any, args: string[], options: any) => Promise<void> | void): void;
    start(args?: string[]): Promise<void>;
    data(): Storage;
  }

  export interface ShellOptions {
    name: string;
    prompt: string;
    delimiter: string;
  }

  export interface Shell {
    onLine(fn: (line: string) => Promise<void> | void): void;
    start(): void;
  }

  export function app(options: AppOptions): App;
  export function shell(options: ShellOptions): Shell;
  export function input(message: string): Promise<string>;
}
