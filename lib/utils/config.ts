import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  // Environment settings
  environment: 'dev' | 'staging' | 'prod';
  region: string;
  
  // Storage configuration
  bucketName: string;
  enableVersioning: boolean;
  enableReplication: boolean;
  backupRegion?: string;
  
  // Knowledge Base settings
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  maxTokens: number;
  
  // OpenSearch configuration
  collectionName: string;
  indexName: string;
  vectorDimensions: number;
  
  // Security settings
  enableMfaDelete: boolean;
  enableEncryption: boolean;
  kmsKeyId?: string;
  enableVpcEndpoints: boolean;
  
  // Monitoring
  enableDetailedMonitoring: boolean;
  alertEmail?: string;
  enableCostAlerts: boolean;
  
  // Frontend configuration
  frontendDomain?: string;
  enableCustomDomain: boolean;
  certificateArn?: string;
  
  // Data processing
  enableOcr: boolean;
  enableWebScraping: boolean;
  maxDocumentSize: number; // in MB
  supportedFormats: string[];
  
  // Performance
  enableCaching: boolean;
  cacheExpirationHours: number;
  maxConcurrentIngestions: number;
}

const defaultConfig: Omit<Config, 'environment' | 'region' | 'bucketName' | 'collectionName'> = {
  // Storage defaults
  enableVersioning: true,
  enableReplication: false,
  
  // Knowledge Base defaults
  embeddingModel: 'amazon.titan-embed-text-v1',
  chunkSize: 1000,
  chunkOverlap: 200,
  maxTokens: 4096,
  
  // OpenSearch defaults
  indexName: 'rag-documents',
  vectorDimensions: 1536,
  
  // Security defaults
  enableMfaDelete: false,
  enableEncryption: true,
  enableVpcEndpoints: false,
  
  // Monitoring defaults
  enableDetailedMonitoring: true,
  enableCostAlerts: true,
  
  // Frontend defaults
  enableCustomDomain: false,
  
  // Data processing defaults
  enableOcr: true,
  enableWebScraping: false,
  maxDocumentSize: 50, // 50MB
  supportedFormats: ['pdf', 'docx', 'txt', 'md', 'html'],
  
  // Performance defaults
  enableCaching: true,
  cacheExpirationHours: 24,
  maxConcurrentIngestions: 5,
};

const environmentConfigs: Record<string, Partial<Config>> = {
  dev: {
    enableMfaDelete: false,
    enableReplication: false,
    enableDetailedMonitoring: false,
    enableCostAlerts: false,
    enableVpcEndpoints: false,
    maxConcurrentIngestions: 2,
    backupRegion: undefined,
  },
  staging: {
    enableMfaDelete: false,
    enableReplication: true,
    enableDetailedMonitoring: true,
    enableCostAlerts: true,
    enableVpcEndpoints: false,
    maxConcurrentIngestions: 3,
    backupRegion: 'us-west-2',
  },
  prod: {
    enableMfaDelete: true,
    enableReplication: true,
    enableDetailedMonitoring: true,
    enableCostAlerts: true,
    enableVpcEndpoints: true,
    maxConcurrentIngestions: 10,
    backupRegion: 'us-west-2',
  },
};

export function getConfig(environment: string, region: string = 'us-east-1'): Config {
  const env = environment as 'dev' | 'staging' | 'prod';
  
  // Validate environment
  if (!['dev', 'staging', 'prod'].includes(env)) {
    throw new Error(`Invalid environment: ${environment}. Must be one of: dev, staging, prod`);
  }
  
  // Generate resource names with environment suffix
  const bucketName = process.env.DOCUMENTS_BUCKET_NAME || `rag-demo-documents-${env}-${Date.now()}`;
  const collectionName = `rag-demo-collection-${env}`;
  
  // Merge configurations
  const config: Config = {
    ...defaultConfig,
    ...environmentConfigs[env],
    environment: env,
    region,
    bucketName,
    collectionName,
    
    // Override with environment variables
    alertEmail: process.env.ALERT_EMAIL,
    frontendDomain: process.env.FRONTEND_DOMAIN,
    certificateArn: process.env.CERTIFICATE_ARN,
    kmsKeyId: process.env.KMS_KEY_ID,
  };
  
  // Environment-specific overrides from env vars
  if (process.env.EMBEDDING_MODEL) {
    config.embeddingModel = process.env.EMBEDDING_MODEL;
  }
  
  if (process.env.CHUNK_SIZE) {
    config.chunkSize = parseInt(process.env.CHUNK_SIZE, 10);
  }
  
  if (process.env.CHUNK_OVERLAP) {
    config.chunkOverlap = parseInt(process.env.CHUNK_OVERLAP, 10);
  }
  
  if (process.env.VECTOR_DIMENSIONS) {
    config.vectorDimensions = parseInt(process.env.VECTOR_DIMENSIONS, 10);
  }
  
  // Validation
  validateConfig(config);
  
  return config;
}

function validateConfig(config: Config): void {
  // Validate chunk settings
  if (config.chunkSize <= 0) {
    throw new Error('Chunk size must be positive');
  }
  
  if (config.chunkOverlap < 0 || config.chunkOverlap >= config.chunkSize) {
    throw new Error('Chunk overlap must be non-negative and less than chunk size');
  }
  
  // Validate vector dimensions
  if (config.vectorDimensions <= 0) {
    throw new Error('Vector dimensions must be positive');
  }
  
  // Validate model compatibility
  const modelDimensions: Record<string, number> = {
    'amazon.titan-embed-text-v1': 1536,
    'cohere.embed-english-v3': 1024,
    'cohere.embed-multilingual-v3': 1024,
  };
  
  if (modelDimensions[config.embeddingModel] && 
      modelDimensions[config.embeddingModel] !== config.vectorDimensions) {
    throw new Error(`Vector dimensions ${config.vectorDimensions} don't match model ${config.embeddingModel} dimensions ${modelDimensions[config.embeddingModel]}`);
  }
  
  // Validate backup region for replication
  if (config.enableReplication && !config.backupRegion) {
    throw new Error('Backup region must be specified when replication is enabled');
  }
  
  if (config.enableReplication && config.backupRegion === config.region) {
    throw new Error('Backup region must be different from primary region');
  }
  
  // Validate document size
  if (config.maxDocumentSize <= 0 || config.maxDocumentSize > 1000) {
    throw new Error('Max document size must be between 0 and 1000 MB');
  }
}

export function getParameterStorePath(config: Config, key: string): string {
  return `/rag-demo/${config.environment}/${key}`;
}

export function getResourceName(config: Config, resourceType: string): string {
  return `rag-demo-${resourceType}-${config.environment}`;
} 