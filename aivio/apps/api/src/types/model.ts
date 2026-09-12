export interface ModelConfig {
  id: string;
  displayName: string;
  provider: string;
  modelType: string;
  inputType: string;
  outputType: string;
  price: number;
  enabled: boolean;
  defaultParams?: Record<string, unknown>;
}

export interface ModelsFile {
  models: ModelConfig[];
}
