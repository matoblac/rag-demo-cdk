"""
Configuration Loader
Loads configuration from AWS SSM Parameter Store and environment variables
"""

import os
import json
import boto3
import logging
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class ConfigLoader:
    """Load configuration from various sources"""

    def __init__(self):
        self.ssm_client = boto3.client("ssm")
        self.region = os.environ.get("REGION", "us-east-1")
        self.environment = os.environ.get("ENVIRONMENT", "dev")

    def load_config(self) -> Dict[str, Any]:
        """Load complete configuration from all sources"""
        config = {}

        # Load from environment variables first
        config.update(self._load_from_env())

        # Load from SSM Parameter Store
        try:
            ssm_config = self._load_from_ssm()
            config.update(ssm_config)
        except Exception as e:
            logger.warning(f"Failed to load SSM config: {e}")
            # Continue with env vars only

        # Validate required fields
        self._validate_config(config)

        return config

    def _load_from_env(self) -> Dict[str, Any]:
        """Load configuration from environment variables"""
        return {
            "knowledgeBaseId": os.environ.get("KNOWLEDGE_BASE_ID"),
            "collectionEndpoint": os.environ.get("COLLECTION_ENDPOINT"),
            "documentsBucket": os.environ.get("DOCUMENTS_BUCKET"),
            "region": self.region,
            "environment": self.environment,
            "embeddingModel": os.environ.get(
                "EMBEDDING_MODEL", "amazon.titan-embed-text-v2:0"
            ),
            "indexName": os.environ.get("INDEX_NAME", "rag-documents"),
            "vectorDimensions": int(os.environ.get("VECTOR_DIMENSIONS", "1024")),
            "chunkSize": int(os.environ.get("CHUNK_SIZE", "1000")),
            "chunkOverlap": int(os.environ.get("CHUNK_OVERLAP", "200")),
            "maxDocumentSize": int(os.environ.get("MAX_DOCUMENT_SIZE", "50")),
            "supportedFormats": json.loads(
                os.environ.get("SUPPORTED_FORMATS", '["pdf", "docx", "txt", "md"]')
            ),
            "enableOcr": os.environ.get("ENABLE_OCR", "true").lower() == "true",
            "enableWebScraping": os.environ.get("ENABLE_WEB_SCRAPING", "false").lower()
            == "true",
        }

    def _load_from_ssm(self) -> Dict[str, Any]:
        """Load configuration from SSM Parameter Store"""
        try:
            # Get the main frontend config parameter
            parameter_name = f"/rag-demo/{self.environment}/frontend-config"

            response = self.ssm_client.get_parameter(
                Name=parameter_name, WithDecryption=True
            )

            config = json.loads(response["Parameter"]["Value"])
            logger.info(f"Loaded configuration from SSM: {parameter_name}")

            return config

        except ClientError as e:
            if e.response["Error"]["Code"] == "ParameterNotFound":
                logger.warning(f"SSM parameter not found: {parameter_name}")
                return self._load_individual_ssm_parameters()
            else:
                raise

    def _load_individual_ssm_parameters(self) -> Dict[str, Any]:
        """Load individual SSM parameters as fallback"""
        parameters = {
            "knowledgeBaseId": f"/rag-demo/{self.environment}/frontend-knowledge-base-id",
            "collectionEndpoint": f"/rag-demo/{self.environment}/frontend-collection-endpoint",
            "documentsBucket": f"/rag-demo/{self.environment}/documents-bucket-name",
            "region": f"/rag-demo/{self.environment}/frontend-region",
        }

        config = {}

        for key, param_name in parameters.items():
            try:
                response = self.ssm_client.get_parameter(
                    Name=param_name, WithDecryption=True
                )
                config[key] = response["Parameter"]["Value"]
                logger.debug(f"Loaded {key} from SSM")

            except ClientError as e:
                if e.response["Error"]["Code"] == "ParameterNotFound":
                    logger.warning(f"SSM parameter not found: {param_name}")
                else:
                    logger.error(f"Error loading {param_name}: {e}")

        return config

    def _validate_config(self, config: Dict[str, Any]) -> None:
        """Validate that required configuration is present"""
        # Apply defaults for local development
        self._apply_development_defaults(config)

        required_fields = [
            "knowledgeBaseId",
            "region",
            "environment",
        ]

        missing_fields = []
        for field in required_fields:
            if not config.get(field):
                missing_fields.append(field)

        if missing_fields:
            raise ValueError(f"Missing required configuration fields: {missing_fields}")

    def _apply_development_defaults(self, config: Dict[str, Any]) -> None:
        """Apply default values for local development when infrastructure isn't deployed"""

        # Check if we're in local development mode (no Knowledge Base ID provided)
        is_local_dev = not config.get("knowledgeBaseId") and not os.environ.get(
            "AWS_LAMBDA_FUNCTION_NAME"
        )

        if is_local_dev:
            logger.warning("🛠️  Local development mode detected - using default values")
            logger.warning(
                "⚠️  Deploy infrastructure first for full functionality: ./scripts/deploy.sh dev"
            )

            # Set development defaults
            if not config.get("knowledgeBaseId"):
                config["knowledgeBaseId"] = "local-dev-placeholder-kb-id"
                logger.warning(
                    "📋 Using placeholder Knowledge Base ID for local development"
                )

            if not config.get("documentsBucket"):
                config["documentsBucket"] = "local-dev-placeholder-bucket"
                logger.warning("📁 Using placeholder S3 bucket for local development")

            if not config.get("collectionEndpoint"):
                config["collectionEndpoint"] = (
                    "https://local-dev-placeholder.us-east-1.aoss.amazonaws.com"
                )
                logger.warning(
                    "🔍 Using placeholder OpenSearch endpoint for local development"
                )

        # Validate data types
        try:
            config["vectorDimensions"] = int(config.get("vectorDimensions", 1024))
            config["chunkSize"] = int(config.get("chunkSize", 1000))
            config["chunkOverlap"] = int(config.get("chunkOverlap", 200))
            config["maxDocumentSize"] = int(config.get("maxDocumentSize", 50))
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid configuration data types: {e}")
            # Set defaults
            config.update(
                {
                    "vectorDimensions": 1024,
                    "chunkSize": 1000,
                    "chunkOverlap": 200,
                    "maxDocumentSize": 50,
                }
            )

        # Ensure lists are properly formatted
        if isinstance(config.get("supportedFormats"), str):
            try:
                config["supportedFormats"] = json.loads(config["supportedFormats"])
            except json.JSONDecodeError:
                config["supportedFormats"] = ["pdf", "docx", "txt", "md"]

        if not isinstance(config.get("supportedFormats"), list):
            config["supportedFormats"] = ["pdf", "docx", "txt", "md"]

    def get_aws_credentials_info(self) -> Dict[str, str]:
        """Get information about AWS credentials being used"""
        try:
            sts_client = boto3.client("sts")
            identity = sts_client.get_caller_identity()

            return {
                "account": identity.get("Account", "Unknown"),
                "arn": identity.get("Arn", "Unknown"),
                "user_id": identity.get("UserId", "Unknown"),
            }
        except Exception as e:
            logger.error(f"Error getting AWS credentials info: {e}")
            return {
                "account": "Unknown",
                "arn": "Unknown",
                "user_id": "Unknown",
            }

    def refresh_config(self) -> Dict[str, Any]:
        """Refresh configuration by reloading from sources"""
        logger.info("Refreshing configuration...")
        return self.load_config()

    def get_deployment_info(self) -> Dict[str, Any]:
        """Get deployment information"""
        try:
            # Try to get CloudFormation stack info
            cf_client = boto3.client("cloudformation")

            # Look for infrastructure stack
            stack_name = f"RagDemoInfrastructureStack-{self.environment}"

            try:
                response = cf_client.describe_stacks(StackName=stack_name)
                stack = response["Stacks"][0]

                return {
                    "stackName": stack_name,
                    "stackStatus": stack["StackStatus"],
                    "creationTime": stack.get("CreationTime"),
                    "lastUpdatedTime": stack.get("LastUpdatedTime"),
                    "outputs": {
                        output["OutputKey"]: output["OutputValue"]
                        for output in stack.get("Outputs", [])
                    },
                }
            except ClientError:
                logger.warning(f"Stack {stack_name} not found")
                return {"stackName": stack_name, "stackStatus": "NOT_FOUND"}

        except Exception as e:
            logger.error(f"Error getting deployment info: {e}")
            return {"error": str(e)}

    def test_aws_connectivity(self) -> Dict[str, bool]:
        """Test connectivity to required AWS services"""
        services = {}

        # Test STS (credentials)
        try:
            sts_client = boto3.client("sts")
            sts_client.get_caller_identity()
            services["sts"] = True
        except Exception:
            services["sts"] = False

        # Test SSM
        try:
            ssm_client = boto3.client("ssm")
            ssm_client.describe_parameters(MaxResults=1)
            services["ssm"] = True
        except Exception:
            services["ssm"] = False

        # Test S3
        try:
            s3_client = boto3.client("s3")
            s3_client.list_buckets()
            services["s3"] = True
        except Exception:
            services["s3"] = False

        # Test Bedrock
        try:
            bedrock_client = boto3.client("bedrock")
            bedrock_client.list_foundation_models()
            services["bedrock"] = True
        except Exception:
            services["bedrock"] = False

        return services
