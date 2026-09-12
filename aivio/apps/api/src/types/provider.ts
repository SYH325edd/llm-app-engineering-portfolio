export interface ProviderConfig {
  key: string;
  displayName: string;
  adapter: string;
  baseUrl: string;
  apiKeyEnvName: string;
  enabled: boolean;
}

export interface ProvidersFile {
  providers: ProviderConfig[];
}

export interface PublicProvider {
  provider: string;
  displayName: string;
  enabled: boolean;
  models: Array<{
    id: string;
    displayName: string;
    modelType: string;
    inputType: string;
    outputType: string;
  }>;
  capabilities: string[];
}
