export interface ReleasePluginOptions {
  revision: string;
  version: string;
}

export function releasePlugin(options: ReleasePluginOptions): import('vite').Plugin;
