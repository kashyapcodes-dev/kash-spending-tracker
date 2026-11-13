export interface VitestBaseConfig {
  test: {
    environment: 'node';
    include: string[];
  };
}

declare const config: VitestBaseConfig;
export default config;
